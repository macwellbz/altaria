import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY, arrive, check, echo, estimate, pairs, query } from "../src/sentence.js";

// The fixture's search: Toronto to Vilnius, leaving Dec 26 or 27, back on Jan 10.
const trip = { ...EMPTY, from: "YYZ", to: "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", "ret-from": "2027-01-10" };

test("a search needs both airports, a first departure day and a first return day", () => {
  assert.deepEqual(check(EMPTY), ["from", "Pick both airports from the suggestions, or type three-letter codes like YYZ and VNO."]);
  assert.equal(check({ ...trip, to: "Vilnius" })[0], "from", "a name, not a code");
  assert.deepEqual(check({ ...trip, to: "YYZ" }), ["to", "Origin and destination are the same airport."]);
  assert.deepEqual(check({ ...trip, "out-from": "" }), ["out-from", "Choose the first day you could depart."]);
  assert.deepEqual(check({ ...trip, "ret-from": "" }), ["ret-from", "Choose the first day you could return."]);
  assert.equal(check(trip), null);
});

test("ranges can't run backwards, and the return can't come before the departure", () => {
  assert.equal(check({ ...trip, "out-to": "2026-12-25" })[0], "out-to");
  assert.equal(check({ ...trip, "ret-to": "2027-01-09" })[0], "ret-to");
  assert.deepEqual(check({ ...trip, "ret-from": "2026-12-20" }), ["ret-from", "The return starts before you depart."]);
  assert.equal(check({ ...trip, "arr-from": "2026-12-31", "arr-to": "2026-12-30" })[0], "arr-to");
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
  assert.equal(pairs(trip), 2);
  assert.equal(estimate(trip), "2 searches, about 15 seconds");
  assert.equal(estimate({ ...trip, "out-to": "" }), "1 search, about 10 seconds");
  const week = { ...trip, "out-to": "2027-01-02", "ret-to": "2027-01-15" };   // across the new year
  assert.equal(pairs(week), 8 * 6);
  assert.equal(estimate(week), "48 searches, about 6 minutes");
  assert.equal(estimate({ ...trip, "ret-from": "" }), "");
});

test("the sentence is echoed back in words", () => {
  assert.equal(echo(trip), "Fly me from YYZ to VNO. Depart from YYZ between Sat Dec 26 and Sun Dec 27. Return to YYZ on Sun Jan 10. Show prices in CAD.");
  assert.equal(echo({ ...trip, stops: "1", "arr-to": "2026-12-31" }),
    "Fly me from YYZ to VNO with at most 1 stop each way. Depart from YYZ between Sat Dec 26 and Sun Dec 27. " +
    "Land in VNO by Thu Dec 31. Return to YYZ on Sun Jan 10. Show prices in CAD.");
  assert.match(echo({ ...trip, stops: "0" }), /^Fly me from YYZ to VNO with no stops each way\./);
});
