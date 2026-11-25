import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AIRPORTS } from "../src/flights.js";
import { EMPTY, arrive, check, echo, estimate, query } from "../src/sentence.js";

// The fixture's search: Toronto to Vilnius, leaving Dec 26 or 27, back on Jan 10.
const trip = { ...EMPTY, from: "YYZ", to: "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", "ret-from": "2027-01-10" };
// The blank a failed check points at, once it has said something about it.
function field(f) {
  const [id, why] = check(f);
  assert.ok(why);
  return id;
}

test("a search needs both airports, a first departure day and a first return day", () => {
  assert.equal(field(EMPTY), "from");
  assert.equal(field({ ...trip, to: "Vilnius" }), "from", "a name, not a code");
  assert.equal(field({ ...trip, to: "YYZ" }), "to");
  assert.equal(field({ ...trip, "out-from": "" }), "out-from");
  assert.equal(field({ ...trip, "ret-from": "" }), "ret-from");
  assert.equal(check(trip), null);
});

test("ranges can't run backwards, and the return can't come before the departure", () => {
  assert.equal(field({ ...trip, "out-to": "2026-12-25" }), "out-to");
  assert.equal(field({ ...trip, "ret-to": "2027-01-09" }), "ret-to");
  assert.equal(field({ ...trip, "ret-from": "2026-12-20" }), "ret-from");
  assert.equal(field({ ...trip, "arr-from": "2026-12-31", "arr-to": "2026-12-30" }), "arr-to");
  assert.equal(check({ ...trip, "arr-to": "2026-12-30" }), null, "a landing window may be open on one side");
});

test("the landing window is sent with either side open", () => {
  assert.equal(arrive(trip), "");
  assert.equal(arrive({ ...trip, "arr-from": "2026-12-30" }), "2026-12-30,");
  assert.equal(arrive({ ...trip, "arr-to": "2026-12-31" }), ",2026-12-31");
  assert.equal(arrive({ ...trip, "arr-from": "2026-12-30", "arr-to": "2026-12-31" }), "2026-12-30,2026-12-31");
});

test("the query searches Google Flights over the sentence's ranges", () => {
  assert.equal(query(trip).toString(), "from=YYZ&to=VNO&currency=CAD&out=2026-12-26..2026-12-27&ret=2027-01-10&sources=google");
  const q = query({ ...trip, "out-to": "2026-12-26", stops: "1", "arr-to": "2026-12-31" });
  assert.equal(q.get("out"), "2026-12-26", "a range of one day is that day");
  assert.equal(q.get("stops"), "1");
  assert.equal(q.get("arrive"), ",2026-12-31");
  assert.equal(query(trip).has("stops"), false, "any number of stops sends no limit");
  assert.equal(query(trip).has("arrive"), false);
});

test("the estimate counts every departure day with every return day", () => {
  assert.match(estimate(trip), /^2 searches\b/);
  assert.match(estimate({ ...trip, "out-to": "" }), /^1 search\b/);
  const week = { ...trip, "out-to": "2027-01-02", "ret-to": "2027-01-15" };   // across the new year
  assert.match(estimate(week), new RegExp(`^${8 * 6} searches\\b`));
  assert.equal(estimate({ ...trip, "ret-from": "" }), "");
});

test("the sentence is echoed back in words", () => {
  const said = echo(trip);
  for (const bit of ["YYZ", "VNO", "Sat Dec 26", "Sun Dec 27", "Sun Jan 10", "CAD"]) assert.ok(said.includes(bit), bit);
  assert.ok(!said.includes("stop"), "any number of stops goes unsaid");
  const limited = echo({ ...trip, stops: "1", "arr-to": "2026-12-31" });
  assert.ok(limited.includes("1 stop") && limited.includes("Thu Dec 31"), limited);
  assert.ok(echo({ ...trip, stops: "0" }).includes("no stops"));
});

// Scotland's airports and London's, more than one side takes.
const UK = ["EDI", "GLA", "PIK", "ABZ", "INV", "LHR", "LGW"];

test("each side takes several airports, up to the most a search allows", () => {
  assert.equal(check({ ...trip, to: "EDI,GLA" }), null);
  assert.equal(check({ ...trip, from: "YYZ,YTZ", to: UK.slice(0, MAX_AIRPORTS).join(",") }), null);
  assert.equal(field({ ...trip, to: UK.slice(0, MAX_AIRPORTS + 1).join(",") }), "to");
  assert.equal(field({ ...trip, from: UK.slice(0, MAX_AIRPORTS + 1).join(","), to: "YYZ" }), "from");
  assert.equal(field({ ...trip, to: "EDI,Glasgow" }), "from", "each one a three-letter code");
  assert.equal(field({ ...trip, to: "EDI," }), "from");
});

test("no airport can be on both sides, and the check names the one that is", () => {
  const both = { ...trip, from: "YYZ,GLA", to: "EDI,GLA" };
  assert.equal(field(both), "to");
  assert.ok(check(both)[1].includes("GLA") && !check(both)[1].includes("EDI"), check(both)[1]);
});

test("several airports are sent joined by commas, and said with an or", () => {
  const q = query({ ...trip, from: "YYZ,YTZ", to: "EDI,GLA,PIK" });
  assert.equal(q.get("from"), "YYZ,YTZ");
  assert.equal(q.get("to"), "EDI,GLA,PIK");
  assert.equal(new URLSearchParams(q.toString()).get("to"), "EDI,GLA,PIK", "and survive the trip through a URL");
  const said = echo({ ...trip, from: "YYZ,YTZ", to: "EDI,GLA,PIK", "arr-to": "2026-12-31" });
  assert.equal(said.split("YYZ or YTZ").length - 1, 3, `the origin, where it departs and where it returns: ${said}`);
  assert.equal(said.split("EDI, GLA or PIK").length - 1, 2, `the destination, and where it lands: ${said}`);
  assert.ok(!echo(trip).includes(" or "), "one airport a side reads as it always did");
});
