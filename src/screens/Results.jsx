import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { getResults } from "../lib/swipes.js";
import { formatEatery } from "../lib/format.js";
import { MOCK_MEDIA } from "../data/mockMedia.js";

function ResultRow({ row, topPick }) {
  const e = formatEatery(row, MOCK_MEDIA[row.name]);
  return (
    <div className={`result-row${topPick ? " top-pick" : ""}`}>
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
      <div style={{ flex: 1 }}>
        <div className="result-name">{e.name}</div>
        <div className="result-sub">
          {e.cuisine} · {e.dist} · {e.price}
        </div>
      </div>
      <div className="result-score">
        <div
          className="result-score-count"
          style={{ color: row.unanimous ? "#1F7A4D" : "#B8860B" }}
        >
          {row.yes_count}/{row.participant_count}
        </div>
        {row.unanimous && <div className="result-all-in">ALL IN</div>}
      </div>
    </div>
  );
}

export default function Results({ session }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getResults(session.id)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [session.id]);

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
  const majority = rows.filter((r) => !r.unanimous);

  return (
    <div className="shell">
      <Logo />
      <div className="results-heading">
        {rows.length > 0 ? "It's a makan! 🎉" : "No matches 😅"}
      </div>
      <div className="results-list">
        {allIn.length > 0 && (
          <>
            <div className="results-tier-heading">ALL IN</div>
            {allIn.map((r, i) => (
              <ResultRow key={r.id} row={r} topPick={i === 0} />
            ))}
          </>
        )}
        {majority.length > 0 && (
          <>
            <div className="results-tier-heading">MAJORITY PICKS</div>
            {majority.map((r, i) => (
              <ResultRow key={r.id} row={r} topPick={allIn.length === 0 && i === 0} />
            ))}
          </>
        )}
        {rows.length === 0 && (
          <p className="results-empty">
            Everyone too picky lah. Try a wider radius?
          </p>
        )}
      </div>
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
