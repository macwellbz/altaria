// The newest saved search, asked for once as the page starts: the fare pass shows its cheapest row and the
// ranking board its first five. Resolves to { file, args, row, rows }, or null when nothing is saved yet, and
// rejects when the server can't be reached.
import { airportsLoaded } from "./airports.js";

export const pageStart = performance.now();   // the load moment counts from here (FarePass.jsx)

export const example = fetch("/api/example")
  .then((r) => {
    if (!r.ok) throw new Error(`example: ${r.status}`);
    return r.json();
  })
  .then((ex) => airportsLoaded.then(() => ex));   // with the airport list in, flights can name their cities
example.catch(() => {});   // each reader handles a failure its own way; this keeps it out of the console until then
