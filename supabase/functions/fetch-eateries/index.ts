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
].join(",");
// NOTE: rating/userRatingCount/priceLevel/photos put this call in the
// Enterprise SKU. Do not add fields without checking the pricing table.
// (types is a Pro-tier field; currentOpeningHours, added below only when
// the open_now filter is set, is Enterprise-tier — neither raises the
// call's SKU beyond Enterprise. See docs/COSTS.md.)

const MIN_RATING_COUNT = 15; // below this, ratings are noise
const MAX_DECK_SIZE = 20;

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
  const openNow = filters.open_now === true;
  // currentOpeningHours is only requested when the filter needs it.
  const fieldMask = openNow
    ? `${FIELD_MASK},places.currentOpeningHours.openNow`
    : FIELD_MASK;

  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": Deno.env.get("GOOGLE_PLACES_API_KEY")!,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      excludedTypes: ["fast_food_restaurant"], // optional, tune later
      maxResultCount: 20,
      rankPreference: "POPULARITY",
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
  const rows = places
    .filter((p: any) => (p.userRatingCount ?? 0) >= MIN_RATING_COUNT)
    .filter((p: any) => !openNow || p.currentOpeningHours?.openNow !== false)
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

  return startSwiping(rows.length);
});
