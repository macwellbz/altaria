import { useEffect, useRef } from "react";

// Vanta's clouds and the pointer's wake (vantaSky.js), over a still of their own first frame (hero.css), which is the
// sky until they draw. three.js loads after the page, so it never holds up the first paint, and the clouds start once
// the hero's entrance has played: their shaders take a moment to compile, a second or more on some Windows machines,
// and that moment would freeze the entrance part-way.
export default function VantaSky() {
  const host = useRef(null);
  useEffect(() => {
    let stop, gone = false;
    const entered = Promise.allSettled(host.current.closest(".stage").getAnimations({ subtree: true }).map((a) => a.finished));
    Promise.all([import("./vantaSky.js"), entered])
      .then(([{ default: start }]) => { if (!gone) stop = start(host.current); })
      .catch((e) => console.warn("sky:", e.message));
    return () => { gone = true; stop?.(); };
  }, []);
  return <div className="clouds" ref={host}></div>;
}
