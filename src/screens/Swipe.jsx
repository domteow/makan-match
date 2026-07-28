import { useEffect, useMemo, useRef, useState } from "react";
import Logo from "../components/Logo.jsx";
import SwipeDeck from "../components/SwipeDeck.jsx";
import ProgressRow from "../components/ProgressRow.jsx";
import RevealSheet from "../components/RevealSheet.jsx";
import ShareButton from "../components/ShareButton.jsx";
import { sessionSharePayload } from "../lib/share.js";
import { recordSwipe, finishSwiping, getMySwipedEateryIds } from "../lib/swipes.js";
import { revealNow, joinedLate } from "../lib/session.js";
import { passesPriceFilter } from "../lib/eateries.js";
import { formatEatery } from "../lib/format.js";

export default function Swipe({ session, participants, eateries, userId, isHost }) {
  const [swipedIds, setSwipedIds] = useState(null); // null until loaded
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(null);
  const finishedRef = useRef(false);

  // Resume support: a refresh mid-deck (or a late joiner arriving with an
  // empty slate) re-loads which eateries we already swiped. Own swipes are
  // selectable under RLS.
  useEffect(() => {
    getMySwipedEateryIds(session.id)
      .then(setSwipedIds)
      .catch((e) => setError(e.message));
  }, [session.id]);

  // price_max is applied client-side (see passesPriceFilter); every client
  // filters identically from session.filters, so the deck matches for all.
  const visible = useMemo(
    () => eateries.filter((e) => passesPriceFilter(e, session.filters)),
    [eateries, session.filters]
  );

  // Resume position is "everything I have no swipe for", in the original
  // position order. A late joiner has no swipes, so that is the whole deck —
  // card order is never realigned to where anyone else has got to.
  const deck = useMemo(() => {
    if (!swipedIds) return [];
    return visible.filter((e) => !swipedIds.has(e.id)).map(formatEatery);
  }, [visible, swipedIds]);

  // Deck exhausted (now, or already when we loaded) -> tell the server.
  // finish_swiping is idempotent, so firing again after a refresh is fine.
  useEffect(() => {
    if (!swipedIds || deck.length > 0 || finishedRef.current) return;
    finishedRef.current = true;
    finishSwiping(session.id).catch((e) => setError(e.message));
  }, [swipedIds, deck.length, session.id]);

  const handleSwipe = (eateryId, liked) => {
    setSwipedIds((prev) => new Set(prev).add(eateryId));
    recordSwipe(eateryId, liked).catch((e) => {
      // The host revealed between the drag starting and the write landing.
      // The sessions UPDATE is already on its way to move us to results —
      // an error here would just be noise.
      if (e.code === "SESSION_NOT_SWIPING") return;
      setError(e.message);
    });
  };

  const reveal = async () => {
    setRevealing(true);
    setRevealError(null);
    try {
      await revealNow(session.id);
      // No navigation here: the sessions UPDATE lands everyone on results
      // together, host included.
    } catch (e) {
      setRevealError(e.message);
      setRevealing(false);
    }
  };

  // Progress denominators use the filtered deck size (same for everyone),
  // not eatery_count, which counts pre-filter rows.
  const total = visible.length;
  const me = participants.find((p) => p.user_id === userId);
  const others = participants.filter((p) => p.user_id !== userId);
  const done = deck.length === 0;

  // Late shares: someone turns up after the deck went live and needs the link.
  // Built here rather than in the handler so the share stays inside the gesture.
  const sharePayload = useMemo(
    () => sessionSharePayload(session.code),
    [session.code]
  );

  if (!swipedIds) {
    return (
      <div className="shell">
        <Logo />
        <p className="screen-status" style={{ marginTop: 40 }}>Shuffling the deck…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <Logo />
      <div className="deck-bar">
        <div className="deck-status">
          {done ? "You're done!" : `${deck.length} left · room ${session.code}`}
          {joinedLate(me, session) && !done && " · you joined late"}
        </div>
        <ShareButton
          payload={sharePayload}
          label="Share ↗"
          className="deck-share"
        />
      </div>
      {error && <p className="form-error">{error}</p>}

      {done ? (
        <div className="waiting-panel">
          {others.length > 0 ? (
            <>
              <div className="lobby-list-heading">WAITING FOR THE OTHERS…</div>
              <ProgressRow
                participants={participants}
                session={session}
                userId={userId}
                total={total}
              />
            </>
          ) : (
            <p className="screen-status">Just you in here — tallying…</p>
          )}
        </div>
      ) : (
        <>
          <SwipeDeck deck={deck} onSwipe={handleSwipe} />
          {participants.length > 1 && (
            <ProgressRow
              participants={participants}
              session={session}
              userId={userId}
              total={total}
            />
          )}
        </>
      )}

      {isHost && (
        <button
          className="btn btn-cream reveal-btn"
          onClick={() => {
            setRevealError(null);
            setConfirming(true);
          }}
        >
          Reveal now
        </button>
      )}

      {confirming && (
        <RevealSheet
          participants={participants}
          userId={userId}
          total={total}
          busy={revealing}
          error={revealError}
          onConfirm={reveal}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
