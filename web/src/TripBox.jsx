import { useEffect, useState } from "react";
import { reader } from "./trip.js";

const known = reader();   // asked once as the page starts, so the box is in place before anyone scrolls to it

// The trip box: a trip described in plain words, which a model reads into the sentence's blanks (SearchForm.jsx
// applies the answer, and the person presses Search). It's its own form above the sentence, so Enter here never
// starts a search, and it's only on the page when the server has a model to read with. A line to write on, then
// its button and, beside that, what the reading did.
export default function TripBox({ busy, note, onRead }) {
  const [ai, setAi] = useState(null);
  const [text, setText] = useState("");
  useEffect(() => { known.then(setAi); }, []);
  if (!ai) return null;

  return (
    <form className="trip" aria-label="Describe the trip" onSubmit={(e) => { e.preventDefault(); onRead(text); }}>
      <label className="vh" htmlFor="trip">Describe the trip in your own words</label>
      {/* Enter reads the trip rather than starting a new line; the field grows a line at a time instead */}
      <textarea id="trip" rows={1} maxLength={500} value={text} readOnly={busy} enterKeyHint="go"
        placeholder="Describe the trip, like Toronto to Vilnius over New Year's"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form.requestSubmit();
          }
        }} />
      {/* busy, the button keeps its place, its name and its focus (aria-disabled, not disabled), and shows the rail */}
      <button type="submit" className="ghost trip-go" aria-disabled={busy || undefined}>
        <span className="trip-labels">
          <span className="trip-idle">Fill in the blanks</span>
          <span className="trip-rail" aria-hidden="true"><i></i><i></i><i></i></span>
        </span>
      </button>
      <p className="trip-note" role="status" data-tone={note?.tone}>{note?.text}</p>
    </form>
  );
}
