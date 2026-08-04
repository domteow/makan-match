import { useMemo, useState } from "react";
import Logo from "../components/Logo.jsx";
import QrChit from "../components/QrChit.jsx";
import ShareButton from "../components/ShareButton.jsx";
import {
  startSwiping,
  resetSessionForRedeal,
  reshuffleDeck,
  passesPriceFilter,
} from "../lib/eateries.js";
import { joinUrl, sessionSharePayload } from "../lib/share.js";
import { formatRadius } from "../lib/format.js";

const AVATAR_COLORS = ["#E8542F", "#2E8B57", "#D4A017", "#7B5EA7", "#C8331F", "#1F7A4D"];

export default function Lobby({
  session,
  sessionId,
  code,
  participants,
  eateries = [],
  userId,
  isHost,
  onRefresh,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [thin, setThin] = useState(null); // fetch-eateries' thin-deck response
  const [shuffling, setShuffling] = useState(false);

  // Built up front, not on tap: the share handler must reach navigator.share
  // without awaiting anything (see lib/share.js).
  const url = useMemo(() => joinUrl(code), [code]);
  const payload = useMemo(() => sessionSharePayload(code), [code]);

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

  // The deck only exists once fetch-eateries has run — which normally starts
  // the session in the same breath, so the lobby sees a real deck only when a
  // thin one is being held here for the host to decide on. Before that we
  // describe the deck the host has asked for, not one that exists.
  //
  // price_max is applied client-side (Nearby Search has no price parameter),
  // so the preview filters the same way the deck will, and the count here is
  // the count people will actually swipe.
  const dealt = eateries.length > 0;
  const deck = useMemo(
    () => eateries.filter((e) => passesPriceFilter(e, session?.filters)),
    [eateries, session?.filters]
  );
  const deckCount = dealt ? deck.length : (session?.deck_size ?? 15);
  const deckSummary = `${deckCount} place${deckCount === 1 ? "" : "s"} within ${formatRadius(session?.radius_m)}`;

  // Honest label: this re-draws from the places we already found nearby (the
  // reserve fetch-eateries stored beyond deck_size). It does not search further
  // afield, and it costs no Places call.
  const shuffle = async () => {
    setShuffling(true);
    setError(null);
    try {
      await reshuffleDeck(sessionId);
      // The host's own refresh. Everyone else re-fetches off the sessions
      // UPDATE that reshuffle_deck stamps, so no one previews a stale order.
      await onRefresh?.();
    } catch (e) {
      setError(e);
    } finally {
      setShuffling(false);
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
      {/* Two ways in, for two situations: scan it if you're at the same table,
          share the link if you're deciding over a group chat. */}
      <div className="room-code-ticket">
        <div className="room-code-label">ROOM CODE</div>
        <div className="room-code-value">{code}</div>
        <QrChit url={url} code={code} />
      </div>
      <ShareButton
        payload={payload}
        label="Share the link ↗"
        className="btn btn-cream share-btn"
      />
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
      {/* Deck summary. This whole screen only renders while status is 'lobby'
          (Session.jsx switches on it), which is also the only state in which
          reshuffling is safe — after Start, re-drawing would strand swipes on
          cards that left the deck. */}
      <div className="deck-summary">
        <span className="deck-summary-line">{deckSummary}</span>
        {isHost && dealt && (
          <button
            type="button"
            className="deck-shuffle"
            disabled={shuffling || busy}
            onClick={shuffle}
          >
            {shuffling ? "Shuffling…" : "🎲 Shuffle"}
          </button>
        )}
      </div>
      {dealt && deck.length > 0 && (
        <p className="deck-preview">
          {deck.slice(0, 3).map((e) => e.name).join(" · ")}
          {deck.length > 3 && ` +${deck.length - 3} more`}
        </p>
      )}
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
