// worker/ai.js, ai.py's trip reader with Gemini behind it: the same instructions, schema and checks as ai.py, and
// Gemini's request and reply against a stand-in, so no test spends the free quota.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FIELDS, Gemini, ProviderError, check, instructions, readTrip, schema } from "../ai.js";
import { ROOT, noPython, py } from "./python.js";
import { FIELDS as PAGE_FIELDS } from "../../web/src/trip.js";

const airports = new Set(JSON.parse(readFileSync(`${ROOT}web/public/airports.json`, "utf8")).map((a) => a.c));
const TODAY = "2026-11-17";
const blank = Object.fromEntries(FIELDS.map((f) => [f, ""]));
// What a model might say: good values, and each way one can fail ai.py's checks.
const SAID = [
  { ...blank, from: "yyz", to: "VNO", "out-from": "2026-12-28", "out-to": "2026-12-30", "ret-from": "2027-01-11", stops: "any", currency: "cad" },
  { from: "YTO", to: "YYZ", "out-from": "2026-11-16", "out-to": "2026-02-30", "arr-from": "2026-12-01", "arr-to": "2026-11-30", "ret-from": "2027-11-19", stops: "3", currency: "BTC" },
  { from: "YYZ", to: "YYZ", "out-from": "2026-12-01", "ret-from": "2026-11-30", "ret-to": "2026-12-05", stops: 1, currency: ["CAD"] },
  { "out-from": " 2026-12-01 ", "arr-to": "2026-11-20", "ret-to": "next week", stops: "0" },
];

test("the page, the worker and ai.py agree on the sentence's blanks", { skip: noPython }, () => {
  const want = py(`
import ai
print(json.dumps(sorted(ai.FIELDS)))`);
  assert.deepEqual([...PAGE_FIELDS].sort(), want);
  assert.deepEqual([...FIELDS].sort(), want);
});

test("instructions, schema and checks match ai.py's", { skip: noPython }, () => {
  const want = py(`
import ai
print(json.dumps([ai.instructions(arg[0]), ai.schema(), [ai.check(s, arg[0]) for s in arg[1]]]))`, [TODAY, SAID]);
  assert.deepEqual([instructions(TODAY), schema(), SAID.map((s) => check(s, TODAY, airports))], want);
});

// Swaps fetch for a stand-in Gemini that answers each call with the next of replies: [status, body].
function standIn(replies) {
  const heard = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    heard.push({ url, init, body: JSON.parse(init.body) });
    const [status, body] = replies.shift();
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { heard, done: () => { globalThis.fetch = real; } };
}
const reply = (text) => [200, { status: "completed", steps: [{ type: "thought", content: [] }, { type: "model_output", content: [{ type: "text", text }] }] }];

test("readTrip asks Gemini's Interactions API for the form as JSON, then checks it", async () => {
  const g = standIn([reply(JSON.stringify({ ...blank, from: "YYZ", to: "VNO", "out-from": "2026-12-28" }))]);
  try {
    const got = await readTrip(new Gemini("k3y", "gemini-3.5-flash-lite"), "Toronto to Vilnius on Dec 28", TODAY, airports);
    assert.deepEqual([got.fields.from, got.fields.to, got.fields["out-from"]], ["YYZ", "VNO", "2026-12-28"]);
    const [{ url, init, body }] = g.heard;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(init.headers["x-goog-api-key"], "k3y");
    assert.equal(body.model, "gemini-3.5-flash-lite");
    assert.equal(body.input, "The trip:\nToronto to Vilnius on Dec 28");
    assert.equal(body.system_instruction, instructions(TODAY));
    assert.deepEqual(body.response_format, { type: "text", mime_type: "application/json", schema: schema() });
    assert.equal(body.store, false, "nobody's trip is kept on Google's side");
  } finally {
    g.done();
  }
});

test("readTrip retries once when the reply holds no form, then gives up", async () => {
  const g = standIn([reply("Sorry, I can't."), reply("```json\n{\"from\": \"YYZ\"}\n```")]);
  try {
    assert.equal((await readTrip(new Gemini("k", "m"), "x", TODAY, airports)).fields.from, "YYZ");
    assert.match(g.heard[1].body.input, /Reply with the JSON object only\.$/);
  } finally {
    g.done();
  }
  const h = standIn([reply("no"), reply("still no")]);
  try {
    await assert.rejects(readTrip(new Gemini("k", "m"), "x", TODAY, airports), /didn't return a form/);
  } finally {
    h.done();
  }
});

test("a 429 says whether today's quota is gone", async () => {
  const g = standIn([
    [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generate_requests_per_model_per_day" } }],
    [429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded: GenerateRequestsPerMinutePerProjectPerModel-FreeTier" } }],
    [400, { error: { message: "API key not valid." } }],
  ]);
  try {
    const fail = (p) => p.then(() => assert.fail("no error"), (e) => e);
    const day = await fail(readTrip(new Gemini("k", "m"), "x", TODAY, airports));
    assert.ok(day instanceof ProviderError && day.daily);
    const minute = await fail(readTrip(new Gemini("k", "m"), "x", TODAY, airports));
    assert.ok(!minute.daily && /busy/.test(minute.message));
    assert.match((await fail(readTrip(new Gemini("k", "m"), "x", TODAY, airports))).message, /^Gemini answered 400/);
  } finally {
    g.done();
  }
});
