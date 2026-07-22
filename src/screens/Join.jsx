import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { createSession, joinSession } from "../lib/session.js";

// One screen for both entry paths: mode="start" (host, name only)
// and mode="join" (code + name).
export default function Join({ mode }) {
  const navigate = useNavigate();
  const isStart = mode === "start";
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = name.trim().length > 0 && (isStart || code.trim().length > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = isStart
        ? await createSession(name.trim())
        : await joinSession(code.trim(), name.trim());
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
