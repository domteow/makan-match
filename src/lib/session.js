import { supabase } from "./supabase.js";
import { friendlyError as friendly } from "./errors.js";

export async function createSession(displayName) {
  const { data, error } = await supabase.rpc("create_session", {
    p_display_name: displayName,
  });
  if (error) throw friendly(error);
  return data; // { session_id, code, status }
}

export async function joinSession(code, displayName) {
  const { data, error } = await supabase.rpc("join_session", {
    p_code: code,
    p_display_name: displayName,
  });
  if (error) throw friendly(error);
  return data; // { session_id, code, status }
}

export async function getSessionState(code) {
  const { data, error } = await supabase.rpc("get_session_state", {
    p_code: code,
  });
  if (error) throw friendly(error);
  return data; // { session, participants, eateries }
}

// One channel per session: participant joins/updates + session status changes.
// Returns an unsubscribe function.
export function subscribeToSession(sessionId, { onParticipants, onSession }) {
  const channel = supabase
    .channel(`session-${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "participants",
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => onParticipants?.(payload)
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "sessions",
        filter: `id=eq.${sessionId}`,
      },
      (payload) => onSession?.(payload.new)
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
