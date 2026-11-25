// The search sentence apart from the page (SearchForm.jsx draws it): what it checks before a search, the query it
// sends to /api/search, how it's echoed in the thread, and what the search will take. Fields are keyed by the
// form's own ids, and every value is a string, "" when the blank is empty. An airport blank holds one code or several
// joined by commas, "EDI,GLA", which is also how /api/search takes them.
import { MAX_AIRPORTS } from "./flights.js";
import { STOPS, day, either, landing } from "./helpers.js";

export const EMPTY = { from: "", to: "", stops: "", "out-from": "", "out-to": "", "arr-from": "", "arr-to": "", "ret-from": "", "ret-to": "", currency: "CAD" };
// Seconds a search takes: date pairs go five at a time, about 2.5s a round with the pause, then the cheapest fares'
// returns take about 5s more.
const ROUND = 2.5, RETURNS = 5;
const range = (a, b) => (b && b !== a ? `${a}..${b}` : a);
const count = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) + 1 : a ? 1 : 0);

// How many date pairs the search will try: every departure day with every return day.
const pairs = (f) => count(f["out-from"], f["out-to"]) * count(f["ret-from"], f["ret-to"]);

// "1 search, about 10 seconds", or "" before the dates are chosen.
export function estimate(f) {
  const n = pairs(f), secs = Math.ceil(n / 5) * ROUND + RETURNS;
  if (n < 1) return "";
  return `${n} ${n === 1 ? "search" : "searches"}, about ${secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} seconds` : `${Math.round(secs / 60)} minutes`}`;
}

// What's wrong before a search can run, as [the field to fix, what to say], or null.
export function check(f) {
  const from = f.from.split(","), to = f.to.split(",");
  if (![...from, ...to].every((c) => /^[A-Z]{3}$/.test(c))) return ["from", "Pick both airports from the suggestions, or type three-letter codes like YYZ and VNO."];
  for (const [id, side, what] of [["from", from, "origin"], ["to", to, "destination"]]) {
    if (side.length > MAX_AIRPORTS) return [id, `A search takes up to ${MAX_AIRPORTS} airports on each side, and the ${what} has ${side.length}. Remove ${side.length - MAX_AIRPORTS}.`];
  }
  const both = to.find((c) => from.includes(c));
  if (both) return ["to", `${both} is both an origin and a destination. Change it on one side.`];
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
  const from = either(f.from), to = either(f.to);
  return `Fly me from ${from} to ${to}${f.stops ? ` with ${STOPS[f.stops]} each way` : ""}.` +
    ` Depart from ${from} ${when(f["out-from"], f["out-to"])}.` +
    (arrive(f) ? ` Land in ${to} ${landing(arrive(f), true)}.` : "") +
    ` Return to ${from} ${when(f["ret-from"], f["ret-to"])}.` +
    ` Show prices in ${f.currency}.`;
}
