import { supabase } from "./supabase.js";

// RPC errors raised in SQL arrive as error.message (e.g. "SESSION_NOT_FOUND").
// Map the known codes to friendly copy; rethrow anything else as-is.
const ERROR_COPY = {
  SESSION_NOT_FOUND: "No session with that code. Check it and try again?",
  SESSION_ALREADY_STARTED: "That session already started swiping. Ask for a new code.",
  NOT_A_PARTICIPANT: "You're not in this session. Join with the code first.",
  NOT_HOST: "Only the host can do that.",
  ALREADY_STARTED: "Session already started.",
};

function friendly(error) {
  const code = Object.keys(ERROR_COPY).find((c) => error.message?.includes(c));
  return new Error(code ? ERROR_COPY[code] : error.message);
}

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

export async function startSession(sessionId) {
  const { error } = await supabase.rpc("start_session", {
    p_session_id: sessionId,
  });
  if (error) throw friendly(error);
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
