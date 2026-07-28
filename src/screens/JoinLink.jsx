import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import { joinSession } from "../lib/session.js";
import { getRememberedName, rememberName } from "../lib/prefs.js";

// The other end of a shared link or a scanned QR: /j/CODE. Short path because
// it gets read aloud across a table and typed by hand.
//
// Distinct from the manual /join screen, which still exists — there the code
// is something you're being told, here it's something you already have, so the
// only question left is what to call you.
export default function JoinLink() {
  const { code: rawCode } = useParams();
  const navigate = useNavigate();
  const code = (rawCode || "").trim().toUpperCase();

  // Read once: re-reading on every render would fight the input while typing.
  const remembered = useMemo(getRememberedName, []);
  const [name, setName] = useState(remembered ?? "");
  const [editingName, setEditingName] = useState(!remembered);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const join = async (displayName) => {
    const trimmed = displayName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await joinSession(code, trimmed);
      rememberName(trimmed);
      // join_session returns the status too, but /s/:code re-reads it from the
      // server and renders lobby / deck / results off that — so a session that
      // started swiping between the tap and the write still lands correctly,
      // and a late joiner goes straight to the deck.
      navigate(`/s/${code}`, { replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (error?.code === "SESSION_NOT_FOUND" || error?.code === "SESSION_FINISHED") {
    const finished = error.code === "SESSION_FINISHED";
    return (
      <div className="shell">
        <div style={{ flex: 1 }} />
        <Logo />
        <p className="join-link-message">
          {finished
            ? "This session already finished."
            : "That session code doesn't exist. Check the link?"}
        </p>
        <div className="home-actions">
          {finished && (
            <button className="btn btn-orange" onClick={() => navigate("/start")}>
              Start a new one
            </button>
          )}
          <button className="btn btn-cream" onClick={() => navigate("/")}>
            Back to start
          </button>
        </div>
        <div style={{ flex: 1.4 }} />
      </div>
    );
  }

  return (
    <div className="shell">
      <div style={{ flex: 1 }} />
      <Logo />
      <div className="join-link-invite">
        You&rsquo;re joining room <span className="join-link-code">{code}</span>
      </div>

      <form
        className="form join-link-form"
        onSubmit={(e) => {
          e.preventDefault();
          join(name);
        }}
      >
        {editingName ? (
          <>
            <label className="field">
              <span className="field-label">YOUR NAME</span>
              <input
                className="text-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Treva"
                maxLength={30}
                autoComplete="off"
                autoFocus
              />
            </label>
            {error && <p className="form-error">{error.message}</p>}
            <button
              type="submit"
              className={`btn ${name.trim() ? "btn-orange" : "btn-muted"}`}
              disabled={!name.trim() || busy}
            >
              {busy ? "Hold on ah…" : "Join the queue"}
            </button>
          </>
        ) : (
          <>
            {error && <p className="form-error">{error.message}</p>}
            <button type="submit" className="btn btn-orange" disabled={busy}>
              {busy ? "Hold on ah…" : `Join as ${name}`}
            </button>
            <button
              type="button"
              className="btn-link"
              onClick={() => setEditingName(true)}
            >
              use a different name
            </button>
          </>
        )}
      </form>
      <div style={{ flex: 1.4 }} />
    </div>
  );
}
