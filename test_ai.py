"""Run: python test_ai.py. No live model calls: Ollama is a stub HTTP server, and claude is a fake script on a PATH
that holds nothing else."""
import http.client
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import ai
import server

TODAY = "2026-11-16"   # a Monday
TRIP = "Toronto to Vilnius for New Year's, land by the 31st, back mid January, one stop at most, in CAD"
ANSWER = {"from": "YYZ", "to": "VNO", "out-from": "2026-12-28", "out-to": "2026-12-30", "arr-from": "", "arr-to": "2026-12-31",
          "ret-from": "2027-01-13", "ret-to": "2027-01-17", "stops": "1", "currency": "CAD"}
tmp = Path(tempfile.mkdtemp(prefix="altaria-test-"))
BIN, EMPTY, LOG = tmp / "bin", tmp / "empty", tmp / "claude.log"
BIN.mkdir()
EMPTY.mkdir()
os.environ.update(PATH=str(BIN), FAKE_CLAUDE_LOG=str(LOG), FAKE_CLAUDE_ANSWER=json.dumps(ANSWER), FAKE_CLAUDE="ok")
os.environ.pop("ALTARIA_AI_MODEL", None)


def check(**said):
    return ai.check(said, TODAY)


def why(r, field):
    return next(d["why"] for d in r["dropped"] if d["field"] == field)


# --- the form's lists, the prompt, parsing ---

assert len(ai.currencies()) == 30 and {"CAD", "EUR", "USD"} <= set(ai.currencies()), \
    "the form's CURRENCIES list moved or changed: point ai.currencies() at it"
assert {"YYZ", "VNO", "JFK"} <= ai.airports() and "YTO" not in ai.airports()
prompt = ai.instructions(TODAY)
assert "Monday 2026-11-16" in prompt and "Fri 2026-11-20" in prompt and "Sun 2026-11-29" in prompt
assert "\N{EM DASH}" not in prompt and "\N{EN DASH}" not in prompt

assert ai.parse('```json\n{"from": "YYZ"}\n```') == {"from": "YYZ"}
assert ai.parse('Sure! {"to": "VNO", "stops": "1"} Have a good trip.') == {"to": "VNO", "stops": "1"}
assert ai.parse({"from": "YYZ"}) == {"from": "YYZ"}
for reply in ("Sorry, I can't help.", '{"answer": "YYZ"}', '["YYZ"]', "{from: YYZ}", "", None):
    try:
        ai.parse(reply)
        raise AssertionError(f"parse accepted {reply!r}")
    except ValueError:
        pass

# --- checking canned model answers ---

r = check(**dict(ANSWER, **{"from": " yyz ", "stops": 1, "currency": "cad"}))
assert r == {"fields": ANSWER, "missing": ["arr-from"], "dropped": []}
assert check() == {"fields": dict.fromkeys(ai.FIELDS, ""), "missing": ai.FIELDS, "dropped": []}
assert check(**{"from": None, "to": ""})["missing"] == ai.FIELDS

r = check(**{"from": "YTO", "to": "yyz"})
assert r["fields"]["from"] == "" and r["fields"]["to"] == "YYZ" and "YTO isn't an airport code" in why(r, "from")
assert "from" not in r["missing"], "a dropped value is listed in dropped, not missing"
assert "same airport" in why(check(**{"from": "YYZ", "to": "yyz"}), "to")
assert "isn't an airport" in why(check(**{"from": "Toronto"}), "from")

assert why(check(**{"out-from": "2026-11-15"}), "out-from") == "That's before today, 2026-11-16."
assert check(**{"out-from": TODAY})["fields"]["out-from"] == TODAY
for bad in ("2026-02-30", "20261228", "Dec 28", "2026-12-28T10:00"):
    assert "isn't a date" in why(check(**{"out-from": bad}), "out-from"), bad
assert "more than a year" in why(check(**{"out-from": "2027-11-18"}), "out-from")
r = check(**{"out-from": "2026-12-30", "out-to": "2026-12-28"})
assert r["fields"]["out-from"] == "2026-12-30" and why(r, "out-to") == "That's before the first departure day, 2026-12-30."
assert "first departure day" in why(check(**{"out-from": "2026-12-28", "ret-from": "2026-12-20"}), "ret-from")
assert "first departure day" in why(check(**{"out-from": "2026-12-28", "ret-to": "2026-12-27"}), "ret-to")
assert "first return day" in why(check(**{"ret-from": "2027-01-13", "ret-to": "2027-01-12"}), "ret-to")
assert "first departure day" in why(check(**{"out-from": "2026-12-28", "arr-from": "2026-12-27"}), "arr-from")
assert "first landing day" in why(check(**{"out-from": "2026-12-28", "arr-from": "2026-12-30", "arr-to": "2026-12-29"}), "arr-to")
r = check(**{"out-from": "2025-12-28", "ret-from": "2026-12-20"})   # the floor falls back to today once out-from is dropped
assert r["fields"]["ret-from"] == "2026-12-20" and [d["field"] for d in r["dropped"]] == ["out-from"]

r = check(stops="any")
assert r["fields"]["stops"] == "" and "stops" not in r["missing"] and not r["dropped"], "any is settled, not missing"
assert check(stops="0")["fields"]["stops"] == "0" and check(stops=2)["fields"]["stops"] == "2"
assert "0, 1 or 2" in why(check(stops="3"), "stops") and "single value" in why(check(stops=True), "stops")
assert check(currency="eur")["fields"]["currency"] == "EUR"
assert why(check(currency="BTC"), "currency") == "BTC isn't one of the form's currencies."
r = check(**{"from": ["YYZ"]})
assert r["dropped"] == [{"field": "from", "value": '["YYZ"]', "why": "That isn't a single value."}]

# --- a fake Ollama and a fake claude ---


class FakeOllama(BaseHTTPRequestHandler):
    models, replies, seen = ["llama3.2:latest", "qwen2.5:7b"], [], []

    def do_GET(self):
        self.seen.append((self.path, None))
        self.send(200, {"models": [{"name": m, "model": m} for m in self.models]})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.seen.append((self.path, body))
        if body["model"] not in self.models:
            return self.send(404, {"error": f"model '{body['model']}' not found"})
        self.send(200, {"model": body["model"], "message": {"role": "assistant", "content": self.replies.pop(0)}, "done": True})

    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def serve(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


ollama = serve(FakeOllama)
UP = f"http://127.0.0.1:{ollama.server_address[1]}"
with socket.socket() as s:   # a port nothing listens on
    s.bind(("127.0.0.1", 0))
    DOWN = f"http://127.0.0.1:{s.getsockname()[1]}"

(BIN / "claude").write_text(r'''#!PYTHON
import json, os, sys, time
log = os.environ["FAKE_CLAUDE_LOG"]
before = len(open(log).readlines()) if os.path.exists(log) else 0
with open(log, "a") as f:
    f.write(json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd(), "files": os.listdir("."),
                        "stdin": sys.stdin.read(), "pid": os.getpid()}) + "\n")
mode, answer = os.environ["FAKE_CLAUDE"], json.loads(os.environ["FAKE_CLAUDE_ANSWER"])
if mode == "garbage-then-ok":
    mode = "ok" if before else "garbage"
if mode == "sleep":
    time.sleep(30)
if mode == "crash":
    sys.exit("boom")
out = {"type": "result", "subtype": "success", "is_error": mode == "error", "result": ""}
if mode == "ok":
    out.update(structured_output=answer, result=json.dumps(answer))
if mode == "text":
    out["result"] = "Here it is:\n```json\n" + json.dumps(answer) + "\n```"
if mode == "garbage":
    out["result"] = "I can't help with that."
if mode == "error":
    out["result"] = "Not logged in · Please run /login"
print(json.dumps(out))
sys.exit(1 if mode == "error" else 0)
'''.replace("PYTHON", sys.executable))
(BIN / "claude").chmod(0o755)


def fake_claude(mode):
    os.environ["FAKE_CLAUDE"] = mode
    LOG.unlink(missing_ok=True)


def calls():
    return [json.loads(line) for line in LOG.read_text().splitlines()] if LOG.exists() else []


def use(choice=None, model=None, ollama_at=DOWN, path=BIN):
    """Set the environment the way a user would, and detect again."""
    for k, v in (("ALTARIA_AI", choice), ("ALTARIA_AI_MODEL", model)):
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    ai.OLLAMA, os.environ["PATH"] = ollama_at, str(path)
    return ai.provider(fresh=True)


def fails(fn, words):
    try:
        fn()
    except ai.ProviderError as e:
        assert words in str(e), str(e)
        return
    raise AssertionError(f"expected a ProviderError saying {words!r}")


# --- choosing a provider ---

p, why_ = use("off")
assert p is None and "ALTARIA_AI=off" in why_
assert use("bogus")[0] is None and "ollama, claude or off" in use("bogus")[1]
assert use("ollama")[0] is None and "isn't answering" in use("ollama")[1]
assert "no model called mistral" in use("ollama", "mistral", UP)[1]
assert use("claude", path=EMPTY)[1].startswith("The claude command isn't on PATH")
assert use(path=EMPTY)[1].startswith("No model found")

p, _ = use()   # auto, Ollama down: the CLI on PATH
assert (p.name, p.exe, p.model, p.label) == ("claude", str(BIN / "claude"), None, "Claude via Claude Code")
p, _ = use(ollama_at=UP)   # auto, Ollama up: its first listed model
assert (p.name, p.model, p.label) == ("ollama", "llama3.2:latest", "llama3.2:latest via Ollama")
assert use(model="qwen2.5:7b", ollama_at=UP)[0].model == "qwen2.5:7b"
assert use(model="llama3.2", ollama_at=UP)[0].name == "ollama", "a name without :latest still matches"
p, _ = use(model="sonnet", ollama_at=UP)   # Ollama lacks it, so the model is for Claude
assert (p.name, p.model, p.label) == ("claude", "sonnet", "Claude sonnet via Claude Code")
assert use("claude", ollama_at=UP)[0].name == "claude"
FakeOllama.models = []
assert use(ollama_at=UP)[0].name == "claude", "Ollama with no model doesn't count"
FakeOllama.models = ["llama3.2:latest", "qwen2.5:7b"]

use(ollama_at=UP)
FakeOllama.seen.clear()
for _ in range(3):
    assert ai.status() == {"available": True, "provider": "ollama", "model": "llama3.2:latest", "label": "llama3.2:latest via Ollama"}
assert len(FakeOllama.seen) == 0, "status() reuses a fresh check"
os.environ["ALTARIA_AI"] = "off"
assert ai.status() == {"available": False, "why": use("off")[1]}, "a changed setting is seen at once"

# --- Ollama against the stub ---

p, _ = use("ollama", ollama_at=UP)
FakeOllama.seen.clear()
FakeOllama.replies[:] = [json.dumps(ANSWER)]
assert ai.read_trip(p, TRIP, TODAY) == {"fields": ANSWER, "missing": ["arr-from"], "dropped": []}
path, body = FakeOllama.seen[-1]
assert path == "/api/chat" and body["model"] == "llama3.2:latest" and body["stream"] is False and body["format"] == ai.schema()
assert [m["role"] for m in body["messages"]] == ["system", "user"] and "Monday 2026-11-16" in body["messages"][0]["content"]
assert body["messages"][1]["content"] == f"The trip:\n{TRIP}"
FakeOllama.replies[:] = ["Toronto is lovely in December.", json.dumps(ANSWER)]   # one retry on a reply with no form
assert ai.read_trip(p, TRIP, TODAY)["fields"] == ANSWER and not FakeOllama.replies
assert FakeOllama.seen[-1][1]["messages"][1]["content"].endswith("Reply with the JSON object only.")
FakeOllama.replies[:] = ["no", "still no"]
fails(lambda: ai.read_trip(p, TRIP, TODAY), "didn't return a form")
fails(lambda: ai.read_trip(ai.Ollama("gone"), TRIP, TODAY), "Ollama answered 404")

# --- Claude Code against the fake ---

p, _ = use("claude")
fake_claude("ok")
assert ai.read_trip(p, TRIP, TODAY) == {"fields": ANSWER, "missing": ["arr-from"], "dropped": []}
call = calls()[-1]
argv = call["argv"]
assert argv[0] == "-p" and {"--safe-mode", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"} <= set(argv)
assert argv[argv.index("--tools") + 1] == "" and argv[argv.index("--output-format") + 1] == "json" and "--model" not in argv
assert json.loads(argv[argv.index("--json-schema") + 1]) == ai.schema()
assert argv[argv.index("--system-prompt") + 1] == ai.instructions(TODAY)
assert call["stdin"] == f"The trip:\n{TRIP}" and not any("Vilnius" in a for a in argv), "the trip goes in on stdin"
assert call["files"] == [] and not Path(call["cwd"]).exists(), "it runs in an empty folder that is removed afterwards"
assert Path(call["cwd"]).resolve() != Path(__file__).resolve().parent

fake_claude("ok")
ai.read_trip(use("claude", "sonnet")[0], TRIP, TODAY)
argv = calls()[-1]["argv"]
assert argv[argv.index("--model") + 1] == "sonnet"

fake_claude("text")
assert ai.read_trip(p, TRIP, TODAY)["fields"] == ANSWER, "JSON in the result text still counts"
fake_claude("garbage-then-ok")
assert ai.read_trip(p, TRIP, TODAY)["fields"] == ANSWER and len(calls()) == 2
fake_claude("garbage")
fails(lambda: ai.read_trip(p, TRIP, TODAY), "didn't return a form")
assert len(calls()) == 2, "one retry, no more"
fake_claude("error")
fails(lambda: ai.read_trip(p, TRIP, TODAY), "Not logged in")
fake_claude("crash")
fails(lambda: ai.read_trip(p, TRIP, TODAY), "boom")

fake_claude("sleep")
ai.TIMEOUT, started = 2, time.monotonic()
fails(lambda: ai.read_trip(p, TRIP, TODAY), "didn't answer within 2 seconds")
assert time.monotonic() - started < 5
try:
    os.kill(calls()[-1]["pid"], 0)
    raise AssertionError("the timed-out claude is still running")
except ProcessLookupError:
    pass
ai.TIMEOUT = 60

# --- the endpoints, in-process ---

server.Handler.log_message = lambda *args: None
(tmp / "results").mkdir()
saved = [{"price": 1000 + i, "source": "google"} for i in range(7)]   # saved cheapest first
(tmp / "results" / "20260101-000000-YYZ-VNO.json").write_text(json.dumps({"args": {"orig": "YYZ"}, "rows": saved}))
server.ROOT = tmp
site = serve(server.Handler)
PORT = site.server_address[1]
HERE = f"http://127.0.0.1:{PORT}"


def call_site(method, path, body=None, **headers):
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=30)
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    h = {"Content-Type": "application/json", "Origin": HERE}
    h.update((k.replace("_", "-"), v) for k, v in headers.items())
    c.request(method, path, body=data, headers={k: v for k, v in h.items() if v is not None})
    r = c.getresponse()
    out = r.status, json.loads(r.read() or "null")
    c.close()
    return out


status, ex = call_site("GET", "/api/example")
assert status == 200 and ex == {"file": "20260101-000000-YYZ-VNO.json", "args": {"orig": "YYZ"}, "row": saved[0], "rows": saved[:5]}

use("off")
assert call_site("GET", "/api/ai") == (200, {"available": False, "why": use("off")[1]})
use("claude")
assert call_site("GET", "/api/ai") == (200, {"available": True, "provider": "claude", "model": None, "label": "Claude via Claude Code"})

ask = {"text": TRIP, "today": TODAY}
fake_claude("ok")
assert call_site("POST", "/api/ai/trip", ask) == (200, {"fields": ANSWER, "missing": ["arr-from"], "dropped": []})
assert call_site("POST", "/api/ai/trip", ask, Origin=None)[0] == 200, "no Origin: not a browser on another site"
assert call_site("POST", "/api/ai/trip", ask, Content_Type="application/json; charset=utf-8")[0] == 200
assert call_site("POST", "/api/ai/trip", ask, Host="localhost:5173", Origin="http://localhost:5173")[0] == 200, "npm run dev"
assert len(calls()) == 4

fake_claude("ok")
for headers in ({"Origin": "http://evil.example"}, {"Origin": "null"}, {"Origin": f"https://127.0.0.1:{PORT}"},
                {"Host": "evil.example"}, {"Host": f"evil.example:{PORT}"}, {"Host": "localhost:3000", "Origin": "http://localhost:3000"}):
    assert call_site("POST", "/api/ai/trip", ask, **headers) == (403, {"error": "Altaria only answers its own page."}), headers
for ctype in ("text/plain", "application/x-www-form-urlencoded", "multipart/form-data", None):
    assert call_site("POST", "/api/ai/trip", ask, Content_Type=ctype)[0] == 415, ctype
assert call_site("POST", "/api/ai/trip", {"text": "x" * 4500, "today": TODAY})[0] == 413
assert not calls(), "a rejected request never reaches the model"

for bad in (b"{not json", b"[]", {"today": TODAY}, {"text": "  ", "today": TODAY}, {"text": 7, "today": TODAY},
            {"text": "x" * 501, "today": TODAY}, {"text": TRIP}, {"text": TRIP, "today": "2026-13-01"}, {"text": TRIP, "today": "today"}):
    status, body = call_site("POST", "/api/ai/trip", bad)
    assert status == 400 and set(body) == {"error"}, (bad, status, body)
assert call_site("POST", "/api/ai/trip", {"text": "x" * 500, "today": TODAY})[0] == 200
assert call_site("POST", "/api/other", ask)[0] == 404

use("off")
assert call_site("POST", "/api/ai/trip", ask) == (503, {"error": use("off")[1]})
use("claude")
fake_claude("error")
status, body = call_site("POST", "/api/ai/trip", ask)
assert status == 502 and "Not logged in" in body["error"]
fake_claude("ok")
with server.one_ai:
    status, body = call_site("POST", "/api/ai/trip", ask)
assert status == 429 and "still reading" in body["error"] and not calls()

use("ollama", ollama_at=UP)
FakeOllama.replies[:] = [json.dumps(dict(ANSWER, **{"out-from": "2025-12-28"}))]
status, body = call_site("POST", "/api/ai/trip", ask)
assert status == 200 and body["fields"]["out-from"] == "" and body["dropped"][0]["field"] == "out-from"

site.shutdown()
ollama.shutdown()
shutil.rmtree(tmp)
print("ok")
