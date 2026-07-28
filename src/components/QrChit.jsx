import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

// SVG rather than canvas: it scales cleanly into the fullscreen view without
// re-encoding, stays crisp at any device pixel ratio, and is just ink on cream
// like the rest of the chit.
const DARK = "#1A1512";
const LIGHT = "#FDF6E3";

// Four modules is the quiet zone the spec requires. Scanners genuinely fail
// without it, and a chit on a cream card has no natural margin of its own.
const QUIET = 4;

// One path for the whole symbol, with horizontal runs merged. A rect per dark
// module would be a few thousand nodes for something that redraws on every
// lobby render.
function modulesToPath({ size, data }) {
  let d = "";
  for (let row = 0; row < size; row++) {
    let run = 0;
    for (let col = 0; col <= size; col++) {
      const dark = col < size && data[row * size + col];
      if (dark) {
        run += 1;
      } else if (run > 0) {
        d += `M${col - run} ${row}h${run}v1h-${run}z`;
        run = 0;
      }
    }
  }
  return d;
}

function QrSvg({ symbol, code, className, style }) {
  const span = symbol.size + QUIET * 2;
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code to join room ${code}`}
    >
      <rect width={span} height={span} fill={LIGHT} />
      <path d={symbol.path} fill={DARK} transform={`translate(${QUIET} ${QUIET})`} />
    </svg>
  );
}

// Sits inside the room-code chit, under the code itself. The code stays the
// fallback: QR scanning falls apart in a dark bar, and someone can always type
// six characters.
export default function QrChit({ url, code }) {
  const [enlarged, setEnlarged] = useState(false);

  const symbol = useMemo(() => {
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    return { size: modules.size, path: modulesToPath(modules) };
  }, [url]);

  useEffect(() => {
    if (!enlarged) return undefined;
    const onKey = (e) => e.key === "Escape" && setEnlarged(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged]);

  return (
    <>
      <QrSvg symbol={symbol} code={code} className="qr-code" />
      <button type="button" className="qr-expand" onClick={() => setEnlarged(true)}>
        Show larger
      </button>

      {/* Scanning across a table needs size and light. The web can't touch
          screen brightness, so the levers we do have are a full-bleed light
          background and as many millimetres per module as the screen allows. */}
      {enlarged && (
        <div
          className="qr-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Room QR code"
          onClick={() => setEnlarged(false)}
        >
          <div className="qr-fullscreen-code">{code}</div>
          <QrSvg symbol={symbol} code={code} className="qr-code-large" />
          <div className="qr-fullscreen-hint">Point a camera at it — or type the code</div>
          <button type="button" className="btn btn-cream qr-fullscreen-close">
            Done
          </button>
        </div>
      )}
    </>
  );
}
