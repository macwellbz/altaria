// Altaria AI front end: hero scroll, fare pass, search sentence, SSE progress, results. No framework.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const DAYS = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const SOURCE = { matrix: "ITA Matrix", google: "Google Flights" };
const SHORT = { matrix: "Matrix", google: "Google" };
const SECONDS = { matrix: 30, google: 4 };
const STOPS = { "": "any number of stops", 0: "no stops", 1: "at most 1 stop", 2: "at most 2 stops" };   // "with ___ each way"
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// "2026-12-29" -> "Dec 29"; with weekday -> "Tue Dec 29". Parsed by hand: these are local airport times.
const day = (iso, weekday) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${weekday ? DAYS[new Date(y, m - 1, d).getDay()] + " " : ""}${MONTHS[m - 1]} ${d}`;
};
const time = (iso) => esc(iso.slice(11, 16));
const fmtMin = (m) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "?");
const money = (v) => Math.round(v).toLocaleString("en-US");
const stops = (n) => (n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`);

// Matrix's own warning codes, labelled in Matrix's own words (from its UI). They cover the flights out and back together.
// Tight and risky are different: tight is about the time to change planes, risky about the cost of missing it.
const WARN = {
  RISKY_CONNECTION: ["risk", "Risky connection", "ITA Matrix: a connection that can be very inconvenient when missed."],
  TIGHT_CONNECTION: ["warn", "Tight connection", "Little time to change planes."],
  CHANGE_OF_AIRPORT_SLICE: ["warn", "Change of airport", "You change airports to make a connection."],
  CHANGE_OF_AIRPORT: ["warn", "Change of airport", "You change airports to make a connection."],
  CHANGE_OF_TERMINAL: ["warn", "Change of terminal", "You change terminals to make a connection."],
  LONG_LAYOVER: ["warn", "Long layover", "A long wait between flights."],
  OVERNIGHT: ["info", "Overnight flight", "Part of the trip flies overnight."],
  PROP_PLANE: ["info", "Propeller plane", "At least one flight is on a propeller plane."],
  NON_PREFERRED_CABIN: ["info", "Preferred class unavailable", "Part of the trip isn't in the cabin you asked for."],
};
const badges = (ws = []) =>
  ws.length
    ? `<div class="badges">${ws.map((w) => {
        const [cls, label, tip] = WARN[w] || ["info", w.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), w];
        return `<span class="badge ${cls}" title="${esc(tip)} (${esc(w)})">${cls === "info" ? "" : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2.4M6 8.9v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'}${esc(label)}</span>`;
      }).join("")}</div>`
    : "";

// A price rolls into place a column at a time, like a departure board. Screen readers get the plain number.
function roll(el, text) {
  if (still()) { el.textContent = text; return; }
  const strip = "0123456789".repeat(2).split("").map((d) => `<span>${d}</span>`).join("");
  el.innerHTML = `<span class="vh">${esc(text)}</span><span class="digits" aria-hidden="true">${[...text]
    .map((c) => (/\d/.test(c) ? `<span class="col" data-d="${c}"><span>${strip}</span></span>` : `<span>${esc(c)}</span>`)).join("")}</span>`;
  const cols = $$(".col > span", el);
  requestAnimationFrame(() => requestAnimationFrame(() => cols.forEach((s, i) => {
    s.style.transitionDelay = `${i * 70}ms`;
    s.style.transform = `translateY(-${10 + Number(s.parentElement.dataset.d)}em)`;
  })));
  setTimeout(() => (el.textContent = text), 1300 + cols.length * 70);   // then plain text again, so copying gets the number
}

/* ---------- hero: the scroll scene and the header ---------- */
const hero = $(".hero");
const nav = $("#nav");
const scene = matchMedia("(min-width: 900px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)");
let ticking = false;
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const span = Math.max(1, hero.offsetHeight - innerHeight);
    const p = scene.matches ? Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / span)) : 0;
    hero.style.setProperty("--p", p.toFixed(4));
    // over the sky the header is bare; once page content can pass beneath it, it gets a backing
    nav.classList.toggle("solid", scene.matches ? scrollY > hero.offsetHeight - innerHeight : scrollY > 24);
  });
};
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
scene.addEventListener("change", onScroll);
onScroll();

/* ---------- the fare pass: the cheapest row of the newest saved run ---------- */
const pass = $(".pass");
fetch("/api/example")
  .then((r) => r.json())
  .then((ex) => {
    const top = $(".pass-top"), stub = $(".pass-stub");
    if (!ex) {
      $(".pass-wait").textContent = "Your cheapest fare will appear here after your first saved search. This card only ever shows a price a search really returned.";
      return;
    }
    const r = ex.row, a = { currency: r.currency, ...ex.args };
    const dates = (spec) => {
      const [x, y = x] = spec.split("..");
      return x === y ? day(x) : x.slice(5, 7) === y.slice(5, 7) ? `${day(x)}–${Number(y.slice(8))}` : `${day(x)} – ${day(y)}`;
    };
    const f = ex.file; // 20260926-033057-YYZ-VNO.json
    const saved = `${day(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`)} at ${f.slice(9, 11)}:${f.slice(11, 13)}`;
    const legs = r.route.split("-");
    const later = (a, b) => (b.slice(0, 10) !== a.slice(0, 10) ? ` ${day(b)}` : "");
    top.innerHTML = `
      <h2 id="pass-title">From your last saved search</h2>
      ${a.out && a.ret ? `<p class="asked">${esc(a.orig)} to ${esc(a.dest)}, out ${dates(a.out)}, back ${dates(a.ret)}</p>` : ""}
      <p class="legs"><span>${esc(legs[0])}</span><span class="hop"><span>${legs.length > 2 ? `via ${esc(legs.slice(1, -1).join(", "))}` : "nonstop"}</span></span><span>${esc(legs.at(-1))}</span></p>
      <dl>
        <dt>Out</dt><dd>${day(r.depart, true)}, ${time(r.depart)} to ${time(r.arrive)}${later(r.depart, r.arrive)}</dd>
        <dt>Back</dt><dd>${r.return_depart ? `${day(r.return_depart, true)}, ${time(r.return_depart)}` : day(r.search_ret, true)}</dd>
        <dt>Flights</dt><dd>${esc(r.flights)}, ${esc(r.carriers.join(", "))}</dd>
      </dl>`;
    stub.innerHTML = `
      <p class="fare-big"><span class="n"></span><small>${esc(a.currency)} round trip on ${esc(SOURCE[r.source])}</small></p>
      ${badges(r.warnings)}
      <p class="fine" title="results/${esc(f)}">The cheapest fare it returned on ${esc(saved)}. Fares change, so search again for today's price.</p>`;
    stub.hidden = false;
    setTimeout(() => roll($(".n", stub), money(r.price_cmp)), still() ? 0 : 900);
  })
  .catch(() => (pass.hidden = true));


/* ---------- the sentence ---------- */
const form = $("#form");
const val = (id) => $(`#${id}`).value;
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const range = (a, b) => (b && b !== a ? `${a}..${b}` : a);
const count = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) + 1 : a ? 1 : 0);

// Each blank shows a readable value; empty optional dates are a bare line to fill in.
function syncBlanks() {
  for (const input of $$(".code input")) input.parentElement.dataset.v = input.value || input.placeholder;
  for (const input of $$('.date input')) {
    const blank = input.parentElement;
    blank.classList.toggle("empty", !input.value);
    // an empty optional date is a bare line; the no-break space gives it a line's height, so it can be clicked
    $(".shown", blank).textContent = input.value ? day(input.value, true) : blank.classList.contains("opt") ? "\u00a0" : "pick a date";
  }
  for (const s of $$(".pick select")) $(".shown", s.parentElement).textContent = s.id === "stops" ? STOPS[s.value] : s.value;
  $(".dest").textContent = /^[A-Z]{3}$/.test(val("to")) ? ` in ${val("to")}` : "";
  // each range's second date starts at its first, so no range can be picked backwards
  const floor = { "out-from": today, "out-to": val("out-from"), "arr-from": val("out-from"), "arr-to": val("arr-from") || val("out-from"),
                  "ret-from": val("out-from"), "ret-to": val("ret-from") || val("out-from") };
  // only when it changes: rewriting min mid-typing resets the date field's half-typed segment
  for (const [id, min] of Object.entries(floor)) if ($(`#${id}`).min !== (min || today)) $(`#${id}`).min = min || today;
}
// Keyboard users see the native date editor while it has focus; pointer users see the readable date.
addEventListener("keydown", (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) document.documentElement.classList.add("kbd"); });
addEventListener("pointerdown", () => document.documentElement.classList.remove("kbd"));

function plan() {
  const outs = count(val("out-from"), val("out-to"));
  const rets = count(val("ret-from"), val("ret-to"));
  const sources = $$('[name="sources"]:checked', form).map((c) => c.value);
  return { pairs: outs * rets, sources };
}
function updateEstimate() {
  syncBlanks();
  const { pairs, sources } = plan();
  const label = $("#go .roll");
  if (pairs < 1 || !sources.length) {
    label.textContent = "Search";
    $("#estimate").textContent = "";
    return;
  }
  const secs = pairs * sources.reduce((s, x) => s + SECONDS[x], 0);
  label.textContent = pairs === 1 ? "Search 1 date pair" : `Search ${pairs} date pairs`;
  const n = pairs * sources.length;
  $("#estimate").textContent = `${n} ${n === 1 ? "search" : "searches"}, about ${secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} seconds` : `${Math.round(secs / 60)} minutes`}.`;
}
form.addEventListener("input", updateEstimate);
form.addEventListener("change", updateEstimate);
for (const id of ["from", "to"]) $(`#${id}`).addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")));
$("#swap").addEventListener("click", () => {
  [$("#from").value, $("#to").value] = [val("to"), val("from")];
  updateEstimate();
});
// Chromium only opens the calendar from its icon; open it from anywhere on the blank.
for (const el of $$(".date input")) el.addEventListener("click", () => { try { el.showPicker(); } catch (e) {} });

function check() {
  const code = /^[A-Z]{3}$/;
  if (!code.test(val("from")) || !code.test(val("to"))) return ["from", "Enter both airports as three-letter codes, like YYZ and VNO."];
  if (val("from") === val("to")) return ["to", "Origin and destination are the same airport."];
  if (!val("out-from")) return ["out-from", "Choose the first day you could leave."];
  if (!val("ret-from")) return ["ret-from", "Choose the first day you could come back."];
  if (val("out-to") && val("out-to") < val("out-from")) return ["out-to", "The leaving dates run backwards: the second is before the first."];
  if (val("ret-to") && val("ret-to") < val("ret-from")) return ["ret-to", "The return dates run backwards: the second is before the first."];
  if (val("ret-from") < val("out-from")) return ["ret-from", "The return starts before you leave."];
  if (val("arr-to") && val("arr-from") && val("arr-to") < val("arr-from")) return ["arr-to", "The arrival dates run backwards: the second is before the first."];
  if (!plan().sources.length) return [null, "Pick at least one source."];
  return null;
}
function showError(msg, id) {
  const box = $("#form-error");
  box.textContent = msg;
  box.hidden = !msg;
  if (id) $(`#${id}`).focus();
}

/* ---------- the conversation: each search is a user turn plus an agent turn ---------- */
const thread = $("#thread");
const smooth = () => (still() ? "auto" : "smooth");
let active = null; // { stop } for the search in flight

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const bad = check();
  if (bad) return showError(bad[1], bad[0]);
  showError("");
  const arrive = val("arr-from") || val("arr-to") ? `${val("arr-from")},${val("arr-to")}` : "";   // either side may be open
  const sources = plan().sources;
  const q = new URLSearchParams({
    from: val("from"), to: val("to"), currency: val("currency"),
    out: range(val("out-from"), val("out-to")), ret: range(val("ret-from"), val("ret-to")),
    sources: sources.join(","),
  });
  if (arrive) q.set("arrive", arrive);
  if (val("stops")) q.set("stops", val("stops"));
  // Echo the sentence back as the user's turn.
  const when = (a, b) => (b && b !== a ? `between ${day(a, true)} and ${day(b, true)}` : `on ${day(a, true)}`);
  const said = `Fly me from ${val("from")} to ${val("to")}${val("stops") ? ` with ${STOPS[val("stops")]} each way` : ""}.` +
    ` Leave ${when(val("out-from"), val("out-to"))}.` +
    (arrive ? ` Arrive in ${val("to")} ${landing(arrive, true)} on the flight out.` : "") +
    ` Come back ${when(val("ret-from"), val("ret-to"))}.` +
    ` Ask ${sources.map((x) => SOURCE[x]).join(" and ")}, with prices in ${val("currency")}.`;
  converse(q, said, { from: val("from"), to: val("to"), arrive, stops: val("stops") });
});

function converse(q, said, trip) {
  if (active) active.stop("I stopped the previous search to start this one.");
  thread.insertAdjacentHTML("beforeend", `<article class="msg user"><div class="body"><p>${esc(said)}</p></div></article>`);
  thread.insertAdjacentHTML("beforeend", `
    <article class="msg agent">
      <svg class="avatar" aria-hidden="true"><use href="#mark"/></svg>
      <div class="body">
        <div class="status-row"><p class="status" role="status">Starting…</p><button type="button" class="ghost stop">Stop</button></div>
        <div class="rail" role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
        <ul class="tasks" aria-label="Searches by date pair"></ul>
        <div class="answer"></div>
      </div>
    </article>`);
  const turn = thread.lastElementChild;
  const status = $(".status", turn);
  const rail = $(".rail", turn);
  const tasks = $(".tasks", turn);
  const started = Date.now();
  const elapsed = () => {
    const s = Math.round((Date.now() - started) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  };
  let meta = null, done = 0, total = 0, clock = null;
  const tick = () => {
    if (!total) return;
    rail.setAttribute("aria-valuenow", Math.round((done / total) * 100));
    status.textContent = `Humming along: ${done} of ${total} ${total === 1 ? "search" : "searches"} done, ${elapsed()} so far.`;
  };
  // one rail segment and one status per search, keyed "source|out|ret"
  const mark = (k, s, text) => {
    const seg = $(`i[data-k="${k}"]`, rail), st = $(`.s[data-k="${k}"]`, tasks);
    if (seg) seg.dataset.s = s;
    if (st) { st.dataset.s = s; $("i", st).textContent = text; }
    return st;
  };

  const es = new EventSource(`/api/search?${q}`);
  const end = () => { es.close(); clearInterval(clock); $(".stop", turn)?.remove(); active = null; $("#go").disabled = false; };
  const failures = () => {
    const failed = $$('.s[data-s="failed"]', tasks);
    if (failed.length) tasks.insertAdjacentHTML("afterend", `<details class="failures"><summary>Why ${failed.length === 1 ? "one search" : `${failed.length} searches`} failed</summary><ul>${failed
      .map((s) => `<li>${esc(s.closest("li").querySelector("b").textContent)}, ${esc(SOURCE[s.dataset.k.split("|")[0]])}: ${esc(s.title)}</li>`).join("")}</ul></details>`);
    return failed.length;
  };
  const stop = (why) => {
    end();
    rail.remove();
    status.textContent = why;
    for (const s of $$('[data-s="pending"], [data-s="searching"]', tasks)) mark(s.dataset.k, "stopped", "stopped");
    failures();
  };
  active = { stop };
  $("#go").disabled = true;
  $(".stop", turn).addEventListener("click", () => stop("Stopped. I'm not showing partial results, since a stopped search may have missed the cheapest fare."));
  turn.previousElementSibling.scrollIntoView({ behavior: smooth(), block: "start" });

  es.addEventListener("wait", () => (status.textContent = "Waiting for the previous search to stop…"));

  es.addEventListener("plan", (e) => {
    meta = JSON.parse(e.data);
    total = meta.pairs.length * meta.sources.length;
    const keys = meta.pairs.flatMap(([o, r]) => meta.sources.map((s) => `${s}|${o}|${r}`));
    rail.innerHTML = keys.map((k) => `<i data-k="${k}" data-s="pending"></i>`).join("");
    tasks.innerHTML = meta.pairs.map(([o, r]) => `<li><b>${day(o)} – ${day(r)}</b>${meta.sources
      .map((s) => `<span class="s" data-k="${s}|${o}|${r}" data-s="pending">${SHORT[s]} <i>waiting</i></span>`).join("")}</li>`).join("");
    clock = setInterval(tick, 1000);
    tick();
  });

  es.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    const k = `${p.src}|${p.out}|${p.ret}`;
    if (p.status === "searching") mark(k, "searching", "asking…");
    else if (p.status === "failed") { const st = mark(k, "failed", "failed"); if (st) st.title = p.error; done++; }
    else { mark(k, "done", `${p.count} ${p.count === 1 ? "fare" : "fares"}`); done++; }
    tick();
  });

  es.addEventListener("result", (e) => {
    const { rows } = JSON.parse(e.data);
    end();
    rail.remove();
    const failed = failures();
    status.textContent = `Done in ${elapsed()}. ` + (total === 1 ? (failed ? "The search failed." : "The search came back.")
      : `${total - failed} of ${total} searches came back` + (failed ? `; ${failed} failed.` : "."));
    render($(".answer", turn), rows, meta, trip);
  });

  es.addEventListener("fail", (e) => {
    stop(JSON.parse(e.data).message);
    tasks.remove();
  });

  es.onerror = () => { if (active && active.stop === stop) stop("The connection to the local server dropped. Check that server.py is still running, then ask again."); };
}

// "2026-12-30,2026-12-31" -> "Dec 30 to Dec 31"; open bounds read "by Dec 31" or "Dec 30 or later".
function landing(arrive, weekday) {
  const [a, b] = arrive.split(",");
  return a && b ? (a === b ? `on ${day(a, weekday)}` : `between ${day(a, weekday)} and ${day(b, weekday)}`) : a ? `on ${day(a, weekday)} or later` : `by ${day(b, weekday)}`;
}

/* ---------- the answer ---------- */
const TOP = 25;

// Plain-English findings, built only from returned rows: nothing here is estimated.
function brief(rows, cur) {
  const fare = (r) => `${money(r.price_cmp)} ${cur}`;
  const what = (r) => `${SOURCE[r.source]}, ${r.flights} via ${r.route.split("-").slice(1, -1).join(" and ") || "nonstop"}, leaving ${day(r.depart, true)} at ${time(r.depart)} and taking ${fmtMin(r.duration)}`;
  const best = rows[0];
  const lines = [`The cheapest is <strong><span class="n">${money(best.price_cmp)}</span> ${esc(cur)}</strong> on ${esc(what(best))}.`];
  if (best.warnings?.length) {
    const has = (w) => best.warnings.includes(w);
    const why = has("TIGHT_CONNECTION") && has("RISKY_CONNECTION")
      ? " Those are two different things: tight means little time to change planes, risky means Matrix expects missing that connection to be very inconvenient."
      : has("RISKY_CONNECTION") ? " Matrix calls a connection risky when missing it would be very inconvenient."
      : has("TIGHT_CONNECTION") ? " Tight means little time to change planes." : "";
    lines.push(`Matrix flags it: ${best.warnings.map((w) => (WARN[w]?.[1] || w).toLowerCase()).join(", ")}.${why}`);
    const risky = (r) => r.warnings?.some((w) => (WARN[w]?.[0] || "warn") !== "info");
    const clean = risky(best) && rows.find((r) => r.source === "matrix" && !risky(r));
    if (clean) lines.push(`The cheapest Matrix fare without connection warnings is ${fare(clean)} (${esc(clean.flights)}, ${fmtMin(clean.duration)}), ${money(clean.price_cmp - best.price_cmp)} more.`);
  }
  const timed = rows.filter((r) => r.duration);
  const fastest = timed.reduce((a, r) => (r.duration < a.duration ? r : a), timed[0]);
  if (fastest && best.duration && best.duration > fastest.duration * 1.5)
    lines.push(`It's a long trip, though: the quickest outbound takes ${fmtMin(fastest.duration)} (${esc(fastest.flights)}) for ${fare(fastest)}.`);
  else if (fastest && fastest !== best && fastest.price_cmp > best.price_cmp)
    lines.push(`The quickest outbound, ${fmtMin(fastest.duration)} on ${esc(fastest.flights)}, costs ${fare(fastest)}.`);
  lines.push("Confirm the fare on the operating airline's own site before you pay.");
  return lines.map((l) => `<p>${l}</p>`).join("");
}

function render(box, rows, meta, trip) {
  const cur = meta.currency;
  const pairs = meta.pairs.length;
  if (!rows.length) {
    const limit = trip.stops === "0" ? " for nonstop flights" : trip.stops ? ` with ${STOPS[trip.stops]} each way` : "";
    const fix = trip.stops === "0" ? "Allow a stop or two" : trip.stops ? "Allow more stops" : "Try a wider date range";
    box.innerHTML = `<p><strong>No fares came back${limit}.</strong> ${fix}${trip.stops ? ", or try a wider date range" : ""}${trip.arrive ? ", or clear the arrival window" : ""}. A failed search above means that search broke, not that it found nothing.</p>`;
    return;
  }
  // Same outbound at the same price for several return dates becomes one row, as print_table does.
  const groups = new Map();
  for (const r of rows) {
    const k = [r.source, r.search_out, r.flights, r.price_cmp].join("|");
    if (!groups.has(k)) groups.set(k, { r, rets: [] });
    groups.get(k).rets.push(r.search_ret);
  }
  const list = [...groups.values()];
  const warnCol = rows.some((r) => r.warnings?.length);
  const html = (items, first) => items.map(({ r, rets }, i) => fareRow(r, rets, cur, first && i === 0, warnCol)).join("");
  box.innerHTML = `
    <div class="brief">${brief(rows, cur)}</div>
    ${meta.sources.length === 2 ? compare(rows, meta.pairs, cur) : ""}
    <section class="block">
      <h3>${rows.length} ${rows.length === 1 ? "fare" : "fares"} from ${esc(trip.from)} to ${esc(trip.to)}, cheapest first</h3>
      <p class="muted">Across ${pairs} date ${pairs === 1 ? "pair" : "pairs"}. Prices are for the whole round trip in ${esc(cur)}; ties go to the shorter flight.${list.length < rows.length ? " Fares that differ only by return date share a row." : ""}${rows.some((r) => r.source === "google") ? " Google details the outbound flights only, so its return shows just the date." : ""}${trip.arrive ? ` Only outbound flights landing ${landing(trip.arrive)}, local time.` : ""}${trip.stops ? ` ${STOPS[trip.stops][0].toUpperCase()}${STOPS[trip.stops].slice(1)} each way.` : ""}${warnCol ? " Matrix's warnings cover the flights out and back together." : ""}${rows.some((r) => r.source === "matrix" && r.link) ? " ITA Matrix can't sell tickets and its links expire, so its fares link to the same search on Google Flights: look for the same flight numbers there." : ""}</p>
      <div class="table-scroll">
        <table class="fares-table">
          <thead><tr><th scope="col">Price and source</th><th scope="col">Outbound</th><th scope="col">Route and flights</th><th scope="col">Return</th>${warnCol ? '<th scope="col">Matrix warnings</th>' : ""}</tr></thead>
          <tbody>${html(list.slice(0, TOP), true)}</tbody>
        </table>
      </div>
      ${list.length > TOP ? `<button type="button" class="ghost more">Show all ${list.length} rows</button>` : ""}
    </section>
    <p class="again"><a href="#form">Ask again with different dates</a></p>`;
  roll($(".brief .n", box), money(rows[0].price_cmp));
  const more = $(".more", box);
  if (more) more.addEventListener("click", () => {
    $("tbody", box.querySelector(".fares-table")).insertAdjacentHTML("beforeend", html(list.slice(TOP), false));
    more.remove();
  });
}

function fareRow(r, rets, cur, top, warnCol) {
  const quoted = r.currency !== cur ? `<div class="quoted">quoted ${esc(r.currency)} ${money(r.price)}</div>` : "";
  const later = (a, b) => (b.slice(0, 10) !== a.slice(0, 10) ? ` ${day(b)}` : "");
  const retText = r.return_depart && rets.length === 1
    ? `<span class="when"><span class="t">${day(r.return_depart, true)}</span>, ${time(r.return_depart)} to ${time(r.return_arrive)}${later(r.return_depart, r.return_arrive)}</span>`
    : `<span class="when">${rets.length === 1 ? day(rets[0], true)
      : rets.map((x, i) => (i && x.slice(5, 7) === rets[i - 1].slice(5, 7) ? Number(x.slice(8)) : day(x))).join(", ")}</span>`;
  return `<tr${top ? ' class="row-top"' : ""}>
    <td class="c-price fare"><div class="price">${money(r.price_cmp)}<small>${esc(cur)}</small></div>${quoted}<span class="src ${esc(r.source)}">${SOURCE[r.source] || esc(r.source)}</span></td>
    <td class="c-out" data-label="Outbound"><span class="when"><span class="t">${day(r.depart, true)}</span>, ${time(r.depart)} to ${time(r.arrive)}${later(r.depart, r.arrive)}</span><div class="sub">${fmtMin(r.duration)}, ${stops(r.stops)}</div></td>
    <td class="c-route" data-label="Route"><div class="route-t">${esc(r.route.replaceAll("-", " – "))}</div><div class="sub">${esc(r.flights)}, ${esc(r.carriers.join(", "))}</div>${bookLink(r)}</td>
    <td class="c-ret" data-label="Return">${retText}</td>
    ${warnCol ? `<td class="c-warn">${badges(r.warnings)}</td>` : ""}
  </tr>`;
}

// Every new row carries a Google Flights link for its route, dates, currency and stops limit. Saved rows from
// before links existed have none, and show nothing. Matrix sells nothing and its links expire, so its fares point
// at the same Google search, where the user finds the itinerary by its flight numbers.
function bookLink(r) {
  if (!/^https:\/\//.test(r.link || "")) return "";
  const a = (label, note) => `<a class="book" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer"${note ? ` title="${esc(note)}"` : ""}>${label} <span aria-hidden="true">↗</span><span class="vh"> (opens in a new tab)</span></a>`;
  return r.source === "matrix"
    ? `${a("Find on Google Flights", "ITA Matrix can't sell tickets and its links expire. This opens the same dates on Google Flights, where the price may differ.")}<div class="sub">Matrix sells no tickets and its links expire. Google's price may differ.</div>`
    : a("View on Google Flights");
}

// Cheapest per date pair on each source, as print_compare does. diff = matrix - google.
function compare(rows, pairs, cur) {
  const diffs = [];
  const body = pairs.map(([o, r]) => {
    const m = {};
    for (const s of ["matrix", "google"]) {
      const ps = rows.filter((x) => x.source === s && x.search_out === o && x.search_ret === r).map((x) => x.price_cmp);
      m[s] = ps.length ? Math.min(...ps) : null;
    }
    const diff = m.matrix !== null && m.google !== null ? m.matrix - m.google : null;
    if (diff !== null) diffs.push(diff);
    const cell = (s, other) => (m[s] === null ? `<td class="num muted">none</td>`
      : `<td class="num${other !== null && m[s] < other ? " win" : ""}">${money(m[s])}</td>`);
    return `<tr><th scope="row">${day(o)} – ${day(r)}</th>${cell("matrix", m.google)}${cell("google", m.matrix)}
      <td class="num">${diff === null ? '<span class="muted">none</span>' : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${money(Math.abs(diff))}`}</td></tr>`;
  }).join("");
  const n = diffs.length;
  const mean = n ? diffs.reduce((a, b) => a + b, 0) / n : 0;
  const summary = n
    ? `Matrix was cheaper in ${diffs.filter((d) => d < 0).length} of ${n} ${n === 1 ? "pair" : "pairs"}, Google in ${diffs.filter((d) => d > 0).length}. On average Matrix came in ${money(Math.abs(mean))} ${esc(cur)} ${mean < 0 ? "lower" : mean > 0 ? "higher" : "the same"}.`
    : "No date pair had fares from both sources, so there's nothing to compare.";
  return `<section class="block">
    <h3>Matrix and Google, date by date</h3>
    <p class="muted">${summary}</p>
    <div class="table-scroll"><table class="cmp">
      <thead><tr><th scope="col">Dates</th><th scope="col" class="num">ITA Matrix</th><th scope="col" class="num">Google Flights</th><th scope="col" class="num">Matrix − Google</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

// Light unless the visitor picked dark; the head script applies a saved choice before first paint.
const themeBtn = $(".theme");
themeBtn.setAttribute("aria-pressed", document.documentElement.dataset.theme === "dark");
themeBtn.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  if (dark) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  themeBtn.setAttribute("aria-pressed", dark);
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (e) {}
});

updateEstimate();
