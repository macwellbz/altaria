// Pure helpers for dates, times, prices and legs. Every date and time is an airport's local time, as search.py gives it.
import { city } from "./airports.js";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const DAYS = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
export const STOPS = { "": "any number of stops", 0: "no stops", 1: "at most 1 stop", 2: "at most 2 stops" };   // "with ___ each way"
export const LONG = 6 * 60;   // a layover longer than this is highlighted, and the summary looks for a fare without one
export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// "2026-12-29" -> "Tue"; day() -> "Dec 29", or with the weekday "Tue Dec 29". Parsed by hand: these are local airport times.
export const weekday = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
};
export const day = (iso, wd) => `${wd ? weekday(iso) + " " : ""}${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
// The visitor's own date, "2026-11-16", from their clock and time zone: the first day a search can depart.
export const localDay = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
// When a run was saved, from its file name: "20260927-204446-YYZ-VNO.json" -> "Sep 27", or with the time "Sep 27 at 20:44".
export const savedOn = (file, withTime) =>
  `${day(`${file.slice(0, 4)}-${file.slice(4, 6)}-${file.slice(6, 8)}`)}${withTime ? ` at ${file.slice(9, 11)}:${file.slice(11, 13)}` : ""}`;
export const time = (iso) => iso.slice(11, 16);
export const fmtMin = (m) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "?");
export const money = (v) => Math.round(v).toLocaleString("en-US");
export const stops = (n) => (n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`);
// A date or a range as search.py takes it: "2026-12-26" -> "Dec 26", "2026-12-26..2026-12-28" -> "Dec 26 to 28",
// "2026-12-30..2027-01-02" -> "Dec 30 to Jan 2".
export const dateSpan = (spec) => {
  const [x, y = x] = spec.split("..");
  return x === y ? day(x) : x.slice(0, 7) === y.slice(0, 7) ? `${day(x)} to ${Number(y.slice(8))}` : `${day(x)} to ${day(y)}`;
};

// "2026-12-30,2026-12-31" -> "between Dec 30 and Dec 31"; open bounds read "by Dec 31" or "on Dec 30 or later".
export function landing(arrive, wd) {
  const [a, b] = arrive.split(",");
  return a && b ? (a === b ? `on ${day(a, wd)}` : `between ${day(a, wd)} and ${day(b, wd)}`) : a ? `on ${day(a, wd)} or later` : `by ${day(b, wd)}`;
}

// Matrix's own warning codes, labelled in Matrix's own words (from its UI). They cover the flights out and back together.
// Tight and risky are different: tight is about the time to change planes, risky about the cost of missing it.
export const WARN = {
  RISKY_CONNECTION: ["risk", "Risky connection", "ITA Matrix: a connection that can be very inconvenient when missed."],
  TIGHT_CONNECTION: ["warn", "Tight connection", "Little time to change planes."],
  CHANGE_OF_AIRPORT_SLICE: ["warn", "Change of airport", "You change airports to make a connection."],
  CHANGE_OF_AIRPORT: ["warn", "Change of airport", "You change airports to make a connection."],
  CHANGE_OF_TERMINAL: ["warn", "Change of terminal", "You change terminals to make a connection."],
  LONG_LAYOVER: ["warn", "Long layover", "A long wait between flights."],
  OVERNIGHT: ["info", "Overnight flight", "Part of the trip flies overnight."],
  PROP_PLANE: ["info", "Propeller plane", "At least one flight is on a propeller plane."],
  NON_PREFERRED_CABIN: ["info", "Preferred class unavailable", "Part of the trip isn't in the cabin you asked for."],
};

// Minutes between two local times at one airport. Both parse as UTC, so no time zone or clock change enters.
const gap = (a, b) => (Date.parse(`${b}Z`) - Date.parse(`${a}Z`)) / 6e4;
// The waits between one leg's flights, from landing to the next take-off. Leaving from another airport means changing airports.
export const layovers = (segs) => (segs || []).slice(1).map((s, i) => {
  const m = gap(segs[i].arrive, s.depart);
  return { at: segs[i].to, next: s.from, m, long: m > LONG, night: s.depart.slice(0, 10) > segs[i].arrive.slice(0, 10) };
});
export const waits = (r) => [...layovers(r.segments), ...layovers(r.return_segments)];   // a fare's layovers, out and back
// The ranking board's note on row i, which is sorted by price, then outbound length. A tie is two fares at one price;
// the shorter outbound comes first and wins it, and only then is it marked.
export function remark(rows, i) {
  const r = rows[i], next = rows[i + 1];
  const wins = next && next.price_cmp === r.price_cmp && r.duration && next.duration > r.duration;
  if (i === 0) return wins ? "Cheapest, wins the tie" : "Cheapest";
  return wins ? `Wins the tie, ${fmtMin(next.duration - r.duration)} quicker` : "";
}
// The summary's pricier fares worth a look beside the cheapest, rows[0], as [row, [why, ...]] from cheapest: a Matrix
// fare without the cheapest's connection warnings, one with no long layover when the cheapest has one, and the
// quickest outbound. Only a fare whose every flight, out and back, is known can be said to have no long layover.
export function picks(rows) {
  const best = rows[0], found = new Map();
  const pick = (r, why) => found.set(r, [...(found.get(r) || []), why]);
  const risky = (r) => r.warnings?.some((w) => (WARN[w]?.[0] || "warn") !== "info");
  const clean = risky(best) && rows.find((r) => r.source === "matrix" && !risky(r));
  if (clean) pick(clean, "no connection warnings from Matrix");
  if (waits(best).some((l) => l.long)) {
    const calm = rows.find((r) => r.segments?.length && r.return_segments?.length && !waits(r).some((l) => l.long));
    if (calm) pick(calm, `no layover over ${LONG / 60} hours`);
  }
  const timed = rows.filter((r) => r.duration);
  const fastest = timed.reduce((a, r) => (r.duration < a.duration ? r : a), timed[0]);
  if (fastest && fastest !== best && fastest.price_cmp > best.price_cmp) pick(fastest, "the quickest outbound");
  return [...found].sort(([a], [b]) => a.price_cmp - b.price_cmp);
}
// "Air Canada to Amsterdam, then Air Baltic to Vilnius": who flies which part. One airline's flights in a row read as one part.
export function airlines(segs) {
  const runs = [];
  for (const s of segs) runs.at(-1)?.[0].airline === s.airline ? runs.at(-1).push(s) : runs.push([s]);
  return runs.map((run, i) => `${i ? "then " : ""}${run[0].airline}${segs.length === 1 ? " nonstop" : ""} to ${city(run.at(-1).to)}` +
    (run.length > 1 ? ` via ${run.slice(0, -1).map((s) => city(s.to)).join(" and ")}` : "")).join(", ");
}
