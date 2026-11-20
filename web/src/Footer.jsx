import Logo from "./Logo.jsx";
import { NAME } from "./brand.js";

// Credits open in a new tab, so a search in progress isn't lost.
const Out = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="vh"> (opens in a new tab)</span></a>
);

// The footer: the lockup and the page's links, and where its data and sky come from.
export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-top">
          <a className="brand" href="#top"><Logo file="altaria-lockup-small" alt={NAME} className="lockup" /></a>
          <nav aria-label="Footer">
            <a href="#how">How it ranks</a>
            <a href="#search">Search flights</a>
            <a href="#top">Back to top</a>
          </nav>
        </div>
        <p className="credits">
          Fares from <Out href="https://www.google.com/travel/flights">Google Flights</Out>. Airports
          from <Out href="https://ourairports.com/">OurAirports</Out>, in the public domain. The sky is
          by <Out href="https://www.vantajs.com/">Vanta.js</Out>, after Inigo Quilez's <Out href="https://www.shadertoy.com/view/XslGRr">"Clouds"</Out> shader,
          licensed <Out href="https://creativecommons.org/licenses/by-nc-sa/3.0/">CC BY-NC-SA 3.0</Out>.
        </p>
      </div>
    </footer>
  );
}
