import { Fragment } from "react";
import Badges from "./Badges.jsx";
import Flap from "./bits/Flap.jsx";
import { city } from "./airports.js";
import { day, fmtMin, layovers, money, stops, time, weekday } from "./helpers.js";

// One row of the fares table: the price, the outbound leg, the return leg, Matrix's warnings when any fare has
// them, and "View flight", which ends the row. rets lists the return dates that share this row. The first rows
// rise in with the brief when results land (enter, their place in that sequence) and their prices flip in.
export default function FareRow({ r, rets, cur, top, warnCol, enter }) {
  const back = r.return_depart && rets.length === 1
    ? <Leg L={{ depart: r.return_depart, arrive: r.return_arrive, duration: r.return_duration, stops: r.return_stops,
               segments: r.return_segments, route: r.return_route, flights: r.return_flights }} />
    : <div className="leg-h"><p className="when"><span className="t">{rets.length === 1 ? day(rets[0], true)
        : rets.map((x, i) => (i && x.slice(5, 7) === rets[i - 1].slice(5, 7) ? Number(x.slice(8)) : day(x))).join(", ")}</span></p></div>;
  return (
    <tr className={[top && "row-top", enter !== undefined && "enter"].filter(Boolean).join(" ") || undefined} style={enter === undefined ? undefined : { "--i": enter }}>
      <td className="c-price fare">
        <div className="price">{enter === undefined ? money(r.price_cmp) : <Flap text={money(r.price_cmp)} delay={180 + enter * 60} />}{" "}<small>{cur}</small></div>
        {r.currency !== cur && <div className="quoted">{`quoted ${r.currency} ${money(r.price)}`}</div>}
      </td>
      <td className="c-leg" data-label="Outbound"><div className="leg"><Leg L={r} /></div></td>
      <td className="c-leg" data-label="Return"><div className="leg">{back}</div></td>
      {warnCol && <td className="c-warn"><Badges warnings={r.warnings} /></td>}
      <td className="c-go"><BookLink r={r} /></td>
    </tr>
  );
}

// One leg: when it leaves and lands and how long it takes, then a line per flight with the layover between
// flights. A day name marks each time that falls on a new day. Rows without per-flight detail (Matrix rows,
// runs saved before segments existed) list their route and flight numbers instead.
function Leg({ L }) {
  const later = L.arrive.slice(0, 10) !== L.depart.slice(0, 10) ? ` ${day(L.arrive, true)}` : "";
  const head = (
    <div className="leg-h">
      <p className="when"><span className="t">{day(L.depart, true)}</span>{`, ${time(L.depart)} to ${time(L.arrive)}${later}`}</p>
      {L.duration ? <p className="sub">{`${fmtMin(L.duration)}, ${stops(L.stops)}`}</p> : null}
    </div>
  );
  if (!L.segments?.length) {
    const via = L.route ? L.route.split("-").slice(1, -1) : [];
    return <>{head}{L.flights ? <p className="sub">{`${via.length ? `Via ${via.join(" and ")}` : "Nonstop"} on ${L.flights}${L.carriers ? `, ${L.carriers.join(" and ")}` : ""}`}</p> : null}</>;
  }
  let last = L.depart;   // at() runs in reading order, so it knows when a time falls on a new day
  const at = (code, iso) => {
    const d = iso.slice(0, 10) !== last.slice(0, 10) ? weekday(iso) : "";
    last = iso;
    return <><span className="ap">{code}</span>{` ${time(iso)}${d ? " " : ""}`}{d ? <span className="d">{d}</span> : null}</>;
  };
  const lays = layovers(L.segments);
  return (
    <>
      {head}
      <ol className="hops">
        {L.segments.map((s, i) => (
          <Fragment key={i}>
            {i > 0 && <Layover l={lays[i - 1]} />}
            <li className="fl">
              {/* a narrow column breaks a flight's line after its arrow, and its flight number after the airline */}
              <span className="fl-r"><span className="nw">{at(s.from, s.depart)}<span className="to" aria-hidden="true">→</span></span><span className="vh"> to </span><wbr /><span className="nw">{at(s.to, s.arrive)}</span></span>
              <span className="fl-a"><span className="nw">{s.airline}</span>{" "}<span className="fn">{s.flight}</span></span>
              <span className="fl-d">{fmtMin(s.duration)}</span>
            </li>
          </Fragment>
        ))}
      </ol>
    </>
  );
}

// The wait between two flights. A long one, or one that changes airports, is highlighted.
function Layover({ l }) {
  const moves = l.next !== l.at;
  return (
    <li className={`lay${l.long || moves ? " warn" : ""}`}>
      <span>{`${fmtMin(l.m)}${l.long && l.night ? " overnight" : ""} layover in ${city(l.at)}${moves ? `, changing airports from ${l.at} to ${l.next}` : ""}`}</span>
    </li>
  );
}

// Every new row carries a Google Flights link: its own trip's booking page, or the search for its dates.
// Saved rows from before links existed have none, and show nothing.
function BookLink({ r }) {
  if (!/^https:\/\//.test(r.link || "")) return null;
  return (
    <a className="ghost book" href={r.link} target="_blank" rel="noopener noreferrer">
      View flight
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5h6v6M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="vh"> (opens in a new tab)</span>
    </a>
  );
}
