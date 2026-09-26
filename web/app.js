// Altaria AI front end: hero scroll, search form, SSE progress, results. No framework.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const DAYS = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
const SOURCE = { matrix: "ITA Matrix", google: "Google Flights" };
const SECONDS = { matrix: 30, google: 4 };

// "2026-12-29" -> "Dec 29"; with weekday -> "Tue Dec 29". Parsed by hand: these are local airport times.
const day = (iso, weekday) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${weekday ? DAYS[new Date(y, m - 1, d).getDay()] + " " : ""}${MONTHS[m - 1]} ${d}`;
};
const time = (iso) => esc(iso.slice(11, 16));
const fmtMin = (m) => (m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "?");
const money = (v) => Math.round(v).toLocaleString("en-US");
const stops = (n) => (n === 0 ? "nonstop" : n === 1 ? "1 stop" : `${n} stops`);

// Matrix's own warning codes, shown as it gives them, with a plain-English label.
const WARN = {
  RISKY_CONNECTION: ["risk", "Risky connection", "Matrix flags this connection as risky, for example a short or cross-terminal transfer."],
  TIGHT_CONNECTION: ["warn", "Tight connection", "Little time to make the connecting flight."],
  CHANGE_OF_AIRPORT: ["warn", "Change of airport", "You must travel to a different airport to connect."],
  OVERNIGHT: ["info", "Overnight", "Includes an overnight flight or layover."],
  LONG_LAYOVER: ["warn", "Long layover", "A long wait between flights."],
};
const badges = (ws = []) =>
  ws.length
    ? `<div class="badges">${ws.map((w) => {
        const [cls, label, tip] = WARN[w] || ["info", w.toLowerCase().replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), w];
        return `<span class="badge ${cls}" title="${esc(tip)} (${esc(w)})">${cls === "info" ? "" : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 5v2.4M6 8.9v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'}${esc(label)}</span>`;
      }).join("")}</div>`
    : "";

/* ---------- hero: the cloud bank parts as you scroll ---------- */
const hero = $(".hero");
let ticking = false;
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const span = Math.max(hero.offsetHeight - innerHeight, innerHeight * 0.6);
    const p = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / span));
    hero.style.setProperty("--p", p.toFixed(4));
  });
};
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  onScroll();
}

/* ---------- hero sample: a real row from the newest saved run ---------- */
fetch("/api/example")
  .then((r) => r.json())
  .then((ex) => {
    const body = $(".sample-body");
    if (!ex) {
      body.innerHTML = `<p class="muted">Your cheapest fare will appear here after your first saved search. This card only ever shows a price a search really returned.</p>`;
      return;
    }
    const r = ex.row, a = { currency: r.currency, ...ex.args };
    const dates = (spec) => {
      const [x, y = x] = spec.split("..");
      return x === y ? day(x) : x.slice(5, 7) === y.slice(5, 7) ? `${day(x)}–${Number(y.slice(8))}` : `${day(x)} – ${day(y)}`;
    };
    const f = ex.file; // 20260926-033057-YYZ-VNO.json
    const saved = `${day(`${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`)} at ${f.slice(9, 11)}:${f.slice(11, 13)}`;
    body.innerHTML = `
      ${a.out && a.ret ? `<p class="asked">${esc(a.orig)} to ${esc(a.dest)}, out ${dates(a.out)}, back ${dates(a.ret)}</p>` : ""}
      <p class="price">${money(r.price_cmp)}<small>${esc(a.currency)} round trip</small></p>
      <p class="route">${esc(r.route.replaceAll("-", " – "))}</p>
      <dl>
        <dt>Leaves</dt><dd>${day(r.depart, true)}, ${time(r.depart)}</dd>
        <dt>Arrives</dt><dd>${day(r.arrive, true)}, ${time(r.arrive)}</dd>
        <dt>Flights</dt><dd>${esc(r.flights)}, ${esc(r.carriers.join(", "))}</dd>
        <dt>Returns</dt><dd>${r.return_depart ? `${day(r.return_depart, true)}, ${time(r.return_depart)}` : day(r.search_ret, true)}</dd>
      </dl>
      ${badges(r.warnings)}
      <p class="fine" title="results/${esc(f)}">The cheapest fare ${esc(SOURCE[r.source])} returned on ${esc(saved)}. Fares change, so search again for today's price.</p>`;
  })
  .catch(() => ($(".sample").hidden = true));

/* ---------- form ---------- */
const form = $("#form");
const val = (id) => $(`#${id}`).value;
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
for (const el of form.querySelectorAll('input[type="date"]')) el.min = today;
const range = (a, b) => (b && b !== a ? `${a}..${b}` : a);
const count = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) + 1 : a ? 1 : 0);

function plan() {
  const outs = count(val("out-from"), val("out-to"));
  const rets = count(val("ret-from"), val("ret-to"));
  const sources = [...form.querySelectorAll('[name="sources"]:checked')].map((c) => c.value);
  return { pairs: outs * rets, sources };
}
function updateEstimate() {
  for (const d of form.querySelectorAll('input[type="date"]')) d.classList.toggle("empty", !d.value);
  const { pairs, sources } = plan();
  const go = $("#go");
  if (pairs < 1 || !sources.length) {
    go.textContent = "Search";
    $("#estimate").textContent = "";
    return;
  }
  const secs = pairs * sources.reduce((s, x) => s + SECONDS[x], 0);
  go.textContent = pairs === 1 ? "Search 1 date pair" : `Search ${pairs} date pairs`;
  const n = pairs * sources.length;
  $("#estimate").textContent = `${n} ${n === 1 ? "search" : "searches"}, about ${secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} seconds` : `${Math.round(secs / 60)} minutes`}.`;
}
form.addEventListener("input", updateEstimate);
for (const id of ["from", "to", "currency"]) $(`#${id}`).addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")));
$("#swap").addEventListener("click", () => ([$("#from").value, $("#to").value] = [val("to"), val("from")]));

function check() {
  const code = /^[A-Z]{3}$/;
  if (!code.test(val("from")) || !code.test(val("to"))) return ["from", "Enter both airports as three-letter codes, like YYZ and VNO."];
  if (val("from") === val("to")) return ["to", "Origin and destination are the same airport."];
  if (!val("out-from")) return ["out-from", "Choose the earliest date you could leave."];
  if (!val("ret-from")) return ["ret-from", "Choose the earliest date you could come back."];
  if (val("out-to") && val("out-to") < val("out-from")) return ["out-to", "The latest leaving date is before the earliest."];
  if (val("ret-to") && val("ret-to") < val("ret-from")) return ["ret-to", "The latest return date is before the earliest."];
  if (val("ret-from") < val("out-from")) return ["ret-from", "The return starts before you leave."];
  if (val("arr-to") && val("arr-from") && val("arr-to") < val("arr-from")) return ["arr-to", "The arrival window ends before it starts."];
  if (!plan().sources.length) return [null, "Pick at least one source."];
  if (!code.test(val("currency"))) return ["currency", "Currency is a three-letter code, like CAD."];
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
const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
let active = null; // { stop } for the search in flight

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const bad = check();
  if (bad) return showError(bad[1], bad[0]);
  showError("");
  const arrive = val("arr-from") || val("arr-to") ? `${val("arr-from") || val("arr-to")},${val("arr-to") || val("arr-from")}` : "";
  const sources = plan().sources;
  const q = new URLSearchParams({
    from: val("from"), to: val("to"), currency: val("currency"),
    out: range(val("out-from"), val("out-to")), ret: range(val("ret-from"), val("ret-to")),
    sources: sources.join(","),
  });
  if (arrive) q.set("arrive", arrive);
  // Echo the composer's sentence back as the user's turn.
  const when = (a, b) => (b && b !== a ? `${day(a, true)}, flexible until ${day(b, true)}` : day(a, true));
  const said = `Fly me from ${val("from")} to ${val("to")}, leaving ${when(val("out-from"), val("out-to"))}, coming back ${when(val("ret-from"), val("ret-to"))}.` +
    (arrive ? ` Only flights landing between ${day(arrive.slice(0, 10))} and ${day(arrive.slice(11))}.` : "") +
    ` Ask ${sources.map((x) => SOURCE[x]).join(" and ")}.`;
  converse(q, said, { from: val("from"), to: val("to"), arrive });
});

function converse(q, said, trip) {
  if (active) active.stop("I stopped the previous search to start this one.");
  thread.insertAdjacentHTML("beforeend", `<article class="msg user"><div class="body"><p>${esc(said)}</p></div></article>`);
  thread.insertAdjacentHTML("beforeend", `
    <article class="msg agent">
      <svg class="avatar" aria-hidden="true"><use href="#mark"/></svg>
      <div class="body">
        <div class="status-row"><p class="status" role="status">Starting…</p><button type="button" class="ghost stop">Stop</button></div>
        <div class="bar" role="progressbar" aria-label="Search progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
        <ol class="tasks"></ol>
        <div class="answer"></div>
      </div>
    </article>`);
  const turn = thread.lastElementChild;
  const status = $(".status", turn);
  const bar = $(".bar", turn);
  const tasks = $(".tasks", turn);
  const setBar = (pct) => { bar.setAttribute("aria-valuenow", Math.round(pct)); bar.firstElementChild.style.width = `${pct}%`; };
  const started = Date.now();
  const elapsed = () => {
    const s = Math.round((Date.now() - started) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  };
  let meta = null, done = 0, total = 0, clock = null;
  const tick = () => { if (total) { setBar((done / total) * 100); status.textContent = `Humming along: ${done} of ${total} ${total === 1 ? "search" : "searches"} done, ${elapsed()} so far.`; } };

  const es = new EventSource(`/api/search?${q}`);
  const end = () => { es.close(); clearInterval(clock); $(".stop", turn)?.remove(); active = null; $("#go").disabled = false; };
  const stop = (why) => {
    end(); bar.remove(); status.textContent = why;
    for (const li of tasks.querySelectorAll('[data-s="pending"], [data-s="searching"]')) { li.dataset.s = "stopped"; $("span", li).textContent = "stopped"; }
  };
  active = { stop };
  $("#go").disabled = true;
  $(".stop", turn).addEventListener("click", () => stop("Stopped. I'm not showing partial results, since a stopped search may have missed the cheapest fare."));
  turn.previousElementSibling.scrollIntoView({ behavior: smooth(), block: "start" });

  es.addEventListener("wait", () => (status.textContent = "Waiting for the previous search to stop…"));

  es.addEventListener("plan", (e) => {
    meta = JSON.parse(e.data);
    total = meta.pairs.length * meta.sources.length;
    tasks.innerHTML = meta.pairs
      .flatMap(([o, r]) => meta.sources.map((s) =>
        `<li data-k="${s}|${o}|${r}" data-s="pending"><b>${day(o)} – ${day(r)}</b> ${SOURCE[s]} <span>waiting</span></li>`))
      .join("");
    clock = setInterval(tick, 1000);
    tick();
  });

  es.addEventListener("progress", (e) => {
    const p = JSON.parse(e.data);
    const li = $(`[data-k="${p.src}|${p.out}|${p.ret}"]`, tasks);
    if (!li) return;
    li.dataset.s = p.status;
    const span = $("span", li);
    if (p.status === "searching") span.textContent = "asking…";
    else if (p.status === "failed") { span.textContent = "failed"; li.title = p.error; done++; }
    else { span.textContent = `${p.count} ${p.count === 1 ? "fare" : "fares"}`; done++; }
    tick();
  });

  es.addEventListener("result", (e) => {
    const { rows } = JSON.parse(e.data);
    end();
    bar.remove();
    const failed = tasks.querySelectorAll('[data-s="failed"]').length;
    status.textContent = `Done in ${elapsed()}. ` + (total === 1 ? (failed ? "The search failed." : "The search came back.")
      : `${total - failed} of ${total} searches came back` + (failed ? `; ${failed} failed (hover a red date pair to see why).` : "."));
    render($(".answer", turn), rows, meta, trip);
  });

  es.addEventListener("fail", (e) => {
    stop(JSON.parse(e.data).message);
    tasks.remove();
  });

  es.onerror = () => { if (active && active.stop === stop) stop("The connection to the local server dropped. Check that server.py is still running, then ask again."); };
}

/* ---------- the answer ---------- */
const TOP = 25;

// Plain-English findings, built only from returned rows: nothing here is estimated.
function brief(rows, cur) {
  const fare = (r) => `${money(r.price_cmp)} ${cur}`;
  const what = (r) => `${SOURCE[r.source]}, ${r.flights} via ${r.route.split("-").slice(1, -1).join(" and ") || "nonstop"}, leaving ${day(r.depart, true)} at ${time(r.depart)} and taking ${fmtMin(r.duration)}`;
  const best = rows[0];
  const lines = [`The cheapest is <strong>${fare(best)}</strong> on ${esc(what(best))}.`];
  if (best.warnings?.length) {
    lines.push(`Matrix flags it: ${best.warnings.map((w) => (WARN[w]?.[1] || w).toLowerCase()).join(", ")}.`);
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
    box.innerHTML = `<p><strong>No fares came back.</strong> Try a wider date range${trip.arrive ? ", or clear the arrival window" : ""}. A red date pair above means that search failed, not that it found nothing.</p>`;
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
      <p class="muted">Across ${pairs} date ${pairs === 1 ? "pair" : "pairs"}. Prices are for the whole round trip in ${esc(cur)}; ties go to the shorter flight.${list.length < rows.length ? " Fares that differ only by return date share a row." : ""}${rows.some((r) => r.source === "google") ? " Google details the outbound flights only, so its return shows just the date." : ""}${trip.arrive ? ` Only outbound flights landing ${day(trip.arrive.slice(0, 10))} to ${day(trip.arrive.slice(11))}.` : ""}</p>
      <div class="table-scroll">
        <table class="fares-table">
          <thead><tr><th scope="col">Price and source</th><th scope="col">Outbound</th><th scope="col">Route and flights</th><th scope="col">Return</th>${warnCol ? '<th scope="col">Matrix warnings</th>' : ""}</tr></thead>
          <tbody>${html(list.slice(0, TOP), true)}</tbody>
        </table>
      </div>
      ${list.length > TOP ? `<button type="button" class="ghost more">Show all ${list.length} rows</button>` : ""}
    </section>
    <p class="again"><a href="#form">Ask again with different dates</a></p>`;
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
    <td class="c-route" data-label="Route"><div class="route">${esc(r.route.replaceAll("-", " – "))}</div><div class="sub">${esc(r.flights)}, ${esc(r.carriers.join(", "))}</div></td>
    <td class="c-ret" data-label="Return">${retText}</td>
    ${warnCol ? `<td class="c-warn">${badges(r.warnings)}</td>` : ""}
  </tr>`;
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

updateEstimate();
