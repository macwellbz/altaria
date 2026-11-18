// Shared by the unit tests: import it before any module from src/. The page fetches the airport list from its own
// server; here that fetch is answered from web/public/airports.json, so city names and the finder's ranking run on
// the real list. `run` is the repo's fixture, the first rows of a real saved search (see tests/test_site.py).
import { readFile } from "node:fs/promises";

const page = globalThis.fetch;
globalThis.fetch = async (url, options) =>
  String(url) === "airports.json" ? new Response(await readFile(new URL("../public/airports.json", import.meta.url))) : page(url, options);

export const run = JSON.parse(await readFile(new URL("../../tests/test_site_run.json", import.meta.url), "utf8"));

// Swaps fetch for one test: answer(url, options) returns a Response, or throws to act as a dropped connection.
export async function withFetch(answer, body) {
  const before = globalThis.fetch;
  globalThis.fetch = async (url, options) => answer(String(url), options);
  try {
    return await body();
  } finally {
    globalThis.fetch = before;
  }
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
