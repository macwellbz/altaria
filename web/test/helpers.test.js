import { run } from "./setup.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { airportsLoaded } from "../src/airports.js";
import { airlines, byDate, dateSpan, day, daysOn, fmtMin, grouped, landing, layovers, localDay, money, picks, remark, savedOn, stops, time, waits, weekday, weeks } from "../src/helpers.js";

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

test("the cheapest fare by date, with a search that broke told apart from one that found nothing", () => {
  // the saved run searched Dec 26 and Dec 27 out, Jan 10 back; here two more days come with it, one failed and one empty
  const pairs = ["2026-12-26", "2026-12-27", "2026-12-28", "2026-12-29"].map((out) => [out, "2027-01-10"]);
  const cells = byDate(rows, pairs, { "google|2026-12-28|2027-01-10": { s: "failed", error: "Google sent no results" }, "google|2026-12-29|2027-01-10": { s: "done", n: 0 } });
  assert.deepEqual([...cells.keys()], pairs.map((p) => p.join("|")), "a cell for every day searched, in the order searched");
  // the run's own cheapest for each day: 1,147 on the 26th and 1,443 on the 27th
  assert.deepEqual([...cells.values()].map((c) => c.price), [1147, 1443, null, null]);
  assert.deepEqual([...cells.values()].map((c) => c.failed), ["", "", "Google sent no results", ""]);
  assert.equal(byDate([...rows].reverse(), pairs).get("2026-12-26|2027-01-10").price, 1147, "whatever order the rows come in");
});

test("a run of days sets out as a calendar's weeks, and a week or less as one row", () => {
  assert.deepEqual(weeks("2026-12-26", "2026-12-27"), [["2026-12-26", "2026-12-27"]]);
  const cal = weeks("2026-12-26", "2027-01-10");   // a Saturday to a Sunday, across the new year
  assert.ok(cal.every((week) => week.length === 7 && weekday(week[0]) === "Sun" && weekday(week[6]) === "Sat"));
  assert.equal(cal[0][6], "2026-12-26");
  assert.equal(cal.at(-1)[0], "2027-01-10");
  const days = cal.flat();
  assert.deepEqual(days, [...days].sort(), "in order");
  assert.equal(new Set(days).size, days.length, "and no day twice");
  // the clocks go back on Nov 1 2026 in Toronto and forward on Mar 14 2027: no day is skipped or doubled
  assert.equal(weeks("2026-10-25", "2026-11-07").flat().length, 14);
  assert.equal(weeks("2027-03-07", "2027-03-20").flat().length, 14);
});

// One departure day of a real nine-search run, three return days (tests/test_site_dates.json): two fares at one price
// fly the same return a day apart, and two more at another price never had their return looked up.
const dates = JSON.parse(await readFile(new URL("../../tests/test_site_dates.json", import.meta.url), "utf8")).rows;
const returns = (rows) => grouped(rows).map((fares) => fares.map((r) => r.search_ret));
// The same fare a day later: every time on its return moves a day, as it does when one flight runs daily.
const tomorrow = (iso) => new Date(Date.parse(iso.slice(0, 10)) + 864e5).toISOString().slice(0, 10) + iso.slice(10);
const nextDay = (r) => ({ ...r, search_ret: tomorrow(r.search_ret), return_depart: tomorrow(r.return_depart), return_arrive: tomorrow(r.return_arrive),
  return_segments: r.return_segments.map((s) => ({ ...s, depart: tomorrow(s.depart), arrive: tomorrow(s.arrive) })) });

test("fares that differ only by return date share a row, in date order", () => {
  assert.deepEqual(returns(dates), [["2027-01-12", "2027-01-13"], ["2027-01-11"], ["2027-01-13"], ["2027-01-11", "2027-01-12"]]);
  assert.deepEqual(returns([dates[1], dates[0]]), [["2027-01-12", "2027-01-13"]]);
  assert.equal(grouped(dates).flat().length, dates.length);
});

test("a row's fares fly the same return at the same times, or they stand apart", () => {
  const [first, second] = dates;
  const retimed = { ...second, return_depart: second.return_depart.replace("07:45", "08:05"),
    return_segments: second.return_segments.map((s, i) => (i ? s : { ...s, depart: s.depart.replace("07:45", "08:05") })) };
  assert.equal(grouped([first, retimed]).length, 2, "the same flight numbers at another time of day");
  const unknown = Object.fromEntries(Object.entries(second).map(([k, v]) => [k, k.startsWith("return_") ? null : v]));
  assert.equal(grouped([first, unknown]).length, 2, "a return that wasn't looked up never joins one that was");
  assert.equal(grouped([unknown, first]).length, 2);
});

test("a return that lands the next day is the same flight whichever day it leaves", () => {
  const overnight = dates.find((r) => r.return_depart && daysOn(r.return_depart, r.return_arrive) === 1);
  const later = nextDay(overnight);
  assert.equal(later.return_arrive.slice(0, 10), "2027-01-13");
  assert.deepEqual(returns([overnight, later]), [["2027-01-11", "2027-01-12"]]);
  assert.equal(daysOn("2026-12-31T23:10", "2027-01-02T00:05"), 2);
  assert.equal(daysOn("2027-01-12T07:45", "2027-01-12T14:15"), 0);
});
