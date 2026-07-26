// Host-only confirm before cutting swiping short. Names who is still
// mid-deck so the host knows exactly what they're interrupting.
export default function RevealSheet({
  participants,
  userId,
  total,
  busy,
  error,
  onConfirm,
  onCancel,
}) {
  const unfinished = participants.filter((p) => !p.done_swiping);

  const describe = (p) => {
    const you = p.user_id === userId;
    const name = you ? "You" : p.display_name;
    if (!p.swipe_count) return `${name} ${you ? "haven't" : "hasn't"} started`;
    const count = Math.min(p.swipe_count, total);
    return `${name} ${you ? "are" : "is"} on ${count}/${total}`;
  };

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Reveal results now"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-title">Reveal now?</div>
        <p className="sheet-body">
          {unfinished.length > 0
            ? `${unfinished.map(describe).join(", ")}. Reveal anyway?`
            : "Everyone's finished their deck. Ready to see the results?"}
        </p>
        <p className="sheet-note">
          Whatever's been swiped so far counts. Nobody can swipe after this.
        </p>
        {error && <p className="form-error">{error}</p>}
        <button
          className="btn btn-orange"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Revealing…" : "Reveal anyway"}
        </button>
        <button className="btn btn-cream" disabled={busy} onClick={onCancel}>
          Keep swiping
        </button>
      </div>
    </div>
  );
}
