# API costs

Four billable Google endpoints (Phase 3, Phase 7) and one billable Anthropic
endpoint (Phase 6b), all called only from Supabase Edge Functions. Change
anything here with the [Places API (New) pricing
table](https://developers.google.com/maps/billing-and-pricing/pricing) open.

## Nearby Search (`fetch-eateries`)

**Exactly one call per session, ever.** The function is host-only, refuses
non-lobby sessions, skips the Places call when a deck already exists
(double-tap idempotency), and races on the `unique (session_id, position)`
constraint if two invocations slip through. A "widen and redeal" wipes the
deck and spends one more call — that is a new deal the host explicitly asked
for, and still one call per deal.

The open-now thin-deck guard does **not** cost a call. When too few places
survive the filters the function still writes the deck, it just holds the
session in the lobby; the host's "swipe these anyway" re-invocation lands on
the idempotent path and calls nothing.

### Deck size does not change the bill

`maxResultCount` is pinned at 20 no matter what deck size the host picked.
Nearby Search bills **per call, not per result** — requesting 10 costs exactly
what requesting 20 costs — so lowering it would save nothing and throw away the
rows past `deck_size` that we store as reserve. Do not "optimise" this by
passing `session.deck_size` through to the request.

That reserve is what makes the lobby's Shuffle free: `reshuffle_deck` only
reassigns `eateries.position` over rows already in the database, so a different
subset surfaces in the deck for the cost of one `UPDATE`. Any change that makes
shuffling reach for new places turns a free action into a per-tap Enterprise-SKU
call, which is the one thing this feature exists to avoid.

### Field mask and SKU

```
places.id
places.displayName
places.formattedAddress
places.location
places.types
places.primaryTypeDisplayName
places.rating              <- Enterprise
places.userRatingCount     <- Enterprise
places.priceLevel          <- Enterprise
places.photos
places.googleMapsUri
places.currentOpeningHours.openNow         <- Pro
places.currentOpeningHours.nextCloseTime   <- Pro
places.regularOpeningHours.openNow         <- Pro
places.priceRange          <- Enterprise
places.websiteUri          <- Enterprise
places.generativeSummary.overview        <- Enterprise + Atmosphere
places.generativeSummary.description     <- Enterprise + Atmosphere
places.generativeSummary.disclosureText  <- Enterprise + Atmosphere
places.reviewSummary.text                <- Enterprise + Atmosphere
places.reviewSummary.reviewsUri          <- Enterprise + Atmosphere
places.reviewSummary.disclosureText      <- Enterprise + Atmosphere
places.servesVegetarianFood              <- Enterprise + Atmosphere
places.servesBreakfast                   <- Enterprise + Atmosphere
places.servesLunch                       <- Enterprise + Atmosphere
places.servesDinner                      <- Enterprise + Atmosphere
places.dineIn                            <- Enterprise + Atmosphere
places.takeout                           <- Enterprise + Atmosphere
places.goodForGroups                     <- Enterprise + Atmosphere
places.reviews                           <- Enterprise + Atmosphere
```

A request is billed at the SKU of its most expensive field. Phase 6 moved
`fetch-eateries` from **Nearby Search Enterprise** to **Nearby Search
Enterprise + Atmosphere** — see the next section for what that cost and why it
was judged worth it. Everything below Atmosphere in the list above
(`types`, `photos`, `googleMapsUri`, the opening-hours fields, `priceRange`,
`websiteUri`) is Essentials/Pro/Enterprise tier and adds nothing on top.

That is why the hours fields are requested on **every** call rather than only
when the `open_now` filter is on: at this SKU they are free, and the cards
want them either way — "hours unknown" and "closes 9:00pm" are shown whether
or not the filter is filtering.

**Do not add fields to the mask without checking the pricing table.** The two
directions are not symmetrical now:

- adding **more** Atmosphere fields (`servesBeer`, `outdoorSeating`,
  `restroom`, `parkingOptions`…) costs **nothing** — the call is already at the
  top SKU;
- removing **some** of them saves **nothing**;
- only removing **every** Atmosphere field drops the call back to Enterprise.

### Phase 6: the deliberate move to Enterprise + Atmosphere

Phase 6 added the generative summaries, the review summary and the
serving/venue attributes so people stop deciding blind on a photo and a `$$`.
Every one of those fields is Enterprise + Atmosphere.

Rates checked August 2026:

| SKU | per 1,000 calls |
| --- | --- |
| Nearby Search Enterprise (before) | $35.00 |
| Nearby Search Enterprise + Atmosphere (now) | $40.00 |

That is **+$0.005 per session** — one call per session, unchanged. At 100
sessions a month the whole line item is $4.00 and sits inside the free
allowance anyway (Enterprise-tier SKUs carry 1,000 free calls per month, so
the first ~1,000 sessions each month cost nothing at all).

> Google's own pricing pages were not directly reachable when this was
> written; the two figures above come from third-party pricing summaries that
> agree with each other. **Confirm them against
> <https://developers.google.com/maps/billing-and-pricing/pricing> or the
> billing console before relying on the arithmetic below.**

#### Daily quota cap

Because the per-call rate went up ~14%, the `SearchNearbyRequest per day`
quota in Google Cloud (APIs & Services → Places API (New) → Quotas) is the
backstop against a runaway loop, and it should be set to something the project
would actually be willing to pay:

- **Recommended cap: 200 requests/day.** Worst case $8.00/day, ~$240/month.
- That is ~200 sessions a day, which is far above anything this app does — a
  handful of groups deciding on lunch. If it is ever hit, that is a bug, and
  the cap is doing its job.

This is a console setting, not something in the repo, so it has to be set by
hand and cannot be enforced by code.

#### What Places still cannot give us

There is **no menu field in the Places API**. `menuForChildren` is a boolean,
not a menu. Nothing in Phase 6 is a menu, and nothing in the UI is labelled
one — the sections are "About" (the generative description, which usually
names dishes), "What people say" (the review summary) and "See website".

Coverage is patchy and that is a data fact, not a bug: chains and sit-down
restaurants usually have summaries, hawker stalls and coffeeshop units usually
have none. Every field degrades to absent.

#### Attribution is not optional

Google's policies require attribution for AI-generated content. The
`disclosureText` strings for both summaries are **stored in the eateries rows,
not hardcoded**, so Google changing the wording flows through without a
deploy. A review summary must additionally link out to
`reviewSummary.reviewsUri`. Do not render either summary without them.

Since Phase 6b most summaries are ours, not Google's, and the two must not be
credited the same way. The rule is one line: **a Google disclosure string is
present if and only if the summary is Google's.** The card shows that string
when it is there and nothing when it is not; the detail sheet shows it when it
is there and "Based on Google reviews" — which is what ours are derived from —
when it is not. Never both, and never Google's wording over our text.

### Phase 6b: `places.reviews`

Reviews joined the mask so we can write our own summaries (see the Anthropic
section below). It is another Enterprise + Atmosphere field, and the call was
already at that SKU, so the Nearby Search bill is **unchanged** — this is the
"adding more Atmosphere fields costs nothing" case from the list above.

Review text is used and discarded: `fetch-eateries` sends up to three reviews
per place to Anthropic and stores only the summary that comes back. Nothing in
the database holds review prose.

There is no price or open-now request parameter on Nearby Search — Text Search
has `openNow`, Nearby Search does not — which is why `price_max` is filtered
client-side and `open_now` is post-filtered in the function.

### Hours go stale, and that is deliberate

`open_now` and `closes_at` are evaluated **once, at fetch time**. A long
session, or a redeal much later, can show state that has moved on.

The mitigation is displaying `closes_at` (on the cards when it is imminent, on
every results row where it is known), not re-checking. **Do not add polling or
re-fetch logic.** Refreshing hours means another Nearby Search per refresh —
the per-session cost stops being 1 and starts being "however long the group
argued" — for a place that, at worst, the group can see the closing time of
and judge for themselves.

## Place Photos (`place-photo`)

Read-through cache in the public `place-photos` Storage bucket, keyed by
`sha256(photo resource name)-width`. Google's photo resource name is stable
per photo (not per session), so:

- a cache hit costs nothing — 302 to the Storage public URL, no Google call;
- each distinct (photo, width) pair is fetched from Google **at most once per
  30-day window across all sessions and users**.

The client always requests `w=640`, so in practice it is one Place Photos
call per distinct eatery photo, ever. Adding new width variants to the client
multiplies that — don't, without a reason. **The detail sheet's carousel uses
`w=640` too, for exactly this reason.**

### Photos 2-5 are loaded on expand, never on deck load

`fetch-eateries` stores up to five photo resource names per eatery in
`photo_refs` (index 0 is the same photo as `photo_ref`). Storing them is free —
they came back in the Nearby Search response we already paid for. *Fetching*
them is not.

So the deck requests exactly one photo per card, and the extra four are only
requested when someone actually opens that card's detail sheet. `DetailSheet`
is conditionally mounted rather than hidden with CSS, and the carousel images
past the first are `loading="lazy"`, so they arrive as they scroll into view.

Most cards are never expanded. Loading five photos per card up front would
multiply the Place Photos bill by ~5 for photos nobody looks at. **Do not
preload the carousel.**

### The cache expires after 30 days, and that is not negotiable

Google Maps Platform terms allow storing `place_id` indefinitely and most
other Places content not at all. The original "served from Storage forever"
design was wrong on that point. A cached object older than 30 days is now
treated as a miss: refetched from Google, overwritten, timestamp reset. The
`Cache-Control` on the redirect matches the same window — an `immutable` year
would have left browsers and the CDN holding bytes after the server-side copy
had aged out.

The bill barely notices. A place's photos change slowly, so the worst case is
one Place Photos call per distinct photo per month instead of one ever, and
every repeat view inside the window still costs nothing.

## Autocomplete and Place Details (`place-search`, Phase 7)

The host can name a place instead of using geolocation. Two Essentials-tier
endpoints, both behind one Edge Function, and only ever touched when the host
chooses to search rather than tap "Use my location".

Rates checked August 2026 — same caveat as the Nearby Search figures above,
confirm against the pricing table before relying on the arithmetic:

| SKU | per 1,000 requests |
| --- | --- |
| Autocomplete (Essentials) | ~$2.83 |
| Place Details (Essentials) | ~$5.00 |

**Realistic cost per location search: ~1.5 cents**, against ~4 cents for the
Nearby Search it precedes. Acceptable, because it replaces a fixed six-item
area list with the whole island, and because it is opt-in per session.

### The debounce is the entire cost story

Autocomplete is cheap per request and billed **per request**, which means the
only thing standing between "1.5 cents" and "15 cents" is how often the client
fires. Two controls, in `src/components/LocationSearch.jsx`:

- **350ms trailing debounce.** One request when the host stops typing, not one
  per keystroke.
- **3-character minimum.** Below that nothing fires at all, and `place-search`
  rejects a short query with a 400 before it reaches Google.

These are cost controls, not UX preferences. **Do not remove them, and do not
lower the minimum.** A typical search lands at 3-4 requests; per-keystroke
firing on "jewel changi" would be 12.

Requests are also aborted (`AbortController`) when the query moves on, so a
fast typist cannot leave a queue of in-flight lookups resolving behind them.

### No session tokens, deliberately

Autocomplete session tokens bundle a search's requests with the Place Details
call that follows. They only start saving money **above 12 autocomplete
requests per search**; below that, requests bill identically with or without a
token. With the debounce above we average 3-4. So a token would add token
lifecycle management, a new failure mode (reused or expired tokens billing as
unsessioned) and nothing else. **Do not add them.**

### `place_locations` is a global cache

`resolve` reads through `place_locations`, keyed by Google `place_id` and shared
across every session and user, with the same 30-day TTL as the photo and
summary caches (same compliance reason: `place_id` may be stored indefinitely,
other place content may not).

Mall and landmark names repeat heavily across sessions — Jewel, VivoCity,
Tampines Hub — so in practice each one costs one Place Details call per month
however many groups search for it. A cache-lookup failure is logged and treated
as a miss: one extra call beats failing the host's search.

### Recent locations cost nothing at all

The last five resolved places are kept in `localStorage`
(`makanmatch:places` — `place_id`, name, lat, lng) and render as chips under an
empty search field. Tapping one sets the session location straight from the
stored coordinates: **no autocomplete request and no Place Details request**.
For the regular Friday spot this is the common path and it is free.

### The `resolve` field mask is Essentials only

```
id
displayName
formattedAddress
location
```

That is the complete Essentials set this needs, and the whole call sits at the
cheapest Place Details SKU because of it. **Do not add fields.** Anything else
(`rating`, `photos`, `currentOpeningHours`, any `serves*` flag) lifts this call
to Pro, Enterprise or Enterprise + Atmosphere — paying several times over for a
lat/lng we already have, on a call that happens per search rather than per
session.

Autocomplete is pinned to Singapore (`includedRegionCodes: ["sg"]`) with a
25km bias circle on the city centre. That is a relevance decision, not a
billing one: neither parameter changes the SKU.

### Daily quota caps

Google's defaults are 175,000 autocomplete and 125,000 Place Details requests
per day, which is no protection at all. In Google Cloud → APIs & Services →
Places API (New) → Quotas:

- `AutocompletePlacesRequest per day` → **500** (worst case ~$1.42/day)
- `GetPlaceRequest per day` → **100** (worst case ~$0.50/day)

Both are far above anything this app does — a few hosts picking a mall — so
hitting either is a bug, and the cap is doing its job. Console settings, not
repo settings; they have to be set by hand.

`place-search` also runs gated (`verify_jwt = true`) **and** requires a real
signed-in user, not just the anon key. That is a cost control too: an open
autocomplete endpoint is a free Google proxy for anyone who finds the URL.

## Anthropic (`fetch-eateries`, Phase 6b)

Google returns no `generativeSummary` or `reviewSummary` for Singapore places,
so the line that says what the food actually is comes from Claude
(`claude-haiku-4-5`), written from the reviews Nearby Search already returned.

**At most three calls per session, never one per place.** Uncached places are
batched into chunks of 8 and the chunks are issued concurrently, so a full
20-place deck is 3 requests — twenty separate calls would be the difference
between a fraction of a cent and a real bill, and between 3 seconds and 40.
The inputs are small (≤8 places × ≤3 reviews × ≤250 chars per request) and the
output is a couple of lines per place, so a full 20-place session is a fraction
of a cent at Haiku rates.

Chunking is a latency decision, not a cost one; per-token cost is the same
either way. One 20-place request reliably blew the 8-second timeout in
practice, and a timeout meant the whole deck lost its summaries. Chunks answer
in a few seconds each, run in parallel (so wall clock is roughly one call, not
three), and fail independently.

Most sessions cost less than the full three, because `place_summaries` is keyed
by Google `place_id` and shared across every session and user: the second group
to swipe in the same neighbourhood pays only for places the first group did not
see. Cache rows carry the same 30-day TTL as the photos, for the same
compliance reason, so a heavily-reused place is re-summarised about monthly.

Three guarantees the implementation keeps, all in
`supabase/functions/fetch-eateries/summaries.ts`:

- **Session start never fails on summarisation, and failure is partial.**
  Missing key, HTTP error, 25-second timeout, truncated or unparseable JSON —
  every path logs and the affected cards simply have no summary line. A chunk
  that fails costs its own 8 places, not the deck.
- **Places with fewer than 2 reviews are skipped**, not summarised thinly.
- **Only the summary is stored**, never the review text it came from.

Each chunk logs its place count, elapsed ms and input/output token counts, so
the next timeout is diagnosable from the Edge Function logs without a repro. If
`max_tokens` truncation ever shows up there, lower `CHUNK_SIZE` rather than
raising `MAX_TOKENS` — the ceiling is what stops one runaway response costing
real money.

Set a spend limit on the Anthropic key (console.anthropic.com → Limits).
Expected usage is cents per month, so a low cap costs nothing and bounds the
damage if something ever loops.

## Per-session worst case

For a brand-new session in a never-seen area: up to 4 Autocomplete requests +
1 Place Details (only if the host searched a location, and only if that place
is not already cached) + 1 Nearby Search (Enterprise + Atmosphere) + 3
concurrent Anthropic calls + up to 20 Place Photos calls (one per new eatery
photo), plus up to 4 more per eatery whose detail sheet is opened. Every repeat session in that area: 1 Nearby Search, and — until the
30-day TTLs lapse — no photo calls, no Place Details call, and Anthropic calls
only if the deck turned up places nobody has swiped on yet. A location picked
from the recent chips adds nothing at all. All three caches are keyed by Google
identifiers that are stable across sessions.
