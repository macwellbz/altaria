// search.py's Google Flights side in JavaScript, for the public site on Cloudflare (worker/). The Worker imports the
// query and parsing half; the page imports the ranking half, since on the public site the browser drives a search one
// Google request at a time (drive.js). Every function keeps search.py's name, in camelCase, and its result shapes.
// worker/test/flights.test.js checks it against the Python.

// "2026-12-28..2026-12-30" -> ["2026-12-28", "2026-12-29", "2026-12-30"]; a single date also works.
export function dateRange(spec) {
  const [start, end = start] = spec.split("..");
  const out = [];
  for (let d = new Date(`${start}T00:00Z`); d <= new Date(`${end}T00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// --- the tfs protobuf, byte for byte as fast-flights builds it (fast_flights/pb/flights.proto) ---

const text = new TextEncoder();
const varint = (n) => {
  const b = [];
  for (; n > 127; n >>>= 7) b.push((n & 127) | 128);
  b.push(n);
  return b;
};
const field = (n, bytes) => [...varint((n << 3) | 2), ...varint(bytes.length), ...bytes];   // a string or message
const str = (n, s) => field(n, [...text.encode(s)]);
const int = (n, v) => [...varint(n << 3), ...varint(v)];

// One leg, FlightData: date (2), max_stops (5) when set, from (13) and to (14) as Airport { airport (2) }, then any
// chosen flights (picked), which protobuf keeps after the fields it knows.
const leg = (date, from, to, maxStops, chosen = []) =>
  [...str(2, date), ...(maxStops == null ? [] : int(5, maxStops)), ...field(13, str(2, from)), ...field(14, str(2, to)), ...chosen];

// Protobuf for 'these flights are chosen' on one leg: FlightData field 4, which Google's own URLs carry after a click
// but fast-flights doesn't model. Each segment is { from, to, depart, flight }.
export const picked = (segments) =>
  segments.flatMap((g) => field(4, [...str(1, g.from), ...str(2, g.depart.slice(0, 10)), ...str(3, g.to), ...str(5, g.flight.slice(0, 2)), ...str(6, g.flight.slice(2))]));

// One date pair's round-trip query: Info { data (3) per leg, passengers (8, packed: one adult), seat (9: economy),
// trip (19: round trip) }. pickOut and pickRet are segments to mark chosen on each leg. Returns { tfs, url, params }:
// url is the link a result opens, params what a search sends.
export function googleQuery(orig, dest, out, ret, currency, maxStops = null, pickOut = [], pickRet = []) {
  const bytes = [...field(3, leg(out, orig, dest, maxStops, picked(pickOut))), ...field(3, leg(ret, dest, orig, maxStops, picked(pickRet))),
    ...field(8, [1]), ...int(9, 1), ...int(19, 1)];
  const tfs = btoa(String.fromCharCode(...bytes));
  return { tfs, url: `https://www.google.com/travel/flights/search?tfs=${tfs}&hl=en&curr=${currency}`, params: new URLSearchParams({ tfs, hl: "en", curr: currency }) };
}

// --- reading Google's reply ---

// The results live in the page's <script class="ds:1">, as AF_initDataCallback({key: 'ds:1', hash: '9', data: [...],
// sideChannel: {}}). Only that script is cut out of the page, so the rest of its 2MB is never parsed.
export function parseGoogle(html, currency) {
  const at = html.indexOf('class="ds:1"');
  const start = html.indexOf(">", at) + 1, end = html.indexOf("</script>", start);
  if (at < 0 || !start || end < 0) throw new Error("Google's page had no results in it");
  const js = html.slice(start, end);
  const from = js.indexOf("data:");
  if (from < 0) throw new Error("Google's page had no results in it");
  const body = js.slice(from + 5);
  return normGoogle(JSON.parse(body.slice(0, body.lastIndexOf(","))), currency);
}

// Python's truthiness, which normGoogle's checks rely on: an empty list is false.
const truthy = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));
const pad = (n) => String(n).padStart(2, "0");
const hm = (t) => `${pad(t?.[0] || 0)}:${pad(t?.[1] || 0)}`;
const ymd = (d) => `${String(d[0]).padStart(4, "0")}-${pad(d[1])}-${pad(d[2])}`;

// search.py's norm_google: Google's 'best' list (payload[2]) and the rest (payload[3]), read by position. Unpriced
// rows are dropped, never guessed.
export function normGoogle(payload, currency) {
  const rows = [];
  for (const block of [payload[2], payload[3]]) {
    const list = (truthy(block) ? block : [null])[0];
    for (const k of truthy(list) ? list : []) {
      if (!(truthy(k[1]) && truthy(k[1][0]) && truthy(k[1][0][1]))) continue;
      const f = k[0];
      rows.push({
        source: "google",
        price: Number(k[1][0][1]),
        currency,
        carriers: f[1],
        route: [f[2][0][3], ...f[2].map((s) => s[6])].join("-"),
        flights: f[2].map((s) => s[22][0] + s[22][1]).join(" "),
        stops: f[2].length - 1,
        depart: `${ymd(f[4])}T${hm(f[5])}`,
        arrive: `${ymd(f[7])}T${hm(f[8])}`,
        duration: f[9],
        // Google prices the round trip but only details the outbound until you pick one (cheapestReturn).
        return_depart: null,
        return_arrive: null,
        // One entry per flight, in local times; flight codes start with the 2-letter IATA airline code.
        segments: f[2].map((s) => ({ from: s[3], to: s[6], depart: `${ymd(s[20])}T${hm(s[8])}`,
          arrive: `${ymd(s[21])}T${hm(s[10])}`, flight: s[22][0] + s[22][1], airline: s[22][3], duration: s[11] })),
      });
    }
  }
  return rows;
}

// add_return's choice, once Google lists the returns for one chosen outbound: the cheapest, then the shortest. Its
// price is the whole trip's, and its link opens this exact trip. null when there's no return to choose.
export function cheapestReturn(backs, orig, dest, out, ret, currency, maxStops, outbound) {
  if (!backs.length) return null;
  const b = backs.reduce((a, x) => ((x.price < a.price || (x.price === a.price && (x.duration || 0) < (a.duration || 0))) ? x : a));
  return {
    link: googleQuery(orig, dest, out, ret, currency, maxStops, outbound, b.segments).url, price: b.price,
    return_depart: b.depart, return_arrive: b.arrive, return_route: b.route, return_flights: b.flights, return_stops: b.stops,
    return_duration: b.duration, return_segments: b.segments,
  };
}

// --- filtering, currency, ranking ---

// window = ["2026-12-30", "2026-12-31"], inclusive, in local arrival time.
export const arrivesWithin = (row, window) => window[0] <= row.arrive.slice(0, 10) && row.arrive.slice(0, 10) <= window[1];

// "2026-12-30,2026-12-31" -> ["2026-12-30", "2026-12-31"]. Either side may be blank for no bound. Throws on a bad date.
export function arrivalWindow(spec) {
  const i = spec.indexOf(",");
  const [lo, hi] = i < 0 ? [spec, ""] : [spec.slice(0, i), spec.slice(i + 1)];
  for (const d of [lo, hi]) if (d && !isDate(d)) throw new RangeError(`not a date: ${d}`);
  return [lo || "0001-01-01", hi || "9999-12-31"];
}

// A real calendar date written YYYY-MM-DD.
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00Z`).toISOString().startsWith(s);

// Adds price_cmp in one currency so sources can be compared, at the ECB spot rate from frankfurter.dev. A Google
// search is already priced in the currency asked for, so it needs no lookup.
export async function convert(rows, currency) {
  const rates = { [currency]: 1 };
  for (const r of rows) {
    const c = r.currency;
    if (!(c in rates)) {
      const resp = await fetch(`https://api.frankfurter.dev/v1/latest?base=${c}&symbols=${currency}`, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`frankfurter.dev answered ${resp.status}`);
      rates[c] = (await resp.json()).rates[currency];
    }
    r.price_cmp = Math.round(r.price * rates[c] * 100) / 100;
  }
}

// Same source + same outbound flights on the same dates: keep the cheapest.
export function dedupe(rows) {
  const best = new Map();
  for (const r of [...rows].sort((a, b) => a.price_cmp - b.price_cmp)) {
    const k = JSON.stringify([r.source, r.search_out, r.search_ret, r.flights, r.return_depart]);
    if (!best.has(k)) best.set(k, r);
  }
  return [...best.values()];
}

// run_search's ending: converted, deduped, kept to the arrival window, then sorted by price, then duration.
export async function rank(rows, currency, window = null) {
  await convert(rows, currency);
  rows = dedupe(rows);
  if (window) rows = rows.filter((r) => arrivesWithin(r, window));
  return rows.sort((a, b) => a.price_cmp - b.price_cmp || (a.duration || 1e6) - (b.duration || 1e6));
}
