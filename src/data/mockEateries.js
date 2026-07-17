// Local mock data for Phase 1. Replaced by Supabase + Google Places later.
const IMG = (id) => `https://images.unsplash.com/${id}?w=640&q=75&fit=crop`;

export const EATERIES = [
  { id: 1, name: "Tian Tian Chicken Rice", cuisine: "Hainanese", emoji: "🍗", price: "$", dist: "450m", rating: 4.6, tag: "Maxwell Food Centre", img: IMG("photo-1617093727343-374698b1b08d") },
  { id: 2, name: "Koh Grill & Sushi Bar", cuisine: "Japanese", emoji: "🍣", price: "$$", dist: "1.2km", rating: 4.4, tag: "Wisma Atria", img: IMG("photo-1579871494447-9811cf80d66c") },
  { id: 3, name: "328 Katong Laksa", cuisine: "Peranakan", emoji: "🍜", price: "$", dist: "800m", rating: 4.5, tag: "East Coast Rd", img: IMG("photo-1569718212165-3a8278d5f624") },
  { id: 4, name: "Burnt Ends", cuisine: "Modern BBQ", emoji: "🔥", price: "$$$$", dist: "2.1km", rating: 4.7, tag: "Dempsey Hill", img: IMG("photo-1544025162-d76694265947") },
  { id: 5, name: "Nakhon Kitchen", cuisine: "Thai", emoji: "🌶️", price: "$$", dist: "650m", rating: 4.3, tag: "Holland Village", img: IMG("photo-1455619452474-d2be8b1e70cd") },
  { id: 6, name: "Muthu's Curry", cuisine: "Indian", emoji: "🍛", price: "$$", dist: "1.5km", rating: 4.4, tag: "Race Course Rd", img: IMG("photo-1585937421612-70a008356fbe") },
  { id: 7, name: "Haidilao Hot Pot", cuisine: "Sichuan", emoji: "🍲", price: "$$$", dist: "900m", rating: 4.5, tag: "Clarke Quay", img: IMG("photo-1547592180-85f173990554") },
  { id: 8, name: "Two Men Bagel House", cuisine: "Brunch", emoji: "🥯", price: "$$", dist: "1.1km", rating: 4.5, tag: "Icon Village", img: IMG("photo-1525351484163-7529414344d8") },
];

export const FRIENDS = [
  { name: "You", color: "#E8542F" },
  { name: "Treva", color: "#2E8B57" },
  { name: "Wei Jie", color: "#D4A017" },
  { name: "Sarah", color: "#7B5EA7" },
];

// Simulated friend votes (deterministic, so "matches" feel real)
export const FRIEND_VOTES = {
  1: [true, true, true],
  2: [true, false, true],
  3: [true, true, true],
  4: [false, true, false],
  5: [true, true, false],
  6: [false, false, true],
  7: [true, true, true],
  8: [true, false, false],
};

export const ROOM_CODE = "MKN-7B3";
