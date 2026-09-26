#!/usr/bin/env python3
"""Unbiased round-trip flight search: real fares from Duffel and Google Flights,
sorted by price then duration. No ranking weights, no affiliate links.

    python search.py --from YYZ --to VNO --out 2026-12-28..2026-12-30 \
        --ret 2027-01-10..2027-01-15 --arrive-between 2026-12-30,2026-12-31 --source both
"""
import argparse
import itertools
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

DUFFEL_URL = "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000"


def date_range(spec):
    """'2026-12-28..2026-12-30' -> ['2026-12-28', '2026-12-29', '2026-12-30']; a single date also works."""
    start, _, end = spec.partition("..")
    d, end = date.fromisoformat(start), date.fromisoformat(end or start)
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def iso_minutes(dur):
    """'P1DT2H30M' / 'PT12H5M' -> minutes."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?", dur or "")
    if not m:
        return None
    d, h, mi = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mi


# --- Duffel: bookable offers straight from airlines (NDC/GDS) ---

def duffel(orig, dest, out, ret):
    token = os.environ.get("DUFFEL_TOKEN")
    if not token:
        sys.exit("DUFFEL_TOKEN not set (see CLAUDE.md)")
    body = {"data": {
        "slices": [
            {"origin": orig, "destination": dest, "departure_date": out},
            {"origin": dest, "destination": orig, "departure_date": ret},
        ],
        "passengers": [{"type": "adult"}],
        "cabin_class": "economy",
        "max_connections": 2,
    }}
    req = urllib.request.Request(DUFFEL_URL, json.dumps(body).encode(), {
        "Authorization": f"Bearer {token}",
        "Duffel-Version": "v2",
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        offers = json.load(r)["data"]["offers"]
    return [norm_duffel(o) for o in offers]


def norm_duffel(o):
    out, back = o["slices"]
    segs = [s for sl in o["slices"] for s in sl["segments"]]
    return {
        "source": "duffel",
        "price": float(o["total_amount"]),
        "currency": o["total_currency"],
        "carriers": sorted({s["marketing_carrier"]["name"] for s in segs}),
        "route": "-".join([out["segments"][0]["origin"]["iata_code"]]
                          + [s["destination"]["iata_code"] for s in out["segments"]]),
        "flights": " ".join(s["marketing_carrier"]["iata_code"] + s["marketing_carrier_flight_number"]
                            for s in out["segments"]),
        "stops": len(out["segments"]) - 1,
        "depart": out["segments"][0]["departing_at"][:16],
        "arrive": out["segments"][-1]["arriving_at"][:16],
        "duration": iso_minutes(out.get("duration")),
        "return_depart": back["segments"][0]["departing_at"][:16],
        "return_arrive": back["segments"][-1]["arriving_at"][:16],
    }


# --- Google Flights via fast-flights (baseline to compare against) ---

def google(orig, dest, out, ret, currency):
    from fast_flights import FlightQuery, create_query, fetch_flights_html
    q = create_query(
        flights=[FlightQuery(date=out, from_airport=orig, to_airport=dest),
                 FlightQuery(date=ret, from_airport=dest, to_airport=orig)],
        trip="round-trip", currency=currency, language="en")
    return parse_google(fetch_flights_html(q), currency)


def parse_google(html, currency):
    from selectolax.lexbor import LexborHTMLParser
    js = LexborHTMLParser(html).css_first(r"script.ds\:1").text()
    return norm_google(json.loads(js.split("data:", 1)[1].rsplit(",", 1)[0]), currency)


def norm_google(payload, currency):
    """Own parser: fast_flights.parse ignores Google's 'best' list (payload[2]) and
    crashes on rows Google shows without a price. Unpriced rows are dropped, never guessed.
    ponytail: positional indexes into Google's private JSON; breaks when Google reshapes it."""
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
                # Google prices the round trip but only details the outbound until you pick one.
                "return_depart": None,
                "return_arrive": None,
            })
    return rows


# --- filtering, currency, output ---

def arrives_within(row, window):
    """window = ('2026-12-30', '2026-12-31'), inclusive, in local arrival time."""
    return window[0] <= row["arrive"][:10] <= window[1]


def convert(rows, currency):
    """Add price_cmp in one currency so sources can be compared.
    ponytail: ECB spot rate via frankfurter.dev, not your card's rate."""
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
        groups.setdefault((r["source"], r["search_out"], r["flights"], r["price_cmp"]), [r, []])[1].append(r["search_ret"][5:])
    print(f"\n{'price ' + currency:>11}  {'src':6} {'depart':16} {'arrive':16} {'dur':>6} st  route / flights / carriers  [return dates]")
    for r, rets in list(groups.values())[:top]:
        print(f"{r['price_cmp']:>11,.0f}  {r['source']:6} {r['depart']:16} {r['arrive']:16} "
              f"{fmt_min(r['duration']):>6} {r['stops']:>2}  {r['route']}  {r['flights']}  "
              f"{', '.join(r['carriers'])}  [{rets[0]}{''.join(',' + x[3:] for x in rets[1:])}]")


def print_compare(rows, pairs, currency):
    print(f"\nCheapest per date pair ({currency}):\n{'out→ret':14} {'duffel':>8} {'google':>8} {'diff':>7}")
    diffs = []
    for out, ret in pairs:
        m = {s: min((r["price_cmp"] for r in rows if r["source"] == s
                     and (r["search_out"], r["search_ret"]) == (out, ret)), default=None)
             for s in ("duffel", "google")}
        diff = m["duffel"] - m["google"] if None not in m.values() else None
        if diff is not None:
            diffs.append(diff)
        show = lambda v: f"{v:>8,.0f}" if v is not None else f"{'—':>8}"
        print(f"{out[5:]}→{ret[5:]:8} {show(m['duffel'])} {show(m['google'])} "
              f"{(f'{diff:>+7,.0f}' if diff is not None else f'{chr(8212):>7}')}")
    if diffs:
        print(f"\nDuffel cheaper in {sum(d < 0 for d in diffs)}/{len(diffs)} pairs, "
              f"Google in {sum(d > 0 for d in diffs)}/{len(diffs)}; mean diff {sum(diffs) / len(diffs):+,.0f} {currency} "
              f"(negative = Duffel cheaper)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="orig", required=True, help="origin IATA, e.g. YYZ")
    ap.add_argument("--to", dest="dest", required=True, help="destination IATA, e.g. VNO")
    ap.add_argument("--out", required=True, help="outbound date or range A..B")
    ap.add_argument("--ret", required=True, help="return date or range A..B")
    ap.add_argument("--arrive-between", help="keep outbound arrivals within local dates A,B (inclusive)")
    ap.add_argument("--source", choices=["duffel", "google", "both"], default="both")
    ap.add_argument("--currency", default="CAD")
    ap.add_argument("--top", type=int, default=15)
    a = ap.parse_args()

    sources = ["duffel", "google"] if a.source == "both" else [a.source]
    pairs = list(itertools.product(date_range(a.out), date_range(a.ret)))
    rows = []
    for (out, ret), src in itertools.product(pairs, sources):
        print(f"{src:6} {a.orig}→{a.dest} {out} / {ret} ...", end=" ", file=sys.stderr, flush=True)
        try:
            found = duffel(a.orig, a.dest, out, ret) if src == "duffel" else google(a.orig, a.dest, out, ret, a.currency)
        except Exception as e:  # one failed search shouldn't sink the run
            detail = e.read().decode()[:300] if isinstance(e, urllib.error.HTTPError) else ""
            print(f"FAILED: {e} {detail}", file=sys.stderr)
            continue
        for r in found:
            r.update(search_out=out, search_ret=ret)
        print(f"{len(found)} offers", file=sys.stderr)
        rows += found
        if src == "google":
            time.sleep(1)  # be polite to Google

    convert(rows, a.currency)
    rows = dedupe(rows)
    if a.arrive_between:
        window = tuple(a.arrive_between.split(","))
        rows = [r for r in rows if arrives_within(r, window)]
    rows.sort(key=lambda r: (r["price_cmp"], r["duration"] or 10**6))

    Path("results").mkdir(exist_ok=True)
    path = Path("results") / f"{datetime.now():%Y%m%d-%H%M%S}-{a.orig}-{a.dest}.json"
    path.write_text(json.dumps({"args": vars(a), "rows": rows}, indent=1))

    print_table(rows, a.currency, a.top)
    if len(sources) == 2:
        print_compare(rows, pairs, a.currency)
    print(f"\n{len(rows)} itineraries saved to {path}")


if __name__ == "__main__":
    main()
