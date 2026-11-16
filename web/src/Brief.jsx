import Flap from "./bits/Flap.jsx";
import { city } from "./airports.js";
import { WARN, airlines, day, fmtMin, layovers, money, picks, time } from "./helpers.js";

// Plain-English findings, built only from returned rows: every price, time and layover here is one a search returned.
// The cheapest fare's way out and way back, then pricier fares worth a look, with how much more they cost.
export default function Brief({ rows, cur }) {
  const best = rows[0];
  const flown = (r) => (r.segments?.length ? airlines(r.segments)
    : `${r.flights} ${r.stops ? `via ${r.route.split("-").slice(1, -1).join(" and ")}` : "nonstop"}, ${r.carriers.join(" and ")}`);
  // " It takes 33h30, including 23h55 overnight in Amsterdam."
  const takes = (minutes, segs) => {
    const long = layovers(segs).filter((l) => l.long).map((l) => `${fmtMin(l.m)}${l.night ? " overnight" : ""} in ${city(l.at)}`);
    return minutes ? ` It takes ${fmtMin(minutes)}${long.length ? `, including ${long.join(" and ")}` : ""}.` : "";
  };
  const leaving = (iso) => <span className="nw">{`${day(iso, true)} at ${time(iso)}`}</span>;   // the date and time after "leaving", kept on one line
  const back = best.return_depart
    ? <>{` ${best.return_segments?.length ? `${airlines(best.return_segments)}, ` : ""}leaving `}{leaving(best.return_depart)}{`.${takes(best.return_duration, best.return_segments)}`}</>
    : ` on ${day(best.search_ret, true)}. Google didn't detail the flights.`;

  let flags = null;
  if (best.warnings?.length) {
    const has = (w) => best.warnings.includes(w);
    const why = has("TIGHT_CONNECTION") && has("RISKY_CONNECTION")
      ? " Those are two different things: tight means little time to change planes, risky means Matrix expects missing that connection to be very inconvenient."
      : has("RISKY_CONNECTION") ? " Matrix calls a connection risky when missing it would be very inconvenient."
      : has("TIGHT_CONNECTION") ? " Tight means little time to change planes." : "";
    flags = <p>{`Matrix flags it: ${best.warnings.map((w) => (WARN[w]?.[1] || w).toLowerCase()).join(", ")}.${why}`}</p>;
  }
  const worth = picks(rows);   // pricier fares worth a look, listed below the cheapest

  return (
    <div className="brief">
      {/* the answer to the question asked: the turn's one display line, its price flipping in as it lands */}
      <p className="lead">The cheapest round trip is <span className="nw"><Flap text={money(best.price_cmp)} delay={200} />{` ${cur}`}</span></p>
      <p><b>Out:</b>{` ${flown(best)}, leaving `}{leaving(best.depart)}{`.${takes(best.duration, best.segments)}`}</p>
      <p><b>Back:</b>{back}</p>
      {flags}
      {worth.length > 0 && (
        <ul className="picks">
          {worth.map(([r, why], i) => {
            const said = why.join(" and ");
            return (
              <li key={i}>
                <span className="pp"><b>{`${money(r.price_cmp)} ${cur}`}</b><small>{`${money(r.price_cmp - best.price_cmp)} more`}</small></span>
                <span><span className="why">{said[0].toUpperCase() + said.slice(1)}</span> <span className="who">{`${flown(r)}${r.duration ? `, ${fmtMin(r.duration)} out` : ""}${r.return_duration ? `, ${fmtMin(r.return_duration)} back` : ""}`}</span></span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="confirm">Before you pay, confirm the fare on the operating airline's own site.</p>
    </div>
  );
}
