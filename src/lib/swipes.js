import { supabase } from "./supabase.js";

export async function recordSwipe(eateryId, liked) {
  const { error } = await supabase.rpc("record_swipe", {
    p_eatery_id: eateryId,
    p_liked: liked,
  });
  if (error) throw error;
}

export async function finishSwiping(sessionId) {
  const { error } = await supabase.rpc("finish_swiping", {
    p_session_id: sessionId,
  });
  if (error) throw error;
}

export async function getResults(sessionId) {
  const { data, error } = await supabase.rpc("get_results", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data; // [{ id, name, ..., yes_count, participant_count, unanimous }]
}

// Own swipes only (RLS); used to resume a half-finished deck after refresh.
export async function getMySwipedEateryIds(sessionId) {
  const { data, error } = await supabase
    .from("swipes")
    .select("eatery_id")
    .eq("session_id", sessionId);
  if (error) throw error;
  return new Set(data.map((s) => s.eatery_id));
}
