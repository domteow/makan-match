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
   (Dashboard → Settings → API). For deploys, add the same two variables in
   Vercel → Settings → Environment Variables.

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

## Two-window smoke test

1. Window A: Start a session → note the room code.
2. Window B (incognito): Join with the code → both lobbies show 2 people live.
3. A: Start swiping → both windows enter the deck.
4. Swipe differently in each window; progress counts update live.
5. Finish both decks → both windows land on results together; unanimous picks
   show ALL IN, then majority picks.
6. Refresh a window mid-deck → it resumes with the remaining cards.
