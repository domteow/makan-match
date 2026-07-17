import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { EATERIES, FRIEND_VOTES } from "../data/mockEateries.js";

export default function Results({ votes, onReset }) {
  const navigate = useNavigate();

  const matches = EATERIES.map((e) => {
    const all = [votes[e.id], ...(FRIEND_VOTES[e.id] || [])];
    const yes = all.filter(Boolean).length;
    return { ...e, yes, total: all.length, unanimous: yes === all.length };
  })
    .filter((m) => m.yes >= 3)
    .sort((a, b) => b.yes - a.yes);

  return (
    <div className="shell">
      <Logo />
      <div className="results-heading">
        {matches.length > 0 ? "It's a makan! 🎉" : "No matches 😅"}
      </div>
      <div className="results-list">
        {matches.map((m, i) => (
          <div key={m.id} className={`result-row${i === 0 ? " top-pick" : ""}`}>
            <div className="result-thumb">
              <span>{m.emoji}</span>
              <img
                src={m.img}
                alt=""
                draggable={false}
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="result-name">{m.name}</div>
              <div className="result-sub">
                {m.cuisine} · {m.dist} · {m.price}
              </div>
            </div>
            <div className="result-score">
              <div
                className="result-score-count"
                style={{ color: m.unanimous ? "#1F7A4D" : "#B8860B" }}
              >
                {m.yes}/{m.total}
              </div>
              {m.unanimous && <div className="result-all-in">ALL IN</div>}
            </div>
          </div>
        ))}
        {matches.length === 0 && (
          <p className="results-empty">
            Everyone too picky lah. Try a wider radius?
          </p>
        )}
      </div>
      <button
        className="btn btn-cream"
        style={{ marginTop: 16 }}
        onClick={() => {
          onReset();
          navigate("/");
        }}
      >
        New session
      </button>
    </div>
  );
}
