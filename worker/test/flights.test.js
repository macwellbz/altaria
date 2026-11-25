// web/src/flights.js, the JavaScript port of search.py's Google side, checked against fast-flights and search.py.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { arrivalWindow, arrivesWithin, cheapestReturn, dateRange, dedupe, googleQuery, normGoogle, parseGoogle, rank } from "../../web/src/flights.js";
import { ROOT, noPython, py } from "./python.js";

const fx = JSON.parse(readFileSync(`${ROOT}tests/test_fixtures.json`, "utf8")).google_payload_stub;
const payload = [null, null, fx["2"], fx["3"]];
const run = JSON.parse(readFileSync(`${ROOT}tests/test_site_run.json`, "utf8"));   // the first rows of a real saved search
// Google's page as it carries its results, around the fixture's payload
const page = `<html><script nonce="x">var a = 1;</script><script class="ds:1" nonce="n">AF_initDataCallback({key: 'ds:1', hash: '9', data:${JSON.stringify(payload)}, sideChannel: {}});</script></html>`;

test("tfs matches fast-flights byte for byte", () => {
  // printed by search.google_query(...).to_str() with fast-flights 3
  const cases = [
    [["YYZ", "VNO", "2027-01-12", "2027-01-20", "CAD"], "GhoSCjIwMjctMDEtMTJqBRIDWVlacgUSA1ZOTxoaEgoyMDI3LTAxLTIwagUSA1ZOT3IFEgNZWVpCAQFIAZgBAQ=="],
    [["YYZ", "LHR", "2026-12-20", "2027-01-03", "USD", 0], "GhwSCjIwMjYtMTItMjAoAGoFEgNZWVpyBRIDTEhSGhwSCjIwMjctMDEtMDMoAGoFEgNMSFJyBRIDWVlaQgEBSAGYAQE="],
    [["JFK", "NRT", "2027-02-01", "2027-02-10", "EUR", 1], "GhwSCjIwMjctMDItMDEoAWoFEgNKRktyBRIDTlJUGhwSCjIwMjctMDItMTAoAWoFEgNOUlRyBRIDSkZLQgEBSAGYAQE="],
  ];
  for (const [args, tfs] of cases) assert.equal(googleQuery(...args).tfs, tfs);
});

test("a trip's link, both legs picked, is the one search.py saved", () => {
  for (const r of run.rows.filter((r) => r.return_segments)) {
    const { orig, dest, currency, max_stops } = run.args;
    assert.equal(googleQuery(orig, dest, r.search_out, r.search_ret, currency, max_stops, r.segments, r.return_segments).url, r.link);
  }
});

test("tfs and links match search.py's google_query and picked", { skip: noPython }, () => {
  const segs = run.rows[0].segments, back = run.rows[0].return_segments, long = [...segs, ...back, ...segs];   // long: over 127 bytes a leg
  const cases = [
    ["YYZ", "VNO", "2026-12-28", "2027-01-11", "CAD", null, [], []],
    ["YYZ", "VNO", "2026-12-28", "2027-01-11", "CAD", 0, segs, []],
    ["BUF", "RIX", "2027-03-01", "2027-03-30", "USD", 2, segs, back],
    ["YYZ", "VNO", "2026-12-26", "2027-01-10", "CAD", 1, long, back],
    ["YYZ,BUF", "EDI,GLA", "2027-06-08", "2027-06-22", "CAD", null, [], []],
    ["YYZ", "EDI,GLA,ABZ,INV", "2027-06-08", "2027-06-22", "GBP", 1, segs, back],
  ];
  const want = py(`
import search
out = []
for args in arg:
    q = search.google_query(*args)
    out.append([q.to_str(), q.url()])
print(json.dumps(out))`, cases);
  assert.deepEqual(cases.map((c) => { const q = googleQuery(...c); return [q.tfs, q.url]; }), want);
});

test("normGoogle and parseGoogle match search.py's on the saved payload, and on empty blocks", { skip: noPython }, () => {
  const empty = [null, null, [], null];
  const want = py(`
import search
print(json.dumps([search.norm_google(arg[0], "CAD"), search.parse_google(arg[1], "EUR"), search.norm_google(arg[2], "CAD")]))`, [payload, page, empty]);
  assert.deepEqual([normGoogle(payload, "CAD"), parseGoogle(page, "EUR"), normGoogle(empty, "CAD")], want);
});

test("parseGoogle fails on a page without results", () => {
  assert.throws(() => parseGoogle("<html>Before you continue to Google</html>", "CAD"), /no results/);
});

test("cheapestReturn takes the cheapest, then the shortest, and links the whole trip", () => {
  const backs = normGoogle(payload, "CAD").map((r, i) => ({ ...r, price: 900, duration: 800 - i }));
  const out = run.rows[0].segments;
  const b = cheapestReturn(backs, "YYZ", "VNO", "2026-12-29", "2027-01-12", "CAD", null, out);
  assert.equal(b.return_flights, backs[1].flights, "a tie on price goes to the shorter");
  assert.equal(b.price, 900);
  assert.equal(b.link, googleQuery("YYZ", "VNO", "2026-12-29", "2027-01-12", "CAD", null, out, backs[1].segments).url);
  assert.equal(cheapestReturn([], "YYZ", "VNO", "2026-12-29", "2027-01-12", "CAD", null, out), null);
});

test("dates and the arrival window match search.py's", { skip: noPython }, () => {
  const spans = ["2026-12-30..2027-01-01", "2026-12-30"], windows = [",2026-12-31", "2026-12-30,", "2026-12-30,2026-12-31"];
  const lands = ["2026-12-20T09:00", "2026-12-31T13:20", "2027-01-01T00:30"];   // 00:30 on Jan 1 is too late for Dec 31
  const want = py(`
import search
spans, windows, lands = arg
ws = [search.arrival_window(w) for w in windows]
print(json.dumps([[search.date_range(s) for s in spans], ws, [[search.arrives_within({"arrive": a}, w) for a in lands] for w in ws]]))`, [spans, windows, lands]);
  const ws = windows.map(arrivalWindow);
  assert.deepEqual([spans.map(dateRange), ws, ws.map((w) => lands.map((a) => arrivesWithin({ arrive: a }, w)))], want);
  assert.throws(() => arrivalWindow("2026-02-30,"));
});

test("rank dedupes, filters and sorts as run_search does", { skip: noPython }, async () => {
  // the run's rows shuffled, each twice, the copy dearer, plus ties on price
  const rows = [...run.rows].reverse().flatMap((r, i) => [{ ...r, price_cmp: undefined }, { ...r, price: r.price + 50 + i, price_cmp: undefined }]);
  rows.push({ ...run.rows[1], flights: "XX1 XX2", duration: 10, price_cmp: undefined }, { ...run.rows[1], flights: "XX3", duration: null, price_cmp: undefined });
  const window = ["2026-12-27", "2026-12-28"];
  const want = py(`
import search
rows = arg[0]
search.convert(rows, "CAD")
rows = [r for r in search.dedupe(rows) if search.arrives_within(r, arg[1])]
rows.sort(key=lambda r: (r["price_cmp"], r["duration"] or 10**6))
print(json.dumps(rows))`, [rows, window]);
  assert.deepEqual(await rank(structuredClone(rows), "CAD", window), want);
  assert.equal(dedupe(structuredClone(rows)).length, run.rows.length + 2);
});
