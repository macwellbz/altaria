import { useState } from "react";
import Footer from "./Footer.jsx";
import Header from "./Header.jsx";
import Hero from "./Hero.jsx";
import How from "./How.jsx";
import Search from "./Search.jsx";

// The page: the header, the hero above the clouds, how it ranks, the search, the footer.
export default function App() {
  const [solid, setSolid] = useState(false);   // the header's backing, which the hero's scroll scene decides
  return (
    <>
      <a className="skip" href="#search">Skip to search</a>

      <Header solid={solid} />

      <main>
        <Hero onSolid={setSolid} />
        <How />
        <Search />
      </main>

      <Footer />
    </>
  );
}
