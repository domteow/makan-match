import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="shell">
      <div style={{ flex: 1 }} />
      <Logo />
      <p className="home-blurb">
        Stop the &ldquo;anything lah&rdquo; loop. Start a session, everyone
        swipes, eat where you all match.
      </p>
      <div className="home-actions">
        <button className="btn btn-orange" onClick={() => navigate("/start")}>
          Start a session
        </button>
        <button className="btn btn-cream" onClick={() => navigate("/join")}>
          Join with code
        </button>
      </div>
      <div style={{ flex: 1.4 }} />
    </div>
  );
}
