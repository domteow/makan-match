# Google Places API costs

Phase 3 calls two billable Google endpoints, both only from Supabase Edge
Functions. Change anything here with the [Places API (New) pricing
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
- each distinct (photo, width) pair is fetched from Google **at most once
  across all sessions and users**, then served from Storage forever.

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

## Per-session worst case

For a brand-new session in a never-seen area: 1 Nearby Search (Enterprise +
Atmosphere) + up to 20 Place Photos calls (one per new eatery photo), plus up
to 4 more per eatery whose detail sheet is opened. Every repeat session in that
area: 1 Nearby Search, ~0 photo calls — the photo cache is keyed by photo
resource name, which is stable across sessions.
