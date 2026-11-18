// The newest saved search, asked for once as the page starts: the fare pass shows its cheapest row and the
// ranking board its first five. Resolves to { file, args, row, rows }, or null when nothing is saved yet, and
// rejects when the server can't be reached. server.py answers from results/. The public site (worker/) keeps no
// searches and answers null, so there it's this browser's own last search, which keep() stores.
import { airportsLoaded } from "./airports.js";

const KEY = "lastSearch";

export const pageStart = performance.now();   // the load moment counts from here (FarePass.jsx)

export const example = fetch("/api/example")
  .then((r) => {
    if (!r.ok) throw new Error(`example: ${r.status}`);
    return r.json();
  })
  .then((ex) => ex ?? kept())
  .then((ex) => airportsLoaded.then(() => ex));   // with the airport list in, flights can name their cities
example.catch(() => {});   // each reader handles a failure its own way; this keeps it out of the console until then

function kept() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
}

// A search the page ran itself (drive.js), in /api/example's shape, named the way search.py names a run.
export function keep(q, rows) {
  if (!rows.length) return;
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const file = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${q.get("from")}-${q.get("to")}.json`;
  const args = { orig: q.get("from"), dest: q.get("to"), out: q.get("out"), ret: q.get("ret"), currency: q.get("currency") };
  try { localStorage.setItem(KEY, JSON.stringify({ file, args, row: rows[0], rows: rows.slice(0, 5) })); } catch (e) {}
}
