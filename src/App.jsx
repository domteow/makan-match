import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./screens/Home.jsx";
import Join from "./screens/Join.jsx";
import Session from "./screens/Session.jsx";
import Logo from "./components/Logo.jsx";
import { ensureSignedIn } from "./lib/auth.js";

export default function App() {
  const [userId, setUserId] = useState(null);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    ensureSignedIn()
      .then(setUserId)
      .catch((e) => setAuthError(e.message));
  }, []);

  if (authError) {
    return (
      <div className="shell">
        <div style={{ flex: 1 }} />
        <Logo />
        <p className="form-error">Couldn&rsquo;t connect: {authError}</p>
        <div style={{ flex: 1.4 }} />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="shell">
        <div style={{ flex: 1 }} />
        <Logo />
        <p className="screen-status">Warming up the wok…</p>
        <div style={{ flex: 1.4 }} />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/start" element={<Join mode="start" />} />
      <Route path="/join" element={<Join mode="join" />} />
      <Route path="/s/:code" element={<Session userId={userId} />} />
    </Routes>
  );
}
