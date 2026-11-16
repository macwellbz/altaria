import { useState } from "react";
import Brief from "./Brief.jsx";
import FareRow from "./FareRow.jsx";
import { LONG, STOPS, day, landing, money, waits } from "./helpers.js";

const TOP = 25;    // rows shown before "Show all"
const ENTER = 5;   // rows that rise in with the brief when results land

// The answer to one search: the brief, then every fare, cheapest first.
export default function Results({ rows, meta, trip }) {
  const [all, setAll] = useState(false);
  const cur = meta.currency;
  const pairs = meta.pairs.length;
  if (!rows.length) {
    const limit = trip.stops === "0" ? " for nonstop flights" : trip.stops ? ` with ${STOPS[trip.stops]} each way` : "";
    const fix = trip.stops === "0" ? "Allow a stop or two" : trip.stops ? "Allow more stops" : "Try a wider date range";
    return <p><strong>{`No fares came back${limit}.`}</strong>{` ${fix}${trip.stops ? ", or try a wider date range" : ""}${trip.arrive ? ", or clear the arrival window" : ""}. A failed search above means that search broke, not that it found nothing.`}</p>;
  }
  // Same outbound at the same price for several return dates becomes one row, as print_table does.
  const groups = new Map();
  for (const r of rows) {
    const k = [r.source, r.search_out, r.flights, r.price_cmp, r.return_flights].join("|");
    if (!groups.has(k)) groups.set(k, { r, rets: [] });
    groups.get(k).rets.push(r.search_ret);
  }
  const list = [...groups.values()];
  const warnCol = rows.some((r) => r.warnings?.length);
  const note = `Across ${pairs} date ${pairs === 1 ? "pair" : "pairs"}. Prices are for the whole round trip in ${cur}; ties go to the shorter flight.` +
    (list.length < rows.length ? " Fares that differ only by return date share a row." : "") +
    (rows.some((r) => !r.return_depart) ? " A return with just a date is one Google didn't detail." : "") +
    (trip.arrive ? ` Only outbound flights landing ${landing(trip.arrive)}, local time.` : "") +
    (trip.stops ? ` ${STOPS[trip.stops][0].toUpperCase()}${STOPS[trip.stops].slice(1)} each way.` : "") +
    (rows.some((r) => waits(r).some((l) => l.long)) ? ` Layovers over ${LONG / 60} hours are highlighted.` : "") +
    (warnCol ? " Warnings cover the flights out and back together." : "");

  return (
    <>
      <Brief rows={rows} cur={cur} />
      {meta.sources.length === 2 && <Compare rows={rows} pairs={meta.pairs} cur={cur} />}
      <section className="block">
        <h3>{`${rows.length} ${rows.length === 1 ? "fare" : "fares"} from ${trip.from} to ${trip.to}, cheapest first`}</h3>
        <p className="muted">{note}</p>
        <div className="table-scroll">
          <table className="fares-table">
            <thead><tr><th scope="col">Price</th><th scope="col">Outbound</th><th scope="col">Return</th>{warnCol && <th scope="col">Warnings</th>}<th scope="col"><span className="vh">Booking</span></th></tr></thead>
            {/* the first rows rise in after the brief, and their prices flip in */}
            <tbody>{(all ? list : list.slice(0, TOP)).map(({ r, rets }, i) => <FareRow key={i} r={r} rets={rets} cur={cur} top={i === 0} warnCol={warnCol} enter={i < ENTER ? 4 + i : undefined} />)}</tbody>
          </table>
        </div>
        {list.length > TOP && !all && <button type="button" className="ghost more" onClick={() => setAll(true)}>{`Show all ${list.length} rows`}</button>}
      </section>
      <p className="again"><a href="#form">Search again with different dates</a></p>
    </>
  );
}

// Cheapest per date pair on each source, as print_compare does. diff = matrix - google.
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
    ? `Matrix was cheaper in ${diffs.filter((d) => d < 0).length} of ${n} ${n === 1 ? "pair" : "pairs"}, Google in ${diffs.filter((d) => d > 0).length}. On average Matrix came in ${money(Math.abs(mean))} ${cur} ${mean < 0 ? "lower" : mean > 0 ? "higher" : "the same"}.`
    : "No date pair had fares from both sources, so there's nothing to compare.";
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
