import { useCallback, useRef } from "react";
import Footer from "./Footer.jsx";
import Header from "./Header.jsx";
import Hero from "./Hero.jsx";
import How from "./How.jsx";
import Search from "./Search.jsx";

// The page: the header, the hero above the clouds, how it ranks, the search, the footer.
export default function App() {
  // How far the header's backing has come in, 0 to 1, which the hero's scroll decides. It goes straight to the
  // header as --backing, so scrolling never re-renders anything.
  const nav = useRef(null);
  const backing = useCallback((b) => nav.current.style.setProperty("--backing", b.toFixed(3)), []);
  return (
    <>
      <a className="skip" href="#search">Skip to search</a>

      <Header ref={nav} />

      <main>
        <Hero onBacking={backing} />
        <How />
        <Search />
      </main>

      <Footer />
    </>
  );
}
