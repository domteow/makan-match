// Presentation helpers: map eatery rows (DB shape) to what the cards render.

export function formatDistance(m) {
  if (m == null) return "";
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
}

export function formatEatery(row, media = {}) {
  return {
    id: row.id,
    name: row.name,
    cuisine: row.cuisine,
    rating: row.rating,
    price: "$".repeat(row.price_level || 1),
    dist: formatDistance(row.distance_m),
    tag: row.address || "",
    emoji: media.emoji || "🍽️",
    img: media.img,
  };
}
