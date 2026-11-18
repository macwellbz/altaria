import { useEffect, useRef } from "react";
import FarePass from "./FarePass.jsx";
import Sky from "./VantaSky.jsx";   // Vanta's clouds. For the earlier raymarched sky and its wake: import Sky from "./CloudSky.jsx";
import { NAME } from "./brand.js";
import { onScroll, scrollToElement } from "./scroll.js";

// The hero: flying above the clouds. On wide screens the stage sticks while --p runs from 0 to 1 and
// styles/sections/hero.css plays the descent through the clouds from it. The page's scroll (scroll.js, through
// Lenis or natively) writes --p straight to the element, so it never re-renders. The pass's height goes to CSS
// as --pass-h, so on a short screen its slot moves up rather than off the bottom.
export default function Hero({ onBacking }) {
  const hero = useRef(null);
  useEffect(() => {
    const el = hero.current, pass = el.querySelector(".pass");
    const scene = matchMedia("(min-width: 900px) and (min-height: 560px) and (prefers-reduced-motion: no-preference)");
    const update = () => {
      const span = Math.max(1, el.offsetHeight - innerHeight);
      const p = scene.matches ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / span)) : 0;
      el.style.setProperty("--p", p.toFixed(4));
      // Over the sky the header is bare. Its backing comes in with the scroll, eased at both ends, before page content
      // can pass beneath it: through the scene's last quarter as the fog closes in, or else over the first 64px, before
      // the headline reaches the bar.
      const b = Math.min(1, Math.max(0, scene.matches ? (p - .75) / .25 : scrollY / 64));
      onBacking(b * b * (3 - 2 * b));
    };
    const sized = new ResizeObserver(() => el.style.setProperty("--pass-h", `${pass.offsetHeight}px`));
    sized.observe(pass);
    // Tabbing back to the copy with the scene under way, the browser stops where the copy has faded out. Once it has,
    // the page goes on up to the scene's start, where the copy is whole.
    const copy = el.querySelector(".hero-copy");
    const show = (e) => {
      if (scene.matches && e.target.matches(":focus-visible")) requestAnimationFrame(() => el.getBoundingClientRect().top < 0 && scrollToElement(el));
    };
    copy.addEventListener("focusin", show);
    const stop = onScroll(update);
    addEventListener("resize", update);
    scene.addEventListener("change", update);
    return () => {
      stop();
      sized.disconnect();
      copy.removeEventListener("focusin", show);
      removeEventListener("resize", update);
      scene.removeEventListener("change", update);
    };
  }, [onBacking]);

  return (
    <section className="hero" id="top" aria-labelledby="hero-title" ref={hero}>
      <div className="stage">
        <div className="sky" aria-hidden="true">
          <Sky />
          <div className="mist"></div>
        </div>

        <div className="hero-copy">
          {/* Two lines set by hand, each rising out of its own mask on load. */}
          <h1 id="hero-title"><span className="line"><span>The sky,</span></span> <span className="line"><span>sorted by&nbsp;price</span></span></h1>
          <p className="lede">{`${NAME} searches every day you could fly, then shows you the best fares it found.`}</p>
          <a className="btn" href="#search">Search flights</a>
        </div>

        <FarePass />
      </div>
    </section>
  );
}
