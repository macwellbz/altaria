import { useRef, useState } from "react";
import Brief from "./Brief.jsx";
import Dates from "./Dates.jsx";
import FareRow from "./FareRow.jsx";
import { DETAIL } from "./drive.js";
import { LONG, STOPS, day, landing, money, waits } from "./helpers.js";
import { scrollToElement } from "./scroll.js";

const TOP = 25;    // rows shown before "Show all"
const ENTER = 5;   // rows that rise in with the brief when results land

// The answer to one search: the brief, the cheapest fare by date when it covered more than one, then every fare,
// cheapest first. A price chosen by date (pick, "out|ret") narrows the fares to its days.
export default function Results({ rows, meta, trip, tasks }) {
  const [all, setAll] = useState(false);
  const [pick, setPick] = useState(null);
  const fares = useRef(null);
  const cur = meta.currency;
  if (!rows.length) {
    const limit = trip.stops === "0" ? " for nonstop flights" : trip.stops ? ` with ${STOPS[trip.stops]} each way` : "";
    const fix = trip.stops === "0" ? "Allow a stop or two" : trip.stops ? "Allow more stops" : "Try a wider date range";
    return <p><strong>{`No fares came back${limit}.`}</strong>{` ${fix}${trip.stops ? ", or try a wider date range" : ""}${trip.arrive ? ", or clear the arrival window" : ""}. A failed search above means that search broke, not that it found nothing.`}</p>;
  }
  // Same outbound at the same price for several return dates becomes one row, as print_table does. A fare whose
  // return wasn't looked up joins the row its outbound and price already have, whichever return that one found.
  const shown = pick ? rows.filter((r) => `${r.search_out}|${r.search_ret}` === pick) : rows;
  const groups = new Map(), first = new Map();
  for (const r of shown) {
    const flown = [r.source, r.search_out, r.flights, r.price_cmp].join("|");
    const k = r.return_flights ? `${flown}|${r.return_flights}` : first.get(flown) ?? flown;
    if (!first.has(flown)) first.set(flown, k);
    if (!groups.has(k)) groups.set(k, { r, rets: [] });
    groups.get(k).rets.push(r.search_ret);
  }
  const list = [...groups.values()];
  list.forEach((g) => g.rets.sort());
  const warnCol = rows.some((r) => r.warnings?.length);
  const note = `Prices are for the whole round trip in ${cur}; ties go to the shorter flight.` +
    (list.length < shown.length ? " Fares that differ only by return date share a row." : "") +
    (!shown.some((r) => !r.return_depart) ? "" : rows.length > DETAIL
      ? ` Return flights are looked up for the ${DETAIL} cheapest fares. A return that shows only a date is past those, or couldn't be found.`
      : " A return that shows only a date couldn't be looked up.") +
    (trip.arrive ? ` Only outbound flights landing ${landing(trip.arrive)}, local time.` : "") +
    (trip.stops ? ` ${STOPS[trip.stops][0].toUpperCase()}${STOPS[trip.stops].slice(1)} each way.` : "") +
    (shown.some((r) => waits(r).some((l) => l.long)) ? ` Layovers over ${LONG / 60} hours are highlighted.` : "") +
    (warnCol ? " Warnings cover the flights out and back together." : "");
  const count = `${shown.length} ${shown.length === 1 ? "fare" : "fares"}`;
  const days = pick && pick.split("|").map((d) => day(d, true));
  // A price chosen by date brings its fares into view, unless their heading is already in the upper half of the screen.
  function choose(k) {
    setPick(k);
    if (k && fares.current.getBoundingClientRect().top > innerHeight / 2) scrollToElement(fares.current);
  }

  return (
    <>
      <Brief rows={rows} cur={cur} />
      {meta.sources.length === 2 && <Compare rows={rows} pairs={meta.pairs} cur={cur} />}
      {meta.pairs.length > 1 && <Dates rows={rows} pairs={meta.pairs} tasks={tasks} cur={cur} pick={pick} onPick={choose} />}
      <section className="block" ref={fares}>
        <div className="block-h">
          <h3>{days ? `${count} leaving ${days[0]} and returning ${days[1]}, cheapest first` : `${count} from ${trip.from} to ${trip.to}, cheapest first`}</h3>
          {pick && <button type="button" className="ghost" onClick={() => setPick(null)}>Show every date</button>}
        </div>
        <p className="vh" role="status">{days ? `Showing ${count} leaving ${days[0]} and returning ${days[1]}.` : ""}</p>
        <p className="muted">{note}</p>
        <div className="table-scroll">
          <table className="fares-table">
            <thead><tr><th scope="col">Price</th><th scope="col">Outbound</th><th scope="col">Return</th>{warnCol && <th scope="col">Warnings</th>}<th scope="col"><span className="vh">Booking</span></th></tr></thead>
            {/* the first rows rise in after the brief, and their prices flip in */}
            <tbody>{(all ? list : list.slice(0, TOP)).map(({ r, rets }, i) => <FareRow key={i} r={r} rets={rets} cur={cur} top={i === 0 && r.price_cmp === rows[0].price_cmp} warnCol={warnCol} enter={i < ENTER ? 4 + i : undefined} />)}</tbody>
          </table>
        </div>
        {list.length > TOP && !all && <button type="button" className="ghost more" onClick={() => setAll(true)}>{`Show all ${list.length} rows`}</button>}
      </section>
      <p className="again"><a className="ghost" href="#composer">Search again with different dates</a></p>
    </>
  );
}

// Cheapest per departure and return date on each source, as print_compare does. diff = matrix - google.
function Compare({ rows, pairs, cur }) {
  const diffs = [];
  const body = pairs.map(([o, r]) => {
    const m = {};
    for (const s of ["matrix", "google"]) {
      const ps = rows.filter((x) => x.source === s && x.search_out === o && x.search_ret === r).map((x) => x.price_cmp);
      m[s] = ps.length ? Math.min(...ps) : null;
    }
    const diff = m.matrix !== null && m.google !== null ? m.matrix - m.google : null;
    if (diff !== null) diffs.push(diff);
    const cell = (s, other) => (m[s] === null ? <td className="num muted">none</td>
      : <td className={`num${other !== null && m[s] < other ? " win" : ""}`}>{money(m[s])}</td>);
    return (
      <tr key={`${o}|${r}`}>
        <th scope="row">{`${day(o)} to ${day(r)}`}</th>{cell("matrix", m.google)}{cell("google", m.matrix)}
        <td className="num">{diff === null ? <span className="muted">none</span> : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${money(Math.abs(diff))}`}</td>
      </tr>
    );
  });
  const n = diffs.length;
  const mean = n ? diffs.reduce((a, b) => a + b, 0) / n : 0;
  const summary = n
    ? `Matrix was cheaper in ${diffs.filter((d) => d < 0).length} of ${n} ${n === 1 ? "trip" : "trips"}, Google in ${diffs.filter((d) => d > 0).length}. On average Matrix came in ${money(Math.abs(mean))} ${cur} ${mean < 0 ? "lower" : mean > 0 ? "higher" : "the same"}.`
    : "No trip had fares from both sources, so there's nothing to compare.";
  return (
    <section className="block">
      <h3>Matrix and Google, date by date</h3>
      <p className="muted">{summary}</p>
      <div className="table-scroll"><table className="cmp">
        <thead><tr><th scope="col">Dates</th><th scope="col" className="num">ITA Matrix</th><th scope="col" className="num">Google Flights</th><th scope="col" className="num">Matrix − Google</th></tr></thead>
        <tbody>{body}</tbody>
      </table></div>
    </section>
  );
}
