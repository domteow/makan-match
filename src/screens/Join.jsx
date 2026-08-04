import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { createSession, joinSession } from "../lib/session.js";
import { setSessionLocation } from "../lib/eateries.js";
import { formatRadius } from "../lib/format.js";
import {
  getRememberedName,
  rememberName,
  getDeckPrefs,
  rememberDeckPrefs,
} from "../lib/prefs.js";

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

// Chips rather than a slider: four decisive choices, each an easy thumb target,
// where a slider would be a fiddly drag ending on an arbitrary 1,347m. The
// walking times are what people actually decide on — nobody has an opinion
// about metres. ~80m/min, so 500m is about five minutes.
const RADIUS_OPTIONS = [
  { value: 500, label: "500m", sub: "5 min walk" },
  { value: 1000, label: "1km", sub: "12 min walk" },
  { value: 2000, label: "2km", sub: "25 min walk" },
  { value: 5000, label: "5km", sub: "worth a ride" },
];

// 20 is the Places maximum and therefore the deck ceiling. All three sizes cost
// the same single Places call — the choice is about swiping stamina, not spend.
const DECK_OPTIONS = [
  { value: 10, label: "10", sub: "quick" },
  { value: 15, label: "15", sub: "standard" },
  { value: 20, label: "20", sub: "the works" },
];

// A chip with a headline and a bit of context under it. Two lines because the
// context ("5 min walk") is what makes the number meaningful.
function StackedChip({ selected, main, sub, onClick }) {
  return (
    <button
      type="button"
      className={`select-chip chip-stacked${selected ? " selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="chip-main">{main}</span>
      <span className="chip-sub">{sub}</span>
    </button>
  );
}

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
  // Prefilled from the host's last session — see lib/prefs.js.
  const [prefs, setPrefs] = useState(getDeckPrefs);
  const [showMore, setShowMore] = useState(false);
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
          radiusM: prefs.radiusM,
          deckSize: prefs.deckSize,
          filters: { price_max: priceMax, open_now: openNow },
        });
        rememberDeckPrefs(prefs);
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
              <span className="field-label">OPENING HOURS</span>
              <div className="filter-row">
                <button
                  type="button"
                  className={`select-chip${openNow ? " selected" : ""}`}
                  aria-pressed={openNow}
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
            {/* Everything below has a defensible default, so it stays folded
                away. The two decisions above are the ones a host must make.
                The current values ride on the label: they are remembered from
                last time, so a collapsed panel must not hide a 5km deck the
                host set a week ago and has forgotten about. */}
            <button
              type="button"
              className="disclosure"
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
            >
              <span className={`disclosure-caret${showMore ? " open" : ""}`}>
                ▸
              </span>
              <span className="disclosure-label">More options</span>
              {!showMore && (
                <span className="disclosure-summary">
                  {formatRadius(prefs.radiusM)} · {prefs.deckSize} places
                </span>
              )}
            </button>
            {showMore && (
              <div className="disclosure-body">
                <div className="field">
                  <span className="field-label">HOW FAR WILL YOU GO?</span>
                  <div className="filter-row">
                    {RADIUS_OPTIONS.map((o) => (
                      <StackedChip
                        key={o.value}
                        main={o.label}
                        sub={o.sub}
                        selected={prefs.radiusM === o.value}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, radiusM: o.value }))
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">HOW MANY PLACES TO SWIPE</span>
                  <div className="filter-row">
                    {DECK_OPTIONS.map((o) => (
                      <StackedChip
                        key={o.value}
                        main={o.label}
                        sub={o.sub}
                        selected={prefs.deckSize === o.value}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, deckSize: o.value }))
                        }
                      />
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
                        aria-pressed={priceMax === o.value}
                        onClick={() => setPriceMax(o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
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
