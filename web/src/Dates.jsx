import { useId, useState } from "react";
import { byDate, day, money, weekday, weeks } from "./helpers.js";
import { focusOn, showIn } from "./scroll.js";

const WIDE = 7;   // return days that fit across a phone's screen or two: more than this, and the longer side runs down

// The cheapest round trip for each day a search covered, as a timetable: departure days down the side and return
// days across the top, or, when one side is a single day, the other set out as a calendar. Every price is the
// lowest of the rows a search returned for those days. The lowest of all is shaded; a search that broke says so,
// apart from one that found nothing. A price is a button: pressed, the fares below list only its days (pick, as
// "out|ret"). The grid is one stop for Tab, and the arrow keys move through it.
export default function Dates({ rows, pairs, tasks, cur, pick, onPick }) {
  const [at, setAt] = useState(null);   // the price Tab comes back to: the one last focused
  const title = useId();
  const cells = byDate(rows, pairs, tasks);
  const all = [...cells.values()];
  const low = Math.min(...all.filter((c) => c.price !== null).map((c) => c.price));
  const stop = at ?? pick ?? [...cells].find(([, c]) => c.price === low)[0];
  const outs = [...new Set(pairs.map(([o]) => o))], rets = [...new Set(pairs.map(([, r]) => r))];
  const one = outs.length === 1 ? "out" : rets.length === 1 ? "ret" : "";   // the side with a single day
  const flip = rets.length > WIDE && rets.length > outs.length;

  // Arrow keys go to the next price that way, past days with none, and bring it into view.
  function move(e) {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    const from = e.target.closest("td");
    if (!step || !from) return;
    e.preventDefault();
    const body = from.parentElement.parentElement;
    for (let r = from.parentElement.sectionRowIndex + step[0], c = from.cellIndex + step[1]; body.rows[r]?.cells[c]; r += step[0], c += step[1]) {
      const next = body.rows[r].cells[c].querySelector("button");
      if (!next) continue;
      focusOn(next);
      return showIn(e.currentTarget.parentElement, next, body.querySelector("th")?.getBoundingClientRect().width);
    }
  }

  // One cell, a day out and a day back: the price as a button, or what came back in its place. In the calendar the
  // cell also holds its date (label).
  const cell = (k, label) => {
    const c = cells.get(k);
    if (!c) return <td key={k}></td>;
    if (c.price === null) {
      return <td key={k} className={c.failed ? "failed" : "none"} title={c.failed || "The search ran and no fares came back."}>{label}<span className="p">{c.failed ? "failed" : "none"}</span></td>;
    }
    const best = c.price === low;
    return (
      <td key={k} className={best ? "low" : undefined}>
        <button type="button" aria-pressed={pick === k} tabIndex={k === stop ? 0 : -1} onFocus={() => setAt(k)} onClick={() => onPick(pick === k ? null : k)}
          aria-label={`Out ${day(c.out, true)}, back ${day(c.ret, true)}: ${money(c.price)} ${cur}${best ? ", the cheapest" : ""}`}>
          {label}<span className="p">{money(c.price)}</span>
        </button>
      </td>
    );
  };
  const head = (d) => <><span className="wd">{weekday(d)}</span>{" "}<span className="nw">{day(d)}</span></>;

  let table, lowest;
  if (one) {
    const days = one === "out" ? rets : outs;
    const cal = weeks(days[0], days.at(-1));
    const key = (d) => (one === "out" ? `${outs[0]}|${d}` : `${d}|${rets[0]}`);
    lowest = one === "out" ? `for each day back, leaving ${day(outs[0], true)}` : `for each day out, returning ${day(rets[0], true)}`;
    table = (
      <table className="cal" aria-labelledby={title} onKeyDown={move}>
        <thead><tr>{cal[0].map((d) => <th scope="col" key={d}>{weekday(d)}</th>)}</tr></thead>
        {/* a date names its month where the calendar starts and where a month does */}
        <tbody>{cal.map((week) => <tr key={week[0]}>{week.map((d) => cell(key(d), <span className="d">{d === days[0] || d.endsWith("-01") ? day(d) : Number(d.slice(8))}</span>))}</tr>)}</tbody>
      </table>
    );
  } else {
    const [side, top] = flip ? [rets, outs] : [outs, rets];
    lowest = "for each day out and day back";
    table = (
      <table className="grid" aria-labelledby={title} onKeyDown={move}>
        <colgroup><col /></colgroup>
        <colgroup span={top.length}></colgroup>
        <thead>
          <tr><th scope="col" rowSpan="2" className="axis">{flip ? "Return" : "Depart"}</th><th scope="colgroup" colSpan={top.length} className="axis"><span>{flip ? "Depart" : "Return"}</span></th></tr>
          <tr>{top.map((d) => <th scope="col" key={d}>{head(d)}</th>)}</tr>
        </thead>
        <tbody>{side.map((s) => <tr key={s}><th scope="row">{head(s)}</th>{top.map((t) => cell(flip ? `${t}|${s}` : `${s}|${t}`))}</tr>)}</tbody>
      </table>
    );
  }

  return (
    <section className="block">
      <h3 id={title}>Cheapest fare by date</h3>
      <p className="muted">
        {`The lowest round-trip price ${lowest}, in ${cur}. The lowest of all is shaded. Choose a price to see its flights.`}
        {all.some((c) => c.price === null && c.failed) && " Failed means that search broke, so those days may still have fares."}
        {all.some((c) => c.price === null && !c.failed) && " None means the search ran and no fares came back."}
      </p>
      <div className="table-scroll dates">{table}</div>
    </section>
  );
}
