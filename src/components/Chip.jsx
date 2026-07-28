// tone: undefined (ink, the default) | "muted" (unknown hours) | "warn" (amber)
export default function Chip({ children, tone }) {
  return <span className={`chip${tone ? ` chip-${tone}` : ""}`}>{children}</span>;
}
