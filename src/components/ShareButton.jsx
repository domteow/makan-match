import { useEffect, useRef, useState } from "react";
import { share } from "../lib/share.js";

// `payload` must already be built by the time this renders: the handler calls
// share() synchronously so navigator.share stays inside the user gesture (see
// lib/share.js). Nothing is awaited before it.
export default function ShareButton({
  payload,
  copyText,
  label = "Share the link",
  copiedLabel = "Link copied",
  className = "btn btn-cream",
  style,
}) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (message) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2400);
  };

  const onClick = () => {
    setToast(null);
    share(payload, { copyText }).then((result) => {
      // "shared" needs no feedback — the sheet was the feedback. "cancelled"
      // needs none either; the user closed it on purpose.
      if (result === "copied") flash(copiedLabel);
      if (result === "failed") flash("Couldn't share — copy the room code instead.");
    });
  };

  return (
    <>
      <button type="button" className={className} style={style} onClick={onClick}>
        {label}
      </button>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}
