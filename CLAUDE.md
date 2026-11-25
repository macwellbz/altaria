# altaria

A self-run flight search with no ranking bias. `search.py` pulls real round-trip fares from two sources:

- **ITA Matrix**, the fare engine airlines and travel agencies price with. It has no sponsored layer, and
  it flags risky or tight connections.
- **Google Flights**, via fast-flights, used as a baseline.

It sorts by price, then duration, and saves every run to `results/`. Duffel was dropped because live
access requires a registered business; the code is in the git history.

## Setup
```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
cd web && npm install && cd ..
./test.sh   # every suite: search, ai, web unit, built site, worker parity; fails without .venv
```

## Web app (Altaria)
Run `.venv/bin/python server.py`, then open http://localhost:8000. It listens on 127.0.0.1 only.
- **Stack:** React and Vite in plain JavaScript (JSX). The Vite project is `web/`, components are in `web/src/` with their logic in plain modules (`helpers.js`, `sentence.js`, `trip.js`), and `npm run build` writes `web/dist/`, which is what `server.py` serves.
- **Google Flights only:** the site always searches Google, because Matrix takes about 30s per date pair. `server.py` still accepts `sources=matrix`, and the CLI keeps both.
- **Search size:** a site search takes up to 100 date pairs (`MAX_SEARCHES` in `server.py`, `MAX_PAIRS` in `worker/index.js`); the CLI has no cap. When a search covers more than one date pair, the page shows the cheapest fare for each (`web/src/Dates.jsx`).
- **Airports:** the airport fields open a finder that searches `web/public/airports.json` (OurAirports, public domain) by city, name or code. A code missing from the list can still be typed. Each side takes up to 4 airports (`MAX_AIRPORTS` in `search.py` and `web/src/flights.js`), sent joined by commas (`to=EDI,GLA`). One Google request covers them all, and a return lookup keeps every airport, as the outbound's price did.
- **Endpoints:** `server.py` serves `web/dist/` and streams `/api/search` runs as Server-Sent Events. Each site search is saved to `results/` like a CLI run, and `/api/example` feeds the hero's fare pass and the ranking board from the newest one (`row`, plus up to five `rows`).
- **Trip reader:** `GET /api/ai` says whether a model is set up, without calling it. `POST /api/ai/trip` with `{"text", "today"}` has the model fill the form's blanks from a trip in plain English; `ai.py` checks each value against `airports.json`, the form's `CURRENCIES` (read from `web/src/`) and the calendar, and the model never sees a fare. Only this page or `npm run dev` may post, one call at a time.
- **Trip box:** with a model available, a field above the search sentence takes the trip in plain words, fills the blanks the answer settles (marked until edited or searched), says what it filled and what's still open, and never searches by itself. With no model, the box isn't on the page.
- **AI settings:** `ALTARIA_AI` is `ollama` (a local server on port 11434), `claude` (the Claude Code CLI on the user's own subscription, with no tools, in an empty temp folder) or `off`. Unset tries Ollama, then `claude` on PATH. `ALTARIA_AI_MODEL` names the model for either. Restart the server after changing them.
- **Reloading:** after editing `web/src/`, run `npm run build` in `web/` and reload (files are sent with `Cache-Control: no-cache`). Or run `npm run dev` in `web/` for live reloads at http://localhost:5173, which passes `/api` to the server on 8000. Changes to `search.py` or `server.py` need a server restart.
- **Sky stills:** the hero shows a still of the clouds (`web/public/sky/`) until the live ones have drawn. After changing `web/src/vantaSky.js` or its colours, run `npm run build`, then `.venv/bin/python posters.py`, then build again. It needs a GPU.
- **Currencies:** only the 30 that api.frankfurter.dev converts will work. Matrix quotes in CAD here, so any other code makes a CLI Matrix run fail mid-search. The page's currency dropdown lists exactly those 30.
- **Tests:** `npm test` in `web/` runs the unit tests in `web/test/` (Node's own runner, no dependencies) on the page's plain modules. `.venv/bin/python tests/test_site.py` drives the built site in headless Chromium against `server.py` in-process: searches replay `tests/test_site_run.json` (the first rows of a real run), the model is a stand-in, and nothing is written to `results/`. Build first.
- **Checking the site:** run `npm run build`, then serve in-process on a free port with `ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)` and drive it with Playwright. Port 8000 is usually the user's own server, and OrbStack holds 8001.
- **Public site (`worker/`):** a Cloudflare Worker on the free plan, live at https://altaria.macwell.workers.dev. It serves `web/dist/` and the same API in JavaScript, Google only: `web/src/flights.js` ports search.py's Google side and `worker/ai.js` ports ai.py's checks with Gemini reading (`GEMINI_API_KEY` secret). The free plan allows 10ms of CPU and 50 subrequests a request, so its `/api/search` only checks the query and answers a plan with `drive: true`, and the page runs it (`web/src/drive.js`) through `/api/google`, one Google request per call. A Durable Object (`Caps`) counts Google requests (4,000) and Gemini readings (400) per UTC day. A search never shows saved fares in place of its own: once the day's Google requests are used up, it says so. Its `/api/example` answers null, so the fare pass and board show the visitor's own last search, kept in their browser by `web/src/example.js`. Build `web/` first, then `cd worker && npx wrangler@4 dev` (http://localhost:8787), or `npx wrangler@4 deploy` from `worker/` to publish.
- **Design work:** send it to the `site-builder` agent, whose brief is in `.claude/agents/site-builder.md`. It only loads when Claude is started from this folder. Run one agent on `web/` at a time, since two agents editing the same files overwrite each other.

## Claude's job here
The user describes a trip in plain English. Claude turns it into one or more `search.py` calls and
reports what comes back.

- Expand what the user said: date windows (`--out A..B`), nearby airports (one search takes several
  a side, joined by commas: `--from YYZ,BUF`, `--to VNO,KUN,RIX`), arrival windows that cross midnight (`--arrive-between`),
  and a cap on stops per leg (`--max-stops 0|1|2`).
- **Only cite prices and flights that appear in `search.py` output.** Never estimate or remember a fare.
- Ideas that come from web search (split tickets on Ryanair or Wizz via WAW/RIX/KUN, positioning
  flights, or buses such as Riga to Vilnius) are labelled **unverified: check on the airline's site**,
  and the self-transfer risk is stated: if the first flight is late, a missed connection on a separate
  ticket is the traveller's problem.
- Surface Matrix `warnings` (RISKY_CONNECTION, TIGHT_CONNECTION, CHANGE_OF_AIRPORT) next to any fare
  you recommend.
- Point out long layovers (compare `duration` with a direct-ish itinerary) and arrivals that land
  very close to the deadline.
- Before the user books, tell them to confirm the top result on the operating airline's own site.

## Known gaps
- Google lists only outbound flights until one is chosen, though each is already priced as the whole
  round trip. So a search lists every date pair's outbounds first, five pairs at a time, then
  `add_return` chooses the outbound of each of the 25 cheapest fares (a protobuf field fast-flights
  doesn't model) and takes the cheapest, then shortest, return. The other fares, and any whose lookup
  fails, keep their return date with the return fields `null`. About 1 Google page in 40 comes back
  without results, so every failed request is asked once more before it counts as failed.
- `norm_google` reads Google's private JSON by position, so it will break when Google changes that
  format. `tests/test_search.py` uses a real saved payload.
- Matrix has no API. `matrix()` drives the real page in headless Chromium, because each search needs a
  Google BotGuard token. It rewrites the outgoing `/v1/search` request, takes about 30s per date pair,
  and will break if the page's form labels change.
- Matrix lists marketing flight numbers (AC9104) while Google lists operating ones (LH471), so the
  same flight can appear under two numbers.
- A Google row whose return was looked up links to Google's booking page for its exact outbound and
  return. Other rows, Matrix fares included, link to the Google search for that route and dates. Matrix can't sell
  tickets, and its result links run no search when opened in a fresh browser.

## Example: Toronto → Vilnius over New Year's
```
.venv/bin/python search.py --from YYZ --to VNO --out 2026-12-28..2026-12-30 \
  --ret 2027-01-10..2027-01-15 --arrive-between 2026-12-30,2026-12-31 --source both
```
