// RPC errors raised in SQL arrive as error.message (e.g. "SESSION_NOT_FOUND");
// Edge Functions return the same codes as { error: "CODE" } bodies.
// Map the known codes to friendly copy; pass anything else through as-is.

const ERROR_COPY = {
  SESSION_NOT_FOUND: "No session with that code. Check it and try again?",
  SESSION_ALREADY_STARTED: "That session already started swiping. Ask for a new code.",
  SESSION_FINISHED: "That session already picked a place. Ask for a new code.",
  NOT_A_PARTICIPANT: "You're not in this session. Join with the code first.",
  NOT_HOST: "Only the host can do that.",
  ALREADY_STARTED: "Session already started.",
  NOT_SWIPING: "Nothing to reveal — this session isn't swiping.",
  SESSION_NOT_SWIPING: "Swiping's closed for this session.",
  SESSION_NOT_DONE: "Results aren't in yet.",
  NO_LOCATION: "Pick where you're eating before starting.",
  NO_EATERIES_FOUND: "Nothing found around there 😅 Widen the radius and try again.",
  PLACES_API_ERROR: "Couldn't fetch nearby makan spots. Try again in a bit?",
  NOT_AUTHENTICATED: "Connection hiccup — refresh and try again.",
};

// Longest match wins: several codes are suffixes of others
// (NOT_SWIPING vs SESSION_NOT_SWIPING), and a shorter key must not shadow
// the specific one the server actually raised.
const CODES_BY_SPECIFICITY = Object.keys(ERROR_COPY).sort(
  (a, b) => b.length - a.length
);

export function friendlyError(error) {
  const code = CODES_BY_SPECIFICITY.find((c) => error.message?.includes(c));
  return friendlyCode(code, error.message);
}

export function friendlyCode(code, fallbackMessage) {
  const e = new Error(
    (code && ERROR_COPY[code]) || fallbackMessage || "Something went wrong. Try again?"
  );
  e.code = code ?? null; // screens can branch on this (e.g. NOT_A_PARTICIPANT)
  return e;
}
