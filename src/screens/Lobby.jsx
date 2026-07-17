import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { FRIENDS, ROOM_CODE } from "../data/mockEateries.js";

export default function Lobby({ joined, setJoined }) {
  const navigate = useNavigate();
  const total = FRIENDS.length;
  const full = joined >= total;

  // Fake friends joining the lobby (Phase 1 mock; realtime later)
  useEffect(() => {
    if (full) return;
    const t = setTimeout(() => setJoined((j) => j + 1), 900);
    return () => clearTimeout(t);
  }, [joined, full, setJoined]);

  return (
    <div className="shell">
      <Logo />
      <div className="room-code-ticket">
        <div className="room-code-label">ROOM CODE</div>
        <div className="room-code-value">{ROOM_CODE}</div>
      </div>
      <div className="lobby-list">
        <div className="lobby-list-heading">
          IN THE QUEUE ({joined}/{total})
        </div>
        {FRIENDS.slice(0, joined).map((f) => (
          <div key={f.name} className="lobby-row">
            <div className="lobby-avatar" style={{ background: f.color }}>
              {f.name[0]}
            </div>
            <span className="lobby-name">{f.name}</span>
            {f.name === "You" && <span className="lobby-host-badge">HOST</span>}
          </div>
        ))}
      </div>
      <button
        className={`btn ${full ? "btn-orange" : "btn-muted"}`}
        style={{ marginTop: 24 }}
        disabled={!full}
        onClick={() => navigate("/swipe")}
      >
        {full ? "Start swiping →" : "Waiting for friends…"}
      </button>
    </div>
  );
}
