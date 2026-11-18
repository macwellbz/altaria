import Board from "./Board.jsx";

// How it ranks: the aim in one statement, the ranking board showing it on your own last saved search, and the
// three things the site never does. The statement is a sentence, so the section's heading is for screen readers.
export default function How() {
  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <h2 id="how-title" className="vh">How it ranks</h2>
        <p className="statement">Every search has one goal: finding the best flight for&nbsp;you.</p>
        <Board />
        <ul className="principles">
          <li>
            <h3>No paid placement</h3>
            <p>No airline or travel site pays to appear here, and no link earns a commission. A fare's place depends on its price, then its flight time.</p>
          </li>
          <li>
            <h3>Searched live</h3>
            <p>Fares are looked up the moment you press Search. A saved search keeps the day it ran, so a price never looks newer than it is.</p>
          </li>
          <li>
            <h3>Nothing estimated</h3>
            <p>Every price you see came back from a real search. Nothing is guessed.</p>
          </li>
        </ul>
      </div>
    </section>
  );
}
