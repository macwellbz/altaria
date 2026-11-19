import { run } from "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { airportsLoaded } from "../src/airports.js";
import { airlines, dateSpan, day, fmtMin, landing, layovers, localDay, money, picks, remark, savedOn, stops, time, waits, weekday } from "../src/helpers.js";

const rows = run.rows;
await airportsLoaded;

test("dates and times read as the airports' local time", () => {
  assert.equal(day("2026-12-29"), "Dec 29");
  assert.equal(day("2026-12-29", true), "Tue Dec 29");
  assert.equal(weekday("2027-01-10T07:45"), "Sun");
  assert.equal(time("2026-12-26T20:50"), "20:50");
  assert.equal(dateSpan("2026-12-26"), "Dec 26");
  assert.equal(dateSpan("2026-12-26..2026-12-28"), "Dec 26 to 28");
  assert.equal(dateSpan("2026-12-30..2027-01-02"), "Dec 30 to Jan 2");
});

test("the visitor's date comes from their own clock, not UTC", () => {
  assert.equal(localDay(new Date(2026, 10, 16, 23, 59)), "2026-11-16");
  assert.equal(localDay(new Date(2027, 0, 5, 0, 1)), "2027-01-05");
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test("a landing window can be open on either side", () => {
  assert.equal(landing("2026-12-30,2026-12-31"), "between Dec 30 and Dec 31");
  assert.equal(landing("2026-12-31,2026-12-31"), "on Dec 31");
  assert.equal(landing(",2026-12-31", true), "by Thu Dec 31");
  assert.equal(landing("2026-12-30,"), "on Dec 30 or later");
});

test("lengths, prices and stops", () => {
  assert.equal(fmtMin(2010), "33h30");
  assert.equal(fmtMin(65), "1h05");
  assert.equal(fmtMin(0), "?");
  assert.equal(money(1147), "1,147");
  assert.equal(money(1146.6), "1,147");
  assert.deepEqual([stops(0), stops(1), stops(2)], ["nonstop", "1 stop", "2 stops"]);
});

test("a run's file name says when it was saved", () => {
  assert.equal(savedOn("20260927-183130-YYZ-VNO.json"), "Sep 27");
  assert.equal(savedOn("20260927-183130-YYZ-VNO.json", true), "Sep 27 at 18:31");
});

test("layovers: long over six hours, overnight when the next flight leaves another day", () => {
  assert.deepEqual(layovers(rows[0].segments), [{ at: "AMS", next: "AMS", m: 1435, long: true, night: true }]);   // 23h55 in Amsterdam
  assert.deepEqual(layovers(rows[1].segments), [{ at: "AMS", next: "AMS", m: 390, long: true, night: false }]);
  assert.deepEqual(layovers(undefined), []);
  assert.equal(waits(rows[0]).length, 2, "out and back");
  // a change of airports: the next flight leaves from another one
  const moves = layovers([{ to: "LHR", arrive: "2026-12-27T08:00" }, { from: "LGW", depart: "2026-12-27T10:30" }]);
  assert.deepEqual(moves, [{ at: "LHR", next: "LGW", m: 150, long: false, night: false }]);
});

test("who flies which part, by city", () => {
  assert.equal(airlines(rows[0].segments), "Air Canada to Amsterdam, then Air Baltic to Vilnius");
  assert.equal(airlines(rows[0].return_segments), "Air Baltic to Amsterdam, then Air Canada to Toronto");
  assert.equal(airlines(rows[2].segments), "LOT to Vilnius via Warsaw");
});

test("the board marks a tie only when two fares share a price and the shorter outbound wins it", () => {
  assert.equal(remark(rows, 0), "Cheapest");
  assert.equal(remark(rows, 1), "");
  assert.equal(rows[2].price_cmp, rows[3].price_cmp);
  assert.equal(remark(rows, 2), "", "same price and the same length: nobody wins");
  assert.equal(rows[6].price_cmp, rows[7].price_cmp);
  assert.equal(remark(rows, 6), "Wins the tie, 5h20 quicker");
  assert.equal(remark(rows, 7), "");
  assert.equal(remark(rows.slice(6), 0), "Cheapest, wins the tie");
});

test("the summary points past the cheapest only to fares that are better in a way it can name", () => {
  // the cheapest waits 23h55 in Amsterdam; Lufthansa via Frankfurt is the first with no long wait, and the quickest out
  assert.deepEqual(picks(rows), [[rows[6], ["no layover over 6 hours", "the quickest outbound"]]]);
  assert.deepEqual(picks(rows.slice(6)), [], "nothing to beat: no long layover, and the cheapest is the quickest");
  const unknown = { ...rows[6], return_segments: null };   // its flights back unknown, so no claim about its layovers
  assert.deepEqual(picks([rows[0], unknown, rows[7]]), [[unknown, ["the quickest outbound"]]]);
  // Matrix's warnings: a fare with only informational ones counts as clean beside a risky cheapest
  const risky = { ...rows[0], source: "matrix", warnings: ["RISKY_CONNECTION"] };
  const clean = { ...rows[1], source: "matrix", warnings: ["OVERNIGHT"] };
  assert.deepEqual(picks([risky, clean]), [[clean, ["no connection warnings from Matrix", "the quickest outbound"]]]);
});
