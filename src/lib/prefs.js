// The only thing we keep on the device: the display name, so a second join
// from the same phone is one tap instead of retyping. Nothing else goes in
// localStorage — there are no accounts and no session history by design.
//
// Every access is guarded: Safari in private mode and locked-down embedded
// webviews throw on localStorage rather than returning null, and a remembered
// name is never worth a blank screen.

const NAME_KEY = "makanmatch:name";
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
