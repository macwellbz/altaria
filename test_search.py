"""Run: python test_search.py. Fixtures are real Google and ITA Matrix responses (YYZ-VNO, 2026-12-29/2027-01-12)."""
import json

from search import arrival_window, arrives_within, date_range, norm_google, norm_matrix

fx = json.load(open("test_fixtures.json"))

g = fx["google_payload_stub"]
rows = norm_google([None, None, g["2"], g["3"]], "CAD")
assert len(rows) == 2, "unpriced SAS row must be dropped, 'best' list must be read"
klm, ac = rows
assert (klm["price"], klm["route"], klm["flights"]) == (1409.0, "YYZ-AMS-VNO", "KL692 BT962")
assert (klm["depart"], klm["arrive"], klm["duration"]) == ("2026-12-29T17:55", "2026-12-30T13:20", 745)
assert ac["arrive"] == "2026-12-31T13:20" and ac["return_depart"] is None

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
print("ok")
