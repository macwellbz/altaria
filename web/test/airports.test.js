import { withFetch } from "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { airportsFor, airportsLoaded, city } from "../src/airports.js";

const codes = (q) => airportsFor(q).map((a) => a.c);

test("the list loads", async () => {
  assert.equal(await airportsLoaded, true);
});

test("the finder matches cities, codes and names, an exact code first", () => {
  assert.equal(codes("vilnius")[0], "VNO");
  assert.equal(codes("Toronto")[0], "YYZ");
  assert.equal(codes("yyz")[0], "YYZ");
  assert.equal(codes("man")[0], "MAN", "the code before Manama, Manila and the other cities that start with it");
  assert.ok(codes("montreal").includes("YUL"), "Montréal, without its accent");
  assert.ok(codes("heathrow").includes("LHR"), "by airport name");
  assert.equal(airportsFor("a").length, 8, "eight at most");
  assert.deepEqual(airportsFor("   "), []);
});

test("codes read as their cities, minus any district", () => {
  assert.equal(city("AMS"), "Amsterdam");
  assert.equal(city("HEL"), "Helsinki");
  assert.equal(city("QQQ"), "QQQ", "a code not on the list stays a code");
});

test("without the list, the finder offers nothing and codes stay codes", async () => {
  const fresh = await withFetch(() => { throw new TypeError("offline"); }, () => import("../src/airports.js?offline"));
  assert.equal(await fresh.airportsLoaded, false);
  assert.deepEqual(fresh.airportsFor("vilnius"), []);
  assert.equal(fresh.city("VNO"), "VNO");
});
