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
places.currentOpeningHours.openNow   (only when the open_now filter is set; Enterprise)
```

A request is billed at the SKU of its most expensive field.
`rating` / `userRatingCount` / `priceLevel` put every `fetch-eateries` call in
the **Enterprise SKU** (Nearby Search Enterprise). The other fields
(`types`, `photos`, `googleMapsUri`, etc.) are Essentials/Pro tier and add
nothing on top; `currentOpeningHours` is also Enterprise, so toggling
`open_now` does not change the SKU either.

**Do not add fields to the mask without checking the pricing table** — a
single Enterprise + Atmosphere field (e.g. `reviews`, `servesBeer`) bumps
every call to the highest SKU.

There is no price or open-now request parameter on Nearby Search, which is
why `price_max` is filtered client-side and `open_now` post-filtered in the
function from `currentOpeningHours.openNow`.

## Place Photos (`place-photo`)

Read-through cache in the public `place-photos` Storage bucket, keyed by
`sha256(photo resource name)-width`. Google's photo resource name is stable
per photo (not per session), so:

- a cache hit costs nothing — 302 to the Storage public URL, no Google call;
- each distinct (photo, width) pair is fetched from Google **at most once
  across all sessions and users**, then served from Storage forever.

The client always requests `w=640`, so in practice it is one Place Photos
call per distinct eatery photo, ever. Adding new width variants to the client
multiplies that — don't, without a reason.

## Per-session worst case

For a brand-new session in a never-seen area: 1 Nearby Search (Enterprise) +
up to 20 Place Photos calls (one per new eatery photo). Every repeat session
in that area: 1 Nearby Search, ~0 photo calls.
