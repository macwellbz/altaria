#!/usr/bin/env python3
"""Altaria AI web app: serves web/ and streams search.py runs to the page as Server-Sent Events.

    .venv/bin/python server.py   ->   http://localhost:8000
"""
import itertools
import json
import re
import select
import socket
import threading
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import search

ROOT = Path(__file__).parent
CODE = re.compile(r"[A-Z]{3}")
MAX_SEARCHES = 80  # date pairs x sources; Matrix alone at this size is ~40 minutes
# Matrix's Playwright browser is a module global in search.py, so one search at a time.
one_search = threading.Lock()


def parse(q):
    """Validate the query string; a ValueError carries a message fit to show on the page."""
    orig, dest, currency = (q.get(k, d).upper() for k, d in (("from", ""), ("to", ""), ("currency", "CAD")))
    if not all(CODE.fullmatch(c) for c in (orig, dest, currency)):
        raise ValueError("Airports and currency must be 3-letter codes, like YYZ, VNO and CAD.")
    try:
        spans = [days(q.get(k, "")) for k in ("out", "ret")]
        window = search.arrival_window(q["arrive"]) if q.get("arrive", "").strip(",") else None
    except ValueError:
        raise ValueError("Dates must look like 2026-12-29.") from None
    if min(spans) < 1 or (window and window[0] > window[1]):
        raise ValueError("Each date range must run forwards: the first date can't be after the second.")
    stops = q.get("stops", "")
    if stops not in ("", "0", "1", "2"):
        raise ValueError("Max stops must be 0 (nonstop), 1 or 2, or left open.")
    stops = int(stops) if stops else None
    sources = [s for s in ("matrix", "google") if s in q.get("sources", "").split(",")]
    if not sources:
        raise ValueError("Pick at least one source.")
    # Count before building any date list, so a typo like 2026..2062 can't eat memory.
    if spans[0] * spans[1] * len(sources) > MAX_SEARCHES:
        raise ValueError(f"That's {spans[0] * spans[1] * len(sources)} searches. Narrow the dates to "
                         f"{MAX_SEARCHES} or fewer (date pairs × sources).")
    pairs = list(itertools.product(search.date_range(q["out"]), search.date_range(q["ret"])))
    return orig, dest, currency, pairs, sources, window, stops


def days(spec):
    """Number of dates in '2026-12-28..2026-12-30' (or a single date); zero or less if it runs backwards."""
    start, _, end = spec.partition("..")
    return (date.fromisoformat(end or start) - date.fromisoformat(start)).days + 1


def closed(sock):
    """True once the page has gone away (Stop, a new search, a closed tab): the socket turns readable with nothing to read."""
    try:
        return bool(select.select([sock], [], [], 0)[0]) and not sock.recv(1, socket.MSG_PEEK)
    except OSError:
        return True


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def do_GET(self):
        url = urlsplit(self.path)
        try:
            if url.path == "/api/search":
                return self.search({k: v[0].strip() for k, v in parse_qs(url.query).items()})
            if url.path == "/api/example":
                return self.example()
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page closed or pressed Stop; for a search this also aborted the run

    def end_headers(self):
        # Without this, browsers cache web/ files by guesswork and a normal reload can show a stale page.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def json_response(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def example(self):
        """The cheapest row of the newest saved run: a real fare, never a made-up one."""
        for f in sorted((ROOT / "results").glob("*.json"), reverse=True):
            try:
                d = json.loads(f.read_text())
            except (OSError, ValueError):
                continue  # a CLI run may still be writing this file
            if d.get("rows"):
                return self.json_response({"file": f.name, "args": d["args"], "row": d["rows"][0]})
        self.json_response(None)

    def search(self, q):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def send(event, data):
            if closed(self.connection):  # raising here also aborts run_search between two searches
                raise ConnectionResetError("the page closed the stream")
            self.wfile.write(f"event: {event}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        try:
            orig, dest, currency, pairs, sources, window, stops = parse(q)
        except ValueError as e:
            return send("fail", {"message": str(e)})

        if not one_search.acquire(blocking=False):
            # Usually the search this page just replaced: it stops before its next date pair.
            send("wait", {})
            if not one_search.acquire(timeout=180):
                return send("fail", {"message": "Another search is still running. Try again when it finishes."})
        try:
            send("plan", {"pairs": pairs, "sources": sources, "currency": currency})

            def progress(src, out, ret, result):
                event = {"src": src, "out": out, "ret": ret}
                if result is None:
                    event["status"] = "searching"
                elif isinstance(result, Exception):
                    event.update(status="failed", error=str(result)[:300])
                else:
                    event.update(status="done", count=len(result))
                send("progress", event)

            try:
                rows = search.run_search(orig, dest, pairs, sources, currency, window, progress, stops)
            except (BrokenPipeError, ConnectionResetError):
                raise
            except Exception as e:  # e.g. the currency-rate lookup failed
                return send("fail", {"message": f"The search stopped: {e}"})
            search.save({"orig": orig, "dest": dest, "out": q["out"], "ret": q["ret"], "arrive_between": q.get("arrive") or None,
                         "source": ",".join(sources), "currency": currency, "max_stops": stops}, rows)   # the CLI's args
            send("result", {"rows": rows})
        finally:
            one_search.release()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Altaria AI on http://localhost:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
