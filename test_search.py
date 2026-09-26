"""Run: python test_search.py. Google payload rows in test_fixtures.json are real (YYZ-VNO, 2026-12-29/2027-01-12)."""
import json

from search import arrives_within, date_range, iso_minutes, norm_duffel, norm_google

fx = json.load(open("test_fixtures.json"))

g = fx["google_payload_stub"]
rows = norm_google([None, None, g["2"], g["3"]], "CAD")
assert len(rows) == 2, "unpriced SAS row must be dropped, 'best' list must be read"
klm, ac = rows
assert (klm["price"], klm["route"], klm["flights"]) == (1409.0, "YYZ-AMS-VNO", "KL692 BT962")
assert (klm["depart"], klm["arrive"], klm["duration"]) == ("2026-12-29T17:55", "2026-12-30T13:20", 745)
assert ac["arrive"] == "2026-12-31T13:20" and ac["return_depart"] is None

d = norm_duffel(fx["duffel_offer"])
assert (d["price"], d["currency"], d["route"], d["stops"]) == (812.4, "EUR", "YYZ-WAW-VNO", 1)
assert (d["flights"], d["duration"]) == ("LO46 LO777", 1670)
assert (d["arrive"], d["return_depart"]) == ("2026-12-31T09:25", "2027-01-12T06:10")

window = ("2026-12-30", "2026-12-31")
assert arrives_within(klm, window) and arrives_within(ac, window)
assert not arrives_within({"arrive": "2027-01-01T00:30"}, window)  # 00:30 on Jan 1 is too late

assert date_range("2026-12-30..2027-01-01") == ["2026-12-30", "2026-12-31", "2027-01-01"]
assert iso_minutes("P1DT3H50M") == 1670 and iso_minutes("PT11H") == 660
print("ok")
