import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { createSession, joinSession } from "../lib/session.js";
import { setSessionLocation } from "../lib/eateries.js";
import { getRememberedName, rememberName } from "../lib/prefs.js";

// Manual fallback when geolocation is denied/unavailable. MVP: a few SG areas.
const SG_AREAS = [
  { label: "Tanjong Pagar", lat: 1.2765, lng: 103.846 },
  { label: "Orchard", lat: 1.3048, lng: 103.8318 },
  { label: "Bugis", lat: 1.3009, lng: 103.8559 },
  { label: "Jurong East", lat: 1.3329, lng: 103.7436 },
  { label: "Tampines", lat: 1.3536, lng: 103.9451 },
  { label: "Serangoon", lat: 1.3554, lng: 103.8737 },
];

const PRICE_OPTIONS = [
  { value: null, label: "Any" },
  { value: 1, label: "$" },
  { value: 2, label: "$$" },
  { value: 3, label: "$$$" },
  { value: 4, label: "$$$$" },
];

// One screen for both entry paths: mode="start" (host: name + location +
// filters) and mode="join" (code + name). ?code= prefills from a shared link.
export default function Join({ mode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isStart = mode === "start";
  // Same remembered name as the /j/:code path, prefilled rather than assumed —
  // this screen already has fields on it, so there's nothing to save by hiding it.
  const [name, setName] = useState(() => getRememberedName() ?? "");
  const [code, setCode] = useState(
    (searchParams.get("code") || "").toUpperCase()
  );
  const [loc, setLoc] = useState(null); // { lat, lng, label }
  const [locating, setLocating] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const [priceMax, setPriceMax] = useState(null);
  const [openNow, setOpenNow] = useState(true); // closed places are the default no
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit =
    name.trim().length > 0 &&
    (isStart ? loc != null : code.trim().length > 0);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoFailed(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "My location",
        });
        setGeoFailed(false);
        setLocating(false);
      },
      () => {
        setGeoFailed(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      let res;
      if (isStart) {
        res = await createSession(name.trim());
        // Location must be on the session before the lobby's Start button
        // can work (fetch-eateries rejects sessions without lat/lng).
        await setSessionLocation(res.session_id, {
          lat: loc.lat,
          lng: loc.lng,
          radiusM: 1500,
          filters: { price_max: priceMax, open_now: openNow },
        });
      } else {
        res = await joinSession(code.trim(), name.trim());
      }
      rememberName(name); // only once it worked
      navigate(`/s/${res.code}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <Logo />
      <form className="form" onSubmit={submit}>
        {!isStart && (
          <label className="field">
            <span className="field-label">ROOM CODE</span>
            <input
              className="text-input code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MKN7B3"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <label className="field">
          <span className="field-label">YOUR NAME</span>
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Treva"
            maxLength={30}
            autoComplete="off"
          />
        </label>
        {isStart && (
          <>
            <div className="field">
              <span className="field-label">WHERE ARE YOU EATING?</span>
              <button
                type="button"
                className={`btn ${loc?.label === "My location" ? "btn-pandan" : "btn-cream"}`}
                disabled={locating}
                onClick={useMyLocation}
              >
                {locating
                  ? "Locating…"
                  : loc?.label === "My location"
                    ? "📍 Using your location ✓"
                    : "📍 Use my location"}
              </button>
              {geoFailed && (
                <p className="field-hint">
                  Couldn&rsquo;t get your location — pick an area instead:
                </p>
              )}
              <div className="area-grid">
                {SG_AREAS.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    className={`select-chip${loc?.label === a.label ? " selected" : ""}`}
                    onClick={() => setLoc(a)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">BUDGET</span>
              <div className="filter-row">
                {PRICE_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    className={`select-chip${priceMax === o.value ? " selected" : ""}`}
                    onClick={() => setPriceMax(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="field-label">OPENING HOURS</span>
              <div className="filter-row">
                <button
                  type="button"
                  className={`select-chip${openNow ? " selected" : ""}`}
                  onClick={() => setOpenNow((v) => !v)}
                >
                  {openNow ? "✓ " : ""}Open now only
                </button>
              </div>
              {openNow && (
                <p className="field-hint">
                  Hides places Google says are closed. Stalls with no hours
                  listed still show, tagged &ldquo;hours unknown&rdquo;.
                </p>
              )}
            </div>
          </>
        )}
        {error && <p className="form-error">{error}</p>}
        <button
          type="submit"
          className={`btn ${canSubmit ? "btn-orange" : "btn-muted"}`}
          disabled={!canSubmit || busy}
        >
          {busy ? "Hold on ah…" : isStart ? "Start a session" : "Join the queue"}
        </button>
        <button
          type="button"
          className="btn btn-cream"
          onClick={() => navigate("/")}
        >
          Back
        </button>
      </form>
    </div>
  );
}
