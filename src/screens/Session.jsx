import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import Lobby from "./Lobby.jsx";
import Swipe from "./Swipe.jsx";
import Results from "./Results.jsx";
import {
  getSessionState,
  subscribeToSession,
  applyParticipantChange,
} from "../lib/session.js";

// Container for /s/:code — loads session state, keeps it fresh via realtime,
// and renders lobby / deck / results based on session.status. Status is only
// ever read from the server, never assumed locally, so every client switches
// screens off the same fact.
export default function Session({ userId }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const hostIdRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSessionState(code);
      hostIdRef.current = next.session.host_id;
      setState(next);
      setError(null);
    } catch (e) {
      // Shared link opened by someone who hasn't joined yet: send them to
      // the join screen with the code prefilled instead of a dead end.
      if (e.code === "NOT_A_PARTICIPANT") {
        navigate(`/join?code=${encodeURIComponent(code)}`, { replace: true });
        return;
      }
      setError(e.message);
    }
  }, [code, navigate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sessionId = state?.session?.id;
  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeToSession(sessionId, {
      // Progress ticks are a single integer on a row we already have —
      // patch it locally rather than refetching the whole session per swipe.
      onParticipant: (payload) =>
        setState((prev) =>
          prev ? applyParticipantChange(prev, payload, hostIdRef.current) : prev
        ),
      // A status change means the deck was dealt, revealed, or redealt —
      // all of which change more than we can patch. Re-read everything.
      onSession: refresh,
      onResync: refresh,
    });
  }, [sessionId, refresh]);

  if (error) {
    return (
      <div className="shell">
        <Logo />
        <p className="form-error" style={{ marginTop: 40 }}>{error}</p>
        <button
          className="btn btn-cream"
          style={{ marginTop: 16 }}
          onClick={() => navigate("/")}
        >
          Back to start
        </button>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="shell">
        <Logo />
        <p className="screen-status" style={{ marginTop: 40 }}>Finding your table…</p>
      </div>
    );
  }

  const { session, participants, eateries } = state;
  const isHost = session.host_id === userId;

  if (session.status === "lobby") {
    return (
      <Lobby
        sessionId={session.id}
        code={session.code}
        participants={participants}
        userId={userId}
        isHost={isHost}
      />
    );
  }

  if (session.status === "swiping") {
    return (
      <Swipe
        session={session}
        participants={participants}
        eateries={eateries}
        userId={userId}
        isHost={isHost}
      />
    );
  }

  return (
    <Results session={session} participants={participants} isHost={isHost} />
  );
}
