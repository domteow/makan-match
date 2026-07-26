import { supabase } from "./supabase.js";
import { friendlyError as friendly } from "./errors.js";

export async function createSession(displayName) {
  const { data, error } = await supabase.rpc("create_session", {
    p_display_name: displayName,
  });
  if (error) throw friendly(error);
  return data; // { session_id, code, status }
}

// Succeeds while the session is still 'swiping' (late joins are supported);
// the returned status tells the caller whether to expect a lobby or a deck.
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

// Host override: ends swiping immediately. Everyone is subscribed to the
// sessions UPDATE, so all clients land on results without polling.
export async function revealNow(sessionId) {
  const { error } = await supabase.rpc("reveal_now", {
    p_session_id: sessionId,
  });
  if (error) throw friendly(error);
}

// One channel per session: participant joins/updates + session status changes.
// Returns an unsubscribe function.
//
// onParticipant receives the raw payload so callers can patch their local
// roster instead of refetching: the swipe_count trigger fires on every swipe
// by everyone, so a full get_session_state per event would be n^2 round trips
// for a session that is only ever changing one integer.
//
// onResync fires when we may have missed events — first join, a rejoin after
// the socket dropped, the tab coming back to the foreground, the device coming
// back online. Callers re-run get_session_state so a missed status UPDATE
// cannot strand someone on a dead deck after the host has revealed.
export function subscribeToSession(
  sessionId,
  { onParticipant, onSession, onResync }
) {
  let stopped = false;
  const resync = () => {
    if (!stopped) onResync?.();
  };

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
      (payload) => onParticipant?.(payload)
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
    .subscribe((status) => {
      // Fires on the initial join and again on every rejoin after a drop.
      // Treat both the same: re-read the truth from the server.
      if (status === "SUBSCRIBED") resync();
    });

  // Realtime can stay quietly dead after a sleep or an offline stretch, and
  // a phone that was in a pocket during the reveal gets no rejoin at all.
  // These are the cheap signals that we are back.
  const onVisibility = () => {
    if (document.visibilityState === "visible") resync();
  };
  window.addEventListener("online", resync);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopped = true;
    window.removeEventListener("online", resync);
    document.removeEventListener("visibilitychange", onVisibility);
    supabase.removeChannel(channel);
  };
}

// Apply a participants realtime payload to a loaded session state. Returns
// the same object when nothing changed so React can skip the re-render.
export function applyParticipantChange(state, payload, hostId) {
  const row = payload.eventType === "DELETE" ? payload.old : payload.new;
  if (!row?.user_id) return state;

  const toEntry = (r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    swipe_count: r.swipe_count,
    done_swiping: r.done_swiping,
    joined_at: r.joined_at,
    is_host: r.user_id === hostId,
  });

  const current = state.participants;
  const i = current.findIndex((p) => p.user_id === row.user_id);

  if (payload.eventType === "DELETE") {
    if (i === -1) return state;
    return { ...state, participants: current.filter((_, j) => j !== i) };
  }

  if (i === -1) {
    // Late joiner. Keep the roster in joined_at order, as the server returns it.
    const next = [...current, toEntry(row)].sort((a, b) =>
      String(a.joined_at).localeCompare(String(b.joined_at))
    );
    return { ...state, participants: next };
  }

  const updated = toEntry(row);
  const existing = current[i];
  const unchanged =
    existing.swipe_count === updated.swipe_count &&
    existing.done_swiping === updated.done_swiping &&
    existing.display_name === updated.display_name;
  if (unchanged) return state;

  const next = [...current];
  next[i] = updated;
  return { ...state, participants: next };
}

// A participant who arrived after the deck went live. started_at is stamped
// on the lobby -> swiping transition and cleared by a redeal, so this stays
// correct across rounds.
export function joinedLate(participant, session) {
  if (!session?.started_at || !participant?.joined_at) return false;
  return new Date(participant.joined_at) > new Date(session.started_at);
}
