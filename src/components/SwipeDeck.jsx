import { useState } from "react";
import SwipeCard from "./SwipeCard.jsx";

export default function SwipeDeck({ deck, onSwipe }) {
  const [forcedDir, setForcedDir] = useState(null);

  const handleSwipe = (id, liked) => {
    setForcedDir(null);
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
              forcedDir={i === 0 ? forcedDir : null}
            />
          ))
          .reverse()}
        {deck.length === 0 && <div className="deck-empty">Tallying votes…</div>}
      </div>
      {deck.length > 0 && (
        <div className="swipe-actions">
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
    </>
  );
}
