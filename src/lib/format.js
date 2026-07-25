// Presentation helpers: map eatery rows (DB shape) to what the cards render.

import { placePhotoUrl } from "./eateries.js";

export function formatDistance(m) {
  if (m == null) return "";
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// Placeholder emoji shown behind (or instead of) the Google photo,
// picked loosely from the cuisine label. Default is the humble plate.
const EMOJI_RULES = [
  [/sushi|japan|ramen/i, "🍣"],
  [/pizza|ital/i, "🍕"],
  [/burger|american/i, "🍔"],
  [/chinese|noodle|dim sum/i, "🍜"],
  [/indian|curry/i, "🍛"],
  [/thai/i, "🌶️"],
  [/korean|barbecue|bbq|grill|steak/i, "🍖"],
  [/cafe|coffee|brunch|bakery|breakfast/i, "☕"],
  [/seafood|fish/i, "🦐"],
  [/veg|salad/i, "🥗"],
  [/dessert|ice cream/i, "🍨"],
  [/bar|pub/i, "🍺"],
];

function cuisineEmoji(cuisine) {
  const [, emoji] = EMOJI_RULES.find(([re]) => re.test(cuisine || "")) || [];
  return emoji || "🍽️";
}

export function formatEatery(row) {
  return {
    id: row.id,
    name: row.name,
    cuisine: row.cuisine,
    rating: row.rating,
    price: "$".repeat(row.price_level || 1),
    dist: formatDistance(row.distance_m),
    tag: row.address || "",
    emoji: cuisineEmoji(row.cuisine),
    img: placePhotoUrl(row.photo_ref, 640),
  };
}
