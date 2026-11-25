// Airport names: airports.json holds large and medium airports with scheduled service
// (OurAirports, public domain). A field only ever shows its chosen code; names are typed
// into the finder that drops down from it (AirportBlank.jsx), so the sentence never reflows.
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();   // "montreal" finds Montréal
let AIRPORTS = [];

// Resolves true once the list is in, or false if it failed: without the list, three-letter codes still work.
export const airportsLoaded = fetch("airports.json")
  .then((r) => r.json())
  .then((a) => {
    AIRPORTS = a.map((x) => ({ ...x, ft: fold(x.t), fn: fold(x.n), fk: fold(x.k) }));
    return true;
  })
  .catch(() => false);

// Up to eight airports for what was typed: an exact code, then cities, codes and names that start with it,
// then names and cities that contain it, then countries.
export function airportsFor(q) {
  const k = fold(q.trim());
  if (!k) return [];
  const c = (a) => a.c.toLowerCase();
  const rank = (a) => (c(a) === k ? 0 : a.ft.startsWith(k) ? 1 : c(a).startsWith(k) ? 2 : a.fn.startsWith(k) ? 3
    : a.fn.includes(k) || a.ft.includes(k) ? 4 : a.fk.startsWith(k) ? 5 : 9);
  return AIRPORTS.map((a) => [rank(a), a]).filter(([r]) => r < 9).sort((x, y) => x[0] - y[0]).slice(0, 8).map(([, a]) => a);
}

// The airport a code names, if the list has it.
export const airport = (code) => AIRPORTS.find((a) => a.c === code);

// "AMS" -> "Amsterdam", from the finder's airport list, minus any district: "Helsinki (Vantaa)" -> "Helsinki".
export const city = (code) => (airport(code)?.t || code).replace(/ \(.*\)$/, "");
