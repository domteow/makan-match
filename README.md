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

Phase 2 ships a mock deck of 8 eateries (seeded server-side when the host
starts the session); real Google Places data arrives in Phase 3.

## Two-window smoke test

1. Window A: Start a session → note the room code.
2. Window B (incognito): Join with the code → both lobbies show 2 people live.
3. A: Start swiping → both windows enter the deck.
4. Swipe differently in each window; progress counts update live.
5. Finish both decks → both windows land on results together; unanimous picks
   show ALL IN, then majority picks.
6. Refresh a window mid-deck → it resumes with the remaining cards.
