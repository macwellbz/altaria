import { useEffect, useRef, useState } from "react";
import Results from "./Results.jsx";
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
    tasks: {},             // one per search, keyed "source|out|ret": { s: pending, searching, done, failed or stopped, text, error }
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
      tasks: Object.fromEntries(Object.entries(t.tasks).map(([k, x]) => [k, x.s === "pending" || x.s === "searching" ? { s: "stopped", text: "stopped" } : x])),
    }));
  };
  const mark = (k, task) => update((t) => (t.tasks[k] ? { tasks: { ...t.tasks, [k]: task } } : {}));

  // What the server streams, by event. On the public site the plan says drive, and the page runs it (drive.js),
  // which reports through these same handlers.
  const on = {
    wait: () => update(() => ({ status: "Waiting for the previous search to stop…" })),

    plan: (meta) => {
      const keys = meta.pairs.flatMap(([o, r]) => meta.sources.map((s) => `${s}|${o}|${r}`));
      update(() => ({ meta, tasks: Object.fromEntries(keys.map((k) => [k, { s: "pending", text: "waiting" }])) }));
      if (meta.drive) {
        es.onerror = null;
        es.close();
        drive(q, meta, on, run.signal);
      }
    },

    progress: (p) => {
      const k = `${p.src}|${p.out}|${p.ret}`;
      if (p.status === "searching") mark(k, { s: "searching", text: "asking…" });
      else if (p.status === "failed") mark(k, { s: "failed", text: "failed", error: p.error });
      else mark(k, { s: "done", text: `${p.count} ${p.count === 1 ? "fare" : "fares"}` });
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
          status: `Done in ${took}. ` + (total === 1 ? (failed ? "The search failed." : "The search came back.")
            : `${total - failed} of ${total} searches came back` + (failed ? `; ${failed} failed.` : ".")),
        };
      });
    },

    fail: ({ message }) => {
      stop(message);
      update(() => ({ listed: false }));
    },
  };
  for (const [name, handle] of Object.entries(on)) es.addEventListener(name, (e) => handle(JSON.parse(e.data)));

  es.onerror = () => stop("The connection to the local server dropped. Check that server.py is still running, then search again.");
  return { stop };
}

// One search in the thread: your sentence, echoed back, then what came back: a status line, a rail with one
// segment per search (as in a race's sector timing), the date pairs, and the answer.
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
  const line = running && total
    ? `Searching: ${done} of ${total} ${total === 1 ? "search" : "searches"} done, ${clock(Date.now() - turn.started)} so far.`
    : status;

  return (
    <article className="turn" ref={entry} tabIndex={-1}>
      <p className="said">{said}</p>
      <div className="reply">
        <div className="status-row">
          <p className="status" role="status">{line}</p>
          {running && <button type="button" className="ghost stop" onClick={onStop}>Stop</button>}
        </div>
        {running && (
          <div className="rail" role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={total ? Math.round((done / total) * 100) : 0}>
            {keys.map((k) => <i key={k} data-k={k} data-s={tasks[k].s}></i>)}
          </div>
        )}
        {listed && (
          <ul className="tasks" aria-label="Searches by date">
            {meta?.pairs.map(([o, r]) => (
              <li key={`${o}|${r}`}>
                <b>{`${day(o)} to ${day(r)}`}</b>
                {meta.sources.map((s) => {
                  const k = `${s}|${o}|${r}`;
                  return <span key={k} className="s" data-k={k} data-s={tasks[k].s} title={tasks[k].error}><i>{tasks[k].text}</i></span>;
                })}
              </li>
            ))}
          </ul>
        )}
        {!running && failed.length > 0 && (
          <details className="failures">
            <summary>{`Why ${failed.length === 1 ? "one search" : `${failed.length} searches`} failed`}</summary>
            <ul>{failed.map((k) => <li key={k}>{`${day(k.split("|")[1])} to ${day(k.split("|")[2])}: ${tasks[k].error}`}</li>)}</ul>
          </details>
        )}
        <div className="answer">{rows && <Results rows={rows} meta={meta} trip={turn.trip} />}</div>
      </div>
    </article>
  );
}
