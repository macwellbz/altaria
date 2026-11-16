import { useEffect, useState } from "react";
import Badges from "./Badges.jsx";
import Flap from "./bits/Flap.jsx";
import { example, pageStart } from "./example.js";
import { airlines, dateSpan, day, money, savedOn, time } from "./helpers.js";

// The fare pass: the cheapest row of the newest saved run, drawn as a boarding pass, with the itinerary on top
// and the price on a stub below a perforation. It only ever shows a price a search really returned.
// It rises once its fare is in, in its place in the load moment (hero.css), and its codes and price flip in.
export default function FarePass() {
  const [card, setCard] = useState();   // undefined while loading, null when there's no saved run yet
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    // The card's words are built here, in the chain, so a saved run in a shape it can't read hides the card
    // (the catch) instead of breaking the page.
    example.then((ex) => setCard(ex && describe(ex))).catch(() => setBroken(true));
  }, []);
  const at = (ms) => Math.max(0, pageStart + ms - performance.now());   // a moment in the load, from now

  return (
    <aside className={card === undefined ? "pass" : "pass in"} style={card === undefined ? undefined : { animationDelay: `${at(520)}ms` }}
      aria-labelledby="pass-title" hidden={broken}>
      <div className="pass-top">
        <h2 id="pass-title">From your last saved search</h2>
        {card === null && <p className="muted pass-wait">Your cheapest fare will appear here after your first saved search. This card only ever shows a price a search really returned.</p>}
        {card && (
          <>
            {card.asked && <p className="asked">{card.asked}</p>}
            <p className="legs"><Flap text={card.from} delay={at(800)} /><span className="hop"><span>{card.hop}</span></span><Flap text={card.to} delay={at(860)} /></p>
            <dl>
              <dt>Out</dt><dd>{card.out}</dd>
              <dt>Back</dt><dd>{card.back}</dd>
              <dt>Flights</dt><dd>{card.flights}</dd>
            </dl>
          </>
        )}
      </div>
      {card && (
        <div className="pass-stub">
          <p className="fare-big"><Flap className="n" text={card.price} delay={at(920)} /><small>{`${card.currency} round trip`}</small></p>
          <Badges warnings={card.warnings} />
          <p className="fine" title={`results/${card.file}`}>{`The cheapest fare it returned on ${card.saved}. Fares change, so search again for today's price.`}</p>
        </div>
      )}
    </aside>
  );
}

// What the card says about /api/example's answer: { file, args, row, rows }.
function describe(ex) {
  const r = ex.row, a = { currency: r.currency, ...ex.args };
  const legs = r.route.split("-");
  const later = (a, b) => (b.slice(0, 10) !== a.slice(0, 10) ? ` ${day(b)}` : "");
  return {
    asked: a.out && a.ret ? `${a.orig} to ${a.dest}, out ${dateSpan(a.out)}, back ${dateSpan(a.ret)}` : "",
    from: legs[0],
    hop: legs.length > 2 ? `via ${legs.slice(1, -1).join(", ")}` : "nonstop",
    to: legs.at(-1),
    out: `${day(r.depart, true)}, ${time(r.depart)} to ${time(r.arrive)}${later(r.depart, r.arrive)}`,
    back: r.return_depart ? `${day(r.return_depart, true)}, ${time(r.return_depart)}` : day(r.search_ret, true),
    flights: r.segments?.length ? airlines(r.segments) : `${r.flights}, ${r.carriers.join(", ")}`,
    price: money(r.price_cmp),
    currency: a.currency,
    warnings: r.warnings ?? [],
    saved: savedOn(ex.file, true),
    file: ex.file,
  };
}
