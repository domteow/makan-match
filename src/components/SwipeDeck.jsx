import { useState } from "react";
import SwipeCard from "./SwipeCard.jsx";
import DetailSheet from "./DetailSheet.jsx";

export default function SwipeDeck({ deck, onSwipe }) {
  const [forcedDir, setForcedDir] = useState(null);
  const [detailId, setDetailId] = useState(null);

  // Derived from the top card rather than held as its own object: when the
  // deck advances (a swipe, a resync) the sheet for the card that just left
  // closes itself. Nobody reads details for something they already voted on.
  const top = deck[0];
  const detail = top && top.id === detailId ? top : null;

  const handleSwipe = (id, liked) => {
    setForcedDir(null);
    setDetailId(null);
    onSwipe(id, liked);
  };

  return (
    <>
      <div className="deck">
        {deck
          .slice(0, 3)
          .map((eatery, i) => (
            <SwipeCard
              key={eatery.id}
              eatery={eatery}
              isTop={i === 0}
              stackIndex={i}
              onSwipe={handleSwipe}
              onExpand={() => setDetailId(eatery.id)}
              forcedDir={i === 0 ? forcedDir : null}
            />
          ))
          .reverse()}
        {deck.length === 0 && <div className="deck-empty">Tallying votes…</div>}
      </div>
      {deck.length > 0 && (
        // With the sheet open these lift above it and pin to the bottom of the
        // viewport: reading the description and deciding is one gesture, not
        // "close the sheet, then swipe".
        <div className={`swipe-actions${detail ? " swipe-actions-floating" : ""}`}>
          <button
            className="btn btn-chili swipe-action-btn"
            onClick={() => setForcedDir("left")}
            aria-label="Pass"
          >
            ✕
          </button>
          <button
            className="btn btn-pandan swipe-action-btn"
            onClick={() => setForcedDir("right")}
            aria-label="Shiok"
          >
            ♥
          </button>
        </div>
      )}
      {/* Mounted only while open, which is what keeps photos 2-5 off the deck
          load: most cards are never expanded. */}
      {detail && (
        <DetailSheet eatery={detail} onClose={() => setDetailId(null)} />
      )}
    </>
  );
}
