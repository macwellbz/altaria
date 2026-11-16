import { useEffect, useRef } from "react";

// Vanta's clouds and the pointer's wake (vantaSky.js), loaded after the page so three.js never holds up the first
// paint. Until they arrive, and without WebGL, the CSS gradient behind them shows.
export default function VantaSky() {
  const host = useRef(null);
  useEffect(() => {
    let stop, gone = false;
    import("./vantaSky.js")
      .then(({ default: start }) => { if (!gone) stop = start(host.current); })
      .catch((e) => console.warn("sky:", e.message));
    return () => { gone = true; stop?.(); };
  }, []);
  return <div className="clouds" ref={host}></div>;
}
