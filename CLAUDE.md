# MakanMatch

Group dining decision app. A host starts a session, friends join via room code, everyone swipes yes/no on nearby eateries (Tinder-style), and the app reveals matches. Mobile-web-first, Singapore-first.

Tagline: "swipe. match. makan."

## Stack

- **Frontend:** Vite + React (JavaScript, not TypeScript for MVP). Mobile web only — design for 375-430px viewports. Desktop just gets a centered mobile-width column.
- **Backend:** Supabase (Postgres + Realtime + Edge Functions). No custom server.
- **Auth:** Supabase anonymous sign-in. No accounts, no signup. Participants are identified by anon user id + display name for the session.
- **External API:** Google Places API (Nearby Search + Place Photos), called ONLY from a Supabase Edge Function. The Places API key must never reach the client.
- **Hosting:** Vercel (frontend). Supabase hosts the rest.
- **Swipe interaction:** custom pointer-event implementation (drag translate + rotation, ~110px threshold, spring snap-back). A working reference implementation exists in `prototype/makan-match.jsx` — port its interaction feel and visual design faithfully.

## Design system (from prototype)

- Backdrop: deep kopitiam teal `#0E3B36`
- Cards: cream `#FDF6E3` with 2px ink borders `#1A1512`, hard offset shadows on buttons
- Accents: chili red `#C8331F` (no/pass), pandan green `#1F7A4D` / `#2FBF71` (yes/shiok), brand orange `#E8542F`
- Display font: Archivo Black; body: Public Sans
- Swipe stamps: "SHIOK" (right) / "PASS" (left), rotated, rubber-stamp style
- Keep the queue-chit / hawker-ticket aesthetic for room codes

## Data model

```sql
sessions (
  id uuid pk default gen_random_uuid(),
  code text unique not null,          -- 6-char join code, e.g. MKN7B3
  host_id uuid not null,              -- anon auth uid of host
  status text not null default 'lobby',  -- lobby | swiping | done
  lat double precision, lng double precision,
  radius_m int default 1500,
  filters jsonb default '{}',         -- { cuisine: [], price_max: 2, halal: false }
  created_at timestamptz default now()
)

participants (
  id uuid pk default gen_random_uuid(),
  session_id uuid references sessions on delete cascade,
  user_id uuid not null,              -- anon auth uid
  display_name text not null,
  done_swiping boolean default false,
  joined_at timestamptz default now(),
  unique (session_id, user_id)
)

eateries (
  id uuid pk default gen_random_uuid(),
  session_id uuid references sessions on delete cascade,
  place_id text not null,             -- Google place_id
  name text not null,
  cuisine text, price_level int, rating numeric,
  distance_m int, address text,
  photo_ref text,                     -- Google photo reference, resolved via Edge Function proxy
  position int not null               -- deck order, same for all participants
)

swipes (
  id uuid pk default gen_random_uuid(),
  session_id uuid references sessions on delete cascade,
  eatery_id uuid references eateries on delete cascade,
  user_id uuid not null,
  liked boolean not null,
  created_at timestamptz default now(),
  unique (eatery_id, user_id)
)
```

## Match logic

- A **full match** = every participant in the session swiped `liked = true` on the eatery.
- Results screen shows full matches first ("ALL IN"), then majority picks (>= ceil(n/2) yes votes) ranked by yes-count desc, then rating desc.
- If zero eateries got a majority, show an empty state suggesting a wider radius, with a one-tap "widen to 3km and redeal" action for the host.
- Compute matches with a single SQL query (group by eatery, count liked), exposed as a Postgres view or RPC — do not compute client-side from raw swipes.

## Realtime behavior

- Lobby: subscribe to `participants` inserts for the session → live "In the queue" list.
- Host presses Start → session.status = 'swiping' → all clients navigate to the deck.
- Swiping: each swipe inserts into `swipes`. Subscribe to swipes to show a subtle progress indicator (e.g. "Treva: 5/20"). Do NOT reveal what others chose per-eatery during swiping.
- When a participant finishes their deck, set `done_swiping = true`. When all participants are done (or host force-ends), session.status = 'done' → everyone navigates to results simultaneously.
- Optional stretch: instant "IT'S A MAKAN!" toast when an eatery reaches full-match mid-session.

## Edge Functions

1. `fetch-eateries` — input: session_id. Reads session lat/lng/radius/filters, calls Google Places Nearby Search, maps ~20 results into `eateries` rows with deck positions. Idempotent: if eateries already exist for the session, return them. Called once by the host at session start — one Places call per session regardless of group size.
2. `place-photo` — input: photo_ref + width. Proxies Google Place Photos so the API key stays server-side. Set long cache headers.

## Row Level Security

RLS on all tables. Principles:
- Anyone authenticated (anon) can read a session by exact code (for joining).
- Participants can read/write only rows belonging to sessions they've joined.
- Only the host can update session status/filters.
- Swipes: users can insert/update only their own (`user_id = auth.uid()`), can read aggregate results only when session.status = 'done' (enforce via the results view/RPC, keep raw swipes of others unreadable).

## Build phases (work in this order, commit per phase)

1. **Phase 1 — UI port:** Vite scaffold, port `prototype/makan-match.jsx` into proper components (`SwipeDeck`, `SwipeCard`, `Lobby`, `Results`, `Home`), local mock data, react-router for screens. Ship to Vercel.
2. **Phase 2 — Sessions:** Supabase project, schema + RLS migrations (use supabase CLI migrations, keep them in repo), anonymous auth, create/join session by code, realtime lobby.
3. **Phase 3 — Real eateries:** `fetch-eateries` + `place-photo` Edge Functions, browser geolocation for the host, filters (cuisine multi-select, max price, halal toggle) on session creation.
4. **Phase 4 — Sync + results:** swipe persistence, done-detection, results view/RPC, results screen with ALL IN vs majority tiers, "widen radius" empty state.
5. **Phase 5 — Polish:** share session link (Web Share API + copy fallback), PWA manifest, loading/error states, haptics on swipe (navigator.vibrate), OG tags for the share link.

## Conventions

- Plain JS, functional components, hooks only. No state library — React state + Supabase subscriptions are enough at this size.
- Keep Supabase calls in `src/lib/` (one module per table/concern), components stay presentational.
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `GOOGLE_PLACES_API_KEY` lives only in Supabase Edge Function secrets.
- Database changes only via supabase CLI migration files committed to the repo. Never mutate schema from the dashboard without a matching migration.
- Mobile-first CSS. Test at 390px width. Touch targets >= 44px.
- Commit after every working phase increment. Small commits, imperative messages.

## Out of scope for MVP (do not build unless asked)

- User accounts, session history, favorites
- Native apps
- Booking/reservation integrations
- Chat inside sessions
- More than one active deck per session
