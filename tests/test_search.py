"""Run: python tests/test_search.py. Fixtures are real Google and ITA Matrix responses (YYZ-VNO, 2026-12-29/2027-01-12)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # the repo root, for search, ai and server
import fast_flights
import search
from search import arrival_window, arrives_within, date_range, norm_google, norm_matrix

fx = json.load(open(Path(__file__).parent / "test_fixtures.json"))

g = fx["google_payload_stub"]
rows = norm_google([None, None, g["2"], g["3"]], "CAD")
assert len(rows) == 2, "unpriced SAS row must be dropped, 'best' list must be read"
klm, ac = rows
assert (klm["price"], klm["route"], klm["flights"]) == (1409.0, "YYZ-AMS-VNO", "KL692 BT962")
assert (klm["depart"], klm["arrive"], klm["duration"]) == ("2026-12-29T17:55", "2026-12-30T13:20", 745)
assert ac["arrive"] == "2026-12-31T13:20" and ac["return_depart"] is None
assert [(g["from"], g["to"], g["flight"], g["airline"]) for g in klm["segments"]] == [
    ("YYZ", "AMS", "KL692", "KLM"), ("AMS", "VNO", "BT962", "Air Baltic")]

sas, ac_m = norm_matrix(fx["matrix_response"])
assert (sas["price"], sas["currency"], sas["route"], sas["stops"]) == (1054.42, "CAD", "YYZ-CPH-VNO", 1)
assert (sas["flights"], sas["duration"]) == ("SK950 SK744", 635)
assert (sas["arrive"], sas["return_depart"]) == ("2026-12-30T10:45", "2027-01-12T11:20")
assert "RISKY_CONNECTION" in sas["warnings"] and ac_m["route"] == "YYZ-FRA-VNO"

window = ("2026-12-30", "2026-12-31")
assert arrives_within(klm, window) and arrives_within(ac, window)
assert not arrives_within({"arrive": "2027-01-01T00:30"}, window)  # 00:30 on Jan 1 is too late
land_by = arrival_window(",2026-12-31")  # blank start: "land by Dec 31"
assert arrives_within({"arrive": "2026-12-20T09:00"}, land_by) and not arrives_within({"arrive": "2027-01-01T00:30"}, land_by)
assert arrival_window("2026-12-30,") == ("2026-12-30", "9999-12-31")

assert date_range("2026-12-30..2027-01-01") == ["2026-12-30", "2026-12-31", "2027-01-01"]

# run_search against a stand-in Google that answers every page with the saved payload: each date pair lists the
# KLM and Air Canada outbounds above, and each return lookup finds a return.
PAGE = f"""<script class="ds:1">AF_initDataCallback({{key: 'ds:1', hash: '9', data:{json.dumps([None, None, g["2"], g["3"]])}, sideChannel: {{}}}});</script>"""


def search_with_stub(pairs, window=None):
    plain = {search.google_query("YYZ", "VNO", o, r, "CAD").to_str() for o, r in pairs}
    asked = {"pairs": 0, "returns": 0}

    def fetch(q):
        asked["pairs" if q.to_str() in plain else "returns"] += 1
        return PAGE
    fast_flights.fetch_flights_html = fetch
    return search.run_search("YYZ", "VNO", pairs, ["google"], "CAD", window), asked


pairs = [(f"2027-01-{d:02d}", "2027-02-01") for d in range(1, 16)]
found, asked = search_with_stub(pairs)
assert len(found) == 2 * len(pairs) and asked["pairs"] == len(pairs), "every date pair is searched once"
full = [r for r in found if r.get("return_flights")]
bare = [r for r in found if not r.get("return_flights")]
assert full and bare and asked["returns"] == len(full), "only some fares get their returns, one lookup each"
assert max(r["price_cmp"] for r in full) <= min(r["price_cmp"] for r in bare), "the returns are the cheapest fares'"
assert all(r["link"] == search.google_query("YYZ", "VNO", r["search_out"], r["search_ret"], "CAD").url() for r in bare)

found, asked = search_with_stub(pairs[:3], window=("2026-12-30", "2026-12-30"))   # only KLM lands on Dec 30
assert [r["flights"] for r in found] == ["KL692 BT962"] * 3 and asked["returns"] == 3, "a fare outside the window is never looked up"

tries = {}   # a page that comes back without results is asked once more, for a date pair and a return alike


def flaky(q):
    tries[q.to_str()] = tries.get(q.to_str(), 0) + 1
    return PAGE if tries[q.to_str()] > 1 else "<html>Before you continue to Google</html>"


fast_flights.fetch_flights_html = flaky
found = search.run_search("YYZ", "VNO", pairs[:2], ["google"], "CAD")
assert len(found) == 4 and all(r.get("return_flights") for r in found) and set(tries.values()) == {2}
print("ok")
