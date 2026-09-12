// What we keep on the device: the display name, so a second join from the same
// phone is one tap instead of retyping, the host's last-used deck options,
// since most people settle on a radius and a deck size and shouldn't have to
// re-pick them every session, and the handful of places they last searched for.
// Nothing else — there are no accounts and no session history by design.
//
// Every access is guarded: Safari in private mode and locked-down embedded
// webviews throw on localStorage rather than returning null, and a remembered
// preference is never worth a blank screen.

const NAME_KEY = "makanmatch:name";
const DECK_KEY = "makanmatch:deck";
const PLACES_KEY = "makanmatch:places";
const MAX_LEN = 30; // matches the display_name check constraint

export function getRememberedName() {
  try {
    const name = window.localStorage.getItem(NAME_KEY)?.trim();
    return name ? name.slice(0, MAX_LEN) : null;
  } catch {
    return null;
  }
}

export function rememberName(name) {
  const trimmed = name?.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(NAME_KEY, trimmed.slice(0, MAX_LEN));
  } catch {
    // Storage denied or full. The join already succeeded; this is a nicety.
  }
}

export function forgetName() {
  try {
    window.localStorage.removeItem(NAME_KEY);
  } catch {
    // See above.
  }
}

// Deck options. Defaults match the RPC's own (1km / 15 cards) so a device with
// no stored preference, a device that can't read storage, and the database all
// agree on what "unset" means.
export const DEFAULT_DECK_PREFS = { radiusM: 1000, deckSize: 15 };

// Values are validated against the offered options rather than merely clamped:
// stored preferences outlive the code that wrote them, and a stale 3000 would
// render as no radius chip selected at all.
const RADIUS_CHOICES = [500, 1000, 2000, 5000];
const DECK_CHOICES = [10, 15, 20];

export function getDeckPrefs() {
  try {
    const raw = window.localStorage.getItem(DECK_KEY);
    if (!raw) return DEFAULT_DECK_PREFS;
    const saved = JSON.parse(raw);
    return {
      radiusM: RADIUS_CHOICES.includes(saved?.radiusM)
        ? saved.radiusM
        : DEFAULT_DECK_PREFS.radiusM,
      deckSize: DECK_CHOICES.includes(saved?.deckSize)
        ? saved.deckSize
        : DEFAULT_DECK_PREFS.deckSize,
    };
  } catch {
    return DEFAULT_DECK_PREFS;
  }
}

export function rememberDeckPrefs({ radiusM, deckSize }) {
  try {
    window.localStorage.setItem(DECK_KEY, JSON.stringify({ radiusM, deckSize }));
  } catch {
    // Storage denied or full. The session already started; this is a nicety.
  }
}

// ---- Recent locations ----
//
// The last few places the host searched for, newest first. This is a cost
// control as much as a convenience: picking a recent sets the session location
// straight from the stored lat/lng, which skips BOTH the autocomplete and the
// Place Details call. For the regular Friday spot that is the common path, and
// it costs nothing.
//
// Only place_id / name / lat / lng are kept. place_id is the one piece of
// Places content Google's terms let us store indefinitely; the rest is what
// the chip needs to work without an API call, and it ages out naturally as
// newer searches push it off the end of the list.
const MAX_RECENTS = 5;

// Stored preferences outlive the code that wrote them, so every field is
// checked rather than trusted — a half-written entry would render as a chip
// that sets a NaN location on the session.
function validLocation(l) {
  return (
    typeof l?.place_id === "string" &&
    l.place_id.length > 0 &&
    typeof l.name === "string" &&
    l.name.trim().length > 0 &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lng)
  );
}

const toLocation = (l) => ({
  place_id: l.place_id,
  name: l.name.trim(),
  lat: l.lat,
  lng: l.lng,
});

export function getRecentLocations() {
  try {
    const raw = window.localStorage.getItem(PLACES_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    return saved.filter(validLocation).slice(0, MAX_RECENTS).map(toLocation);
  } catch {
    return [];
  }
}

// Newest first, deduped by place_id — re-picking a recent moves it back to the
// front rather than adding a second copy. Returns the new list so the caller
// can render it without a second read.
export function rememberLocation(location) {
  if (!validLocation(location)) return getRecentLocations();
  const entry = toLocation(location);
  const next = [
    entry,
    ...getRecentLocations().filter((l) => l.place_id !== entry.place_id),
  ].slice(0, MAX_RECENTS);
  try {
    window.localStorage.setItem(PLACES_KEY, JSON.stringify(next));
  } catch {
    // Storage denied or full. The location is already chosen; this is a nicety.
  }
  return next;
}
