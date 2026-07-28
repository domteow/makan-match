// Presentation helpers: map eatery rows (DB shape) to what the cards render.

import { placePhotoUrl } from "./eateries.js";

export function formatDistance(m) {
  if (m == null) return "";
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// A place closing this soon still goes in the deck — the group needs time to
// walk there and eat, and only they know whether that fits. We flag it.
const CLOSING_SOON_MS = 45 * 60 * 1000;

// en-SG for the format, device timezone for the value: "9:30pm", not "21:30".
const TIME_FMT = new Intl.DateTimeFormat("en-SG", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatTime(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  // "9:30 PM" / "9:30 pm" -> "9:30pm" (the separator can be a narrow no-break
  // space depending on the ICU build, so match any whitespace).
  return TIME_FMT.format(t).replace(/\s*([ap])\.?m\.?/i, (_, p) => `${p.toLowerCase()}m`);
}

// open_now is stamped once, at fetch time, and a session can run for several
// minutes — so "closing soon" is judged against the clock now, not then.
export function formatHours(row, now = Date.now()) {
  const closesAt = row.closes_at ? new Date(row.closes_at).getTime() : NaN;
  const known = !Number.isNaN(closesAt);
  const time = known ? formatTime(row.closes_at) : null;
  return {
    // No hours at all from Google. Common for hawker stalls and small units.
    hoursUnknown: row.open_now == null,
    closingSoon: known && closesAt - now <= CLOSING_SOON_MS,
    closesLabel: time && `${closesAt <= now ? "closed" : "closes"} ${time}`,
  };
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
    ...formatHours(row),
  };
}
