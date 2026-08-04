import { supabase } from "./supabase.js";
import { friendlyError, friendlyCode } from "./errors.js";

// Host sets lat/lng + deck options on the session before Start is possible.
export async function setSessionLocation(
  sessionId,
  { lat, lng, radiusM = 1000, deckSize = 15, filters = {} }
) {
  const { error } = await supabase.rpc("set_session_location", {
    p_session_id: sessionId,
    p_lat: lat,
    p_lng: lng,
    p_radius_m: radiusM,
    p_deck_size: deckSize,
    p_filters: filters,
  });
  if (error) throw friendlyError(error);
}

// Re-draws the deck from the places already fetched for this session — the
// rows past deck_size that fetch-eateries stored as reserve. Costs no Places
// call, which is the whole point: it is a free second opinion, not a new
// search. Lobby only, host only; the RPC raises NOT_IN_LOBBY otherwise.
//
// Positions are rewritten on the session's rows, so every participant gets the
// same new order — the caller re-runs get_session_state, and everyone else is
// nudged by the sessions UPDATE that reshuffle_deck stamps.
export async function reshuffleDeck(sessionId) {
  const { error } = await supabase.rpc("reshuffle_deck", {
    p_session_id: sessionId,
  });
  if (error) throw friendlyError(error);
}

// Host's Start action: the fetch-eateries Edge Function deals the deck from
// Google Places and flips session.status to 'swiping'. All clients navigate
// via the sessions UPDATE they're already subscribed to.
//
// One non-error outcome does NOT start the session: too few places survived
// the filters. The deck is written but held in the lobby, and the response
// comes back as { thin_deck: true, eatery_count, closed_dropped, open_now }
// so the host can widen the radius instead. Calling this again starts the
// held deck as-is, without a second Places call.
export async function startSwiping(sessionId) {
  const { data, error } = await supabase.functions.invoke("fetch-eateries", {
    body: { session_id: sessionId },
  });
  if (!error) return data ?? {};
  let code = null;
  try {
    code = (await error.context?.json?.())?.error ?? null;
  } catch {
    // non-JSON error body; fall through to the generic message
  }
  throw friendlyCode(code, "Couldn't deal the deck. Try again?");
}

// After a zero-match result: back to lobby with a wider radius, deck and
// swipes wiped, so the host can Start again.
export async function resetSessionForRedeal(sessionId, radiusM = 3000) {
  const { error } = await supabase.rpc("reset_session_for_redeal", {
    p_session_id: sessionId,
    p_radius_m: radiusM,
  });
  if (error) throw friendlyError(error);
}

// Photos are served by the place-photo Edge Function (read-through cache);
// the Google photo endpoint is never called from the client.
const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

export function placePhotoUrl(photoRef, width = 640) {
  if (!photoRef) return null;
  return `${FUNCTIONS_URL}/place-photo?ref=${encodeURIComponent(photoRef)}&w=${width}`;
}

// Nearby Search has no price filter parameter, so price_max is applied
// client-side over the fetched deck. Every client filters the same rows
// with the same session.filters, so deck order stays identical for all
// participants. Unknown price levels are kept (null passes).
export function passesPriceFilter(eatery, filters) {
  const max = filters?.price_max;
  if (!max) return true;
  return eatery.price_level == null || eatery.price_level <= max;
}
