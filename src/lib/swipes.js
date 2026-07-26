import { supabase } from "./supabase.js";
import { friendlyError } from "./errors.js";

// Upsert on (eatery_id, user_id), so a swipe replayed after a reconnect is
// harmless.
export async function recordSwipe(eateryId, liked) {
  const { error } = await supabase.rpc("record_swipe", {
    p_eatery_id: eateryId,
    p_liked: liked,
  });
  if (error) throw friendlyError(error);
}

export async function finishSwiping(sessionId) {
  const { error } = await supabase.rpc("finish_swiping", {
    p_session_id: sessionId,
  });
  if (error) throw friendlyError(error);
}

export async function getResults(sessionId) {
  const { data, error } = await supabase.rpc("get_results", {
    p_session_id: sessionId,
  });
  if (error) throw friendlyError(error);
  // [{ ..., yes_count, vote_count, participant_count, unanimous, clean_sweep }]
  return data;
}

// Own swipes only (RLS); used to resume a half-finished deck after refresh.
export async function getMySwipedEateryIds(sessionId) {
  const { data, error } = await supabase
    .from("swipes")
    .select("eatery_id")
    .eq("session_id", sessionId);
  if (error) throw friendlyError(error);
  return new Set(data.map((s) => s.eatery_id));
}
