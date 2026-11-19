// Altaria's public site on Cloudflare Workers: the built page (web/dist) as static assets, and server.py's API in
// JavaScript. Google Flights only. The free plan gives each request 10ms of CPU and 50 subrequests, and one date
// pair costs about a dozen Google requests of 2MB each, so the browser drives a search (web/src/drive.js): one call
// here per Google request. Nothing a visitor searches is stored; the only shared state is two daily counters (Caps).
import { DurableObject } from "cloudflare:workers";
import { CURRENCIES } from "../web/src/currencies.js";
import { arrivalWindow, cheapestReturn, dateRange, googleQuery, isDate, parseGoogle } from "../web/src/flights.js";
import { Gemini, ProviderError, readTrip } from "./ai.js";

const GOOGLE_PER_DAY = 2000;   // Google requests a day, for everyone: a date pair takes about 12
const GEMINI_PER_DAY = 400;    // trip readings a day; the free tier allows 500, and resets at midnight Pacific
const MAX_PAIRS = 30;          // date pairs in one search
const MODEL = "gemini-3.5-flash-lite";
const CODE = /^[A-Z]{3}$/;
const HEADERS = {   // a Chrome 145 on macOS, as fast-flights presents itself
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

// Today's use of Google and Gemini, counted per UTC day in one Durable Object (SQLite-backed, as the free plan has).
export class Caps extends DurableObject {
  key = (kind) => `${kind}:${new Date().toISOString().slice(0, 10)}`;
  async left(kind, limit) {
    return limit - ((await this.ctx.storage.get(this.key(kind))) || 0);
  }
  // Counts one use and answers true, or answers false once today's uses have reached limit.
  async take(kind, limit) {
    const n = (await this.ctx.storage.get(this.key(kind))) || 0;
    if (n >= limit) return false;
    await this.ctx.storage.put(this.key(kind), n + 1);
    return true;
  }
  async useUp(kind, limit) {
    await this.ctx.storage.put(this.key(kind), limit);
  }
}

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const events = (...list) => new Response(list.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""),
  { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
const days = (spec) => {   // dates in "2026-12-28..2026-12-30", or 0 if it runs backwards
  const [a, b = a] = spec.split("..");
  if (!isDate(a) || !isDate(b)) throw new RangeError("bad date");
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 864e5 + 1);
};

// server.py's parse(): the query checked, with each message fit to show on the page. Throws a RangeError.
function parse(q) {
  const [orig, dest, currency] = [["from", ""], ["to", ""], ["currency", "CAD"]].map(([k, d]) => (q.get(k) ?? d).trim().toUpperCase());
  if (![orig, dest, currency].every((c) => CODE.test(c))) throw new RangeError("Airports and currency must be 3-letter codes, like YYZ, VNO and CAD.");
  if (!CURRENCIES.some(([c]) => c === currency)) throw new RangeError(`${currency} isn't one of the currencies this site converts.`);
  let spans, window = null;
  try {
    spans = ["out", "ret"].map((k) => days((q.get(k) || "").trim()));
    const arrive = (q.get("arrive") || "").trim();
    if (arrive.replaceAll(",", "")) window = arrivalWindow(arrive);
  } catch {
    throw new RangeError("Dates must look like 2026-12-29.");
  }
  if (Math.min(...spans) < 1 || (window && window[0] > window[1])) throw new RangeError("Each date range must run forwards: the first date can't be after the second.");
  const stops = (q.get("stops") || "").trim();
  if (!["", "0", "1", "2"].includes(stops)) throw new RangeError("Max stops must be 0 (nonstop), 1 or 2, or left open.");
  if (!(q.get("sources") || "google").split(",").includes("google")) throw new RangeError("This site doesn't search that source.");
  if (spans[0] * spans[1] > MAX_PAIRS) throw new RangeError(`That's ${spans[0] * spans[1]} date pairs. Narrow the dates to ${MAX_PAIRS} or fewer.`);
  const pairs = dateRange(q.get("out").trim()).flatMap((o) => dateRange(q.get("ret").trim()).map((r) => [o, r]));
  return { orig, dest, currency, pairs, window, stops: stops === "" ? null : Number(stops) };
}

// The outbound flights a /api/google call chose, from ?pick: [{ from, to, depart, flight }, ...], checked so this
// can't be made to send Google anything else.
function pickOf(text) {
  const segs = JSON.parse(text);
  const ok = Array.isArray(segs) && segs.length >= 1 && segs.length <= 4 && segs.every((g) =>
    CODE.test(g?.from) && CODE.test(g?.to) && isDate(String(g?.depart).slice(0, 10)) && /^[A-Z0-9]{3,8}$/.test(g?.flight));
  if (!ok) throw new RangeError("bad pick");
  return segs.map(({ from, to, depart, flight }) => ({ from, to, depart: depart.slice(0, 10), flight }));
}

// One Google Flights page, parsed. Anything but a 200 with results in it is a failure.
async function google(query, currency, again = true) {
  const r = await fetch(`https://www.google.com/travel/flights?${query.params}`, { headers: HEADERS, redirect: "manual" });
  if (r.status !== 200) {
    await r.body?.cancel();
    // About 1 lookup in 40 comes back as a redirect, so ask once more. Where it pointed goes to the log, to find out why.
    const to = r.headers.get("location");
    if (again && to) {
      console.log(`Google Flights redirected to ${to.slice(0, 300)}; asking again`);
      return google(query, currency, false);
    }
    throw new Error(`The fare search answered ${r.status}`);
  }
  return parseGoogle(await r.text(), currency);
}

// GET /api/google: one date pair's outbound flights, { rows }, each linked to the search for its dates. With ?pick
// (a row's outbound segments), that outbound's cheapest return instead, { ret }: search.py's add_return.
async function searchOne(q, caps) {
  let p, pick = null;
  try {
    p = parse(q);
    if (p.pairs.length !== 1) throw new RangeError("Ask for one date pair at a time.");
    if (q.get("pick")) pick = pickOf(q.get("pick"));
  } catch (e) {
    return json({ error: e instanceof RangeError ? e.message : "That pick isn't a list of flights." }, 400);
  }
  const [[out, ret]] = p.pairs;
  if (!(await caps.take("google", GOOGLE_PER_DAY))) {
    return json({ error: "Altaria has used up today's searches. Try again after midnight UTC.", cap: true }, 429);
  }
  try {
    if (pick) {
      const backs = await google(googleQuery(p.orig, p.dest, out, ret, p.currency, p.stops, pick), p.currency);
      return json({ ret: cheapestReturn(backs, p.orig, p.dest, out, ret, p.currency, p.stops, pick) });
    }
    const link = googleQuery(p.orig, p.dest, out, ret, p.currency, p.stops);
    const rows = await google(link, p.currency);
    return json({ rows: rows.map((r) => ({ ...r, search_out: out, search_ret: ret, link: link.url })) });
  } catch (e) {
    return json({ error: String(e.message || e).slice(0, 300) }, 502);
  }
}

let airports = null;   // the codes in web/public/airports.json, read once per isolate
const known = async (env, url) => (airports ??= new Set((await (await env.ASSETS.fetch(new URL("/airports.json", url))).json()).map((a) => a.c)));

async function aiStatus(env, caps) {
  if (!env.GEMINI_API_KEY) return { available: false, why: "The trip reader isn't set up on this site." };
  if ((await caps.left("gemini", GEMINI_PER_DAY)) <= 0) return { available: false, why: "The trip reader has used up today's readings." };
  const model = env.ALTARIA_AI_MODEL || MODEL;
  return { available: true, provider: "gemini", model, label: new Gemini("", model).label };
}

// POST /api/ai/trip: server.py's trip(), with Gemini reading.
async function trip(request, env, caps) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return json({ error: "Send the trip as application/json." }, 415);
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: "That request is too big." }, 413);
  let q;
  try {
    q = JSON.parse(raw);
  } catch {
    return json({ error: "The request isn't valid JSON." }, 400);
  }
  const [text, today] = q && typeof q === "object" ? [q.text, q.today] : [null, null];
  if (typeof text !== "string" || !text.trim()) return json({ error: "Describe the trip first." }, 400);
  if (text.trim().length > 500) return json({ error: "Keep the trip to 500 characters." }, 400);
  if (!isDate(String(today))) return json({ error: "today must be a date like 2026-12-29." }, 400);
  const status = await aiStatus(env, caps);
  if (!status.available || !(await caps.take("gemini", GEMINI_PER_DAY))) return json({ error: status.why || "The trip reader has used up today's readings." }, 503);
  try {
    return json(await readTrip(new Gemini(env.GEMINI_API_KEY, status.model), text.trim(), today, await known(env, request.url)));
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    if (e.daily) await caps.useUp("gemini", GEMINI_PER_DAY);
    return json({ error: e.message }, 502);
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // Only this site's own page may spend searches and readings (a browser always says where a request comes from).
    const site = request.headers.get("Sec-Fetch-Site");
    if (site && site !== "same-origin") return json({ error: "Altaria only answers its own page." }, 403);
    const caps = env.CAPS.get(env.CAPS.idFromName("caps"));
    const q = url.searchParams;
    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/search":   // checks the search and answers its plan; the page then runs it through /api/google
        try {
          const { pairs, currency } = parse(q);
          return events(["plan", { pairs, sources: ["google"], currency, drive: true }]);
        } catch (e) {
          return events(["fail", { message: e.message }]);
        }
      case "GET /api/google":
        return searchOne(q, caps);
      case "GET /api/example":   // no shared searches here: the page shows its visitor's own (example.js)
        return json(null);
      case "GET /api/ai":
        return json(await aiStatus(env, caps));
      case "POST /api/ai/trip":
        return trip(request, env, caps);
    }
    return json({ error: "There's nothing here." }, 404);
  },
};
