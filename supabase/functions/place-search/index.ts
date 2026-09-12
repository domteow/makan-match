// place-search: the host names a place, we turn it into a lat/lng.
//
// Two actions behind one function, so Phase 7 adds a single deployment:
//
//   { action: "autocomplete", query }  -> [{ place_id, primary_text, secondary_text }]
//   { action: "resolve", place_id }    -> { place_id, name, address, lat, lng }
//
// Both are Places Essentials SKUs and the Places key never leaves this
// function. Autocomplete is billed per request, so the client's 350ms debounce
// and 3-character minimum are the cost control — this function is the backstop,
// not the control: it rejects anything too short to be a real search before a
// single cent is spent.
//
// No session tokens, deliberately. A token only reduces cost above 12
// autocomplete requests per search; with the client's debounce we average 3-4,
// and below 12 requests bill identically with or without one. See docs/COSTS.md.
//
// Runs with verify_jwt = true (unlike place-photo): it is called through
// supabase.functions.invoke from app code, so the JWT rides along normally, and
// leaving it gated is what stops the autocomplete endpoint being used as a free
// Google proxy.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Essentials tier, and nothing beyond it. Adding ANY other field
// (rating, photos, opening hours…) lifts this call to a higher SKU for a
// lat/lng we could already resolve — see docs/COSTS.md before touching it.
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location";

// Singapore-only, biased at the city centre. Region code keeps the predictions
// honest ("Jewel" is a mall here and a jeweller almost everywhere else); the
// bias radius covers the whole island with room to spare.
const REGION_CODES = ["sg"];
const BIAS_CENTER = { latitude: 1.3521, longitude: 103.8198 };
const BIAS_RADIUS_M = 25000;

// Six fits on a phone without scrolling, and a host who needs a seventh
// suggestion should type another character instead.
const MAX_PREDICTIONS = 6;

// Below 3 characters predictions are noise; above 120 it is not a place name.
// Rejected before the Google call, not after.
const MIN_QUERY = 3;
const MAX_QUERY = 120;

// Google place ids are base64url-ish. Strict allowlist: this value is
// interpolated into a Google URL path.
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// Same 30-day window as the photo and summary caches, for the same compliance
// reason: Google Maps Platform terms let us keep place_id indefinitely and
// other place content not at all. An older row is treated as absent.
const TTL_MS = 30 * 86_400_000;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

// Places wraps prose in LocalizedText ({ text, languageCode }).
const localized = (v?: any): string | null => v?.text?.trim() || null;

async function autocomplete(query: string) {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": Deno.env.get("GOOGLE_PLACES_API_KEY")!,
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: REGION_CODES,
      locationBias: {
        circle: { center: BIAS_CENTER, radius: BIAS_RADIUS_M },
      },
    }),
  });
  if (!res.ok) {
    console.error("Autocomplete failed", res.status, await res.text());
    return jsonResponse(502, { error: "PLACES_API_ERROR" });
  }

  const { suggestions = [] } = await res.json();
  // Trimmed to what the list renders. Google also returns queryPredictions
  // (free-text searches with no place behind them); those have no placeId and
  // nothing to resolve, so they are dropped rather than shown as dead rows.
  const predictions = suggestions
    .map((s: any) => s.placePrediction)
    .filter((p: any) => p?.placeId)
    .slice(0, MAX_PREDICTIONS)
    .map((p: any) => ({
      place_id: p.placeId,
      primary_text:
        localized(p.structuredFormat?.mainText) ?? localized(p.text) ?? "",
      secondary_text: localized(p.structuredFormat?.secondaryText),
    }));

  return jsonResponse(200, { predictions });
}

async function resolve(admin: any, placeId: string) {
  // Cache hit inside the TTL: no Google call at all. Mall and landmark names
  // repeat heavily across sessions, so this is the common path in practice.
  const { data: cached, error: cacheError } = await admin
    .from("place_locations")
    .select("place_id, name, address, lat, lng")
    .eq("place_id", placeId)
    .gt("resolved_at", new Date(Date.now() - TTL_MS).toISOString())
    .maybeSingle();
  // A failed lookup means one extra Place Details call, which is a far better
  // outcome than failing the host's search.
  if (cacheError) console.error("Location cache lookup failed", cacheError);
  if (cached) return jsonResponse(200, cached);

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": Deno.env.get("GOOGLE_PLACES_API_KEY")!,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    }
  );
  if (!res.ok) {
    console.error("Place details failed", res.status, await res.text());
    return jsonResponse(res.status === 404 ? 404 : 502, {
      error: res.status === 404 ? "PLACE_NOT_FOUND" : "PLACES_API_ERROR",
    });
  }

  const place = await res.json();
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const name = localized(place.displayName) ?? place.formattedAddress ?? null;
  // Without coordinates there is no deck to build, and without a name there is
  // nothing to show the group. Either missing makes the prediction unusable.
  if (typeof lat !== "number" || typeof lng !== "number" || !name) {
    return jsonResponse(404, { error: "PLACE_NOT_FOUND" });
  }

  const row = {
    place_id: place.id ?? placeId,
    name,
    address: place.formattedAddress ?? null,
    lat,
    lng,
  };

  // upsert, so a row past its TTL is overwritten and its timestamp reset —
  // which is what makes a refreshed location count as fresh again.
  const { error: upsertError } = await admin
    .from("place_locations")
    .upsert({ ...row, resolved_at: new Date().toISOString() });
  // Non-fatal: the host gets their location either way, we just pay for the
  // next resolve of this place.
  if (upsertError) console.error("Location cache write failed", upsertError);

  return jsonResponse(200, row);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const body = await req.json().catch(() => ({}));
  const { action } = body;

  // verify_jwt already rejected unsigned callers, but it accepts the bare anon
  // key as well as a user token. Requiring a real signed-in user is what keeps
  // this from being a free Google proxy for anyone holding the public key.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse(401, { error: "NOT_AUTHENTICATED" });
  }

  if (action === "autocomplete") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < MIN_QUERY || query.length > MAX_QUERY) {
      return jsonResponse(400, { error: "BAD_QUERY" });
    }
    return autocomplete(query);
  }

  if (action === "resolve") {
    const placeId = typeof body.place_id === "string" ? body.place_id : "";
    if (!placeId || !PLACE_ID_PATTERN.test(placeId)) {
      return jsonResponse(400, { error: "BAD_PLACE_ID" });
    }
    // The cache table is service-role only (no RLS policies at all), so the
    // read-through goes through the admin client.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    return resolve(admin, placeId);
  }

  return jsonResponse(400, { error: "BAD_ACTION" });
});
