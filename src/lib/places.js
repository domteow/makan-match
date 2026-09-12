import { supabase } from "./supabase.js";
import { edgeFunctionError } from "./errors.js";

// Location search. Both calls go through the place-search Edge Function — the
// Google Places key is never in the client.
//
// Cost note: autocomplete is billed per request. The debounce and the
// 3-character minimum that make that affordable live in LocationSearch, and the
// function rejects anything shorter anyway. Do not call this per keystroke.

export const MIN_QUERY_LENGTH = 3;

// Predictions for a partial place name. `signal` lets the caller abort a
// request that a newer keystroke has already superseded.
//
// Returns null — not [] — when the request was aborted, so the caller can tell
// "no results" apart from "never mind, a newer search is running" and leave the
// list showing whatever was there.
export async function autocompletePlaces(query, { signal } = {}) {
  const { data, error } = await supabase.functions.invoke("place-search", {
    body: { action: "autocomplete", query },
    signal,
  });
  // An aborted fetch comes back as an error rather than a rejection, so the
  // signal is the reliable thing to check, and it must be checked first.
  if (signal?.aborted) return null;
  if (error) throw await edgeFunctionError(error, "Couldn't search just now. Try again?");
  return data?.predictions ?? [];
}

// Prediction -> a point on the map. Served from the place_locations cache when
// the same place has been resolved in the last 30 days, which for malls and
// landmarks is most of the time.
export async function resolvePlace(placeId) {
  const { data, error } = await supabase.functions.invoke("place-search", {
    body: { action: "resolve", place_id: placeId },
  });
  if (error) throw await edgeFunctionError(error, "Couldn't pin that place. Try another?");
  return data; // { place_id, name, address, lat, lng }
}
