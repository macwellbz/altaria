// The trip box apart from the page (TripBox.jsx draws it, SearchForm.jsx applies its answer): asking the server to
// read a trip, and what the answer does to the sentence. The answer is { fields, missing, dropped } (server.py, ai.py):
// a value for each blank, "" for any the trip left open, the ids of those, and any value the server threw out, with
// its reason. The model only ever fills blanks: it never sees or gives a price, and the person presses Search.
import { localDay } from "./helpers.js";

export const FIELDS = ["from", "to", "stops", "out-from", "out-to", "arr-from", "arr-to", "ret-from", "ret-to", "currency"];   // the sentence's order
export const REQUIRED = ["from", "to", "out-from", "ret-from"];
export const FILLED = ", filled in from your description";   // read after the name of a blank a reading filled
const NAMES = {
  from: "origin", to: "destination", stops: "stops limit", "out-from": "first departure day", "out-to": "last departure day",
  "arr-from": "first landing day", "arr-to": "last landing day", "ret-from": "first return day", "ret-to": "last return day", currency: "currency",
};
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);   // "a, b and c"

// Whether a model can read trips: { available: true, provider, model, label }, or null when none can or the server
// can't be reached. The server calls no model to answer this.
export const reader = () =>
  fetch("/api/ai").then((r) => (r.ok ? r.json() : null)).then((s) => (s?.available ? s : null)).catch(() => null);

// Asks the server to read a trip, on the visitor's own date. Resolves to { answer }, or to { error } with a sentence
// to show as it is; it never rejects.
export async function ask(text, today = localDay()) {
  let r;
  try {
    r = await fetch("/api/ai/trip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, today }) });
  } catch {
    return { error: "The connection to the local server dropped. Check that server.py is still running, then try again." };
  }
  const body = await r.json().catch(() => null);
  if (r.ok && body?.fields) return { answer: body };
  return { error: body?.error || `The server answered ${r.status} without a reason. Check that server.py is up to date and running, then try again.` };
}

// The sentence once an answer is in. A blank the answer settles takes its value; every other keeps what the person
// had. Stops left "" without being listed as missing is settled too: the trip said any number of stops.
// Returns { fields, filled: { id: the value it had before }, open: the required blanks still empty }.
export function merge(fields, answer) {
  const next = { ...fields }, filled = {};
  for (const id of FIELDS) {
    const v = answer.fields?.[id];
    if (typeof v !== "string") continue;
    const any = id === "stops" && !answer.missing?.includes(id) && !answer.dropped?.some((d) => d.field === id);
    if (v === "" && !any) continue;
    filled[id] = fields[id];
    next[id] = v;
  }
  return { fields: next, filled, open: REQUIRED.filter((id) => !next[id]) };
}

// What a reading did, in one line: how many blanks it filled, any value it threw out with the server's own reason,
// then what's still needed before a search, or that the rest is the person's to check.
export function outcome({ filled, open }, answer) {
  const n = Object.keys(filled).length;
  const said = [n ? `Filled ${n} ${n === 1 ? "blank" : "blanks"}.` : "Nothing in that fills a blank."];
  for (const d of answer.dropped || []) said.push(`Didn't use ${d.value} as the ${NAMES[d.field] || d.field}. ${d.why}`);
  if (!n) said.push("Try naming the airports or cities, and the days you could fly.");
  else if (open.length) said.push(`Still open: ${list(open.map((id) => `the ${NAMES[id]}`))}.`);
  else said.push("Check them, then press Search.");
  return said.join(" ");
}
