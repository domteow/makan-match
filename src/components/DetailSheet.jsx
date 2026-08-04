import { useEffect, useRef, useState } from "react";
import Chip from "./Chip.jsx";

// Bottom sheet over the deck: everything Places knows about the top card that
// would not fit on the card face. It deliberately does NOT cover the ✕ / ♥
// buttons — the whole point is that you can read the description and decide
// without closing the sheet first (SwipeDeck floats them above this).
//
// Not a menu. Places has no menu field. "About" is the generative description
// (which usually names dishes), "What people say" is the review summary. The
// word "menu" appears nowhere in this file on purpose.

const CLOSE_DRAG_PX = 90; // drag further than this and it closes
const DIRECTION_LOCK_PX = 10; // deadzone before we commit to a gesture

// One photo of the carousel. Hides itself if the proxy 404s or Google has
// pulled the photo, so a dead frame never leaves a grey gap mid-scroll.
function CarouselPhoto({ src, alt, eager }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="detail-photo"
      src={src}
      alt={alt}
      // The first frame is already cached from the card. The rest load as they
      // scroll into view, so opening a sheet does not fire four photo requests
      // for photos nobody looks at.
      loading={eager ? "eager" : "lazy"}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export default function DetailSheet({ eatery, onClose }) {
  const [dragY, setDragY] = useState(0);
  const scrollRef = useRef(null);
  // "idle" -> "undecided" -> "closing" | "ignored". Anything but "closing" is
  // left to the browser, so the horizontal carousel and the vertical content
  // scroll keep working normally.
  const gesture = useRef({ mode: "idle", x: 0, y: 0 });

  // The page behind is a normal scrolling document; without this a drag that
  // the sheet ignores scrolls the deck around underneath it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePointerDown = (e) => {
    gesture.current = {
      mode: "undecided",
      x: e.clientX,
      y: e.clientY,
      // The handle is a dismiss control: dragging it down works even when the
      // content underneath is scrolled halfway through the description.
      fromGrabber: e.target.classList.contains("detail-grabber"),
    };
  };

  const handlePointerMove = (e) => {
    const g = gesture.current;
    if (g.mode === "idle" || g.mode === "ignored") return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;

    if (g.mode === "undecided") {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) {
        return;
      }
      // Downward and mostly vertical, from the handle or from the top of the
      // content: a dismiss. Anything else (sideways through the carousel,
      // upward, or a downward drag while scrolled into the text) belongs to
      // the browser.
      const atTop = g.fromGrabber || (scrollRef.current?.scrollTop ?? 0) <= 0;
      g.mode = atTop && dy > 0 && dy > Math.abs(dx) ? "closing" : "ignored";
      if (g.mode === "closing") e.currentTarget.setPointerCapture(e.pointerId);
    }

    if (g.mode === "closing") setDragY(Math.max(0, dy));
  };

  const release = () => {
    const closing = gesture.current.mode === "closing";
    gesture.current.mode = "idle";
    if (closing && dragY > CLOSE_DRAG_PX) {
      onClose();
      return;
    }
    setDragY(0);
  };

  const {
    name,
    cuisine,
    tag,
    photos,
    description,
    summaryDisclosure,
    reviewSummary,
    reviewSummaryUri,
    reviewSummaryDisclosure,
    attributes,
    priceRangeText,
    websiteUri,
    mapsUri,
  } = eatery;

  const hasLinks = Boolean(websiteUri || mapsUri);

  return (
    <div
      className="detail-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`More about ${name}`}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? "none" : "transform 0.22s cubic-bezier(.2,.8,.3,1)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="detail-grabber" />
        <div className="detail-scroll" ref={scrollRef}>
          <div className="detail-head">
            <h2 className="detail-name">{name}</h2>
            <p className="detail-sub">
              {[cuisine, tag].filter(Boolean).join(" · ")}
            </p>
          </div>

          {photos.length > 0 && (
            <div className="detail-carousel">
              {photos.map((src, i) => (
                <CarouselPhoto key={src} src={src} alt={name} eager={i === 0} />
              ))}
            </div>
          )}

          {description && (
            <section className="detail-section">
              <h3 className="detail-heading">About</h3>
              <p className="detail-text">{description}</p>
              {summaryDisclosure && (
                <p className="detail-disclosure">{summaryDisclosure}</p>
              )}
            </section>
          )}

          {reviewSummary && (
            <section className="detail-section">
              <h3 className="detail-heading">What people say</h3>
              <p className="detail-text">{reviewSummary}</p>
              {reviewSummaryDisclosure && (
                <p className="detail-disclosure">{reviewSummaryDisclosure}</p>
              )}
              {/* Google requires a link to the reviews alongside a review
                  summary. Not optional, not conditional on space. */}
              {reviewSummaryUri && (
                <a
                  className="detail-review-link"
                  href={reviewSummaryUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the reviews on Google Maps ↗
                </a>
              )}
            </section>
          )}

          {attributes.length > 0 && (
            <section className="detail-section">
              <div className="detail-chips">
                {attributes.map((label) => (
                  <Chip key={label}>{label}</Chip>
                ))}
              </div>
            </section>
          )}

          {priceRangeText && (
            <section className="detail-section">
              <h3 className="detail-heading">Typical spend</h3>
              <p className="detail-price">{priceRangeText}</p>
            </section>
          )}

          {hasLinks && (
            <div className="detail-links">
              {websiteUri && (
                <a
                  className="btn btn-cream detail-link"
                  href={websiteUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  See website ↗
                </a>
              )}
              {mapsUri && (
                <a
                  className="btn btn-cream detail-link"
                  href={mapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Maps ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
