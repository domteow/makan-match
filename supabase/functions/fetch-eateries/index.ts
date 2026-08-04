// fetch-eateries: host-only. Reads the session's lat/lng/radius/filters,
// calls Google Places API (New) Nearby Search once, summarises the survivors in
// one batched Anthropic call, writes them all as eateries rows in shuffled deck
// order, then flips the session to 'swiping'. Neither the Places key nor the
// Anthropic key ever leaves this function.
//
// We always ask Places for the maximum 20 results, whatever the host's chosen
// deck_size. Places bills per call, not per result, so asking for 10 costs the
// same as asking for 20 — and the rows past deck_size become free reserve that
// reshuffle_deck can draw on without a second call. Clients only ever see
// position <= sessions.eatery_count (enforced in get_session_state).

import { createClient } from "npm:@supabase/supabase-js@2";
import { summariesFor, type Summary } from "./summaries.ts";

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
  // ---- Phase 6: what the food actually is ----
  // EVERYTHING FROM HERE DOWN IS A SKU CHANGE. The generative summaries, the
  // review summary and every serves*/dineIn/takeout/goodForGroups attribute are
  // Enterprise + ATMOSPHERE fields, one tier above the Enterprise SKU the rest
  // of this mask sits in. A request bills at the SKU of its most expensive
  // field, so this whole block moves together:
  //   - adding MORE atmosphere fields from here costs nothing extra;
  //   - removing SOME of them saves nothing;
  //   - removing ALL of them drops the call back to Enterprise.
  // priceRange and websiteUri are NOT atmosphere fields — they are Enterprise,
  // and would be free even without the block below. See docs/COSTS.md.
  // Google returns neither summary for Singapore places today (verified
  // against Place Details: only displayName comes back). They stay in the mask
  // anyway — they cost nothing extra at this SKU, and if Google ever extends
  // coverage here we prefer their summary over ours. Not dead code: read the
  // preference rule where the rows are built.
  "places.generativeSummary.overview",
  "places.generativeSummary.description",
  "places.generativeSummary.disclosureText",
  "places.reviewSummary.text",
  "places.reviewSummary.reviewsUri",
  "places.reviewSummary.disclosureText",
  // Phase 6b: raw reviews ARE returned for Singapore, and are what we write our
  // own summaries from (see summaries.ts). Also Enterprise + Atmosphere, so
  // it joins the block above for free. The review text itself is never stored.
  "places.reviews",
  "places.priceRange",
  "places.websiteUri",
  "places.servesVegetarianFood",
  "places.servesBreakfast",
  "places.servesLunch",
  "places.servesDinner",
  "places.dineIn",
  "places.takeout",
  "places.goodForGroups",
].join(",");
// NOTE: rating/userRatingCount/priceLevel/photos put this call in the
// Enterprise SKU; the Phase 6 block above lifts it to Enterprise + Atmosphere.
// Do not add fields without checking the pricing table.
// (types and the opening-hours fields are Pro-tier, so they cost nothing on
// top of Enterprise. See docs/COSTS.md.)

const MIN_RATING_COUNT = 15; // below this, ratings are noise
// Places' own ceiling for one Nearby Search, and therefore the most rows we
// can ever store for a session. Not a deck size — see deckSizeFor below.
const MAX_STORED_EATERIES = 20;
// Below this the deck is too thin to be worth swiping. We do not start the
// session; the host is offered a wider radius instead. Compared against the
// deck the host will actually see, capped by what they asked for: a host who
// picked a 5-card deck and got 5 has exactly what they wanted.
const MIN_DECK_SIZE = 8;
const DEFAULT_DECK_SIZE = 15;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(n, hi));

const deckSizeFor = (session: any) =>
  clamp(session.deck_size ?? DEFAULT_DECK_SIZE, 5, MAX_STORED_EATERIES);

// Fisher-Yates, in place. Deliberately not `sort(() => Math.random() - 0.5)`:
// a random comparator is inconsistent, so the resulting distribution is biased
// and engine-dependent — which shows up as the same handful of places leading
// the deck session after session.
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

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

// Places wraps most prose in LocalizedText ({ text, languageCode }). Summaries
// nest it twice: reviewSummary.text is a LocalizedText, so the string is at
// reviewSummary.text.text.
const localized = (v?: any): string | null => v?.text?.trim() || null;

// Symbols for the currencies this app plausibly sees. Anything else falls back
// to the ISO code, which is ugly but never wrong.
const CURRENCY_SYMBOLS: Record<string, string> = {
  SGD: "S$",
  MYR: "RM",
  USD: "US$",
  AUD: "A$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  THB: "฿",
  IDR: "Rp",
};
const currencySymbol = (code?: string) =>
  code ? CURRENCY_SYMBOLS[code] ?? `${code} ` : "";

// Money.units is an int64 and therefore arrives as a STRING. Nanos are ignored:
// these are rough per-person ranges, and "S$10–20" is the whole point of
// preferring this over "$$".
const moneyUnits = (m?: any): number | null => {
  const n = m?.units == null ? NaN : Number(m.units);
  return Number.isFinite(n) ? n : null;
};

// { startPrice, endPrice } -> "S$10–20". Either end can be missing.
function formatPriceRange(range?: any): string | null {
  if (!range) return null;
  const lo = moneyUnits(range.startPrice);
  const hi = moneyUnits(range.endPrice);
  const symbol = currencySymbol(
    range.startPrice?.currencyCode ?? range.endPrice?.currencyCode
  );
  if (lo != null && hi != null) return `${symbol}${lo}–${hi}`; // en dash
  if (lo != null) return `${symbol}${lo}+`;
  if (hi != null) return `under ${symbol}${hi}`;
  return null;
}

// currentOpeningHours accounts for holidays and special days; regularOpeningHours
// is the fallback when Google has no current-hours record. null means Google has
// no hours at all for the place — a large share of Singapore F&B (hawker stalls,
// coffeeshop units, small tenants). Never guess "closed" from missing data.
const toOpenNow = (p: any): boolean | null =>
  p.currentOpeningHours?.openNow ?? p.regularOpeningHours?.openNow ?? null;

// RFC3339, only ever present on currentOpeningHours.
const toClosesAt = (p: any): string | null =>
  p.currentOpeningHours?.nextCloseTime ?? null;

// Which summary ends up on the card. Google's generative summary wins whenever
// it exists: it is the one that carries a mandated disclosure string, and
// preferring it keeps that attribution attached to the text it belongs to. It
// exists for approximately nothing in Singapore, which is why Phase 6b writes
// our own — those carry no Google disclosure, because Google did not write
// them. The UI credits "Based on Google reviews" for ours instead.
//
// All-or-nothing per place, never a mix: Google's one-liner over our paragraph
// would make the attribution ambiguous for both.
function summaryColumns(p: any, ours?: Summary) {
  const overview = localized(p.generativeSummary?.overview);
  const description = localized(p.generativeSummary?.description);
  if (overview || description) {
    return {
      summary_overview: overview,
      summary_description: description,
      // Stored, not hardcoded, so Google rewording "Summarized with Gemini"
      // flows through without a deploy.
      summary_disclosure: localized(p.generativeSummary?.disclosureText),
    };
  }
  return {
    summary_overview: ours?.overview ?? null,
    summary_description: ours?.detail ?? null,
    summary_disclosure: null,
  };
}

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

  const deckSize = deckSizeFor(session);

  const startSwiping = async (eateryCount: number) => {
    const { error } = await admin
      .from("sessions")
      .update({ eatery_count: eateryCount, status: "swiping" })
      .eq("id", session_id);
    if (error) return jsonResponse(500, { error: "SESSION_UPDATE_FAILED" });
    return jsonResponse(200, { ok: true, eatery_count: eateryCount });
  };

  // Idempotency: a double tap must not double-bill. If the deck already
  // exists, skip the Places call and just flip the status. `stored` counts the
  // reserve too, so the deck is still capped at what the host asked for.
  const { count: stored, error: countError } = await admin
    .from("eateries")
    .select("*", { count: "exact", head: true })
    .eq("session_id", session_id);
  if (countError) return jsonResponse(500, { error: "EATERY_LOOKUP_FAILED" });
  if (stored && stored > 0) return startSwiping(Math.min(deckSize, stored));

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

  // Shuffle here, once, and store the result as `position`. Every participant
  // reads that same column, so the deck order is identical for the whole
  // session — never shuffled per person (see 0006_deck_options.sql).
  const survivors = shuffle(
    candidates.filter((p: any) => !openNowFilter || toOpenNow(p) !== false)
  );

  const deck = survivors.slice(0, MAX_STORED_EATERIES);

  if (deck.length === 0) {
    // Do NOT start the session; the client shows "widen the radius". Checked
    // before summarisation so a dead search never spends an Anthropic call.
    return jsonResponse(404, { error: "NO_EATERIES_FOUND" });
  }

  // One batched call for every place in the deck that is not already cached,
  // reserve rows included — reshuffle_deck can promote those into the deck
  // later, and summarising them now costs one line in the same request rather
  // than a second call then. Never throws: if this fails the deck is dealt with
  // blank summary lines (see summaries.ts).
  const summaries = await summariesFor(admin, deck);

  const rows = deck
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
      // Phase 6 detail. Every one of these is allowed to be null and the UI
      // omits the section entirely when it is.
      ...summaryColumns(p, summaries.get(p.id)),
      review_summary: localized(p.reviewSummary?.text),
      review_summary_uri: p.reviewSummary?.reviewsUri ?? null,
      review_summary_disclosure: localized(p.reviewSummary?.disclosureText),
      price_range_text: formatPriceRange(p.priceRange),
      website_uri: p.websiteUri ?? null,
      attributes: {
        vegetarian: p.servesVegetarianFood ?? null,
        breakfast: p.servesBreakfast ?? null,
        lunch: p.servesLunch ?? null,
        dinner: p.servesDinner ?? null,
        dine_in: p.dineIn ?? null,
        takeout: p.takeout ?? null,
        groups: p.goodForGroups ?? null,
      },
      // Includes photo_ref above at index 0, so the carousel's first frame is
      // already in the browser cache from the card. Capped at 5: the detail
      // sheet only ever fetches 2-5, and only when it is actually opened.
      photo_refs: (p.photos ?? [])
        .slice(0, 5)
        .map((ph: any) => ph.name)
        .filter(Boolean),
      // Shuffled order, assigned once for the session. Positions above
      // eatery_count are reserve: stored, never served, free to shuffle in.
      position: i + 1,
    }));

  const { error: insertError } = await admin.from("eateries").insert(rows);
  if (insertError) {
    // 23505 = unique(session_id, position): a concurrent invocation seeded
    // the deck between our existence check and this insert. Use theirs.
    if (insertError.code === "23505") {
      const { count } = await admin
        .from("eateries")
        .select("*", { count: "exact", head: true })
        .eq("session_id", session_id);
      return startSwiping(Math.min(deckSize, count ?? rows.length));
    }
    console.error("Eatery insert failed", insertError);
    return jsonResponse(500, { error: "EATERY_INSERT_FAILED" });
  }

  // The deck the group swipes: what the host asked for, or everything we found
  // if that was less. The remainder stays in the table as reserve.
  const eateryCount = Math.min(deckSize, rows.length);

  // Too few to swipe on: hold the session in the lobby and let the host decide
  // between a wider radius and starting anyway. The deck is already written, so
  // "start anyway" is the idempotent path above — it costs no second Places
  // call, and a redeal wipes these rows before dealing again.
  if (eateryCount < Math.min(MIN_DECK_SIZE, deckSize)) {
    // Publish the count even though we are not starting: the lobby renders the
    // held deck from get_session_state, which serves position <= eatery_count
    // and would otherwise show nothing to shuffle.
    const { error } = await admin
      .from("sessions")
      .update({ eatery_count: eateryCount })
      .eq("id", session_id);
    if (error) return jsonResponse(500, { error: "SESSION_UPDATE_FAILED" });
    return jsonResponse(200, {
      ok: false,
      thin_deck: true,
      eatery_count: eateryCount,
      closed_dropped: closedDropped,
      open_now: openNowFilter,
    });
  }

  return startSwiping(eateryCount);
});
