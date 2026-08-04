// Presentation helpers: map eatery rows (DB shape) to what the cards render.

import { placePhotoUrl } from "./eateries.js";

export function formatDistance(m) {
  if (m == null) return "";
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

// Search radius, not a measured distance: these are round numbers the host
// picked, so "1km" reads better than formatDistance's "1.0km".
export function formatRadius(m) {
  if (m == null) return "";
  if (m < 1000) return `${m}m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)}km`;
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

// Serving/venue flags, in the order the detail sheet renders them. Only `true`
// becomes a chip: Places returns false and null interchangeably for places it
// simply has no data on, and "No takeaway" would be an assertion we cannot make.
const ATTRIBUTE_LABELS = [
  ["vegetarian", "Vegetarian options"],
  ["dine_in", "Dine-in"],
  ["takeout", "Takeaway"],
  ["groups", "Good for groups"],
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
];

export function attributeLabels(attributes) {
  if (!attributes) return [];
  return ATTRIBUTE_LABELS.filter(([key]) => attributes[key] === true).map(
    ([, label]) => label
  );
}

// Card photo first, then whatever else Places gave us. photo_refs already
// includes the primary (fetch-eateries stores photos[0..4]), so the carousel's
// first frame is a browser cache hit from the card. Always w=640, the same
// width the card asks for — a second width would double the Place Photos bill
// for every photo (see docs/COSTS.md).
function photoUrls(row) {
  const refs = row.photo_refs?.length ? row.photo_refs : [row.photo_ref];
  return refs.filter(Boolean).map((ref) => placePhotoUrl(ref, 640));
}

export function formatEatery(row) {
  const photos = photoUrls(row);
  const attributes = attributeLabels(row.attributes);
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
    // Phase 6. Every one of these can be null — most hawker stalls have none
    // of them — and every consumer omits its section rather than rendering a
    // placeholder. `|| null` normalises the empty strings Postgres can hand
    // back so components only ever test truthiness.
    summary: row.summary_overview || null,
    summaryDisclosure: row.summary_disclosure || null,
    description: row.summary_description || null,
    reviewSummary: row.review_summary || null,
    reviewSummaryUri: row.review_summary_uri || null,
    reviewSummaryDisclosure: row.review_summary_disclosure || null,
    priceRangeText: row.price_range_text || null,
    websiteUri: row.website_uri || null,
    mapsUri: row.maps_uri || null,
    attributes,
    photos,
    // Whether the "More info" affordance is worth showing. The card front
    // already carries the name, cuisine, address, rating and distance, so the
    // sheet needs at least one thing the card does not have.
    hasDetail: Boolean(
      row.summary_description ||
        row.review_summary ||
        row.price_range_text ||
        row.website_uri ||
        row.maps_uri ||
        attributes.length > 0 ||
        photos.length > 1
    ),
  };
}
