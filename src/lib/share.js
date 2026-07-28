// Sharing: the native share sheet where it exists, clipboard everywhere else.
//
// The one hard rule for callers: build the payload from state you already
// have, and call share() straight out of the click handler. navigator.share
// has to run inside the user gesture, and iOS Safari revokes the gesture
// across an await — so an RPC or a fetch before the call makes the sheet
// silently never appear. Everything here is synchronous up to the share()
// call for that reason.

// Short on purpose: /j/CODE gets read aloud across a table and typed by hand.
export function joinUrl(code) {
  return `${window.location.origin}/j/${encodeURIComponent(code)}`;
}

export function sessionSharePayload(code) {
  return {
    title: "MakanMatch",
    text: `Swipe with us to pick where we eat. Room ${code}`,
    url: joinUrl(code),
  };
}

// The message that actually lands in the group chat after the decision, so it
// carries the name, cuisine, distance and the Maps link rather than a bare
// link back into the app. maps_uri can be null for a place Google gave us no
// link for; the text still works, there is just nothing to tap.
export function eaterySharePayload({ name, cuisine, distanceLabel, mapsUri }) {
  const detail = [cuisine, distanceLabel].filter(Boolean).join(", ");
  const text = [
    `We're eating at ${name}${detail ? ` (${detail})` : ""}.`,
    mapsUri,
  ]
    .filter(Boolean)
    .join(" ");
  return { title: "MakanMatch", text, ...(mapsUri ? { url: mapsUri } : {}) };
}

// Returns "shared" | "copied" | "cancelled" | "failed" so the caller can decide
// what to show. Cancelling the sheet is a normal outcome, not an error.
//
// copyText is what the clipboard fallback writes: the bare URL for a session
// invite, but the whole sentence for a result, where the link alone loses the
// name of the place.
export async function share(payload, { copyText } = {}) {
  if (navigator.share && (navigator.canShare?.(payload) ?? true)) {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
      console.error(err);
      return "failed";
    }
  }

  // Desktop Firefox, and any browser on plain http — navigator.share needs a
  // secure context, so local dev always lands here.
  const text = copyText ?? payload.url ?? payload.text;
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch (err) {
    console.error(err);
    return "failed";
  }
}
