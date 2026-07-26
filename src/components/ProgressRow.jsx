import { joinedLate } from "../lib/session.js";

// Compact live progress for everyone in the session. Counts only — what
// anyone actually picked stays hidden until the reveal.
export default function ProgressRow({ participants, session, userId, total }) {
  return (
    <div className="progress-row">
      {participants.map((p) => {
        const late = joinedLate(p, session);
        const count = Math.min(p.swipe_count ?? 0, total);
        return (
          <div
            key={p.user_id}
            className={`progress-pill${p.done_swiping ? " is-done" : ""}`}
          >
            <span className="progress-pill-name">
              {p.user_id === userId ? "You" : p.display_name}
            </span>
            <span className="progress-pill-count">
              {p.done_swiping ? "done ✓" : `${count}/${total}`}
            </span>
            {late && (
              // Explains a count that is behind everyone else's without
              // anyone having to ask.
              <span className="progress-pill-late">joined late</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
