import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Flap from "./bits/Flap.jsx";
import { airportsFor, airportsLoaded } from "./airports.js";
import { focusOn, scrollToElement, showIn } from "./scroll.js";
import { FILLED } from "./trip.js";

/* An airport blank is a button that holds and shows only a code. It opens a finder below it: a search box
   (an ARIA combobox) over a listbox of matches. Typing stays in the search box; Enter, Tab or a click picks
   the active match, and Escape or clicking away keeps the code the blank already had. A blank the trip box
   filled (mark) is tinted and says so, and its code flips in at its place in the sentence. */
export default function AirportBlank({ id, name, placeholder, code, mark, onPick }) {
  const [open, setOpen] = useState(null);   // while the finder is open: { typed }, the key that opened it, if any
  const button = useRef(null);
  const wasOpen = useRef(false);
  const close = (refocus) => {
    setOpen(null);
    if (refocus) focusOn(button.current);
  };
  return (
    <span className={`blank code${code ? "" : " empty"}${mark ? " from-trip" : ""}`}>
      <button type="button" id={id} ref={button} aria-haspopup="dialog" aria-expanded={Boolean(open)} aria-controls="finder"
        aria-label={`${name} airport: ${code || "not chosen yet"}${mark ? FILLED : ""}`}
        onPointerDown={() => (wasOpen.current = Boolean(open))}
        onClick={() => {
          if (wasOpen.current) return (wasOpen.current = false);   // a click on its own blank closes the finder
          setOpen({ typed: "" });
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen({ typed: "" }); }
          else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen({ typed: e.key }); }   // typing starts a search
        }}>
        {/* a code flips in when it's picked, and over when it's swapped */}
        {code ? <Flap text={code} delay={mark?.delay} /> : placeholder}
      </button>
      {open && <Finder name={name} typed={open.typed} onPick={onPick} onClose={close} />}
    </span>
  );
}

// The finder drops down from the blank that opened it.
function Finder({ name, typed, onPick, onClose }) {
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
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
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onClose(false); }}>
      <input id="finder-q" ref={input} role="combobox" aria-label="Search airports by city, airport name or code" aria-autocomplete="list"
        aria-expanded={picks.length > 0} aria-controls="finder-list" aria-activedescendant={active < 0 ? undefined : `finder-${active}`}
        autoComplete="off" autoCapitalize="off" spellCheck="false" placeholder="City, airport or code"
        value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} onKeyDown={onKeyDown} />
      <span className="finder-list" id="finder-list" role="listbox" aria-label="Airports" hidden={!picks.length} ref={list} onMouseDown={keepFocus}>
        {picks.map(([c, airport, place], i) => (
          <span role="option" id={`finder-${i}`} aria-selected={i === active} key={i}
            onPointerMove={() => i !== active && setAt(i)} onClick={() => choose(i) && onClose(true)}>
            <b>{c}</b><span>{airport}<small>{place}</small></span>
          </span>
        ))}
      </span>
      <span className="finder-note" id="finder-note" aria-live="polite">{note}</span>
    </span>
  );
}
