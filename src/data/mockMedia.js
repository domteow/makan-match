// Photos/emoji for the Phase 2 mock deck, keyed by eatery name.
// Phase 3 replaces this with Google Place Photos via the place-photo proxy.
const IMG = (id) => `https://images.unsplash.com/${id}?w=640&q=75&fit=crop`;

export const MOCK_MEDIA = {
  "Tian Tian Chicken Rice": { emoji: "🍗", img: IMG("photo-1617093727343-374698b1b08d") },
  "Koh Grill & Sushi Bar": { emoji: "🍣", img: IMG("photo-1579871494447-9811cf80d66c") },
  "328 Katong Laksa": { emoji: "🍜", img: IMG("photo-1569718212165-3a8278d5f624") },
  "Burnt Ends": { emoji: "🔥", img: IMG("photo-1544025162-d76694265947") },
  "Nakhon Kitchen": { emoji: "🌶️", img: IMG("photo-1455619452474-d2be8b1e70cd") },
  "Muthu's Curry": { emoji: "🍛", img: IMG("photo-1585937421612-70a008356fbe") },
  "Haidilao Hot Pot": { emoji: "🍲", img: IMG("photo-1547592180-85f173990554") },
  "Two Men Bagel House": { emoji: "🥯", img: IMG("photo-1525351484163-7529414344d8") },
};
