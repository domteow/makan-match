import { useEffect, useRef, useState } from "react";
import { autocompletePlaces, resolvePlace, MIN_QUERY_LENGTH } from "../lib/places.js";
import { getRecentLocations, rememberLocation } from "../lib/prefs.js";

// "We're meeting at Jewel later" — type a place or mall, pick it, and the deck
// is built around that point instead of wherever the host's phone is.
//
// THE DEBOUNCE AND THE MINIMUM LENGTH ARE COST CONTROLS, NOT UX PREFERENCES.
// Autocomplete is billed per request, so firing per keystroke is the difference
// between ~3 requests per search and ~15. Do not remove the debounce and do not
// lower MIN_QUERY_LENGTH. See docs/COSTS.md.
const DEBOUNCE_MS = 350;

// value / onPick trade the resolved shape { place_id, name, lat, lng }.
// onClear drops back to no searched location (the geolocation path).
export default function LocationSearch({ value, onPick, onClear }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null); // null = nothing searched yet
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(null); // place_id being resolved
  const [error, setError] = useState(null);
  const [recents, setRecents] = useState(getRecentLocations);
  // Guards the async resolve: a host who dismisses the chip or picks something
  // else mid-flight must not have the earlier answer land on top of it.
  const pickSeq = useRef(0);

  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setSearching(false);
      return undefined;
    }

    // One trailing timer per query value, so a fast typist fires a single
    // request when they stop rather than one per character.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const predictions = await autocompletePlaces(q, {
          signal: controller.signal,
        });
        // null means a newer keystroke aborted this one — leave the list alone.
        if (predictions) setResults(predictions);
      } catch (e) {
        setError(e.message);
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    // Runs on every query change: cancels a debounce that has not fired yet,
    // and aborts the request if it has, so requests never stack up behind a
    // fast typist.
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  const commit = (location) => {
    setRecents(rememberLocation(location));
    setQuery("");
    setResults(null);
    setError(null);
    onPick(location);
  };

  const pickPrediction = async (prediction) => {
    const seq = ++pickSeq.current;
    setResolving(prediction.place_id);
    setError(null);
    try {
      const place = await resolvePlace(prediction.place_id);
      if (seq !== pickSeq.current) return; // superseded; drop it
      commit(place);
    } catch (e) {
      if (seq === pickSeq.current) setError(e.message);
    } finally {
      if (seq === pickSeq.current) setResolving(null);
    }
  };

  // The free path, and the common one for a regular spot: the lat/lng is
  // already on the device, so neither Google call happens at all.
  const pickRecent = (location) => {
    pickSeq.current += 1;
    setResolving(null);
    commit(location);
  };

  const clear = () => {
    pickSeq.current += 1;
    setResolving(null);
    setError(null);
    onClear();
  };

  const tooShort = q.length > 0 && q.length < MIN_QUERY_LENGTH;

  // This field lives inside the create form, so Enter (and the phone
  // keyboard's "Go") would otherwise submit it — starting the session on
  // whatever location was chosen before, mid-search. Enter picks the top
  // prediction instead, which is what pressing it here means.
  const onKeyDown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const top = results?.[0];
    if (top && resolving == null) pickPrediction(top);
  };

  return (
    <div className="location-search">
      {/* What the deck will be built around, stated plainly and dismissible —
          the alternative is a search field that looks empty while the session
          quietly points at whatever was tapped a minute ago. */}
      {value && (
        <button
          type="button"
          className="location-chip"
          aria-label={`Clear ${value.name}`}
          onClick={clear}
        >
          <span className="location-chip-name">📍 {value.name}</span>
          <span className="location-chip-x" aria-hidden="true">
            ✕
          </span>
        </button>
      )}

      <input
        className="text-input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="or search a place or mall"
        aria-label="Search for a place or mall"
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
      />

      {tooShort && (
        <p className="field-hint">Keep typing — {MIN_QUERY_LENGTH} letters minimum.</p>
      )}
      {searching && <p className="field-hint">Searching…</p>}
      {error && <p className="form-error">{error}</p>}

      {results?.length === 0 && !searching && !error && (
        <p className="field-hint">Nothing matched &ldquo;{q}&rdquo;.</p>
      )}

      {results?.length > 0 && (
        <ul className="place-results">
          {results.map((r) => (
            <li key={r.place_id}>
              <button
                type="button"
                className="place-result"
                disabled={resolving != null}
                onClick={() => pickPrediction(r)}
              >
                <span className="place-primary">{r.primary_text}</span>
                {r.secondary_text && (
                  <span className="place-secondary">{r.secondary_text}</span>
                )}
                {resolving === r.place_id && (
                  <span className="place-secondary">Pinning it…</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Only while the field is empty and nothing is chosen: two competing
          answers to "where are we eating" on screen at once is worse than one. */}
      {!value && q.length === 0 && recents.length > 0 && (
        <>
          <p className="field-hint">Recent</p>
          <div className="filter-row">
            {recents.map((r) => (
              <button
                key={r.place_id}
                type="button"
                className="select-chip"
                onClick={() => pickRecent(r)}
              >
                {r.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
