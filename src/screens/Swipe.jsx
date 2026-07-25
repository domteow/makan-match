import { useEffect, useMemo, useRef, useState } from "react";
import Logo from "../components/Logo.jsx";
import SwipeDeck from "../components/SwipeDeck.jsx";
import { recordSwipe, finishSwiping, getMySwipedEateryIds } from "../lib/swipes.js";
import { passesPriceFilter } from "../lib/eateries.js";
import { formatEatery } from "../lib/format.js";

export default function Swipe({ session, participants, eateries, userId }) {
  const [swipedIds, setSwipedIds] = useState(null); // null until loaded
  const [error, setError] = useState(null);
  const finishedRef = useRef(false);

  // Resume support: a refresh mid-deck re-loads which eateries we already
  // swiped (own swipes are selectable under RLS).
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
    recordSwipe(eateryId, liked).catch((e) => setError(e.message));
  };

  const others = participants.filter((p) => p.user_id !== userId);
  // Progress denominators use the filtered deck size (same for everyone),
  // not eatery_count, which counts pre-filter rows.
  const total = visible.length;

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
      <div className="deck-status">
        {deck.length > 0
          ? `${deck.length} left · room ${session.code}`
          : "You're done!"}
      </div>
      {error && <p className="form-error">{error}</p>}
      {deck.length > 0 ? (
        <SwipeDeck deck={deck} onSwipe={handleSwipe} />
      ) : (
        <div className="waiting-panel">
          <div className="lobby-list-heading">WAITING FOR THE OTHERS…</div>
          {others.map((p) => (
            <div key={p.user_id} className="lobby-row">
              <span className="lobby-name">{p.display_name}</span>
              <span className="progress-count">
                {p.done_swiping ? "done ✓" : `${p.swipe_count}/${total}`}
              </span>
            </div>
          ))}
          {others.length === 0 && (
            <p className="screen-status">Just you in here — tallying…</p>
          )}
        </div>
      )}
      {deck.length > 0 && others.length > 0 && (
        <div className="progress-line">
          {others
            .map((p) => `${p.display_name}: ${p.done_swiping ? "done" : `${p.swipe_count}/${total}`}`)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
