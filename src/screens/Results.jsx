import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { getResults } from "../lib/swipes.js";
import { resetSessionForRedeal } from "../lib/eateries.js";
import { formatEatery } from "../lib/format.js";

const STAGGER_MS = 60;

// The fraction is always votes cast on that card, never headcount — with
// partial participation those differ, and a card two people saw and both
// loved is a 2/2, not a 2/3. Spell out the gap rather than hide it.
function voteLabel(row) {
  const missing = (row.participant_count ?? 0) - (row.vote_count ?? 0);
  const base = `${row.yes_count}/${row.vote_count} liked`;
  if (missing <= 0) return base;
  return `${base} · ${missing} didn't vote`;
}

// Hours matter most on this screen: it is the one people act on, and a session
// can run long enough for a place to close between the fetch and the decision.
// So the closing time shows whenever it is known, not only when it is imminent.
function Hours({ e }) {
  const label = e.closesLabel || (e.hoursUnknown ? "hours unknown" : null);
  if (!label) return null;
  return (
    <span className={`hours-note${e.closingSoon ? " soon" : ""}`}> · {label}</span>
  );
}

function Meta({ e, row }) {
  return (
    <>
      {[e.cuisine, e.dist, e.price].filter(Boolean).join(" · ")}
      {row.rating != null && ` · ★ ${row.rating}`}
      <Hours e={e} />
    </>
  );
}

function MapsLink({ row }) {
  if (!row.maps_uri) return null;
  return (
    <a className="maps-link" href={row.maps_uri} target="_blank" rel="noreferrer">
      Open in Maps ↗
    </a>
  );
}

// The one card that won outright: full-bleed photo, brand orange, the
// biggest type on the screen.
function HeroCard({ row }) {
  const e = formatEatery(row);
  return (
    <div className="hero-card">
      <div className="hero-photo">
        <span className="hero-emoji">{e.emoji}</span>
        {e.img && (
          <img
            src={e.img}
            alt=""
            draggable={false}
            onError={(ev) => {
              ev.target.style.display = "none";
            }}
          />
        )}
        <div className="hero-scrim" />
        <div className="hero-stamp">IT&rsquo;S A MAKAN MATCH</div>
      </div>
      <div className="hero-info">
        <h2 className="hero-name">{e.name}</h2>
        <div className="hero-meta">
          <Meta e={e} row={row} />
        </div>
        <div className="hero-votes">{voteLabel(row)} · everyone in</div>
        <MapsLink row={row} />
      </div>
    </div>
  );
}

function ResultRow({ row, tier }) {
  const e = formatEatery(row);
  return (
    <div className={`result-row tier-${tier}`}>
      <div className="result-thumb">
        <span>{e.emoji}</span>
        {e.img && (
          <img
            src={e.img}
            alt=""
            draggable={false}
            onError={(ev) => {
              ev.target.style.display = "none";
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="result-name">{e.name}</div>
        <div className="result-sub">
          <Meta e={e} row={row} />
        </div>
        <div className={`result-votes tier-${tier}`}>{voteLabel(row)}</div>
        <MapsLink row={row} />
      </div>
      <div className="result-score">
        <div className={`result-score-count tier-${tier}`}>
          {row.yes_count}/{row.vote_count}
        </div>
        {tier === "allin" && <div className="result-all-in">ALL IN</div>}
        {tier === "sweep" && <div className="result-sweep">SWEEP</div>}
      </div>
    </div>
  );
}

export default function Results({ session, participants, isHost }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [redealing, setRedealing] = useState(false);

  useEffect(() => {
    getResults(session.id)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [session.id]);

  // Zero matches: host widens to 3km and redeals. The reset flips the session
  // back to 'lobby'; the sessions UPDATE moves everyone there automatically.
  const widenAndRedeal = async () => {
    setRedealing(true);
    setError(null);
    try {
      await resetSessionForRedeal(session.id, 3000);
    } catch (e) {
      setError(e.message);
      setRedealing(false);
    }
  };

  if (error) {
    return (
      <div className="shell">
        <Logo />
        <p className="form-error" style={{ marginTop: 40 }}>{error}</p>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="shell">
        <Logo />
        <p className="screen-status" style={{ marginTop: 40 }}>Tallying votes…</p>
      </div>
    );
  }

  const allIn = rows.filter((r) => r.unanimous);
  const sweeps = rows.filter((r) => r.clean_sweep);
  const crowd = rows.filter((r) => !r.unanimous && !r.clean_sweep);
  const [hero, ...moreAllIn] = allIn;

  const revealer = participants.find((p) => p.user_id === session.revealed_by);
  const headcount = participants.length;
  const context = [
    `${headcount} of you swiped`,
    session.revealed_by
      ? `revealed by ${revealer?.display_name ?? "the host"}`
      : "everyone finished",
  ].join(" · ");

  // One running index across every card so the whole page deals itself out
  // top to bottom, tier headings included.
  let step = 0;
  const dealt = () => ({ animationDelay: `${step++ * STAGGER_MS}ms` });

  return (
    <div className="shell">
      <Logo />
      <div className="results-heading reveal-in" style={dealt()}>
        {rows.length > 0 ? "Here's the verdict" : "No matches 😅"}
      </div>
      <div className="results-context reveal-in" style={dealt()}>{context}</div>

      <div className="results-list">
        {hero && (
          <div className="hero-wrap" style={dealt()}>
            <HeroCard row={hero} />
          </div>
        )}

        {moreAllIn.length > 0 && (
          <>
            <div className="results-tier-heading reveal-in" style={dealt()}>
              ALSO ALL IN
            </div>
            {moreAllIn.map((r) => (
              <div key={r.id} className="reveal-in" style={dealt()}>
                <ResultRow row={r} tier="allin" />
              </div>
            ))}
          </>
        )}

        {sweeps.length > 0 && (
          <>
            <div className="results-tier-heading reveal-in" style={dealt()}>
              CLEAN SWEEP · EVERYONE WHO SAW IT SAID YES
            </div>
            {sweeps.map((r) => (
              <div key={r.id} className="reveal-in" style={dealt()}>
                <ResultRow row={r} tier="sweep" />
              </div>
            ))}
          </>
        )}

        {crowd.length > 0 && (
          <>
            <div className="results-tier-heading reveal-in" style={dealt()}>
              CROWD FAVOURITES
            </div>
            {crowd.map((r) => (
              <div key={r.id} className="reveal-in" style={dealt()}>
                <ResultRow row={r} tier="crowd" />
              </div>
            ))}
          </>
        )}

        {rows.length === 0 && (
          <p className="results-empty reveal-in" style={dealt()}>
            Everyone too picky lah. Try a wider radius?
          </p>
        )}
      </div>

      {rows.length === 0 &&
        (isHost ? (
          <button
            className="btn btn-orange"
            style={{ marginTop: 16 }}
            disabled={redealing}
            onClick={widenAndRedeal}
          >
            {redealing ? "Redealing…" : "Widen to 3km and redeal"}
          </button>
        ) : (
          <p className="screen-status" style={{ marginTop: 16 }}>
            Ask the host to widen the radius and redeal.
          </p>
        ))}
      <button
        className="btn btn-cream"
        style={{ marginTop: 16 }}
        onClick={() => navigate("/")}
      >
        New session
      </button>
    </div>
  );
}
