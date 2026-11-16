import { useRef, useState } from "react";
import SearchForm from "./SearchForm.jsx";
import SearchTurn, { streamSearch } from "./SearchTurn.jsx";

const STOPPED = "Stopped. Partial results aren't shown, since a stopped search may have missed the cheapest fare.";

// The search section: its heading, the thread of searches so far (each your sentence, then what came back), and
// the composer below them.
export default function Search() {
  const [turns, setTurns] = useState([]);
  const active = useRef(null);   // { stop } for the search in flight

  // A search starts here, in the form's submit handler rather than in an effect, so nothing re-rendering
  // (or a hot reload) can ever send it twice.
  function converse(q, said, trip) {
    active.current?.stop("Stopped, to start the newer search below.");
    const id = turns.length;
    setTurns((ts) => [...ts, { id, said, trip }]);
    active.current = streamSearch(q, (change) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...change(t) } : t))));
  }

  return (
    <section className="search" id="search" aria-labelledby="search-title">
      <div className="wrap">
        <h2 id="search-title">Where are you headed?</h2>
        <p className="search-lede">Allow a few days either way and every pair of dates is searched, a few seconds each.</p>
        {turns.length > 0 && (
          <div className="thread" id="thread">
            {turns.map((t) => <SearchTurn key={t.id} turn={t} onStop={() => active.current.stop(STOPPED)} />)}
          </div>
        )}
        <SearchForm busy={turns.some((t) => t.running)} onSearch={converse} />
      </div>
    </section>
  );
}
