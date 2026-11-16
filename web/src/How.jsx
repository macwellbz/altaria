import Board from "./Board.jsx";

// How it ranks: the rule in one statement, the ranking board showing it on your own last saved search, and the
// three things the site never does. The statement is a sentence, so the section's heading is for screen readers.
export default function How() {
  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <h2 id="how-title" className="vh">How it ranks</h2>
        <p className="statement">Sorted by price, then by flight time. Nothing else moves a fare&nbsp;up.</p>
        <Board />
        <ul className="principles">
          <li>
            <h3>No paid placement</h3>
            <p>No airline or travel site pays to appear here, and no link earns a commission. A fare's place depends on its price, then its flight time.</p>
          </li>
          <li>
            <h3>Searched live</h3>
            <p>Each search asks Google Flights when you press Search, one date pair at a time. A saved search keeps the day it ran, so a price never looks newer than it is.</p>
          </li>
          <li>
            <h3>Nothing estimated</h3>
            <p>If a search didn't return a price, you won't see one. No typical fares, forecasts or starting-from prices, only what came back.</p>
          </li>
        </ul>
      </div>
    </section>
  );
}
