// Eatery summaries, written by Claude from Google review text.
//
// Google returns no generativeSummary/reviewSummary for Singapore places, so
// the "what is this food" line on the card is ours: fetch-eateries hands the
// reviews it already paid for to one batched Anthropic call and stores the
// result in place_summaries, keyed by Google place_id and shared across every
// session and user. A place is summarised once per TTL window however many
// sessions include it.
//
// Three rules this file exists to keep:
//
//   1. ONE Anthropic call per session, batched over every uncached place. Twenty
//      calls instead of one is the difference between a fraction of a cent and a
//      real bill, and between 3 seconds and 40.
//   2. It never throws. A session that cannot be summarised is a session with
//      blank summary lines, not a session that fails to start. Every failure
//      path logs and returns what it has.
//   3. Review text is never stored — only the derived summary. Google Maps
//      Platform terms allow caching place_id indefinitely and little else,
//      which is also why cached rows expire after 30 days.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2000;

// Google Maps Platform caching terms. Photos and reviews both move slowly, so
// in practice this costs almost nothing — a place is re-summarised at most
// once a month — and it keeps the cache defensible.
const TTL_DAYS = 30;

// Below this there is nothing honest to summarise, and no summary is a better
// card than an invented one.
const MIN_REVIEWS = 2;
const MAX_REVIEWS_PER_PLACE = 4;
const REVIEW_CHARS = 400;

// Session start already spends ~2s on the Places call. "Start swiping" is a
// deliberate press and a couple of seconds under a loading state is fine, but
// beyond that the host thinks it hung — so we give up and deal without
// summaries. Deliberately synchronous: a background job for twenty one-line
// strings is not worth the machinery at this scale.
const TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You write one-line descriptions of eateries for a Singapore group-dining app,
based only on Google review text.

For each place return:
- overview: one sentence, max 110 characters. Lead with the food. Name specific
  dishes ONLY if reviews name them. No marketing language, no adjectives like
  "delightful" or "hidden gem", no exclamation marks.
- detail: 2-3 sentences. What the food is, what people order, what the place is
  like to sit in. Mention portion size, queues, or group-friendliness if
  reviews consistently do.

Rules:
- Never invent a dish, price, or fact not present in the reviews.
- If reviews do not name dishes, describe the cuisine and setting instead.
- Do not mention ratings, star counts, or review scores.
- Singapore English is fine. "Zi char", "hawker", "cai fan" are expected terms.

Return ONLY a JSON array, no markdown fences, no preamble:
[{"place_id": "...", "overview": "...", "detail": "..."}]`;

export type Summary = { overview: string; detail: string | null };

type PlacePayload = {
  place_id: string;
  name: string;
  primary_type: string | null;
  price_range: string | null;
  reviews: string[];
};

// Places wraps review prose in LocalizedText, and `text` is the translated
// form while `originalText` is what the reviewer typed. Either is fine to
// summarise from; prefer the translated one so an English summary does not
// have to be inferred from Mandarin.
const reviewText = (r: any): string | null =>
  (r?.text?.text ?? r?.originalText?.text ?? "").trim() || null;

function reviewTexts(place: any): string[] {
  return (place.reviews ?? [])
    .map(reviewText)
    .filter((t: string | null): t is string => Boolean(t))
    .slice(0, MAX_REVIEWS_PER_PLACE)
    .map((t: string) => t.slice(0, REVIEW_CHARS));
}

// Models sometimes wrap JSON in a fence despite being told not to. Strip one
// if it is there rather than failing the whole batch over punctuation.
function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function parseSummaries(text: string): Map<string, Summary> {
  const out = new Map<string, Summary>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch (err) {
    console.error("Summary JSON parse failed", err, text.slice(0, 500));
    return out;
  }
  if (!Array.isArray(parsed)) {
    console.error("Summary response was not an array");
    return out;
  }
  for (const item of parsed) {
    const placeId = typeof item?.place_id === "string" ? item.place_id : null;
    const overview =
      typeof item?.overview === "string" ? item.overview.trim() : "";
    if (!placeId || !overview) continue;
    const detail = typeof item?.detail === "string" ? item.detail.trim() : "";
    out.set(placeId, { overview, detail: detail || null });
  }
  return out;
}

// One request covering every uncached place. Returns an empty map on any
// failure — missing key, non-2xx, timeout, truncation, unparseable body.
async function generate(payload: PlacePayload[]): Promise<Map<string, Summary>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY not set; dealing deck without summaries");
    return new Map();
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("Anthropic API error", res.status, await res.text());
      return new Map();
    }

    const body = await res.json();
    if (body.stop_reason === "max_tokens") {
      // The JSON array is cut mid-object, so the parse below would fail
      // anyway. Log the real cause rather than "parse failed".
      console.error("Summary response hit max_tokens; JSON is truncated");
    }
    const text = (body.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    return parseSummaries(text);
  } catch (err) {
    // AbortSignal.timeout throws TimeoutError here; so does any network fault.
    console.error("Summary generation failed", err);
    return new Map();
  }
}

/**
 * Summaries for `places`, keyed by Google place_id. Cache first, one batched
 * Anthropic call for the remainder, then write the new ones back to the cache.
 *
 * Places absent from the returned map simply have no summary: too few reviews,
 * or generation failed. Callers must treat that as normal.
 */
export async function summariesFor(
  admin: SupabaseClient,
  places: any[]
): Promise<Map<string, Summary>> {
  const found = new Map<string, Summary>();
  const ids = places.map((p) => p.id).filter(Boolean);
  if (ids.length === 0) return found;

  // Anything older than the TTL is treated as absent and regenerated below.
  const cutoff = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString();
  const { data: cached, error: cacheError } = await admin
    .from("place_summaries")
    .select("place_id, overview, detail")
    .in("place_id", ids)
    .gt("generated_at", cutoff);
  if (cacheError) {
    // Not fatal: a cache miss costs one Anthropic call, not a failed session.
    console.error("place_summaries lookup failed", cacheError);
  }
  for (const row of cached ?? []) {
    found.set(row.place_id, { overview: row.overview, detail: row.detail });
  }

  const payload: PlacePayload[] = places
    .filter((p) => p.id && !found.has(p.id))
    .map((p) => ({
      place_id: p.id,
      name: p.displayName?.text ?? "Unknown",
      primary_type: p.primaryTypeDisplayName?.text ?? null,
      price_range: p.priceRange ? JSON.stringify(p.priceRange) : null,
      reviews: reviewTexts(p),
    }))
    .filter((p) => p.reviews.length >= MIN_REVIEWS);

  if (payload.length === 0) return found;

  const generated = await generate(payload);
  if (generated.size === 0) return found;

  // Only accept ids we asked about — a hallucinated place_id must not become a
  // cache row that later attaches itself to a real place.
  const reviewCounts = new Map(payload.map((p) => [p.place_id, p.reviews.length]));
  const generatedAt = new Date().toISOString();
  const rows = [...generated.entries()]
    .filter(([placeId]) => reviewCounts.has(placeId))
    .map(([placeId, summary]) => ({
      place_id: placeId,
      overview: summary.overview,
      detail: summary.detail,
      review_count: reviewCounts.get(placeId) ?? 0,
      model: MODEL,
      // Explicit, not the column default: the default only fires on insert, and
      // a refresh of a stale row is an update. Without this the TTL never resets.
      generated_at: generatedAt,
    }));

  if (rows.length > 0) {
    const { error: upsertError } = await admin
      .from("place_summaries")
      .upsert(rows, { onConflict: "place_id" });
    if (upsertError) {
      // Use them for this session anyway; the next session pays again.
      console.error("place_summaries upsert failed", upsertError);
    }
    for (const row of rows) {
      found.set(row.place_id, { overview: row.overview, detail: row.detail });
    }
  }

  return found;
}
