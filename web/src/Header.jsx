import { useState } from "react";
import Logo from "./Logo.jsx";
import { NAME } from "./brand.js";

// The fixed header. It's bare over the sky, and its backing comes in with the scroll (--backing, from App.jsx).
// Light unless the visitor picked dark; the head script in index.html applies a saved choice before first paint.
// Day and night swap at once, in the page itself: a view transition shows the page as a snapshot while it runs, and
// the header's blur drops out of it.
export default function Header({ ref }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark;
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    setDark(next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch (e) {}
  };
  return (
    <header className="nav" id="nav" ref={ref}>
      <a className="brand" href="#top">
        <Logo file="altaria-lockup" alt={NAME} className="lockup" />
        {/* Over the day's sky, the kit's one-colour ink lockup: the guide keeps the colour one off sky blue, where its
            sky half would vanish. It hands over to the colour one as the backing comes in. */}
        <img className="lockup on-sky light-only" src="/logo/altaria-lockup-ink.svg" alt="" />
      </a>
      <nav aria-label="Page">
        <a className="link" href="#how">How it ranks</a>
        <button className="theme" type="button" aria-label="Dark mode" aria-pressed={dark} onClick={toggle}>
          <svg className="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8 8 0 1 1 9.4 4a6.3 6.3 0 0 0 10.6 10.6z" fill="currentColor" /></svg>
          <svg className="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4 7 7M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>
        </button>
        <a className="btn btn-sm" href="#search">Search flights</a>
      </nav>
    </header>
  );
}
