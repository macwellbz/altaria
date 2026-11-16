"""Run: python test_site.py, after npm run build in web/. It drives the built site in headless Chromium against
server.py in-process. Searches replay test_site_run.json (the first rows of a real saved run) and the trip box's model
is a stand-in, so nothing searches live, no model is called, and nothing is written to results/."""
import json
import re
import shutil
import tempfile
import threading
from datetime import datetime
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

import ai
import server

RUN = json.loads((Path(__file__).parent / "test_site_run.json").read_text())
ROWS = RUN["rows"]
NOW = datetime(2026, 11, 16, 12)   # the page's clock, so the run's dates stay ahead of "today" whenever this runs
OFF = "The trip reader is off because ALTARIA_AI=off. Unset it and restart the server to turn it on."
# What the stand-in model says for the trip: the saved run's own search. It leaves the origin open.
SAID = {"from": "", "to": "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", "arr-from": "", "arr-to": "",
        "ret-from": "2027-01-10", "ret-to": "2027-01-10", "stops": "1", "currency": "CAD"}
TRIP = "Vilnius on Boxing Day or the day after, back on January 10th, one stop at most, in Canadian dollars"
assert (server.SITE / "index.html").is_file(), "build the site first: cd web && npm run build"

# --- the server: the saved run as the newest in results/, searches replayed from it, a model that answers on cue ---

tmp = Path(tempfile.mkdtemp(prefix="altaria-site-"))
(tmp / "results").mkdir()
(tmp / "results" / "20260927-183130-YYZ-VNO.json").write_text(json.dumps(RUN))
server.ROOT = tmp
searched, saved = [], []


def replay(orig, dest, pairs, sources, currency, window=None, progress=lambda *a: None, stops=None):
    searched.append({"orig": orig, "dest": dest, "pairs": pairs, "sources": sources, "currency": currency, "window": window, "stops": stops})
    for out, ret in pairs:
        for src in sources:
            progress(src, out, ret, None)
            progress(src, out, ret, [r for r in ROWS if (r["search_out"], r["search_ret"]) == (out, ret)])
    return ROWS


server.search.run_search = replay
server.search.save = lambda args, rows: saved.append(args)


class Model:
    """Stands in for Claude Code behind ai.read_trip, so ai.check still judges every value. It replies with `said`
    as JSON, or raises it, once `gate` is open."""
    name, model, label = "claude", None, "Claude via Claude Code"

    def __init__(self):
        self.said, self.heard, self.gate = SAID, [], threading.Event()
        self.gate.set()

    def ask(self, system, user, timeout):
        self.heard.append(user)
        self.gate.wait(10)
        if isinstance(self.said, Exception):
            raise self.said
        return json.dumps(self.said)


model = Model()
ai.provider = lambda fresh=False: (model, None) if model else (None, OFF)
server.Handler.log_message = lambda *args: None
httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{httpd.server_address[1]}"


def visit(browser, width=1440, height=900, motion="no-preference"):
    page = browser.new_context(viewport={"width": width, "height": height}, reduced_motion=motion).new_page()
    page.clock.set_fixed_time(NOW)
    page.errors, page.urls = [], []
    page.on("console", lambda m: m.type == "error" and page.errors.append(m.text))
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("request", lambda r: page.urls.append(r.url))
    page.goto(URL + "/", wait_until="networkidle")
    return page


def done(page, expected=()):
    """No console errors but the expected ones, and no request to another origin."""
    assert [e for e in page.errors if not any(x in e for x in expected)] == [], page.errors
    assert all(u.startswith(URL + "/") or u.startswith(("data:", "blob:")) for u in page.urls), [u for u in page.urls if URL not in u]
    page.context.close()


def text(page, sel):   # a split-flap's final text is in .flap-text from the first paint
    return page.locator(sel).first.text_content().strip()


def money(v):
    return f"{round(v):,}"


def prices(page, sel):
    return [float(re.sub(r"[^\d.]", "", t)) for t in page.eval_on_selector_all(sel, "els => els.map((el) => (el.querySelector('.flap-text') || el).textContent)")]


def wide(page):
    """Whatever spills past the right edge: the page scrolling sideways, or anything in the search cut off."""
    return page.evaluate("""() => document.documentElement.scrollWidth > innerWidth ? ['the page'] :
      [...document.querySelectorAll('#search *')].filter((el) => !el.closest('.table-scroll, .flap-board, .vh')
        && el.getBoundingClientRect().right > innerWidth + 1).map((el) => el.id || el.className || el.tagName)""")


def airport(page, sel):
    return page.get_attribute(sel, "aria-label")


def rest(page):
    """Waits until nothing moves: no glide under way, the scroll still for a few frames, and no animation running."""
    for _ in range(200):
        if page.evaluate("""() => new Promise((done) => {
          const y = scrollY, still = () => scrollY === y && !document.documentElement.classList.contains('lenis-scrolling')
            && document.getAnimations().every((a) => a.playState !== 'running');
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(still()))));
        })"""):
            return
    raise AssertionError("the page never came to rest")


# Every element Tab should reach, and at each stop, once the page is still: which it is, and whether a focus ring
# shows on it, or on the blank around it, since a blank's native control is see-through.
STOPS = """() => {
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert], [aria-hidden="true"]');
  window.stops = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter((el) => el.tabIndex >= 0 && !el.disabled && shown(el));
  return window.stops.length;
}"""
AT = """() => {
  const el = document.activeElement, host = el.closest('.blank') || el, s = getComputedStyle(host), r = host.getBoundingClientRect();
  let seen = 1;
  for (let n = host; n; n = n.parentElement) seen *= Number(getComputedStyle(n).opacity);
  return { i: window.stops.indexOf(el), what: el.id || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 40) || el.tagName,
           ring: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 && seen > .5 && r.bottom > 0 && r.top < innerHeight };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- the page as most see it: wide, motion welcome, a model to read with ---

    page = visit(browser)
    cheapest = min(ROWS, key=lambda r: r["price_cmp"])
    page.wait_for_selector(".pass.in")
    assert text(page, ".pass .fare-big .flap-text") == money(cheapest["price_cmp"]) == "1,147", "the hero's fare is the run's cheapest"
    assert text(page, ".pass .fare-big small") == "CAD round trip"
    board = prices(page, ".board tbody td.price")
    assert board == sorted(board) == [r["price_cmp"] for r in ROWS[:5]], board
    assert page.evaluate("document.documentElement.classList.contains('lenis')"), "Lenis smooths the scroll"

    page.click("#from")   # the finder, by city name
    page.keyboard.type("toronto")
    page.wait_for_selector("#finder-0 >> text=YYZ")
    page.keyboard.press("Enter")
    assert airport(page, "#from") == "From airport: YYZ" and page.evaluate("document.activeElement.id") == "from"
    assert page.locator("#finder").count() == 0

    # the trip box: busy while the model reads, then it fills the blanks the answer settles and leaves the search to Search
    assert text(page, ".trip-by") == "Read by Claude via Claude Code"
    model.gate.clear()
    page.fill("#trip", TRIP)
    page.press("#trip", "Enter")
    page.wait_for_selector(".trip-go[aria-disabled=true]")
    assert page.input_value("#trip") == TRIP and page.get_attribute("#trip", "readonly") is not None
    assert text(page, ".trip-note").startswith("Reading the trip.")
    model.gate.set()
    page.wait_for_selector(".trip-note[data-tone=done]")
    assert model.heard == [f"The trip:\n{TRIP}"]
    assert text(page, ".trip-note") == "Filled 7 blanks. Check them, then press Search."
    assert airport(page, "#from") == "From airport: YYZ", "a blank the answer leaves open keeps the person's choice"
    assert airport(page, "#to") == "To airport: VNO, filled in from your description"
    assert [page.input_value(f"#{f}") for f in ("out-from", "out-to", "arr-from", "arr-to", "ret-from", "ret-to", "stops", "currency")] == [
        "2026-12-26", "2026-12-27", "", "", "2027-01-10", "2027-01-10", "1", "CAD"]
    assert page.locator(".blank.from-trip").count() == 7
    assert page.evaluate("document.activeElement.id") == "go", "nothing required is open, so focus goes to Search"
    page.wait_for_timeout(500)
    assert not any("/api/search" in u for u in page.urls) and page.locator(".turn").count() == 0, "reading a trip never searches"
    page.evaluate(STOPS)   # Shift+Tab from the trip box goes back up into the hero, which the scroll scene has faded out
    rest(page)
    page.focus("#trip")
    page.keyboard.press("Shift+Tab")
    rest(page)
    assert page.evaluate("!!document.activeElement.closest('.hero-copy')") and page.evaluate(AT)["ring"], "the hero's button shows"

    # the search: the saved run comes back through the real server, and renders its lead price and every row
    page.click("#go")
    page.wait_for_selector(".fares-table tbody tr")
    assert searched == [{"orig": "YYZ", "dest": "VNO", "pairs": [("2026-12-26", "2027-01-10"), ("2026-12-27", "2027-01-10")],
                         "sources": ["google"], "currency": "CAD", "window": None, "stops": 1}], searched
    assert saved == [{"orig": "YYZ", "dest": "VNO", "out": "2026-12-26..2026-12-27", "ret": "2027-01-10", "arrive_between": None,
                      "source": "google", "currency": "CAD", "max_stops": 1}], saved
    assert text(page, ".brief .lead .flap-text") == money(cheapest["price_cmp"])
    assert prices(page, ".fares-table tbody .c-price .price") == [r["price_cmp"] for r in ROWS]
    assert page.locator(".fares-table tbody a[href^='https://www.google.com/travel/flights']").count() == len(ROWS)
    assert text(page, ".turn .status").endswith("2 of 2 searches came back.")
    assert page.locator(".blank.from-trip").count() == 0 and text(page, ".trip-note") == "", "searching clears the marks"

    # the keyboard: Tab reaches everything, each with a visible ring, from the skip link round to it again
    rest(page)
    assert page.evaluate(STOPS) > 30
    page.focus(".skip")
    reached, faint = set(), []
    for _ in range(600):
        page.keyboard.press("Tab")
        rest(page)
        at = page.evaluate(AT)
        if at["i"] < 0:
            continue   # the page itself, between the last stop and the first
        reached.add(at["i"])
        if not at["ring"]:
            faint.append(at["what"])
        if at["i"] == 0:
            break
    missing = page.evaluate("(seen) => window.stops.filter((el, i) => !seen.includes(i)).map((el) => el.id || el.outerHTML.slice(0, 80))", sorted(reached))
    assert not missing, f"Tab never reaches {missing}"
    assert not faint, f"no visible focus ring on {sorted(set(faint))}"

    page.click("button.theme")   # the theme toggle, remembered
    page.wait_for_function("document.documentElement.dataset.theme === 'dark'")
    page.reload(wait_until="networkidle")
    assert page.evaluate("document.documentElement.dataset.theme") == "dark" and page.get_attribute("button.theme", "aria-pressed") == "true"
    page.click("button.theme")
    page.wait_for_function("!document.documentElement.dataset.theme")
    page.reload(wait_until="networkidle")
    assert page.evaluate("[document.documentElement.dataset.theme, localStorage.getItem('theme')]") == [None, "light"]
    done(page)

    # --- a 360px phone: nothing scrolls sideways, through the finder, the trip box and the results ---

    page = visit(browser, 360, 740)
    assert wide(page) == []
    page.click("#to")
    page.keyboard.type("vil")
    page.wait_for_selector("#finder-0")
    assert wide(page) == []
    page.keyboard.press("Escape")
    model.said = dict(SAID, **{"from": "YYZ"})
    page.fill("#trip", TRIP)
    page.click(".trip-go")
    page.wait_for_selector(".trip-note[data-tone=done]")
    assert wide(page) == []
    page.click("#go")
    page.wait_for_selector(".fares-table tbody tr")
    page.wait_for_timeout(1500)
    assert wide(page) == []
    done(page)
    model.said = SAID

    # --- asked for less motion: no Lenis, and the page is all there ---

    page = visit(browser, motion="reduce")
    assert not page.evaluate("document.documentElement.classList.contains('lenis')")
    assert text(page, ".pass .fare-big .flap-text") == "1,147"
    done(page)

    # --- no model: no trip box, and no hint of one ---

    model = None
    page = visit(browser)
    assert page.locator("#go").is_visible() and page.locator(".trip, #trip").count() == 0
    done(page)

    # --- a value the server throws out, and a model that fails: said as given ---

    model = Model()
    page = visit(browser)
    model.said = dict.fromkeys(ai.FIELDS, "") | {"from": "YTO"}   # Toronto's city-wide code, which no flight leaves from
    page.fill("#trip", "Out of Toronto, any airport")
    page.click(".trip-go")
    page.wait_for_selector(".trip-note[data-tone=done]")
    assert text(page, ".trip-note") == ("Nothing in that fills a blank. Didn't use YTO as the origin. YTO isn't an airport code "
                                       "on Altaria's list. Try naming the airports or cities, and the days you could fly.")
    assert airport(page, "#from") == "From airport: not chosen yet" and page.evaluate("document.activeElement.id") != "go"
    model.said = ai.ProviderError("Claude Code failed: Not logged in")
    page.click(".trip-go")
    page.wait_for_selector(".trip-note[data-tone=error]")
    assert text(page, ".trip-note") == "Claude Code failed: Not logged in" and page.input_value("#trip") == "Out of Toronto, any airport"
    assert not any("/api/search" in u for u in page.urls)
    done(page, expected=["status of 502"])   # Chrome logs the failed request itself

    browser.close()

httpd.shutdown()
shutil.rmtree(tmp)
print("ok")
