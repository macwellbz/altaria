// The search sentence apart from the page (SearchForm.jsx draws it): what it checks before a search, the query it
// sends to /api/search, how it's echoed in the thread, and what the search will take. Fields are keyed by the
// form's own ids, and every value is a string, "" when the blank is empty.
import { STOPS, day, landing } from "./helpers.js";

export const EMPTY = { from: "", to: "", stops: "", "out-from": "", "out-to": "", "arr-from": "", "arr-to": "", "ret-from": "", "ret-to": "", currency: "CAD" };
const SECONDS = 8;   // one Google search: the outbound list, then each outbound's cheapest return
const range = (a, b) => (b && b !== a ? `${a}..${b}` : a);
const count = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) + 1 : a ? 1 : 0);

// How many date pairs the search will try: every departure day with every return day.
export const pairs = (f) => count(f["out-from"], f["out-to"]) * count(f["ret-from"], f["ret-to"]);

// "1 search, about 10 seconds", or "" before the dates are chosen.
export function estimate(f) {
  const n = pairs(f), secs = n * SECONDS;
  if (n < 1) return "";
  return `${n} ${n === 1 ? "search" : "searches"}, about ${secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} seconds` : `${Math.round(secs / 60)} minutes`}`;
}

// What's wrong before a search can run, as [the field to fix, what to say], or null.
export function check(f) {
  const code = /^[A-Z]{3}$/;
  if (!code.test(f.from) || !code.test(f.to)) return ["from", "Pick both airports from the suggestions, or type three-letter codes like YYZ and VNO."];
  if (f.from === f.to) return ["to", "Origin and destination are the same airport."];
  if (!f["out-from"]) return ["out-from", "Choose the first day you could depart."];
  if (!f["ret-from"]) return ["ret-from", "Choose the first day you could return."];
  if (f["out-to"] && f["out-to"] < f["out-from"]) return ["out-to", "The second departure date is before the first."];
  if (f["ret-to"] && f["ret-to"] < f["ret-from"]) return ["ret-to", "The second return date is before the first."];
  if (f["ret-from"] < f["out-from"]) return ["ret-from", "The return starts before you depart."];
  if (f["arr-to"] && f["arr-from"] && f["arr-to"] < f["arr-from"]) return ["arr-to", "The second landing date is before the first."];
  return null;
}

// The landing window as server.py takes it, "2026-12-30,2026-12-31", where either side may be open; "" for none.
export const arrive = (f) => (f["arr-from"] || f["arr-to"] ? `${f["arr-from"]},${f["arr-to"]}` : "");

// The query string for /api/search. The site searches Google Flights only.
export function query(f) {
  const q = new URLSearchParams({
    from: f.from, to: f.to, currency: f.currency,
    out: range(f["out-from"], f["out-to"]), ret: range(f["ret-from"], f["ret-to"]),
    sources: "google",
  });
  if (arrive(f)) q.set("arrive", arrive(f));
  if (f.stops) q.set("stops", f.stops);
  return q;
}

// The sentence echoed back as the person's turn in the thread.
export function echo(f) {
  const when = (a, b) => (b && b !== a ? `between ${day(a, true)} and ${day(b, true)}` : `on ${day(a, true)}`);
  return `Fly me from ${f.from} to ${f.to}${f.stops ? ` with ${STOPS[f.stops]} each way` : ""}.` +
    ` Depart from ${f.from} ${when(f["out-from"], f["out-to"])}.` +
    (arrive(f) ? ` Land in ${f.to} ${landing(arrive(f), true)}.` : "") +
    ` Return to ${f.from} ${when(f["ret-from"], f["ret-to"])}.` +
    ` Show prices in ${f.currency}.`;
}
