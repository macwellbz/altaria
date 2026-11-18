import { json, run, withFetch } from "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drive } from "../src/drive.js";

// The public site's search, against a stand-in Worker. Outbound rows are the saved run's, as Google first lists
// them: no return yet, no price_cmp.
const outbound = run.rows.slice(0, 3).map(({ source, price, currency, carriers, route, flights, stops, depart, arrive, duration, segments, search_out, search_ret }) =>
  ({ source, price, currency, carriers, route, flights, stops, depart, arrive, duration, return_depart: null, return_arrive: null, segments, search_out, search_ret, link: "pair" }));
const q = new URLSearchParams({ from: "YYZ", to: "VNO", currency: "CAD", out: "2026-12-26", ret: "2027-01-10", stops: "1", sources: "google" });
const plan = (pairs) => ({ pairs, sources: ["google"], currency: "CAD", drive: true });

// Runs drive against answer(path, params) and collects what it reports.
async function search(meta, answer, signal = new AbortController().signal) {
  const heard = [];
  const on = Object.fromEntries(["progress", "result", "fail"].map((e) => [e, (d) => heard.push([e, d])]));
  const asked = [];
  await withFetch((url) => {
    const u = new URL(url, "http://x");
    asked.push(Object.fromEntries(u.searchParams));
    return answer(u.pathname, u.searchParams);
  }, () => drive(q, meta, on, signal));
  return { heard, asked };
}

test("each pair asks for its outbounds, then each outbound's return, and the rows come back ranked", async () => {
  const back = run.rows.find((r) => r.return_segments);
  const { heard, asked } = await search(plan([["2026-12-26", "2027-01-10"]]), (path, p) => {
    if (!p.get("pick")) return json(200, { rows: structuredClone(outbound) });
    const flights = JSON.parse(p.get("pick")).map((g) => g.flight).join(" ");
    if (flights === outbound[0].flights) return json(200, { ret: { price: 999, return_flights: back.return_flights, return_depart: back.return_depart, link: "trip" } });
    return flights === outbound[1].flights ? json(502, { error: "Google Flights answered 302" }) : json(200, { ret: null });
  });
  assert.deepEqual(asked[0], { from: "YYZ", to: "VNO", currency: "CAD", stops: "1", out: "2026-12-26", ret: "2027-01-10" });
  assert.equal(asked.length, 1 + outbound.length);
  assert.deepEqual(Object.keys(JSON.parse(asked[1].pick)[0]), ["from", "to", "depart", "flight"], "a pick sends only what the server checks");
  assert.deepEqual(heard.slice(0, 2), [["progress", { src: "google", out: "2026-12-26", ret: "2027-01-10", status: "searching" }],
    ["progress", { src: "google", out: "2026-12-26", ret: "2027-01-10", status: "done", count: 3 }]]);
  const [kind, { rows }] = heard[2];
  assert.equal(kind, "result");
  assert.deepEqual(rows.map((r) => r.price_cmp), [999, ...outbound.slice(1).map((r) => r.price).sort((a, b) => a - b)]);
  assert.equal(rows[0].link, "trip");
  assert.ok(rows.slice(1).every((r) => r.return_depart === null && r.link === "pair"), "a failed or empty return lookup leaves the return blank");
});

test("once today's searches are used up, the rest aren't asked and the search says so, never showing saved fares", async () => {
  const pairs = [["2026-12-26", "2027-01-10"], ["2026-12-27", "2027-01-10"]];
  const { heard, asked } = await search(plan(pairs), () => json(429, { error: "Used up.", cap: true }));
  assert.equal(asked.length, 1);
  assert.deepEqual(heard.map(([e, d]) => [e, d.status, d.error]).slice(0, 3), [["progress", "searching", undefined], ["progress", "failed", "Used up."], ["progress", "failed", "Used up."]]);
  assert.deepEqual(heard.at(-1), ["fail", { message: "Used up." }]);
});

test("a failed Google comes back empty, as server.py's does", async () => {
  const { heard } = await search(plan([["2026-12-26", "2027-01-10"]]), () => json(502, { error: "No." }));
  assert.deepEqual(heard.at(-1), ["result", { rows: [] }]);
});

test("a stopped search reports nothing more", async () => {
  const stop = new AbortController();
  const { heard } = await search(plan([["2026-12-26", "2027-01-10"]]), (path, p) => {
    if (!p.get("pick")) return json(200, { rows: structuredClone(outbound) });
    stop.abort();
    throw new DOMException("stopped", "AbortError");
  }, stop.signal);
  assert.deepEqual(heard.map(([e, d]) => d.status), ["searching"]);
});
