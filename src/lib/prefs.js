// What we keep on the device: the display name, so a second join from the same
// phone is one tap instead of retyping, and the host's last-used deck options,
// since most people settle on a radius and a deck size and shouldn't have to
// re-pick them every session. Nothing else — there are no accounts and no
// session history by design.
//
// Every access is guarded: Safari in private mode and locked-down embedded
// webviews throw on localStorage rather than returning null, and a remembered
// preference is never worth a blank screen.

const NAME_KEY = "makanmatch:name";
const DECK_KEY = "makanmatch:deck";
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
