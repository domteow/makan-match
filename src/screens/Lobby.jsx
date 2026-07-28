import { useState } from "react";
import Logo from "../components/Logo.jsx";
import { startSwiping, resetSessionForRedeal } from "../lib/eateries.js";

const AVATAR_COLORS = ["#E8542F", "#2E8B57", "#D4A017", "#7B5EA7", "#C8331F", "#1F7A4D"];

export default function Lobby({ sessionId, code, participants, userId, isHost }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [thin, setThin] = useState(null); // fetch-eateries' thin-deck response

  // force=true accepts a thin deck the host has already been warned about.
  // widenFirst redeals from scratch and can come back thin again, so it does
  // not force — the host sees the new count and decides once more.
  const start = async ({ widenFirst = false, force = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      if (widenFirst) {
        setThin(null); // the count is about to be re-dealt; don't show a stale one
        await resetSessionForRedeal(sessionId, 3000);
      }
      const res = await startSwiping(sessionId);
      if (res?.thin_deck && !force) {
        setThin(res);
        setBusy(false);
        return;
      }
      setThin(null);
      // No navigation here: the sessions UPDATE event flips status to
      // 'swiping' and Session re-renders everyone into the deck.
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const thinMessage = () => {
    const n = thin.eatery_count;
    const places = `${n} place${n === 1 ? "" : "s"}`;
    const closed =
      thin.closed_dropped > 0 ? ` ${thin.closed_dropped} more are closed.` : "";
    return thin.open_now
      ? `Only ${places} open around here.${closed} Widen the radius?`
      : `Only ${places} around here. Widen the radius?`;
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
      {error && <p className="form-error">{error.message}</p>}
      {thin && <p className="lobby-notice">{thinMessage()}</p>}
      {isHost ? (
        <>
          <button
            className="btn btn-orange"
            style={{ marginTop: 24 }}
            disabled={busy}
            onClick={() => start({ force: thin != null })}
          >
            {busy
              ? "Dealing the deck…"
              : thin
                ? `Swipe these ${thin.eatery_count} anyway →`
                : "Start swiping →"}
          </button>
          {(thin || error?.code === "NO_EATERIES_FOUND") && (
            <button
              className="btn btn-cream"
              style={{ marginTop: 12 }}
              disabled={busy}
              onClick={() => start({ widenFirst: true })}
            >
              Widen to 3km and try again
            </button>
          )}
        </>
      ) : (
        <p className="screen-status" style={{ marginTop: 24 }}>
          Waiting for the host to start…
        </p>
      )}
    </div>
  );
}
