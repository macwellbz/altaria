#!/usr/bin/env python3
"""Unbiased round-trip flight search: real fares from ITA Matrix and Google Flights,
sorted by price then duration. No ranking weights, no affiliate links.

    python search.py --from YYZ --to VNO --out 2026-12-28..2026-12-30 \
        --ret 2027-01-10..2027-01-15 --arrive-between 2026-12-30,2026-12-31 --source both
"""
import argparse
import itertools
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

AT_ONCE = 5   # Google requests in flight at once: date pairs, then returns
DETAIL = 25   # the cheapest fares whose return flights are looked up; the rest keep only their return date


def date_range(spec):
    """'2026-12-28..2026-12-30' -> ['2026-12-28', '2026-12-29', '2026-12-30']; a single date also works."""
    start, _, end = spec.partition("..")
    d, end = date.fromisoformat(start), date.fromisoformat(end or start)
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# --- ITA Matrix: the fare engine itself, full fare construction, no sponsored layer ---

_pw = _browser = None


def matrix(orig, dest, out, ret, max_stops=None):
    """Every Matrix search carries a Google BotGuard token, so we drive the real page in headless
    Chromium and rewrite the search request it sends (the token isn't bound to the request body)."""
    global _pw, _browser
    from playwright.sync_api import sync_playwright
    if _browser is None:
        _pw = sync_playwright().start()
        _browser = _pw.chromium.launch(headless=True)
    got = []

    def rewrite(route):
        body = route.request.post_data or ""
        if "/v1/search" not in body:
            return route.continue_()
        i, j = body.index("{"), body.rindex("}") + 1
        q = json.loads(body[i:j])
        for sl, (o, d, day) in zip(q["inputs"]["slices"], [(orig, dest, out), (dest, orig, ret)]):
            sl.update(origins=[o], destinations=[d], date=day, dateModifier={"minus": 0, "plus": 0})
        q["inputs"]["page"]["size"] = 100
        if max_stops is not None:
            q["inputs"]["maxStopCount"] = max_stops  # Matrix's own "Up to N stops", applied to each leg
        route.continue_(post_data=body[:i] + json.dumps(q) + body[j:])

    page = _browser.new_page()
    try:
        page.route("**/content-alkalimatrix-pa.googleapis.com/batch*", rewrite)
        page.on("response", lambda r: "alkalimatrix-pa" in r.url
                and "/v1/search" in (r.request.post_data or "") and got.append(r.text()))
        page.goto("https://matrix.itasoftware.com/search")
        boxes = page.get_by_role("combobox", name="Add airport")
        for i, code in enumerate([orig, dest]):
            boxes.nth(i).click()
            boxes.nth(i).press_sequentially(code, delay=80)
            page.wait_for_timeout(1500)
            page.keyboard.press("Enter")
        mdy = lambda d: f"{d[5:7]}/{d[8:10]}/{d[:4]}"
        page.get_by_role("textbox", name="Start date").fill(mdy(out))
        page.get_by_role("textbox", name="End date").fill(mdy(ret))
        page.keyboard.press("Tab")
        page.get_by_role("button", name="Search").last.click()
        for _ in range(150):
            if got:
                break
            page.wait_for_timeout(1000)
    finally:
        page.close()
    if not got:
        raise TimeoutError("Matrix returned nothing in 150s")
    d = json.loads(got[0][got[0].index("{"):got[0].rindex("}") + 1])
    if "error" in d:
        raise RuntimeError(d["error"]["message"])
    return norm_matrix(d)


def norm_matrix(d):
    rows = []
    for s in d.get("solutionList", {}).get("solutions", []):
        out, back = s["itinerary"]["slices"]
        cur, amount = re.fullmatch(r"([A-Z]{3})([\d.]+)", s["displayTotal"]).groups()
        rows.append({
            "source": "matrix",
            "price": float(amount),
            "currency": cur,
            "carriers": [c["shortName"] for c in s["itinerary"]["carriers"]],
            "route": "-".join([out["origin"]["code"]] + [x["code"] for x in out.get("stops", [])]
                              + [out["destination"]["code"]]),
            "flights": " ".join(out["flights"]),
            "stops": len(out.get("stops", [])),
            "depart": out["departure"][:16],
            "arrive": out["arrival"][:16],
            "duration": out["duration"],
            "return_depart": back["departure"][:16],
            "return_arrive": back["arrival"][:16],
            # Matrix's own flags, e.g. RISKY_CONNECTION, OVERNIGHT, CHANGE_OF_AIRPORT
            "warnings": sorted({w for sl in (out, back) for w in sl.get("ext", {}).get("warnings", {}).get("types", [])}),
        })
    return rows


# --- Google Flights via fast-flights (baseline to compare against) ---

def google_query(orig, dest, out, ret, currency, max_stops=None):
    """One date pair's Google Flights query. max_stops applies to each leg (0 = nonstop only).
    Its .url() is also every result's link: Matrix can't sell tickets and its result links expire."""
    from fast_flights import FlightQuery, create_query
    return create_query(
        flights=[FlightQuery(date=out, from_airport=orig, to_airport=dest),
                 FlightQuery(date=ret, from_airport=dest, to_airport=orig)],
        trip="round-trip", currency=currency, language="en", max_stops=max_stops)


def fetch_google(q, currency):
    """One Google Flights page, parsed. A page that comes back without results usually has them the second
    time, so a failure is asked once more."""
    from fast_flights import fetch_flights_html
    try:
        return parse_google(fetch_flights_html(q), currency)
    except Exception:
        return parse_google(fetch_flights_html(q), currency)


def google(orig, dest, out, ret, currency, max_stops=None):
    """One date pair's outbound flights. Each is already priced as the whole round trip, with its cheapest
    return; add_return finds which return that is."""
    return fetch_google(google_query(orig, dest, out, ret, currency, max_stops), currency)


def picked(segments):
    """Protobuf for 'these flights are chosen' on one leg: FlightData field 4, which Google's own URLs
    carry after a click but fast-flights doesn't model. Every length here fits in one byte."""
    f = lambda n, s: bytes([n << 3 | 2, len(s)]) + s
    return b"".join(f(4, b"".join(f(n, v.encode()) for n, v in zip((1, 2, 3, 5, 6), (
        g["from"], g["depart"][:10], g["to"], g["flight"][:2], g["flight"][2:])))) for g in segments)


def add_return(r, orig, dest, out, ret, currency, max_stops=None):
    """Google details the return only once an outbound is chosen, so choose this row's outbound and take
    the cheapest return, then the shortest. Its price is the whole trip's. A failed lookup leaves the
    return blank, never guessed."""
    q = google_query(orig, dest, out, ret, currency, max_stops)
    q.flight_data[0].MergeFromString(picked(r["segments"]))
    try:
        backs = fetch_google(q, currency)
    except Exception:
        return
    if backs:
        b = min(backs, key=lambda x: (x["price"], x["duration"] or 0))
        q.flight_data[1].MergeFromString(picked(b["segments"]))   # both legs chosen: the link opens this trip
        r.update(link=q.url(), price=b["price"], return_depart=b["depart"], return_arrive=b["arrive"], return_route=b["route"],
                 return_flights=b["flights"], return_stops=b["stops"], return_duration=b["duration"],
                 return_segments=b["segments"])


def parse_google(html, currency):
    from selectolax.lexbor import LexborHTMLParser
    js = LexborHTMLParser(html).css_first(r"script.ds\:1").text()
    return norm_google(json.loads(js.split("data:", 1)[1].rsplit(",", 1)[0]), currency)


def norm_google(payload, currency):
    """Own parser: fast_flights.parse ignores Google's 'best' list (payload[2]) and
    crashes on rows Google shows without a price. Unpriced rows are dropped, never guessed."""
    hm = lambda t: "%02d:%02d" % ((t or [0])[0] or 0, ((t or []) + [0, 0])[1] or 0)
    ymd = lambda d: "%04d-%02d-%02d" % tuple(d)
    rows = []
    for block in (payload[2], payload[3]):
        for k in ((block or [None])[0] or []):
            if not (k[1] and k[1][0] and k[1][0][1]):
                continue
            f = k[0]
            rows.append({
                "source": "google",
                "price": float(k[1][0][1]),
                "currency": currency,
                "carriers": f[1],
                "route": "-".join([f[2][0][3]] + [s[6] for s in f[2]]),
                "flights": " ".join(s[22][0] + s[22][1] for s in f[2]),
                "stops": len(f[2]) - 1,
                "depart": f"{ymd(f[4])}T{hm(f[5])}",
                "arrive": f"{ymd(f[7])}T{hm(f[8])}",
                "duration": f[9],
                # Google prices the round trip but only details the outbound until you pick one (add_return).
                "return_depart": None,
                "return_arrive": None,
                # One entry per flight, in local times; flight codes start with the 2-letter IATA airline code.
                "segments": [{"from": s[3], "to": s[6], "depart": f"{ymd(s[20])}T{hm(s[8])}",
                              "arrive": f"{ymd(s[21])}T{hm(s[10])}", "flight": s[22][0] + s[22][1],
                              "airline": s[22][3], "duration": s[11]} for s in f[2]],
            })
    return rows


# --- filtering, currency, output ---

def arrives_within(row, window):
    """window = ('2026-12-30', '2026-12-31'), inclusive, in local arrival time."""
    return window[0] <= row["arrive"][:10] <= window[1]


def arrival_window(spec):
    """'2026-12-30,2026-12-31' -> ('2026-12-30', '2026-12-31'). Either side may be blank for no bound,
    so ',2026-12-31' means "land by Dec 31". Raises ValueError on a malformed date."""
    lo, _, hi = spec.partition(",")
    for d in (lo, hi):
        if d:
            date.fromisoformat(d)
    return (lo or "0001-01-01", hi or "9999-12-31")


def convert(rows, currency):
    """Add price_cmp in one currency so sources can be compared.
    Uses the ECB spot rate from frankfurter.dev, not a card's rate."""
    rates = {currency: 1.0}
    for r in rows:
        c = r["currency"]
        if c not in rates:
            url = f"https://api.frankfurter.dev/v1/latest?base={c}&symbols={currency}"
            with urllib.request.urlopen(url, timeout=30) as resp:
                rates[c] = json.load(resp)["rates"][currency]
        r["price_cmp"] = round(r["price"] * rates[c], 2)


def dedupe(rows):
    """Same source + same outbound flights on the same dates: keep the cheapest."""
    best = {}
    for r in sorted(rows, key=lambda r: r["price_cmp"]):
        best.setdefault((r["source"], r["search_out"], r["search_ret"], r["flights"], r["return_depart"]), r)
    return list(best.values())


def fmt_min(m):
    return f"{m // 60}h{m % 60:02d}" if m else "?"


def print_table(rows, currency, top):
    """Rows are sorted by price. The same outbound at the same price for several return dates becomes one line."""
    groups = {}
    for r in rows:
        groups.setdefault((r["source"], r["search_out"], r["flights"], r["price_cmp"], r.get("return_flights")),
                          [r, []])[1].append(r["search_ret"][5:])
    print(f"\n{'price ' + currency:>11}  {'src':6} {'depart':16} {'arrive':16} {'dur':>6} st  route / flights / carriers  [return dates]")
    for r, rets in list(groups.values())[:top]:
        print(f"{r['price_cmp']:>11,.0f}  {r['source']:6} {r['depart']:16} {r['arrive']:16} "
              f"{fmt_min(r['duration']):>6} {r['stops']:>2}  {r['route']}  {r['flights']}  "
              f"{', '.join(r['carriers'])}  [{rets[0]}{''.join(',' + x[3:] for x in rets[1:])}"
              + (f" {r['return_depart'][11:]} {r['return_flights']}" if r.get("return_flights") else "") + "]"
              + (f"  ⚠ {' '.join(r['warnings'])}" if r.get("warnings") else ""))


def print_compare(rows, pairs, currency):
    print(f"\nCheapest per date pair ({currency}):\n{'out→ret':14} {'matrix':>8} {'google':>8} {'diff':>7}")
    diffs = []
    for out, ret in pairs:
        m = {s: min((r["price_cmp"] for r in rows if r["source"] == s
                     and (r["search_out"], r["search_ret"]) == (out, ret)), default=None)
             for s in ("matrix", "google")}
        diff = m["matrix"] - m["google"] if None not in m.values() else None
        if diff is not None:
            diffs.append(diff)
        show = lambda v: f"{v:>8,.0f}" if v is not None else f"{'—':>8}"
        print(f"{out[5:]}→{ret[5:]:8} {show(m['matrix'])} {show(m['google'])} "
              f"{(f'{diff:>+7,.0f}' if diff is not None else f'{chr(8212):>7}')}")
    if diffs:
        print(f"\nMatrix cheaper in {sum(d < 0 for d in diffs)}/{len(diffs)} pairs, "
              f"Google in {sum(d > 0 for d in diffs)}/{len(diffs)}; mean diff {sum(diffs) / len(diffs):+,.0f} {currency} "
              f"(negative = Matrix cheaper)")


def run_search(orig, dest, pairs, sources, currency, arrive_between=None, progress=lambda *a: None,
               max_stops=None):
    """Search each (out, ret) date pair on each source. Returns deduped rows sorted by price, then duration.
    Google's pairs go AT_ONCE at a time, then the DETAIL cheapest Google fares get their return flights.
    Each row links to its trip on Google Flights, or else the search for its dates. max_stops caps stops on each leg.
    progress(src, out, ret, result) runs before each search (result=None) and after it (result = the
    offers found, or the exception that sank that one search). An exception raised by progress aborts the run."""
    global _pw, _browser
    rows = []

    def found(src, out, ret, result):
        if isinstance(result, Exception):  # one failed search shouldn't sink the run
            return progress(src, out, ret, result)
        link = google_query(orig, dest, out, ret, currency, max_stops).url()
        for r in result:
            r.update(search_out=out, search_ret=ret, link=link)
        progress(src, out, ret, result)
        rows.extend(result)

    def attempt(search, *args):
        try:
            return search(*args)
        except Exception as e:
            return e

    try:
        if "google" in sources:
            with ThreadPoolExecutor(AT_ONCE) as pool:
                for i in range(0, len(pairs), AT_ONCE):
                    if i:
                        time.sleep(1)  # be polite to Google
                    batch = pairs[i:i + AT_ONCE]
                    for out, ret in batch:
                        progress("google", out, ret, None)
                    results = pool.map(lambda p: attempt(google, orig, dest, *p, currency, max_stops), batch)
                    for (out, ret), result in zip(batch, list(results)):
                        found("google", out, ret, result)
        if "matrix" in sources:
            for out, ret in pairs:
                progress("matrix", out, ret, None)
                found("matrix", out, ret, attempt(matrix, orig, dest, out, ret, max_stops))
    finally:
        if _browser:
            _browser.close()
            _pw.stop()
            _pw = _browser = None
    if arrive_between:
        rows = [r for r in rows if arrives_within(r, arrive_between)]
    cheapest = sorted((r for r in rows if r["source"] == "google"), key=lambda r: (r["price"], r["duration"] or 10**6))
    with ThreadPoolExecutor(AT_ONCE) as pool:
        list(pool.map(lambda r: add_return(r, orig, dest, r["search_out"], r["search_ret"], currency, max_stops), cheapest[:DETAIL]))
    convert(rows, currency)
    rows = dedupe(rows)
    rows.sort(key=lambda r: (r["price_cmp"], r["duration"] or 10**6))
    return rows


def save(args, rows):
    """Every run, from the CLI or the site, lands in results/ as {args, rows}."""
    folder = Path(__file__).parent / "results"   # the same folder whichever directory the run started in
    folder.mkdir(exist_ok=True)
    path = folder / f"{datetime.now():%Y%m%d-%H%M%S}-{args['orig']}-{args['dest']}.json"
    path.write_text(json.dumps({"args": args, "rows": rows}, indent=1))
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="orig", required=True, help="origin IATA, e.g. YYZ")
    ap.add_argument("--to", dest="dest", required=True, help="destination IATA, e.g. VNO")
    ap.add_argument("--out", required=True, help="outbound date or range A..B")
    ap.add_argument("--ret", required=True, help="return date or range A..B")
    ap.add_argument("--arrive-between", help="keep outbound arrivals within local dates A,B (inclusive; "
                                             "either may be blank, e.g. ,2026-12-31 to land by Dec 31)")
    ap.add_argument("--source", choices=["matrix", "google", "both"], default="both")
    ap.add_argument("--currency", default="CAD")
    ap.add_argument("--max-stops", type=int, choices=[0, 1, 2], help="most stops on each leg (default: any)")
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()

    sources = ["matrix", "google"] if a.source == "both" else [a.source]
    pairs = list(itertools.product(date_range(a.out), date_range(a.ret)))

    def progress(src, out, ret, result):
        if result is None:
            print(f"{src:6} {a.orig}→{a.dest} {out} / {ret} ...", end=" ", file=sys.stderr, flush=True)
        elif isinstance(result, Exception):
            print(f"FAILED: {result}", file=sys.stderr)
        else:
            print(f"{len(result)} offers", file=sys.stderr)

    window = arrival_window(a.arrive_between) if a.arrive_between else None
    rows = run_search(a.orig, a.dest, pairs, sources, a.currency, window, progress, a.max_stops)

    path = save(vars(a), rows)

    print_table(rows, a.currency, a.top)
    if len(sources) == 2:
        print_compare(rows, pairs, a.currency)
    print(f"\n{len(rows)} itineraries saved to {path}")


if __name__ == "__main__":
    main()
