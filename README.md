# MakanMatch

swipe. match. makan.

Group dining decision app: a host starts a session, friends join with a room
code, everyone swipes on nearby eateries, the app reveals matches. See
`CLAUDE.md` for the full product/tech spec.

## Local development

```sh
npm install
npm run dev
```

The app needs a Supabase project (Phase 2+):

1. Create a project at [supabase.com](https://supabase.com) (region: Southeast
   Asia, Singapore).
2. Enable anonymous sign-ins: Dashboard → Authentication → Sign In / Up →
   "Anonymous sign-ins".
3. Link and push the schema:

   ```sh
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

4. Copy `.env.example` to `.env` and fill in the Project URL and anon key
   (Dashboard → Settings → API). For deploys, add the same variables in
   Vercel → Settings → Environment Variables — including `VITE_SITE_URL`, the
   deployed origin, which is baked into the Open Graph tags at build time.

## Google Places setup (Phase 3)

Decks are dealt from Google Places API (New) Nearby Search, called only from
the `fetch-eateries` Edge Function; photos are proxied and cached by
`place-photo`. The API key never reaches the client.

1. In Google Cloud, enable **Places API (New)** and create an API key
   restricted to it.
2. Set the key as an Edge Function secret and deploy both functions:

   ```sh
   npx supabase secrets set GOOGLE_PLACES_API_KEY=<your-key>
   npx supabase functions deploy fetch-eateries
   npx supabase functions deploy place-photo
   ```

   (`place-photo` is configured with `verify_jwt = false` in
   `supabase/config.toml` — it is loaded from plain `<img>` tags.)

3. The `place-photos` Storage bucket (photo cache) is created by migration
   `0002_places.sql`, so `npx supabase db push` covers it.

`fetch-eateries` also needs an Anthropic key from Phase 6b on — it writes the
card summaries from Google review text (see below). Same treatment: an Edge
Function secret, never a client variable.

```sh
npx supabase secrets set ANTHROPIC_API_KEY=<your-key>
```

Before touching the Places field mask or call patterns, read
`docs/COSTS.md`.

## Reveal and late joins (Phase 4)

Migrations `0003_reveal.sql` and `0004_reveal_context.sql` cover this phase —
`npx supabase db push` is all that is needed. No new secrets, buckets, or
Edge Function deploys.

Two behaviours change how results read:

- **The host can reveal at any time**, and **people can join after swiping has
  started**. Participation is therefore partial by design.
- Because of that, **match strength is measured per eatery — against the votes
  actually cast on that card, not session headcount.** A card two people saw
  and both liked is a 2/2 clean sweep, not a 2/3. Every row shows its
  `yes/votes` fraction plus how many people never saw it, so the number is
  never ambiguous.

Three tiers on the results screen: `unanimous` (everyone voted and all said
yes) leads with a hero card, then `clean_sweep`, then the rest ranked by yes
count and yes share. `finish_swiping` is unchanged — a session where everyone
finishes their deck still closes itself without the host touching anything.

## Open now (Phase 4.5)

Migration `0005_hours.sql` adds `eateries.open_now` / `eateries.closes_at` and
extends `get_session_state` and `get_results` to return them. This phase does
need an Edge Function redeploy, because the Places field mask changed:

```sh
npx supabase db push
npx supabase functions deploy fetch-eateries   # place-photo is unchanged
```

The policy, in one line: **closed is dropped, unknown is kept and flagged.**

- `sessions.filters.open_now` defaults to **on**. With it on, places Google
  reports as closed are dropped in `fetch-eateries`.
- Places with **no hours data at all** are kept and tagged "hours unknown".
  Google has no hours for a large share of Singapore F&B — hawker stalls,
  coffeeshop units, small tenants — and excluding them would remove exactly
  the places people actually eat at.
- **Closing soon is not hidden.** A place closing within 45 minutes gets an
  amber "closes 9:00pm" chip; whether that leaves time to walk over and eat is
  the group's call.
- If fewer than 8 places survive the filters, the session does **not** start.
  The deck is written but held in the lobby and the host is offered a wider
  radius or "swipe these anyway" — the latter costs no extra Places call.

Hours are stamped once, at fetch time, and never re-checked; see
`docs/COSTS.md` for why, and what the closing-time display does about it.

## Sharing and joining (Phase 5a)

No migration and no Edge Function changes — this phase is client-side plus one
static image.

Two ways in, for two situations:

- **Same table → QR.** The lobby's room-code chit carries a QR of the join URL,
  with a "Show larger" fullscreen view for scanning across a table. The room
  code stays above it: QR fails in a dark bar, and six characters always work.
- **Group chat → share sheet.** `navigator.share` where it exists, clipboard
  plus a toast everywhere else. Both the lobby and the deck (for late arrivals)
  carry the control, and the results screen shares the winning eatery with its
  name, cuisine, distance and Maps link — the message that actually goes in the
  chat once it is settled.

Links point at `/j/CODE`, deliberately short because it gets read aloud and
typed. That screen asks only for a name, remembers it in `localStorage`, and
routes off the session's server-side status, so a link to a session that has
already started lands the joiner straight on the deck.

`navigator.share` needs HTTPS and must be called inside the user gesture, with
nothing awaited first — see the note at the top of `src/lib/share.js`. Locally
it is absent, so `npm run dev` always exercises the clipboard path.

### Link previews

`index.html` carries static Open Graph tags. `og:image` and `og:url` have to be
absolute, so `VITE_SITE_URL` is substituted into them at build time by a small
plugin in `vite.config.js`.

The image itself is `public/og.png`, rasterised from `scripts/og.svg`:

```sh
npm run build:og   # asserts 1200x630 and that the brand fonts actually set
```

It is committed, so a normal build does not need to run it — only re-run it
after editing `scripts/og.svg`.

Per-session previews (the host's name, who is already in the queue) would need
server-rendered HTML for `/j/*` routes. This is a static SPA where every route
serves the same `index.html`, so that is out of scope.

## Deck options and shuffle (Phase 5b)

The session-create screen keeps two decisions in front of the host — where, and
whether to hide closed places — and folds the rest behind **More options**:
search radius (500m / 1km / 2km / 5km, chips rather than a slider, labelled with
walking times), deck size (10 / 15 / 20) and budget. Radius and deck size are
remembered in `localStorage` and prefilled next session.

Two rules hold the feature together:

- **Shuffle per session, never per participant.** `eateries.position` is
  assigned once, by `fetch-eateries` at deal time or by `reshuffle_deck`, and
  every client reads that same column. The vote maths is per-eatery so order
  does not change the counting — but participation is routinely partial (the
  host can reveal at any time, people join late), and an identical order means
  everyone's partial progress covers the same cards, so the votes overlap. Five
  per-person orders would leave every eatery with one or two votes.
- **Always fetch the Places maximum, whatever the deck size.** Nearby Search
  bills per call, not per result, so asking for 10 costs exactly what asking for
  20 costs. `fetch-eateries` stores every survivor and `get_session_state`
  serves only `position <= sessions.eatery_count`. The rest is free reserve.

That reserve is what makes the lobby's **Shuffle** free: `reshuffle_deck`
reassigns positions across all stored rows, so a different subset surfaces,
without a second Places call. It is host-only and lobby-only — after Start,
re-drawing would strand swipes on cards that had left the deck, and the RPC
raises `NOT_IN_LOBBY` regardless of what the UI shows. It also stamps
`sessions.deck_shuffled_at`, which is what pushes every other client to
re-read the deck instead of previewing a stale order.

The label is deliberately "Shuffle", not "Find more": it re-draws from places
already found nearby, it does not search further afield. Widening the search is
the separate, and separately billed, "widen and redeal".

## Know what you're swiping on (Phase 6)

Migration `0007_details.sql` adds the detail columns to `eateries` and extends
`get_session_state` and `get_results` to return them. The Places field mask
changed, so this phase needs a redeploy too:

```sh
npx supabase db push
npx supabase functions deploy fetch-eateries   # place-photo is unchanged
```

**This phase costs money on purpose.** The generative summaries, the review
summary and the serving attributes are Enterprise + Atmosphere fields, one SKU
above where the deck used to sit: $35 → $40 per 1,000 Nearby Searches, i.e.
+$0.005 per session, still one call per session. Read `docs/COSTS.md` before
touching the mask, and set the `SearchNearbyRequest per day` quota cap in
Google Cloud — that step is manual and cannot be done from the repo.

Three rules shape the feature:

- **It is not a menu, and it never says "menu".** The Places API has no menu
  field at all (`menuForChildren` is a boolean). What it has is a generative
  description that usually names dishes, a review summary that names what
  people order, several photos and a website link. The UI calls them "About",
  "What people say" and "See website", because that is what they are.
- **Absent means absent.** Coverage is poor for exactly the places Singaporeans
  eat at — hawker stalls, coffeeshop units, small tenants. Every field is
  optional and every section is omitted entirely when its data is missing. No
  placeholders, no "no information available", no empty boxes. The card face
  gets one addition and one only: a two-line `summary_overview` under the
  cuisine row, which simply is not there when Google has no summary.
- **Photos 2-5 load on expand, never on deck load.** `photo_refs` is stored for
  free out of the Nearby Search response, but fetching a photo is billable.
  The deck fires one `place-photo` request per card; the rest only when a
  detail sheet is actually opened. Most cards never are.

Tapping a card (or its "ⓘ More info" affordance) slides a detail sheet up over
the deck. The ✕ / ♥ buttons lift into a footer above the sheet and stay live,
so you can read the description and decide in one gesture. Swipe the sheet
down, tap outside it, or press Escape to go back to the deck; swiping the card
either way closes it too.

**Attribution is mandatory, not decorative.** Wherever a Google-generated
summary appears, so does the `disclosureText` Google returned with it; a review
summary additionally links out to the place's reviews on Google Maps. Both
disclosure strings are stored per eatery rather than hardcoded, so Google
rewording them flows through without a deploy. Phase 6b adds a second kind of
summary with its own credit line — see below.

## We write the summaries ourselves (Phase 6b)

Phase 6 asked Google for summaries and Singapore said no. `generativeSummary`,
`reviewSummary` and `editorialSummary` all come back empty for Singapore places
(verified with a direct Place Details call — only `displayName` came back).
Raw `reviews` do come back. So `fetch-eateries` now reads the reviews and has
Claude write the summary instead.

```sh
npx supabase db push                            # 0008_summaries.sql
npx supabase functions deploy fetch-eateries    # reviews in the mask + summaries
npx supabase functions deploy place-photo       # 30-day cache TTL
```

One manual step: create an Anthropic API key at
[console.anthropic.com](https://console.anthropic.com), add it as
`ANTHROPIC_API_KEY` under Supabase → Edge Functions → Secrets, and set a spend
limit on it. Expected usage is cents per month, so a low cap is a pure safety
net. Without the secret the app still runs — cards simply have no summary line.

Writing them ourselves also means we choose the voice, which is the actual
reason to prefer this even where Google has coverage. The target is dish-first
and local: *"Zi char spot known for chilli crab and butter prawns, big round
tables"* beats *"Casual eatery serving seafood."* The system prompt bans
marketing adjectives, forbids naming a dish the reviews do not name, and expects
"zi char", "cai fan" and "hawker" as ordinary words.

Four rules, in `supabase/functions/fetch-eateries/summaries.ts`:

- **One Anthropic call per session, batched over every uncached place.** Twenty
  calls instead of one is the difference between a fraction of a cent and a real
  bill, and between 3 seconds and 40.
- **Session start never waits on it and never fails on it.** The call has an 8
  second timeout, and a missing key, an HTTP error, a timeout or unparseable
  output all end the same way: the deck is dealt with blank summary lines and
  the failure is logged. Nobody is told the summariser had a bad day.
- **Nothing is invented, and thin evidence is no evidence.** Places with fewer
  than two reviews are skipped rather than summarised from one opinion.
- **Google's summary wins where it exists.** If Google ever extends coverage
  here, its summary and its disclosure string take the card; those fields stay
  in the field mask for exactly that reason, and cost nothing at this SKU.

`place_summaries` is a global cache keyed by Google `place_id` and shared across
every session and user, so a place is summarised once however many groups swipe
on it. The second group in the same neighbourhood usually pays for nothing at
all.

**Attribution, again.** Our summaries are not Google-generated, so they never
carry Google's "Summarized with Gemini" line — that string is present in the
row if and only if the summary is Google's. What ours are derived from is Google
review text, so the detail sheet credits **"Based on Google reviews"** under the
description instead.

### Caches expire after 30 days

Google Maps Platform terms let us store `place_id` indefinitely and most other
Places content not at all. The Phase 3 photo cache was specced as permanent,
which was not correct; `place-photo` now treats an object older than 30 days as
a miss and refetches it, and `place_summaries` rows age out the same way. The
practical cost is close to zero — a place's photos and reviews move slowly, so
this is at most one refresh per item per month — and both caches still absorb
essentially every repeat view. See `docs/COSTS.md`.

## Multi-window smoke test

1. Window A: Start a session → note the room code.
2. Window B (incognito): Join with the code → both lobbies show 2 people live.
3. A: Start swiping → both windows enter the deck.
4. Window C: join mid-deck → lands straight on the deck with the full card
   list, and shows up in everyone's progress row tagged "joined late".
5. Swipe differently in each window; progress counts update live and nobody
   can see anyone else's choices.
6. A (host): "Reveal now" → the sheet names who is still unfinished → confirm
   → all three windows land on results together.
7. Refresh a window mid-deck → it resumes on the correct next card.
8. Drop one window's network for ~20s and restore it → it re-syncs, and if the
   reveal happened while it was offline it lands on results, not a dead deck.

Sharing adds three more, best run on the deployed URL (local dev has no
`navigator.share`):

9. Lobby → Share → the native sheet opens on iOS/Android; cancelling it shows
   nothing. On desktop Firefox the same button copies the link and toasts.
10. Send the link through Telegram or WhatsApp → the preview card renders →
    opening it lands on `/j/CODE` → joining shows up live in the host's lobby.
    Join again on the same device and it offers "Join as {name}", one tap.
11. Share a link for a session that is already swiping (joiner lands on the
    deck) and one that has finished ("This session already finished", not an
    empty deck).

Deck options and shuffle:

12. Create a session with defaults → 15 cards, all within 1km. Set radius 5km
    and deck size 20 → 20 cards with a visibly wider spread of distances. Set
    deck size 10 → exactly 10.
13. Create two sessions back to back from the same spot with the same settings
    → different order, and a different set of places.
14. Lobby → Shuffle → the deck preview changes, and **Google Cloud metrics show
    no additional Nearby Search request**. That last part is the assertion.
15. Two windows in the same session → identical card order, before and after a
    shuffle.
16. Start swiping → the Shuffle control is gone, and calling `reshuffle_deck`
    directly raises `NOT_IN_LOBBY`.
17. Somewhere quiet, 300m with Open now on → the thin-deck prompt still fires,
    now against `eatery_count` rather than a fixed 20.

Summaries (Phase 6b):

18. New session → cards carry a one-line summary that names actual dishes
    wherever the reviews name them, and
    `select count(*), count(overview) from place_summaries;` is populated.
19. Second session in the same area → check Anthropic usage: the batch covers
    only places that were not already cached. Repeat places cost nothing.
20. Set `ANTHROPIC_API_KEY` to something invalid → the session still starts
    within the usual couple of seconds, cards render without summary lines, and
    nothing about it reaches the user. Put the real key back.
21. A place with one review or none → no summary, card renders cleanly.
22. **Read five summaries against the place's actual Google reviews and confirm
    nothing was invented.** This is the check that matters most; rerun it
    whenever the system prompt changes.
