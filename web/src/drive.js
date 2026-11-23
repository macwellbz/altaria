// A search on the public site (worker/), where each call to the server may make only one Google request: its plan
// says drive, and the page runs it here, the way search.py's run_search does. Ask /api/google for each date pair's
// outbound flights, AT_ONCE pairs at a time; each is already priced as the whole round trip. Then ask for the
// cheapest fares' returns, and rank everything.
// It reports through on, with the same events server.py streams: progress for each pair, then result or fail.
import { keep } from "./example.js";
import { arrivalWindow, arrivesWithin, rank } from "./flights.js";

const AT_ONCE = 5;   // Google requests in flight at once, as search.py's thread pool
const PAUSE = 1000;  // ms between rounds of date pairs, to be polite to Google, as search.py does
export const DETAIL = 25;   // the cheapest fares whose return flights are looked up, as search.py's DETAIL

// One Google request through the Worker. A failure other than the day's cap is asked once more, as search.py's
// fetch_google does: a page that comes back without results usually has them the second time.
async function call(params, signal, again = true) {
  let got;
  try {
    const r = await fetch(`/api/google?${params}`, { signal });
    got = (await r.json().catch(() => null)) || { error: `Altaria's server answered ${r.status}.` };
  } catch (e) {
    if (signal.aborted) throw e;
    got = { error: "Couldn't reach Altaria's server." };
  }
  return got.error && !got.cap && again ? call(params, signal, false) : got;
}

export async function drive(q, meta, on, signal) {
  const base = { from: q.get("from"), to: q.get("to"), currency: meta.currency, ...(q.get("stops") ? { stops: q.get("stops") } : {}) };
  const arrive = q.get("arrive") || "";
  const window = arrive.replaceAll(",", "") ? arrivalWindow(arrive) : null;
  const rows = [];
  let capped = "", failed = 0;
  try {
    for (let i = 0; i < meta.pairs.length; i += AT_ONCE) {
      if (i) await new Promise((ok) => setTimeout(ok, PAUSE));
      if (signal.aborted) return;
      await Promise.all(meta.pairs.slice(i, i + AT_ONCE).map(async ([out, ret]) => {
        const p = { src: "google", out, ret };
        const got = capped ? { error: capped } : (on.progress({ ...p, status: "searching" }), await call(new URLSearchParams({ ...base, out, ret }), signal));
        if (got.error) {
          if (got.cap) capped = got.error;
          failed++;
          on.progress({ ...p, status: "failed", error: got.error });
          return;
        }
        on.progress({ ...p, status: "done", count: got.rows.length });
        rows.push(...got.rows);
      }));
      if (signal.aborted) return;
    }
    if (capped && failed === meta.pairs.length) return on.fail({ message: capped });
    // add_return, for the cheapest fares that land in time: a lookup that fails leaves that row's return blank, never guessed
    const queue = rows.filter((r) => !window || arrivesWithin(r, window))
      .sort((a, b) => a.price - b.price || (a.duration || 1e6) - (b.duration || 1e6)).slice(0, DETAIL);
    await Promise.all(Array.from({ length: AT_ONCE }, async () => {
      for (let r; (r = queue.shift());) {
        const pick = JSON.stringify(r.segments.map(({ from, to, depart, flight }) => ({ from, to, depart, flight })));
        const back = await call(new URLSearchParams({ ...base, out: r.search_out, ret: r.search_ret, pick }), signal);
        if (back.ret) Object.assign(r, back.ret);
      }
    }));
    if (signal.aborted) return;
    const ranked = await rank(rows, meta.currency, window);
    if (signal.aborted) return;
    keep(q, ranked);
    on.result({ rows: ranked });
  } catch (e) {
    if (!signal.aborted) on.fail({ message: `The search stopped: ${e.message}` });
  }
}
