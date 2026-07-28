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
