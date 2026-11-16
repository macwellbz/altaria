#!/usr/bin/env python3
"""Altaria web app: serves the built site in web/dist/ and streams search.py runs to the page as Server-Sent Events.

    cd web && npm install && npm run build   # after every change to web/
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

import ai
import search

ROOT = Path(__file__).parent
SITE = ROOT / "web" / "dist"   # what npm run build writes
CODE = re.compile(r"[A-Z]{3}")
MAX_SEARCHES = 80  # date pairs x sources; Matrix alone at this size is ~40 minutes
# Matrix's Playwright browser is a module global in search.py, so one search at a time.
one_search = threading.Lock()
one_ai = threading.Lock()   # each trip read spends the user's model quota or machine: one at a time


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
        super().__init__(*args, directory=str(SITE), **kwargs)

    def do_GET(self):
        url = urlsplit(self.path)
        try:
            if url.path == "/api/search":
                return self.search({k: v[0].strip() for k, v in parse_qs(url.query).items()})
            if url.path == "/api/example":
                return self.example()
            if url.path == "/api/ai":
                return self.json_response(ai.status())
            if not (SITE / "index.html").is_file():
                return self.text_response(503, "The site isn't built yet. In web/, run npm install once, then npm run build, and reload.\n")
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page closed or pressed Stop; for a search this also aborted the run

    def end_headers(self):
        # Without this, browsers cache the site's files by guesswork and a normal reload can show a stale page.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_POST(self):
        try:
            self.json_response(*self.trip())
        except (BrokenPipeError, ConnectionResetError):
            pass

    def trip(self):
        """POST /api/ai/trip: a model reads a trip in plain English into the form's blanks, and ai.py checks each one.
        Only this site may ask, since every call spends the user's model quota."""
        if urlsplit(self.path).path != "/api/ai/trip":
            return {"error": "There's nothing to post to here."}, 404
        own = {f"{h}:{p}" for h in ("localhost", "127.0.0.1") for p in (self.server.server_address[1], 5173)}  # 5173: npm run dev
        origin = self.headers.get("Origin")
        if self.headers.get("Host") not in own or (origin is not None and origin not in {f"http://{h}" for h in own}):
            return {"error": "Altaria only answers its own page."}, 403
        if self.headers.get_content_type() != "application/json":
            return {"error": "Send the trip as application/json."}, 415
        n = self.headers.get("Content-Length", "")
        if not n.isdigit():
            return {"error": "Send the trip with a Content-Length."}, 400
        if int(n) > 4096:
            return {"error": "That request is too big."}, 413
        try:
            q = json.loads(self.rfile.read(int(n)))
        except ValueError:
            return {"error": "The request isn't valid JSON."}, 400
        text, today = (q.get("text"), q.get("today")) if isinstance(q, dict) else (None, None)
        if not isinstance(text, str) or not text.strip():
            return {"error": "Describe the trip first."}, 400
        if len(text.strip()) > 500:
            return {"error": "Keep the trip to 500 characters."}, 400
        if not ai.as_date(today):
            return {"error": "today must be a date like 2026-12-29."}, 400
        p, why = ai.provider()
        if not p:
            return {"error": why}, 503
        if not one_ai.acquire(blocking=False):
            return {"error": "Altaria is still reading the last trip. Try again when it finishes."}, 429
        try:
            return ai.read_trip(p, text.strip(), today), 200
        except ai.ProviderError as e:
            return {"error": str(e)}, 502
        finally:
            one_ai.release()

    def json_response(self, body, status=200):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def text_response(self, status, text):
        data = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def example(self):
        """The newest saved run's cheapest row, and its first five rows: real fares, never made-up ones."""
        for f in sorted((ROOT / "results").glob("*.json"), reverse=True):
            try:
                d = json.loads(f.read_text())
            except (OSError, ValueError):
                continue  # a CLI run may still be writing this file
            if d.get("rows"):
                return self.json_response({"file": f.name, "args": d["args"], "row": d["rows"][0], "rows": d["rows"][:5]})
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
    print("Altaria on http://localhost:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
