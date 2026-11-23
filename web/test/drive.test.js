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

// Days from Dec 26, as dates, and each date pair's outbounds as the Worker would answer them, k dearer per pair.
const dec = (n) => new Date(Date.UTC(2026, 11, 26 + n)).toISOString().slice(0, 10);
const pairsOf = (n) => Array.from({ length: n }, (_, i) => [dec(i), "2027-01-10"]);
const listed = (out, ret, k = 0) => outbound.map((r) => ({ ...structuredClone(r), price: r.price + k, search_out: out, search_ret: ret }));

// Runs drive against answer(path, params) and collects what it reports in heard.
async function search(meta, answer, { signal = new AbortController().signal, heard = [], query = q } = {}) {
  const on = Object.fromEntries(["progress", "result", "fail"].map((e) => [e, (d) => heard.push([e, d])]));
  const asked = [];
  await withFetch((url) => {
    const u = new URL(url, "http://x");
    asked.push(Object.fromEntries(u.searchParams));
    return answer(u.pathname, u.searchParams);
  }, () => drive(query, meta, on, signal));
  return { heard, asked };
}

test("each pair asks for its outbounds, then each outbound's return, and the rows come back ranked", async () => {
  const back = run.rows.find((r) => r.return_segments);
  const { heard, asked } = await search(plan([["2026-12-26", "2027-01-10"]]), (path, p) => {
    if (!p.get("pick")) return json(200, { rows: structuredClone(outbound) });
    const flights = JSON.parse(p.get("pick")).map((g) => g.flight).join(" ");
    if (flights === outbound[0].flights) return json(200, { ret: { price: 999, return_flights: back.return_flights, return_depart: back.return_depart, link: "trip" } });
    return flights === outbound[1].flights ? json(502, { error: "The fare search answered 302" }) : json(200, { ret: null });
  });
  assert.deepEqual(asked[0], { from: "YYZ", to: "VNO", currency: "CAD", stops: "1", out: "2026-12-26", ret: "2027-01-10" });
  assert.equal(asked.length, 1 + outbound.length + 1, "the lookup that failed is asked once more");
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
  const pairs = pairsOf(8);
  const { heard, asked } = await search(plan(pairs), () => json(429, { error: "Used up.", cap: true }));
  assert.ok(asked.length < pairs.length, `asked ${asked.length} of ${pairs.length}`);
  const failed = heard.filter(([e, d]) => e === "progress" && d.status === "failed");
  assert.equal(failed.length, pairs.length);
  assert.ok(failed.every(([, d]) => d.error === "Used up."));
  assert.deepEqual(heard.at(-1), ["fail", { message: "Used up." }]);
});

test("every date pair is searched, but only the cheapest fares get their returns, and the rest keep their dates", async () => {
  const pairs = pairsOf(10);
  const { heard, asked } = await search(plan(pairs), (path, p) => {
    const k = pairs.findIndex(([o]) => o === p.get("out"));
    if (!p.get("pick")) return json(200, { rows: listed(p.get("out"), p.get("ret"), k) });
    const flights = JSON.parse(p.get("pick")).map((g) => g.flight).join(" ");
    const r = listed(p.get("out"), p.get("ret"), k).find((x) => x.flights === flights);
    return json(200, { ret: { price: r.price, return_flights: "BT961 AC809", return_depart: "2027-01-10T07:45", link: "trip" } });
  });
  const [kind, { rows }] = heard.at(-1);
  assert.equal(kind, "result");
  assert.equal(rows.length, pairs.length * outbound.length, "every pair's fares come back");
  assert.deepEqual(heard.filter(([, d]) => d.status === "done").map(([, d]) => d.out).sort(), pairs.map(([o]) => o));
  const full = rows.filter((r) => r.return_depart), bare = rows.filter((r) => !r.return_depart);
  assert.ok(full.length > 0 && bare.length > 0, "some fares get their returns and some don't");
  assert.equal(asked.filter((a) => a.pick).length, full.length, "one lookup per return found, and none for the rest");
  assert.ok(Math.max(...full.map((r) => r.price_cmp)) <= Math.min(...bare.map((r) => r.price_cmp)), "the returns are the cheapest fares'");
  assert.ok(bare.every((r) => r.link === "pair" && r.search_ret), "a fare without its return keeps its dates and its search");
});

test("fares that land outside the window never get a return lookup", async () => {
  const query = new URLSearchParams({ ...Object.fromEntries(q), arrive: ",2026-12-27" });
  const late = outbound.filter((r) => r.arrive.slice(0, 10) > "2026-12-27").map((r) => r.flights);
  assert.ok(late.length > 0 && late.length < outbound.length, "the fixture has fares on both sides of the window");
  const { heard, asked } = await search(plan([["2026-12-26", "2027-01-10"]]), (path, p) =>
    p.get("pick") ? json(200, { ret: null }) : json(200, { rows: structuredClone(outbound) }), { query });
  const picked = asked.filter((a) => a.pick).map((a) => JSON.parse(a.pick).map((g) => g.flight).join(" "));
  assert.equal(picked.length, outbound.length - late.length);
  assert.ok(picked.every((f) => !late.includes(f)));
  assert.ok(heard.at(-1)[1].rows.every((r) => !late.includes(r.flights)));
});

test("a request that fails is asked once more, and only a second failure counts", async () => {
  const pairs = pairsOf(3), tries = new Map();
  const { heard } = await search(plan(pairs), (path, p) => {
    const n = (tries.get(p.toString()) || 0) + 1;
    tries.set(p.toString(), n);
    if (n === 1 || (p.get("out") === pairs[2][0] && !p.get("pick"))) return json(502, { error: "The fare search answered 302" });   // the last fails twice
    if (!p.get("pick")) return json(200, { rows: listed(p.get("out"), p.get("ret")) });
    return json(200, { ret: { return_flights: "BT961 AC809", return_depart: "2027-01-10T07:45", link: "trip" } });
  });
  const ends = heard.filter(([e, d]) => e === "progress" && d.status !== "searching").map(([, d]) => [d.out, d.status]);
  assert.deepEqual(ends.sort(), [[pairs[0][0], "done"], [pairs[1][0], "done"], [pairs[2][0], "failed"]]);
  assert.ok([...tries.values()].every((n) => n <= 2), "nothing is asked more than twice");
  assert.ok(heard.at(-1)[1].rows.every((r) => r.return_depart), "a return that failed once is found the second time");
});

test("fares that tie keep the order of their dates, however Google's answers arrive", async () => {
  const pairs = pairsOf(4);
  const { heard } = await search(plan(pairs), async (path, p) => {
    if (p.get("pick")) return json(200, { ret: null });
    await new Promise((ok) => setTimeout(ok, 40 - 10 * pairs.findIndex(([o]) => o === p.get("out"))));   // the last date answers first
    return json(200, { rows: listed(p.get("out"), p.get("ret")) });
  });
  const dates = (heard.at(-1)[1].rows).filter((r) => r.flights === outbound[0].flights).map((r) => r.search_out);
  assert.deepEqual(dates, pairs.map(([o]) => o));
});

test("a failed Google comes back empty, as server.py's does", async () => {
  const { heard } = await search(plan([["2026-12-26", "2027-01-10"]]), () => json(502, { error: "No." }));
  assert.deepEqual(heard.at(-1), ["result", { rows: [] }]);
});

test("a stopped search reports nothing more", async () => {
  const stop = new AbortController(), heard = [];
  let then = -1;
  await search(plan(pairsOf(7)), (path, p) => {
    if (!p.get("pick")) return json(200, { rows: listed(p.get("out"), p.get("ret")) });
    then = heard.length;
    stop.abort();
    throw new DOMException("stopped", "AbortError");
  }, { signal: stop.signal, heard });
  assert.ok(then > 0, "it stopped while looking up returns");
  assert.equal(heard.length, then);
});
