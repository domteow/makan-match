import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import LocationSearch from "../components/LocationSearch.jsx";
import { createSession, joinSession } from "../lib/session.js";
import { setSessionLocation } from "../lib/eateries.js";
import { formatRadius } from "../lib/format.js";
import {
  getRememberedName,
  rememberName,
  getDeckPrefs,
  rememberDeckPrefs,
} from "../lib/prefs.js";

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

// Searching "Jewel" means you want food in and around Jewel, not across the
// East Coast — so a searched location starts tighter than the geolocation
// default. Only applied while the host has not picked a radius themselves.
const SEARCHED_RADIUS_M = 500;

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
  // Two shapes, one slot: { source: "geo", lat, lng } from the device, or
  // { source: "search", place_id, name, lat, lng } from a searched place. Only
  // the searched one has a name worth putting on the session.
  const [loc, setLoc] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const [priceMax, setPriceMax] = useState(null);
  const [openNow, setOpenNow] = useState(true); // closed places are the default no
  // Prefilled from the host's last session — see lib/prefs.js.
  const [prefs, setPrefs] = useState(getDeckPrefs);
  // The remembered radius, kept aside so the searched-location default (500m)
  // can be applied and then undone without losing what the host last chose.
  const rememberedRadiusM = useRef(prefs.radiusM);
  // Set the moment the host taps a radius chip. From then on the radius is
  // theirs and nothing auto-adjusts it — picking a second searched place must
  // not stomp the 2km they just asked for. A ref, not state: nothing renders
  // from it, and the geolocation callback fires long after its render, so a
  // captured `false` would undo a chip tapped while locating was in flight.
  const radiusTouched = useRef(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit =
    name.trim().length > 0 &&
    (isStart ? loc != null : code.trim().length > 0);

  // The radius follows the kind of location, until the host overrides it:
  // a searched mall wants 500m, "where I am now" wants whatever they last used.
  const setRadiusFor = (source) => {
    if (radiusTouched.current) return;
    const radiusM =
      source === "search" ? SEARCHED_RADIUS_M : rememberedRadiusM.current;
    setPrefs((p) => (p.radiusM === radiusM ? p : { ...p, radiusM }));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoFailed(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          source: "geo",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setRadiusFor("geo");
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

  const pickSearchedPlace = (place) => {
    setLoc({ source: "search", ...place });
    setRadiusFor("search");
    setGeoFailed(false);
  };

  // Back to no location at all rather than silently falling back to the device:
  // "Use my location" is one tap away and is the host's call, not ours.
  const clearSearchedPlace = () => {
    setLoc((prev) => (prev?.source === "search" ? null : prev));
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
          // Only a searched place has a name; the geolocation path sends null,
          // which is what keeps the lobby on radius phrasing.
          locationLabel: loc.source === "search" ? loc.name : null,
        });
        // A radius the host never touched is not a preference — remembering the
        // automatic 500m would quietly shrink their next geolocated session.
        rememberDeckPrefs({
          radiusM: radiusTouched.current
            ? prefs.radiusM
            : rememberedRadiusM.current,
          deckSize: prefs.deckSize,
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
                className={`btn ${loc?.source === "geo" ? "btn-pandan" : "btn-cream"}`}
                disabled={locating}
                onClick={useMyLocation}
              >
                {locating
                  ? "Locating…"
                  : loc?.source === "geo"
                    ? "📍 Using your location ✓"
                    : "📍 Use my location"}
              </button>
              {geoFailed && (
                <p className="field-hint">
                  Couldn&rsquo;t get your location — search for a place instead:
                </p>
              )}
              {/* Where you are is one answer; where you're meeting is the other,
                  and it's the one a plan usually starts from. */}
              <LocationSearch
                value={loc?.source === "search" ? loc : null}
                onPick={pickSearchedPlace}
                onClear={clearSearchedPlace}
              />
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
                        onClick={() => {
                          radiusTouched.current = true;
                          setPrefs((p) => ({ ...p, radiusM: o.value }));
                        }}
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
