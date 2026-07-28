// fetch-eateries: host-only. Reads the session's lat/lng/radius/filters,
// calls Google Places API (New) Nearby Search once, writes ~20 eateries
// rows with deck positions, then flips the session to 'swiping'.
// The Places API key never leaves this function.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.photos",
  "places.googleMapsUri",
  // Hours are always requested, not just when the open_now filter is on: the
  // cards flag "hours unknown" and "closes 9:00pm" either way, and the fields
  // are free at this SKU (see below).
  "places.currentOpeningHours.openNow",
  "places.currentOpeningHours.nextCloseTime",
  "places.regularOpeningHours.openNow",
].join(",");
// NOTE: rating/userRatingCount/priceLevel/photos put this call in the
// Enterprise SKU. Do not add fields without checking the pricing table.
// (types and the opening-hours fields are Pro-tier, so they cost nothing on
// top of Enterprise. See docs/COSTS.md.)

const MIN_RATING_COUNT = 15; // below this, ratings are noise
const MAX_DECK_SIZE = 20;
// Below this the deck is too thin to be worth swiping. We do not start the
// session; the host is offered a wider radius instead.
const MIN_DECK_SIZE = 8;

// distance in metres between two lat/lng points (haversine)
function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Google's priceLevel enum -> int 1..4 (null when unknown).
// FREE maps to 1, not 0: the UI renders "$" x n and zero dollar signs
// reads as a rendering bug.
const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 1,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const toPriceLevel = (v?: string) =>
  v && PRICE_LEVEL_MAP[v] ? PRICE_LEVEL_MAP[v] : null;

// currentOpeningHours accounts for holidays and special days; regularOpeningHours
// is the fallback when Google has no current-hours record. null means Google has
// no hours at all for the place — a large share of Singapore F&B (hawker stalls,
// coffeeshop units, small tenants). Never guess "closed" from missing data.
const toOpenNow = (p: any): boolean | null =>
  p.currentOpeningHours?.openNow ?? p.regularOpeningHours?.openNow ?? null;

// RFC3339, only ever present on currentOpeningHours.
const toClosesAt = (p: any): string | null =>
  p.currentOpeningHours?.nextCloseTime ?? null;

// "chinese_restaurant" -> "Chinese Restaurant"
const prettifyType = (t?: string) =>
  t
    ? t
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : null;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const { session_id } = await req.json().catch(() => ({}));
  if (!session_id) return jsonResponse(400, { error: "MISSING_SESSION_ID" });

  // Caller identity comes from their JWT; writes go through the service
  // role client because eateries/sessions have no client write policies.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: "NOT_AUTHENTICATED" });
  }

  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .select("*")
    .eq("id", session_id)
    .maybeSingle();
  if (sessionError) return jsonResponse(500, { error: "SESSION_LOOKUP_FAILED" });
  if (!session) return jsonResponse(404, { error: "SESSION_NOT_FOUND" });
  if (session.host_id !== userData.user.id) {
    return jsonResponse(403, { error: "NOT_HOST" });
  }
  if (session.status !== "lobby") {
    return jsonResponse(400, { error: "ALREADY_STARTED" });
  }
  if (session.lat == null || session.lng == null) {
    return jsonResponse(400, { error: "NO_LOCATION" });
  }

  const startSwiping = async (eateryCount: number) => {
    const { error } = await admin
      .from("sessions")
      .update({ eatery_count: eateryCount, status: "swiping" })
      .eq("id", session_id);
    if (error) return jsonResponse(500, { error: "SESSION_UPDATE_FAILED" });
    return jsonResponse(200, { ok: true, eatery_count: eateryCount });
  };

  // Idempotency: a double tap must not double-bill. If the deck already
  // exists, skip the Places call and just flip the status.
  const { count: existing, error: countError } = await admin
    .from("eateries")
    .select("*", { count: "exact", head: true })
    .eq("session_id", session_id);
  if (countError) return jsonResponse(500, { error: "EATERY_LOOKUP_FAILED" });
  if (existing && existing > 0) return startSwiping(existing);

  const filters = session.filters ?? {};
  const openNowFilter = filters.open_now !== false; // defaults on

  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": Deno.env.get("GOOGLE_PLACES_API_KEY")!,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ["restaurant", "cafe", "meal_takeaway"],
      // Hotels (their restaurants get tagged lodging) and malls/markets kept
      // showing up as pins; excludedTypes takes precedence over included.
      excludedTypes: [
        "lodging",
        "hotel",
        "shopping_mall",
        "supermarket",
        "grocery_store",
      ],
      maxResultCount: 20,
      // DISTANCE surfaces the individual eateries inside nearby malls that
      // POPULARITY buried under big-name places further away.
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: { latitude: session.lat, longitude: session.lng },
          radius: session.radius_m,
        },
      },
    }),
  });
  if (!res.ok) {
    console.error("Places API error", res.status, await res.text());
    return jsonResponse(502, { error: "PLACES_API_ERROR" });
  }

  const { places = [] } = await res.json();
  // Belt and braces on top of excludedTypes: Google still occasionally
  // returns hotel/mall pins whose primary type matched includedTypes.
  const BANNED_TYPES = ["lodging", "shopping_mall"];
  const candidates = places
    .filter(
      (p: any) => !p.types?.some((t: string) => BANNED_TYPES.includes(t))
    )
    .filter((p: any) => (p.userRatingCount ?? 0) >= MIN_RATING_COUNT);

  // Nearby Search (New) has no openNow request parameter (Text Search does),
  // so the filter is applied here over the hours fields in the mask.
  //
  // false -> dropped. true -> kept. null -> KEPT, and flagged in the UI as
  // "hours unknown". Dropping unknowns would gut the deck and remove exactly
  // the places people actually eat at. "Closing soon" is kept and flagged too:
  // whether there is time to walk over and eat is the group's call, not ours.
  const closedDropped = openNowFilter
    ? candidates.filter((p: any) => toOpenNow(p) === false).length
    : 0;

  const rows = candidates
    .filter((p: any) => !openNowFilter || toOpenNow(p) !== false)
    .slice(0, MAX_DECK_SIZE)
    .map((p: any, i: number) => ({
      session_id,
      place_id: p.id,
      name: p.displayName?.text ?? "Unknown",
      cuisine: p.primaryTypeDisplayName?.text ?? prettifyType(p.types?.[0]),
      price_level: toPriceLevel(p.priceLevel),
      rating: p.rating ?? null,
      distance_m: distanceMeters(
        session.lat, session.lng,
        p.location.latitude, p.location.longitude
      ),
      address: p.formattedAddress ?? null,
      photo_ref: p.photos?.[0]?.name ?? null,
      open_now: toOpenNow(p),
      closes_at: toClosesAt(p),
      lat: p.location.latitude,
      lng: p.location.longitude,
      maps_uri: p.googleMapsUri ?? null,
      position: i + 1, // deck order must be identical for every participant
    }));

  if (rows.length === 0) {
    // Do NOT start the session; the client shows "widen the radius".
    return jsonResponse(404, { error: "NO_EATERIES_FOUND" });
  }

  const { error: insertError } = await admin.from("eateries").insert(rows);
  if (insertError) {
    // 23505 = unique(session_id, position): a concurrent invocation seeded
    // the deck between our existence check and this insert. Use theirs.
    if (insertError.code === "23505") {
      const { count } = await admin
        .from("eateries")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session_id);
      return startSwiping(count ?? rows.length);
    }
    console.error("Eatery insert failed", insertError);
    return jsonResponse(500, { error: "EATERY_INSERT_FAILED" });
  }

  // Too few to swipe on: hold the session in the lobby and let the host decide
  // between a wider radius and starting anyway. The deck is already written, so
  // "start anyway" is the idempotent path above — it costs no second Places
  // call, and a redeal wipes these rows before dealing again.
  if (rows.length < MIN_DECK_SIZE) {
    return jsonResponse(200, {
      ok: false,
      thin_deck: true,
      eatery_count: rows.length,
      closed_dropped: closedDropped,
      open_now: openNowFilter,
    });
  }

  return startSwiping(rows.length);
});
