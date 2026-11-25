import { useEffect, useRef, useState } from "react";
import Flap from "./bits/Flap.jsx";
import { example } from "./example.js";
import { dateSpan, either, fmtMin, money, remark, savedOn } from "./helpers.js";

// The ranking board: up to five fares from the newest saved search, ranked the way every search here is, by
// price and then by the outbound flight's length (search.py's own order, which /api/example keeps). When the
// board comes into view its rows flip in from the top, the way a departure board refreshes. Every figure is
// from the saved rows. With no saved search there is no board.
const PACE = 16;   // ms between characters: a row of the board ripples rather than types

export default function Board() {
  const [ex, setEx] = useState(null);
  const [seen, setSeen] = useState(false);
  const board = useRef(null);
  useEffect(() => {
    example.then((e) => e?.rows?.length && setEx(e)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!ex) return;
    const watch = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      setSeen(true);
      watch.disconnect();
    }, { threshold: .4 });
    watch.observe(board.current);
    return () => watch.disconnect();
  }, [ex]);
  if (!ex) return null;

  const { rows, args: a, file } = ex;
  const cur = a.currency || rows[0].currency;
  const n = rows.length;   // the server sends at most five, the cheapest first
  const which = n === 5 ? "The 5 cheapest fares" : n === 1 ? "The one fare" : `All ${n} fares`;

  return (
    <div className="board" ref={board}>
      <table>
      <caption>
        <span className="board-title">{`${which} from your search on ${savedOn(file)}`}</span>
        <span className="board-trip">{`${either(a.orig)} to ${either(a.dest)}, out ${dateSpan(a.out)}, back ${dateSpan(a.ret)}, prices in ${cur}`}</span>
      </caption>
      <thead>
        <tr><th scope="col" className="num" aria-sort="ascending">Price</th><th scope="col" className="num">Outbound</th><th scope="col" className="num">Return</th><th scope="col">Route</th><th scope="col">Airline</th><th scope="col"><span className="vh">Remarks</span></th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const at = (k) => ({ go: seen, delay: i * 110 + k, pace: PACE });   // row by row, and left to right along each
          const note = remark(rows, i);
          return (
            <tr key={i} className={i === 0 ? "first" : undefined}>
              <td className="num price"><Flap text={money(r.price_cmp)} {...at(0)} /></td>
              <td className="num out" data-label="out"><Flap text={r.duration ? fmtMin(r.duration) : ""} {...at(50)} /></td>
              <td className="num" data-label="back"><Flap text={r.return_duration ? fmtMin(r.return_duration) : ""} {...at(100)} /></td>
              <td className="route"><Flap text={r.route.split("-").join(" ")} {...at(150)} /></td>
              <td className="carrier"><Flap text={r.carriers.join(", ")} {...at(230)} /></td>
              <td className="note">{note && <Flap text={note} {...at(330)} />}</td>
            </tr>
          );
        })}
      </tbody>
      </table>
    </div>
  );
}
