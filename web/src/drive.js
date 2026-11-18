// A search on the public site (worker/), where each call to the server may make only one Google request: its plan
// says drive, and the page runs it here, the way search.py's run_search does. For each date pair, ask /api/google for
// the outbound flights, then for each outbound's cheapest return, five at a time. Then rank everything.
// It reports through on, with the same events server.py streams: progress for each pair, then result or fail.
import { keep } from "./example.js";
import { arrivalWindow, rank } from "./flights.js";

const AT_ONCE = 5;   // return lookups in flight at once, as search.py's thread pool
const PAUSE = 1000;  // ms between date pairs, to be polite to Google, as search.py does

async function call(params, signal) {
  try {
    const r = await fetch(`/api/google?${params}`, { signal });
    return (await r.json().catch(() => null)) || { error: `Altaria's server answered ${r.status}.` };
  } catch (e) {
    if (signal.aborted) throw e;
    return { error: "Couldn't reach Altaria's server." };
  }
}

export async function drive(q, meta, on, signal) {
  const base = { from: q.get("from"), to: q.get("to"), currency: meta.currency, ...(q.get("stops") ? { stops: q.get("stops") } : {}) };
  const arrive = q.get("arrive") || "";
  const rows = [];
  let capped = "", failed = 0;
  try {
    for (const [i, [out, ret]] of meta.pairs.entries()) {
      const p = { src: "google", out, ret };
      const got = capped ? { error: capped } : (on.progress({ ...p, status: "searching" }), await call(new URLSearchParams({ ...base, out, ret }), signal));
      if (got.error) {
        if (got.cap) capped = got.error;
        failed++;
        on.progress({ ...p, status: "failed", error: got.error });
        continue;
      }
      // add_return: a lookup that fails leaves that row's return blank, never guessed
      const queue = [...got.rows];
      await Promise.all(Array.from({ length: AT_ONCE }, async () => {
        for (let r; (r = queue.shift());) {
          const pick = JSON.stringify(r.segments.map(({ from, to, depart, flight }) => ({ from, to, depart, flight })));
          const back = await call(new URLSearchParams({ ...base, out, ret, pick }), signal);
          if (back.ret) Object.assign(r, back.ret);
        }
      }));
      if (signal.aborted) return;
      on.progress({ ...p, status: "done", count: got.rows.length });
      rows.push(...got.rows);
      if (i < meta.pairs.length - 1) await new Promise((ok) => setTimeout(ok, PAUSE));
      if (signal.aborted) return;
    }
    if (capped && failed === meta.pairs.length) return on.fail({ message: capped });
    const ranked = await rank(rows, meta.currency, arrive.replaceAll(",", "") ? arrivalWindow(arrive) : null);
    if (signal.aborted) return;
    keep(q, ranked);
    on.result({ rows: ranked });
  } catch (e) {
    if (!signal.aborted) on.fail({ message: `The search stopped: ${e.message}` });
  }
}
