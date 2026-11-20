import { WARN } from "./helpers.js";

// Matrix's warnings on a fare, each as a badge. Those that matter carry a warning triangle.
export default function Badges({ warnings = [] }) {
  if (!warnings.length) return null;
  return (
    <div className="badges">
      {warnings.map((w) => {
        const [cls, label, tip] = WARN[w] || ["info", w.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), w];
        return (
          <span key={w} className={`badge ${cls}`} title={`${tip} (${w})`}>
            {cls === "info" ? null : <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 5v2.4M6 8.9v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
            {label}
          </span>
        );
      })}
    </div>
  );
}
