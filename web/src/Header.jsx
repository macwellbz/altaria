import { useState } from "react";
import Logo from "./Logo.jsx";
import { NAME } from "./brand.js";
import { still } from "./helpers.js";

// The fixed header. It's bare over the sky and gets a backing (solid) once page content can pass beneath it.
// Light unless the visitor picked dark; the head script in index.html applies a saved choice before first paint.
// Day and night crossfade where the browser has view transitions and motion is welcome; elsewhere they swap at once.
export default function Header({ solid }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark;
    const apply = () => {
      if (next) document.documentElement.dataset.theme = "dark";
      else delete document.documentElement.dataset.theme;
    };
    if (document.startViewTransition && !still()) document.startViewTransition(apply);
    else apply();
    setDark(next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch (e) {}
  };
  return (
    <header className={solid ? "nav solid" : "nav"} id="nav">
      {/* the primary lockup, 'altaria ai'; phones get the secondary, 'altaria', which the guide gives a mobile header */}
      <a className="brand" href="#top"><Logo file="altaria-lockup" alt={NAME} className="lockup" /></a>
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
