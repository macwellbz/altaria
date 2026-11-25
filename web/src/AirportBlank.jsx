import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Flap from "./bits/Flap.jsx";
import { airportsFor, airportsLoaded } from "./airports.js";
import { MAX_AIRPORTS } from "./flights.js";
import { focusOn, scrollToElement, showIn } from "./scroll.js";
import { FILLED } from "./trip.js";

/* An airport blank holds one airport or several, up to MAX_AIRPORTS: "EDI, GLA or PIK", joined in words, with each
   code on a ruled line of its own. Each code is a button that shows only its code and opens the finder below it: a
   search box (an ARIA combobox) over a listbox of matches. Typing stays in the search box; Enter, Tab or a click
   puts the active match in that code's place, and Escape or clicking away keeps what the blank had. Before anything
   is typed, the finder also offers to add another airport, which opens a new line after the last, there for as long
   as its finder is, and to remove the code it hangs from; Delete on a code removes it too. `codes` is the form's
   string, "EDI,GLA". A blank the trip box filled (mark) is tinted and says so, and its codes flip in at their place
   in the sentence. `lead` is the word that stays with the first code, and children (the swap) stay with the last. */
export default function AirportBlank({ id, name, placeholder, lead = "", codes, mark, onChange, children }) {
  const list = codes ? codes.split(",") : [];
  const [open, setOpen] = useState(null);   // while the finder is open: { slot, typed }, the key that opened it, if any
  const [aim, setAim] = useState(null);     // { slot }: the code that takes the focus once the finder has closed
  const wasOpen = useRef(false);
  const had = useRef(list);                 // the codes as last drawn: only one that's new here flips in
  useEffect(() => { had.current = list; });
  const n = Math.max(1, list.length, open ? open.slot + 1 : 0);   // the lines: one a code, and one more while adding
  const at = (i) => (i ? `${id}-${i + 1}` : id);
  useEffect(() => { if (aim) focusOn(document.getElementById(at(Math.min(aim.slot, Math.max(1, list.length) - 1)))); }, [aim]);   // eslint-disable-line react-hooks/exhaustive-deps

  const close = (i, refocus) => {
    setOpen((o) => (o?.slot === i ? null : o));
    if (refocus) setAim({ slot: i });
  };
  // A code picked for line i takes that line; chosen twice on one side, it stays where it was just put.
  const pick = (i, c) => {
    const next = [...list];
    next[i] = c;
    const kept = next.filter((x, j) => j === i || x !== c);
    onChange(kept.join(","));
    if (kept.length <= i) close(i, true);   // its line moved up into the other's place
  };
  const remove = (i) => {
    onChange(list.filter((_, j) => j !== i).join(","));
    close(i, true);
  };
  // How each line is named: "To airport: EDI", "To airport 2 of 3: GLA", and the open one "Another to airport".
  const label = (i) => {
    const which = i && i >= list.length ? `Another ${name.toLowerCase()} airport` : `${name} airport${list.length > 1 ? ` ${i + 1} of ${list.length}` : ""}`;
    return `${which}: ${list[i] || "not chosen yet"}${mark && list[i] ? FILLED : ""}`;
  };

  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const code = list[i] || "", last = i === n - 1, isOpen = open?.slot === i;
        // The last line keeps its place in the page whatever the count, so the swap keeps its focus and its turn.
        return (
          <Fragment key={last ? "last" : i}>
            {i > 0 && " "}
            <span className="nw">
              {i === 0 ? lead : last ? "or " : ""}
              <span className={`blank code${code ? "" : " empty"}${code || !i ? "" : " another"}${mark && code ? " from-trip" : ""}`}>
                <button type="button" id={at(i)} aria-haspopup="dialog" aria-expanded={isOpen} aria-controls="finder" aria-label={label(i)}
                  aria-describedby={code && list.length > 1 ? `${id}-keys` : undefined}
                  onPointerDown={() => (wasOpen.current = isOpen)}
                  onClick={() => {
                    if (wasOpen.current) return (wasOpen.current = false);   // a click on its own blank closes the finder
                    setOpen({ slot: i, typed: "" });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen({ slot: i, typed: "" }); }
                    else if ((e.key === "Delete" || e.key === "Backspace") && code && list.length > 1) { e.preventDefault(); remove(i); }
                    else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen({ slot: i, typed: e.key }); }   // typing starts a search
                  }}>
                  {/* a code flips in when it's picked, and over when it takes another's line; one that only moved along stays as it is */}
                  {code ? <Flap key={code} text={code} from={had.current[i]} intro={!had.current.includes(code)} delay={mark && mark.delay + i * 100} /> : i ? null : placeholder}
                </button>
                {isOpen && (
                  <Finder key={i} name={name} typed={open.typed} code={code} onPick={(c) => pick(i, c)} onClose={(refocus) => close(i, refocus)}
                    onAdd={code && list.length < MAX_AIRPORTS ? () => setOpen({ slot: list.length, typed: "" }) : undefined}
                    full={Boolean(code) && list.length === MAX_AIRPORTS}
                    onRemove={code && list.length > 1 ? () => remove(i) : undefined} />
                )}
              </span>
              {i < n - 2 && ","}
              {last && children}
            </span>
          </Fragment>
        );
      })}
      {list.length > 1 && <span id={`${id}-keys`} hidden>Press Delete to remove this airport.</span>}
    </>
  );
}

// The finder drops down from the blank that opened it.
function Finder({ name, typed, code, full, onPick, onClose, onAdd, onRemove }) {
  const [q, setQ] = useState(typed);
  const [at, setAt] = useState(0);   // the active match: where Enter or Tab lands
  const [loaded, setLoaded] = useState();   // whether the airport list loaded; undefined while it loads
  const finder = useRef(null), input = useRef(null), list = useRef(null);
  useEffect(() => { airportsLoaded.then(setLoaded); }, []);   // the matches refresh once the list is in

  const picks = useMemo(() => {
    const k = q.trim();
    const found = airportsFor(k).map((a) => [a.c, a.n, `${a.t}, ${a.k}`]);
    // a three-letter code that isn't in the list can still be used as typed
    if (/^[a-z]{3}$/i.test(k) && !found.some(([c]) => c === k.toUpperCase())) found.push([k.toUpperCase(), "Use this code", "It isn't in the airport list, so check it's right"]);
    return found;
  }, [q, loaded]);
  const active = Math.min(at, picks.length - 1);   // -1 when nothing matches

  useLayoutEffect(() => {
    // It hangs from its blank's left edge, and near the right edge slides left to stay on screen. Until it's placed
    // here it lies to the blank's left (finder.css): Safari keeps the page as wide as anything that was ever laid
    // out past its right edge, even for a moment.
    const el = finder.current, room = document.documentElement.clientWidth - 16;
    el.style.left = `${Math.min(0, room - el.previousElementSibling.getBoundingClientRect().left - el.getBoundingClientRect().width)}px`;
    input.current.focus({ preventScroll: true });   // the effect below brings the whole finder into view
  }, []);
  useLayoutEffect(() => {   // new matches: the first is active, and the finder scrolls into view
    if (picks.length) showIn(list.current, list.current.firstElementChild);
    // On a touch screen its blank goes to the top of the view instead, so the matches stand clear of the keyboard,
    // which covers the bottom of the screen without the page knowing.
    if (matchMedia("(pointer: coarse)").matches) scrollToElement(finder.current.parentElement);
    else scrollToElement(finder.current, { block: "nearest" });
  }, [picks]);

  const choose = (i) => {
    if (!picks[i]) return false;
    onPick(picks[i][0]);
    return true;
  };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!picks.length) return;
      const i = (active + (e.key === "ArrowDown" ? 1 : picks.length - 1)) % picks.length;
      setAt(i);
      showIn(list.current, list.current.children[i]);
    } else if (e.key === "Enter") {
      e.preventDefault();   // never submits the form
      if (choose(active)) onClose(true);
    } else if (e.key === "Tab" && !e.shiftKey) {
      choose(active);   // focus then moves on as usual, and the finder closes behind it
    }
  };
  // Pressing on a match keeps the search box focused. It's the mousedown that moves focus, and a phone sends one
  // after a tap whatever became of the pointerdown, so that is the one to stop: the blur would close the finder
  // before the click landed. Stopping the pointerdown instead costs the tap its click in Safari.
  const keepFocus = (e) => e.preventDefault();
  const note = !q.trim() ? "Matching airports show as you type."
    : picks.length ? "" : loaded === false ? "The airport list didn't load. Type a three-letter code instead." : "No airport matches that.";

  return (
    <span className="finder" id="finder" role="dialog" aria-label={`${name} airport`} ref={finder}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onClose(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(true); } }}>
      <input id="finder-q" ref={input} role="combobox" aria-label="Search airports by city, airport name or code" aria-autocomplete="list"
        aria-expanded={picks.length > 0} aria-controls="finder-list" aria-activedescendant={active < 0 ? undefined : `finder-${active}`}
        autoComplete="off" autoCapitalize="off" spellCheck="false" placeholder="City, airport or code"
        value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={onKeyDown} />
      {/* never a Tab stop of its own, which Chrome makes of a list long enough to scroll: Tab picks and moves on */}
      <span className="finder-list" id="finder-list" role="listbox" aria-label="Airports" tabIndex={-1} hidden={!picks.length} ref={list} onMouseDown={keepFocus}>
        {picks.map(([c, airport, place], i) => (
          <span role="option" id={`finder-${i}`} aria-selected={i === active} key={i}
            onPointerMove={() => i !== active && setAt(i)} onClick={() => choose(i) && onClose(true)}>
            <b>{c}</b><span>{airport}<small>{place}</small></span>
          </span>
        ))}
      </span>
      <span className="finder-note" id="finder-note" aria-live="polite">{note}</span>
      {/* Before anything is typed: the other things to do with this blank. Buttons of their own, after the search
          box in the Tab order, and pressed with the pointer they leave the focus where it is, as a match does. */}
      {!q.trim() && (onAdd || onRemove || full) && (
        <span className="finder-acts" onMouseDown={keepFocus}>
          {onAdd && <button type="button" className="add" onClick={onAdd}>Add another airport</button>}
          {onRemove && <button type="button" onClick={onRemove}>{`Remove ${code}`}</button>}
          {full && <span>{`A search takes up to ${MAX_AIRPORTS} airports on each side.`}</span>}
        </span>
      )}
    </span>
  );
}
