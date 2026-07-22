import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import Lobby from "./Lobby.jsx";
import Swipe from "./Swipe.jsx";
import Results from "./Results.jsx";
import { getSessionState, subscribeToSession } from "../lib/session.js";

// Container for /s/:code — loads session state, keeps it fresh via realtime,
// and renders lobby / deck / results based on session.status.
export default function Session({ userId }) {
  const { code } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setState(await getSessionState(code));
    } catch (e) {
      setError(e.message);
    }
  }, [code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sessionId = state?.session?.id;
  useEffect(() => {
    if (!sessionId) return undefined;
    return subscribeToSession(sessionId, {
      onParticipants: refresh,
      onSession: refresh,
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
      />
    );
  }

  return <Results session={session} />;
}
