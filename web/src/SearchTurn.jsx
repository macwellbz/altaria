import { useEffect, useRef, useState } from "react";
import Logo from "./Logo.jsx";
import Results from "./Results.jsx";
import { NAME } from "./brand.js";
import { drive } from "./drive.js";
import { day } from "./helpers.js";
import { scrollToElement } from "./scroll.js";

// 7s, or 1m 05s
const clock = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

// Streams one search from /api/search as Server-Sent Events. update(change) merges change(turn) into this
// search's turn, whose fields are set below. Returns { stop }.
export function streamSearch(q, update) {
  const started = Date.now();
  update(() => ({
    started,
    status: "Starting…",   // the status line, except while searches run: then it counts them
    running: true,         // until the search ends: the Stop button and the rail show
    meta: null,            // the plan: date pairs, sources and currency
    tasks: {},             // one per search, keyed "source|out|ret": { s: pending, searching, done, failed or stopped, n, error }
    listed: true,          // a failed run drops its list of searches
    rows: null,            // what came back
  }));
  const es = new EventSource(`/api/search?${q}`);
  const run = new AbortController();   // a search the page drives itself (drive.js)
  let ended = false;
  const end = () => { ended = true; es.close(); };
  const stop = (why) => {
    if (ended) return;
    end();
    run.abort();
    update((t) => ({
      running: false,
      status: why,
      tasks: Object.fromEntries(Object.entries(t.tasks).map(([k, x]) => [k, x.s === "pending" || x.s === "searching" ? { s: "stopped" } : x])),
    }));
  };
  const mark = (k, task) => update((t) => (t.tasks[k] ? { tasks: { ...t.tasks, [k]: task } } : {}));

  // What the server streams, by event. On the public site the plan says drive, and the page runs it (drive.js),
  // which reports through these same handlers.
  const on = {
    wait: () => update(() => ({ status: "Waiting for the previous search to stop…" })),

    plan: (meta) => {
      const keys = meta.pairs.flatMap(([o, r]) => meta.sources.map((s) => `${s}|${o}|${r}`));
      update(() => ({ meta, tasks: Object.fromEntries(keys.map((k) => [k, { s: "pending" }])) }));
      if (meta.drive) {
        es.onerror = null;
        es.close();
        drive(q, meta, on, run.signal);
      }
    },

    progress: (p) => {
      const k = `${p.src}|${p.out}|${p.ret}`;
      mark(k, p.status === "searching" ? { s: "searching" } : p.status === "failed" ? { s: "failed", error: p.error } : { s: "done", n: p.count });
    },

    result: ({ rows }) => {
      end();
      const took = clock(Date.now() - started);
      update((t) => {
        const total = Object.keys(t.tasks).length;
        const failed = Object.values(t.tasks).filter((x) => x.s === "failed").length;
        return {
          running: false,
          rows,
          status: `Done in ${took}.` + (total === 1 ? (failed ? " The search failed." : "")
            : ` ${total - failed} of ${total} searches came back` + (failed ? `; ${failed} failed.` : ".")),
        };
      });
    },

    fail: ({ message }) => {
      stop(message);
      update(() => ({ listed: false }));
    },
  };
  for (const [name, handle] of Object.entries(on)) es.addEventListener(name, (e) => handle(JSON.parse(e.data)));

  es.onerror = () => stop("The connection to the server dropped. Search again, and if you run Altaria yourself, check that server.py is still running.");
  return { stop };
}

const FEW = 12;   // searches that each get a line of their own; more than this are listed a day to a line

// One line of the reply's list: its searches' states as one. A day's searches are searching from its first until its
// last is back, then say how many fares they found and how many of them failed.
function tally(ts) {
  const n = (s) => ts.filter((t) => t.s === s).length;
  const failed = n("failed"), back = n("done") + failed;
  if (failed === ts.length) return { s: "failed", text: "failed" };
  if (back === ts.length) {
    const fares = ts.reduce((a, t) => a + (t.n || 0), 0);
    return { s: "done", text: `${fares} ${fares === 1 ? "fare" : "fares"}`, failed };
  }
  if (n("stopped")) return { s: "stopped", text: "stopped" };
  return back || n("searching") ? { s: "searching", text: "searching…" } : { s: "pending", text: "waiting" };
}

// One search in the thread, which reads as a chat: your sentence as the message you sent, then the reply. Its first
// message, from the site's symbol, says how the search is going: a status line, a rail with one segment per search
// (as in a race's sector timing) and the searches by date, a line each, or a line a day once there are too many to
// read (by departure day, or by return day when those are fewer). The answer follows across the full column.
export default function SearchTurn({ turn, onStop }) {
  const { said, status, running, meta, tasks, listed, rows } = turn;
  const entry = useRef(null);
  const [, setTick] = useState(0);
  // A new search glides into view, its sentence at the top, and keyboard focus moves to it: the Search button is
  // disabled while it runs, and from here Tab reaches its Stop button and then its results.
  useEffect(() => {
    entry.current.focus({ preventScroll: true });
    scrollToElement(entry.current);
  }, []);
  useEffect(() => {   // while its searches run, the status line counts the seconds
    if (!running || !meta) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running, meta]);

  const keys = meta ? meta.pairs.flatMap(([o, r]) => meta.sources.map((s) => `${s}|${o}|${r}`)) : [];
  const total = keys.length;
  const done = keys.filter((k) => tasks[k].s === "done" || tasks[k].s === "failed").length;
  const failed = keys.filter((k) => tasks[k].s === "failed");
  // Once every search is back, the cheapest fares' return flights are still being looked up (search.py's add_return).
  const returns = running && total > 0 && done === total && failed.length < total;
  const line = returns ? `Looking up return flights for the cheapest fares, ${clock(Date.now() - turn.started)} so far.`
    : running && total ? `Searching: ${done} of ${total} ${total === 1 ? "search" : "searches"} done, ${clock(Date.now() - turn.started)} so far.`
    : status;
  let lines = [];
  if (listed && meta) {
    const outs = new Set(meta.pairs.map(([o]) => o)), rets = new Set(meta.pairs.map(([, r]) => r));
    const side = rets.size < outs.size ? 2 : 1;   // the side with fewer days makes the shorter list
    lines = total <= FEW ? meta.pairs.map(([o, r]) => ({ id: `${o}|${r}`, label: `${day(o)} to ${day(r)}`, keys: meta.sources.map((s) => `${s}|${o}|${r}`) }))
      : [...(side === 2 ? rets : outs)].map((d) => ({ id: d, label: `${side === 2 ? "Back" : "Out"} ${day(d)}`, keys: keys.filter((k) => k.split("|")[side] === d) }));
  }

  return (
    <article className="turn" ref={entry} tabIndex={-1}>
      <p className="said">{said}</p>
      <div className="reply">
        <div className="heard">
          <Logo file="altaria-symbol-small" alt={NAME} className="sender" />
          <div className="report">
            <div className="status-row">
              <p className="status" role="status">{line}</p>
              {running && <button type="button" className="ghost stop" onClick={onStop}>Stop</button>}
            </div>
            {running && (
              <div className={returns ? "rail returns" : "rail"} style={{ "--n": total || 1 }} role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={total ? Math.round((done / total) * 100) : 0}>
                {keys.map((k) => <i key={k} data-k={k} data-s={tasks[k].s}></i>)}
              </div>
            )}
            {lines.length > 0 && (
              <ul className="tasks" aria-label="Searches by date">
                {lines.map(({ id, label, keys: ks }) => {
                  const t = tally(ks.map((k) => tasks[k]));
                  return (
                    <li key={id}>
                      <b>{label}</b>
                      <span className="s" data-s={t.s} title={ks.length === 1 ? tasks[ks[0]].error : undefined}><i>{t.text}</i>{t.failed > 0 && <i className="bad">{`, ${t.failed} failed`}</i>}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {!running && failed.length > 0 && (
              <details className="failures">
                <summary>{`Why ${failed.length === 1 ? "one search" : `${failed.length} searches`} failed`}</summary>
                <ul>{failed.map((k) => <li key={k}>{`${day(k.split("|")[1])} to ${day(k.split("|")[2])}: ${tasks[k].error}`}</li>)}</ul>
              </details>
            )}
          </div>
        </div>
        <div className="answer">{rows && <Results rows={rows} meta={meta} trip={turn.trip} tasks={tasks} />}</div>
      </div>
    </article>
  );
}
