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


def backing(page):   # how far the header's backing has come in, 0 to 1
    return page.evaluate("+getComputedStyle(document.getElementById('nav')).getPropertyValue('--backing')")


def blank(page, sel):
    """The blank round a control: whether it's still open, how its line is drawn, its ring, and how wide it is."""
    return page.eval_on_selector(sel, """(el) => { const b = el.closest('.blank'), s = getComputedStyle(b);
      return { open: b.classList.contains('empty'), line: s.borderBottomStyle, ring: s.outlineStyle !== 'none', width: b.getBoundingClientRect().width }; }""")


def top(page, sel):   # how far down the page something starts
    return page.eval_on_selector(sel, "(el) => el.getBoundingClientRect().top + scrollY")


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

# How the sentence sets: the lines each clause takes, and how many phrases meant to stay whole broke across two.
SET = """() => ({
  lines: [...document.querySelectorAll('.clause')].map((c) => Math.round(c.getBoundingClientRect().height / parseFloat(getComputedStyle(c).lineHeight))),
  broken: [...document.querySelectorAll('.range, .tail')].filter((el) => el.getClientRects().length > 1).length,
})"""
# The sentence's controls that answer a press less than 32px tall, measured through each one's middle.
SMALL = """() => [...document.querySelectorAll('.say :is(button, input, select)')].map((el) => {
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  let tall = 1;
  for (const way of [-1, 1]) for (let i = 1; i < 40 && document.elementFromPoint(x, y + way * i) === el; i++) tall++;
  return [el.id, tall];
}).filter(([, tall]) => tall < 32)"""

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
    tint, paper = page.evaluate("[document.querySelector('.board tr.first td'), document.body].map((el) => getComputedStyle(el).backgroundColor)")
    assert tint != paper, "the cheapest fare's tint stands apart from the page"
    assert backing(page) == 0 and page.evaluate("getComputedStyle(document.querySelector('.brand .on-sky')).opacity") == "1", \
        "over the sky the header is bare, with the ink lockup"
    assert page.evaluate("document.documentElement.classList.contains('lenis')"), "Lenis smooths the scroll"

    # the sentence's blanks: an open one the search can do without is dashed, the rest are solid, and each is as wide as what it holds
    assert (blank(page, "#out-to")["open"], blank(page, "#out-to")["line"]) == (True, "dashed")
    assert (blank(page, "#from")["open"], blank(page, "#from")["line"]) == (True, "solid")
    assert (blank(page, "#stops")["open"], blank(page, "#stops")["line"]) == (False, "solid")
    any_stops = blank(page, "#stops")["width"]
    page.select_option("#stops", "0")
    assert blank(page, "#stops")["width"] < any_stops / 2, "a blank is as wide as its value, so the sentence keeps its word spacing"
    page.select_option("#stops", "")
    assert page.get_attribute("#go", "aria-describedby") == "estimate" and text(page, "#estimate") == ""

    page.click("#from")   # the finder, by city name
    page.keyboard.type("toronto")
    page.wait_for_selector("#finder-0 >> text=YYZ")
    page.keyboard.press("Enter")
    assert airport(page, "#from") == "From airport: YYZ" and page.evaluate("document.activeElement.id") == "from"
    assert page.locator("#finder").count() == 0
    assert (blank(page, "#from")["open"], blank(page, "#from")["line"]) == (False, "solid")
    page.click("#out-from")
    assert page.evaluate("document.activeElement.id") == "out-from" and not blank(page, "#out-from")["ring"], \
        "pressed with the pointer, a blank shows its accent line, not the keyboard's ring"
    page.keyboard.press("Escape")   # the calendar

    # the trip box: busy while the model reads, then it fills the blanks the answer settles and leaves the search to Search
    assert page.locator(".trip-by").count() == 0
    model.gate.clear()
    sentence = top(page, ".say")
    page.fill("#trip", TRIP)
    page.press("#trip", "Enter")
    page.wait_for_selector(".trip-go[aria-disabled=true]")
    assert page.input_value("#trip") == TRIP and page.get_attribute("#trip", "readonly") is not None
    assert text(page, ".trip-note") == "Reading your trip…"
    assert page.get_by_role("button", name="Fill in the blanks").count() == 1, "busy, the button shows its rail and keeps its name"
    model.gate.set()
    page.wait_for_selector(".trip-note[data-tone=done]")
    assert top(page, ".say") == sentence, "the reading's line is beside its button, so it never moves the sentence"
    assert model.heard == [f"The trip:\n{TRIP}"]
    assert text(page, ".trip-note") == "Filled 7 blanks. Check them, then press Search."
    assert airport(page, "#from") == "From airport: YYZ", "a blank the answer leaves open keeps the person's choice"
    assert airport(page, "#to") == "To airport: VNO, filled in from your description"
    assert [page.input_value(f"#{f}") for f in ("out-from", "out-to", "arr-from", "arr-to", "ret-from", "ret-to", "stops", "currency")] == [
        "2026-12-26", "2026-12-27", "", "", "2027-01-10", "2027-01-10", "1", "CAD"]
    assert page.locator(".blank.from-trip").count() == 7
    assert page.evaluate("document.activeElement.id") == "go", "nothing required is open, so focus goes to Search"
    assert text(page, "#estimate") == "2 searches, about 15 seconds"
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
    rest(page)   # the glide to the new turn
    assert backing(page) == 1, "over the page the header has its backing"
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
    assert page.evaluate(SET) == {"lines": [2, 2, 2, 2, 1], "broken": 0}, "each clause turns over once, as whole phrases"
    seen = []
    for y in (0, 32, 200):   # the header's backing comes in with the scroll rather than at a threshold
        page.evaluate(f"scrollTo(0, {y})")
        rest(page)
        seen.append(backing(page))
    assert seen[0] == 0 and 0 < seen[1] < 1 and seen[2] == 1, seen
    page.evaluate("scrollTo(0, 0)")
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
    rest(page)   # the glide to Search, which leaves the sentence in view
    assert page.evaluate(SET) == {"lines": [2, 2, 2, 2, 1], "broken": 0}, "filled in, the sentence sets the same way"
    assert page.evaluate(SMALL) == [], "every blank answers a press anywhere on its line"
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
    # beside Search: what the search will take, and above that, when it can't start, what's in the way
    page.fill("#out-from", "2026-12-26")
    page.fill("#ret-from", "2027-01-10")
    assert text(page, "#estimate") == "1 search, about 10 seconds" and page.locator("#form-error").is_hidden()
    page.click("#go")
    assert text(page, "#form-error").startswith("Pick both airports") and page.locator("#estimate").is_visible()
    assert page.evaluate("""() => { const [b, e, t] = ['go', 'form-error', 'estimate'].map((id) => document.getElementById(id).getBoundingClientRect());
      return e.left > b.right && e.top < b.bottom && e.bottom > b.top && t.left === e.left && t.top >= e.bottom - 1; }"""), \
        "the error is beside the button that raised it, with the estimate under it"
    assert page.evaluate("document.activeElement.id") == "from" and not any("/api/search" in u for u in page.urls)
    page.fill("#ret-from", "2027-01-11")   # the estimate stays, and follows the blanks, while the error is up
    assert text(page, "#estimate") == "1 search, about 10 seconds" and page.locator("#form-error").is_visible()
    page.fill("#ret-to", "2027-01-12")
    assert text(page, "#estimate") == "2 searches, about 15 seconds"
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
