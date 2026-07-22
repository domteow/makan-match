import { useState } from "react";
import Logo from "../components/Logo.jsx";
import { startSession } from "../lib/session.js";

const AVATAR_COLORS = ["#E8542F", "#2E8B57", "#D4A017", "#7B5EA7", "#C8331F", "#1F7A4D"];

export default function Lobby({ sessionId, code, participants, userId, isHost }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await startSession(sessionId);
      // No navigation here: the sessions UPDATE event flips status to
      // 'swiping' and Session re-renders everyone into the deck.
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <Logo />
      <div className="room-code-ticket">
        <div className="room-code-label">ROOM CODE</div>
        <div className="room-code-value">{code}</div>
      </div>
      <div className="lobby-list">
        <div className="lobby-list-heading">
          IN THE QUEUE ({participants.length})
        </div>
        {participants.map((p, i) => (
          <div key={p.user_id} className="lobby-row">
            <div
              className="lobby-avatar"
              style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
            >
              {p.display_name[0].toUpperCase()}
            </div>
            <span className="lobby-name">
              {p.display_name}
              {p.user_id === userId && " (you)"}
            </span>
            {p.is_host && <span className="lobby-host-badge">HOST</span>}
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      {isHost ? (
        <button
          className="btn btn-orange"
          style={{ marginTop: 24 }}
          disabled={busy}
          onClick={start}
        >
          {busy ? "Dealing the deck…" : "Start swiping →"}
        </button>
      ) : (
        <p className="screen-status" style={{ marginTop: 24 }}>
          Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
