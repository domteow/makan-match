import { useState, useRef, useEffect } from "react";
import Chip from "./Chip.jsx";

const SWIPE_THRESHOLD = 110;
const EXIT_MS = 260;

export default function SwipeCard({ eatery, onSwipe, isTop, stackIndex, forcedDir }) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [imgFailed, setImgFailed] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const start = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e) => {
    if (!isTop || leaving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag((d) => ({ ...d, active: true }));
  };

  const handlePointerMove = (e) => {
    if (!drag.active || leaving) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y, active: true });
  };

  const release = () => {
    if (!drag.active || leaving) return;
    if (Math.abs(drag.x) > SWIPE_THRESHOLD) {
      const dir = drag.x > 0 ? "right" : "left";
      setLeaving(dir);
      setTimeout(() => onSwipe(eatery.id, dir === "right"), EXIT_MS);
    } else {
      setDrag({ x: 0, y: 0, active: false });
    }
  };

  // Programmatic swipe via the ✕ / ♥ buttons
  useEffect(() => {
    if (forcedDir && isTop && !leaving) {
      setLeaving(forcedDir);
      setTimeout(() => onSwipe(eatery.id, forcedDir === "right"), EXIT_MS);
    }
  }, [forcedDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const x = leaving ? (leaving === "right" ? 600 : -600) : drag.x;
  const y = leaving ? drag.y - 40 : drag.y;
  const rot = x / 18;
  const yesOpacity = Math.min(Math.max(x / SWIPE_THRESHOLD, 0), 1);
  const noOpacity = Math.min(Math.max(-x / SWIPE_THRESHOLD, 0), 1);

  const scale = isTop ? 1 : 1 - stackIndex * 0.045;
  const offsetY = isTop ? 0 : stackIndex * 14;

  return (
    <div
      className="swipe-card"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      style={{
        transform: `translate(${isTop ? x : 0}px, ${isTop ? y + offsetY : offsetY}px) rotate(${isTop ? rot : 0}deg) scale(${scale})`,
        transition: drag.active ? "none" : "transform 0.26s cubic-bezier(.2,.8,.3,1)",
        cursor: isTop ? "grab" : "default",
        zIndex: 10 - stackIndex,
      }}
    >
      <div
        className="swipe-card-inner"
        style={{
          boxShadow: isTop
            ? "0 12px 32px rgba(0,0,0,0.35)"
            : "0 4px 12px rgba(0,0,0,0.2)",
        }}
      >
        <div className="swipe-card-photo">
          {/* Emoji fallback layer (visible if photo fails) */}
          <span className="swipe-card-emoji">{eatery.emoji}</span>
          {!imgFailed && (
            <img
              className="swipe-card-img"
              src={eatery.img}
              alt={eatery.name}
              draggable={false}
              onError={() => setImgFailed(true)}
            />
          )}
          {/* Bottom gradient so stamps + card edge read cleanly over photos */}
          <div className="swipe-card-scrim" />
          <div className="stamp stamp-shiok" style={{ opacity: yesOpacity }}>
            SHIOK
          </div>
          <div className="stamp stamp-pass" style={{ opacity: noOpacity }}>
            PASS
          </div>
        </div>
        <div className="swipe-card-info">
          <div className="swipe-card-title-row">
            <h2 className="swipe-card-name">{eatery.name}</h2>
            <span className="swipe-card-price">{eatery.price}</span>
          </div>
          <div className="swipe-card-sub">
            {eatery.cuisine} · {eatery.tag}
          </div>
          <div className="swipe-card-chips">
            <Chip>★ {eatery.rating}</Chip>
            <Chip>{eatery.dist} away</Chip>
          </div>
        </div>
      </div>
    </div>
  );
}
