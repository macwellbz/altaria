import { useEffect, useRef, useState } from "react";
import AirportBlank from "./AirportBlank.jsx";
import TripBox from "./TripBox.jsx";
import Flap from "./bits/Flap.jsx";
import { STOPS, day, localDay } from "./helpers.js";
import { focusOn } from "./scroll.js";
import { EMPTY, arrive, check, echo, estimate, pairs, query } from "./sentence.js";
import { FIELDS, FILLED, ask, merge, outcome } from "./trip.js";

const STOP_CHOICES = [["", "Any number of stops"], ["0", "Nonstop only"], ["1", "At most 1 stop"], ["2", "At most 2 stops"]];
const CURRENCIES = [   // the 30 that api.frankfurter.dev converts; ai.py reads this list too, so it stays the only one
  ["AUD", "Australian Dollar"], ["BRL", "Brazilian Real"], ["CAD", "Canadian Dollar"], ["CHF", "Swiss Franc"],
  ["CNY", "Chinese Renminbi Yuan"], ["CZK", "Czech Koruna"], ["DKK", "Danish Krone"], ["EUR", "Euro"],
  ["GBP", "British Pound"], ["HKD", "Hong Kong Dollar"], ["HUF", "Hungarian Forint"], ["IDR", "Indonesian Rupiah"],
  ["ILS", "Israeli New Shekel"], ["INR", "Indian Rupee"], ["ISK", "Icelandic Króna"], ["JPY", "Japanese Yen"],
  ["KRW", "South Korean Won"], ["MXN", "Mexican Peso"], ["MYR", "Malaysian Ringgit"], ["NOK", "Norwegian Krone"],
  ["NZD", "New Zealand Dollar"], ["PHP", "Philippine Peso"], ["PLN", "Polish Złoty"], ["RON", "Romanian Leu"],
  ["SEK", "Swedish Krona"], ["SGD", "Singapore Dollar"], ["THB", "Thai Baht"], ["TRY", "Turkish Lira"],
  ["USD", "United States Dollar"], ["ZAR", "South African Rand"],
].map(([c, name]) => [c, `${c} · ${name}`]);

/* The composer: the trip box, when there's a model to read with, then the search as one sentence at one size, with no
   periods, a clause to a line. Every field is a blank on the text's baseline: airports are buttons that open the
   finder (AirportBlank.jsx), and dates and choices put a native control, invisible, over a readable label. */
export default function SearchForm({ busy, onSearch }) {
  const [fields, setFields] = useState(EMPTY);
  const [marks, setMarks] = useState({});   // blanks the trip box filled, until the person edits them or searches: id -> { was, delay }
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState(null);   // the trip box's line: { text, tone }
  const [aim, setAim] = useState(null);     // where focus goes once a reading's blanks are in
  const [error, setError] = useState("");
  const latest = useRef(fields);            // the blanks as they are when a reading comes back, edits made while it read included
  useEffect(() => { latest.current = fields; }, [fields]);
  useEffect(() => { if (aim) focusOn(document.getElementById(aim.id)); }, [aim]);
  const val = (id) => fields[id];
  const unmark = (...ids) => setMarks((m) => (ids.some((id) => id in m) ? Object.fromEntries(Object.entries(m).filter(([id]) => !ids.includes(id))) : m));
  const set = (id, value) => {
    setFields((f) => ({ ...f, [id]: value }));
    unmark(id);
  };

  // Keyboard users see the native date editor while it has focus; pointer users see the readable date.
  useEffect(() => {
    const key = (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) document.documentElement.classList.add("kbd"); };
    const pointer = () => document.documentElement.classList.remove("kbd");
    addEventListener("keydown", key);
    addEventListener("pointerdown", pointer);
    return () => { removeEventListener("keydown", key); removeEventListener("pointerdown", pointer); };
  }, []);

  // each range's second date starts at its first, so no range can be picked backwards
  const today = localDay();
  const floor = { "out-from": today, "out-to": val("out-from"), "arr-from": val("out-from"), "arr-to": val("arr-from") || val("out-from"),
                  "ret-from": val("out-from"), "ret-to": val("ret-from") || val("out-from") };
  const date = (id, label, required = false) => (
    <DateBlank id={id} label={label} value={val(id)} min={floor[id] || today} required={required} mark={marks[id]} onChange={set} />
  );

  function showError(msg, id) {
    setError(msg);
    if (id) focusOn(document.getElementById(id));
  }

  // The trip box's answer fills the blanks it settles, each flipping in along the sentence, and leaves the rest as
  // they are. Focus moves on to what still needs the person: the first required blank left open, or Search. The
  // search itself only ever starts from Search.
  async function read(text) {
    if (reading) return;
    if (!text.trim()) {
      setNote({ text: "Describe the trip first.", tone: "error" });
      return focusOn(document.getElementById("trip"));
    }
    setReading(true);
    setNote({ text: "Reading the trip. This usually takes 5 to 10 seconds.", tone: "busy" });
    const { answer, error } = await ask(text.trim());
    setReading(false);
    if (error) return setNote({ text: error, tone: "error" });
    const fill = merge(latest.current, answer);
    latest.current = fill.fields;
    setFields(fill.fields);
    setMarks((m) => ({ ...m, ...Object.fromEntries(Object.entries(fill.filled).map(([id, was]) => [id, { was, delay: FIELDS.indexOf(id) * 50 }])) }));
    setNote({ text: outcome(fill, answer), tone: "done" });
    if (Object.keys(fill.filled).length) setAim({ id: fill.open[0] || "go" });
  }

  // A search starts here, in the submit handler, and never from an effect.
  function submit(e) {
    e.preventDefault();
    const bad = check(fields);
    if (bad) return showError(bad[1], bad[0]);
    showError("");
    setMarks({});
    setNote(null);
    onSearch(query(fields), echo(fields), { from: val("from"), to: val("to"), arrive: arrive(fields), stops: val("stops") });
  }

  const n = pairs(fields);
  const from = val("from"), to = val("to");
  return (
    <div className="composer">
      <TripBox busy={reading} note={note} onRead={read} />
      <form id="form" className="sentence" noValidate aria-labelledby="search-title" onSubmit={submit}>
        {/* The sentence, a clause to a line. Each run of words is one string, spaces included, so it sets exactly as
            plain HTML would. Where a clause wraps, "to" and "and" stay with their blanks, and "each way" with its. */}
        <div className="say">
          <p className="clause">
            {"Fly me from "}
            <AirportBlank id="from" name="From" placeholder="YYZ" code={from} mark={marks.from} onPick={(c) => set("from", c)} />
            {" "}
            <span className="nw">{"to "}<AirportBlank id="to" name="To" placeholder="VNO" code={to} mark={marks.to} onPick={(c) => set("to", c)} /><button type="button" className="swap" id="swap" aria-label="Swap origin and destination" onClick={() => { setFields((f) => ({ ...f, from: f.to, to: f.from })); unmark("from", "to"); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button></span>
            {" "}
            <span className="keep">{"with "}<span className="tail"><PickBlank id="stops" label="Stops on each leg, outbound and return" value={val("stops")} choices={STOP_CHOICES} shown={(v) => STOPS[v]} mark={marks.stops} onChange={set} />{" each way"}</span></span>
          </p>
          <p className="clause leg">
            {"Depart"}<span className="odep">{from ? ` from ${from}` : ""}</span>{" between "}
            {date("out-from", "Depart between: first date", true)}
            {" "}
            <span className="nw">{"and "}{date("out-to", "Depart between: last date (optional; blank searches one day)")}</span>
          </p>
          <p className="clause">
            <span className="soft">Land<span className="dest">{to ? ` in ${to}` : ""}</span> between</span>{" "}
            {date("arr-from", "Land at the destination, outbound flight, local time: no earlier than (optional)")}
            {" "}
            <span className="nw"><span className="soft">and</span>{" "}{date("arr-to", "Land at the destination, outbound flight, local time: no later than (optional)")}</span>
          </p>
          <p className="clause leg">
            {"Return"}<span className="rdest">{from ? ` to ${from}` : ""}</span>{" between "}
            {date("ret-from", "Return between: first date", true)}
            {" "}
            <span className="nw">{"and "}{date("ret-to", "Return between: last date (optional; blank searches one day)")}</span>
          </p>
          <p className="clause leg last">
            {"Show prices in "}
            <PickBlank id="currency" label="Currency" value={val("currency")} choices={CURRENCIES} shown={(v) => v} mark={marks.currency} onChange={set} />
          </p>
          <div className="go">
            <p id="estimate" className="muted">{estimate(fields)}</p>
            <button className="btn" type="submit" id="go" disabled={busy}>{n < 1 ? "Search" : n === 1 ? "Search 1 date pair" : `Search ${n} date pairs`}</button>
          </div>
        </div>
        <p id="form-error" className="error" role="alert" hidden={!error}>{error}</p>
      </form>
    </div>
  );
}

// A date blank shows the date, or a prompt until one is picked. The native input over it takes the clicks. Filled by
// the trip box (mark), its date flips in, from the date it had or from blank.
function DateBlank({ id, label, value, min, required, mark, onChange }) {
  const shown = (v) => (v ? day(v, true) : required ? "pick a date" : "(optional)");
  return (
    <span className={`blank date${required ? "" : " opt"}${value ? "" : " empty"}${mark ? " from-trip" : ""}`}>
      <span className="shown" aria-hidden="true">{mark ? <Flap text={shown(value)} from={mark.was ? shown(mark.was) : ""} delay={mark.delay} /> : shown(value)}</span>
      <label className="vh" htmlFor={id}>{mark ? label + FILLED : label}</label>
      {/* Chromium only opens the calendar from its icon; open it from anywhere on the blank. React only rewrites
          min when it changes, which matters: rewriting it mid-typing resets the field's half-typed segment. The max
          keeps a typed year to four digits, so a date typed in the wrong order can't run into a six-digit year. */}
      <input type="date" id={id} required={required} min={min} max="9999-12-31" value={value} onChange={(e) => onChange(id, e.target.value)}
        onClick={(e) => { try { e.currentTarget.showPicker(); } catch (err) {} }} />
    </span>
  );
}

// A select's blank shows a short label, and holds the width of the widest one it can show (see .pick::after).
function PickBlank({ id, label, value, choices, shown, mark, onChange }) {
  return (
    <span className={`blank pick${mark ? " from-trip" : ""}`} data-fit={choices.map(([v]) => shown(v)).join("\n")}>
      <span className="shown" aria-hidden="true">{mark ? <Flap text={shown(value)} from={shown(mark.was)} delay={mark.delay} /> : shown(value)}</span>
      <label className="vh" htmlFor={id}>{mark ? label + FILLED : label}</label>
      <select id={id} value={value} onChange={(e) => onChange(id, e.target.value)}>
        {choices.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </span>
  );
}
