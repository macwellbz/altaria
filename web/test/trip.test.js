import { json, withFetch } from "./setup.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { localDay } from "../src/helpers.js";
import { EMPTY } from "../src/sentence.js";
import { FIELDS, REQUIRED, ask, merge, outcome, reader } from "../src/trip.js";

// An answer as server.py sends one: every field, "" for the ones the trip left open, and those listed as missing,
// unless a value was thrown out (dropped). A field given as "" here was settled empty, as "any" stops is.
function answer(said, dropped = []) {
  const fields = Object.fromEntries(FIELDS.map((id) => [id, said[id] ?? ""]));
  const missing = FIELDS.filter((id) => !(id in said) && !dropped.some((d) => d.field === id));
  return { fields, missing, dropped };
}
const said = (a) => outcome(merge(EMPTY, a), a);

test("the page and the server agree on the sentence's blanks", async () => {
  const py = await readFile(new URL("../../ai.py", import.meta.url), "utf8");
  const theirs = JSON.parse(py.match(/^FIELDS = (\[.*\])$/m)[1]);
  assert.deepEqual([...FIELDS].sort(), [...theirs].sort());
  assert.deepEqual([...FIELDS].sort(), Object.keys(EMPTY).sort());
  assert.ok(REQUIRED.every((id) => FIELDS.includes(id)));
});

test("a reading fills the blanks it settles and keeps what the person typed in the rest", () => {
  const typed = { ...EMPTY, from: "BUF", "ret-from": "2027-01-12" };
  const { fields, filled, open } = merge(typed, answer({ to: "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", stops: "1" }));
  assert.deepEqual(fields, { ...typed, to: "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", stops: "1" });
  assert.deepEqual(filled, { to: "", "out-from": "", "out-to": "", stops: "" }, "each filled blank and what it held");
  assert.deepEqual(open, []);
});

test("a settled value replaces the person's, and the reading remembers what it replaced", () => {
  const { fields, filled } = merge({ ...EMPTY, from: "BUF" }, answer({ from: "YYZ", currency: "EUR" }));
  assert.equal(fields.from, "YYZ");
  assert.equal(fields.currency, "EUR");
  assert.deepEqual(filled, { from: "BUF", currency: "CAD" });
});

test("stops left empty means any number only when the server settled it so", () => {
  const before = { ...EMPTY, stops: "1" };
  const any = merge(before, answer({ from: "YYZ", stops: "" }));
  assert.equal(any.fields.stops, "");
  assert.equal(any.filled.stops, "1");
  assert.equal(merge(before, answer({ from: "YYZ" })).fields.stops, "1", "missing: the person's choice stands");
  const thrown = answer({ from: "YYZ" }, [{ field: "stops", value: "3", why: "Stops must be 0, 1 or 2 on each leg, or any." }]);
  assert.equal(merge(before, thrown).fields.stops, "1", "dropped: the person's choice stands");
});

test("open is the required blanks still empty, in the sentence's order", () => {
  assert.deepEqual(merge(EMPTY, answer({ from: "YYZ" })).open, ["to", "out-from", "ret-from"]);
  assert.deepEqual(merge(EMPTY, answer({})).open, REQUIRED);
  assert.deepEqual(merge({ ...EMPTY, to: "VNO" }, answer({ from: "YYZ" })).open, ["out-from", "ret-from"]);
});

test("anything malformed in an answer is left alone", () => {
  const odd = { fields: { from: 7, to: null, "out-from": ["2026-12-26"], price: "100", "ret-from": "2027-01-10" } };
  const { fields, filled } = merge(EMPTY, odd);
  assert.deepEqual(fields, { ...EMPTY, "ret-from": "2027-01-10" });
  assert.deepEqual(filled, { "ret-from": "" });
  assert.deepEqual(merge(EMPTY, {}).filled, {});
});

test("one line says what the reading did", () => {
  assert.equal(said(answer({ from: "YYZ", to: "VNO", "out-from": "2026-12-26", "out-to": "2026-12-27", "ret-from": "2027-01-10", "ret-to": "2027-01-10", stops: "1", currency: "CAD" })),
    "Filled 8 blanks. Check them, then press Search.");
  assert.equal(said(answer({ from: "YYZ", to: "VNO", "out-from": "2026-12-26" })), "Filled 3 blanks. Still open: the first return day.");
  assert.equal(said(answer({ to: "VNO" })), "Filled 1 blank. Still open: the origin, the first departure day and the first return day.");
  assert.equal(said(answer({ from: "YYZ" }, [{ field: "to", value: "VNX", why: "VNX isn't an airport code on Altaria's list." }])),
    "Filled 1 blank. Didn't use VNX as the destination. VNX isn't an airport code on Altaria's list. " +
    "Still open: the destination, the first departure day and the first return day.");
  assert.equal(said(answer({})), "Nothing in that fills a blank. Try naming the airports or cities, and the days you could fly.");
});

test("ask posts the text and the visitor's date as JSON, and hands back the answer", async () => {
  const sent = [], reply = answer({ from: "YYZ" });
  const got = await withFetch((url, options) => (sent.push({ url, ...options }), json(200, reply)), () => ask("Toronto to Vilnius", "2026-11-16"));
  assert.deepEqual(got, { answer: reply });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/api/ai/trip");
  assert.equal(sent[0].method, "POST");
  assert.equal(sent[0].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(sent[0].body), { text: "Toronto to Vilnius", today: "2026-11-16" });
  let today;
  await withFetch((url, options) => ((today = JSON.parse(options.body).today), json(200, reply)), () => ask("Riga"));
  assert.equal(today, localDay(), "the visitor's own date by default");
});

test("ask shows the server's sentence for each refusal as it is, and never rejects", async () => {
  for (const [status, error] of [[400, "Describe the trip first."], [403, "Altaria only answers its own page."],
    [413, "That request is too big."], [415, "Send the trip as application/json."],
    [429, "Altaria is still reading the last trip. Try again when it finishes."], [502, "The model's reply had no form in it."],
    [503, "No model is available."]]) {
    assert.deepEqual(await withFetch(() => json(status, { error }), () => ask("x")), { error }, String(status));
  }
  const bare = await withFetch(() => new Response("<h1>Bad gateway</h1>", { status: 502 }), () => ask("x"));
  assert.match(bare.error, /^The server answered 502 without a reason\. /);
  const gone = await withFetch(() => { throw new TypeError("fetch failed"); }, () => ask("x"));
  assert.match(gone.error, /^The connection to the local server dropped\. /);
});

test("reader is the model's status when one can read, and null otherwise", async () => {
  const on = { available: true, provider: "claude", model: "sonnet", label: "Claude via Claude Code" };
  assert.deepEqual(await withFetch(() => json(200, on), reader), on);
  assert.equal(await withFetch(() => json(200, { available: false, why: "No model found." }), reader), null);
  assert.equal(await withFetch(() => new Response("Not found", { status: 404 }), reader), null, "a server from before the trip box");
  assert.equal(await withFetch(() => { throw new TypeError("fetch failed"); }, reader), null);
});
