import { useEffect, useRef } from "react";

// The hero's load moment is over when nothing under the stage has moved for a little while: the words have risen,
// the pass has landed and its flaps have stopped turning (they pause between turns, hence the wait).
function settled(stage) {
  return new Promise((done) => {
    let quiet = 0;
    const look = () => {
      quiet = stage.getAnimations({ subtree: true }).some((a) => a.playState === "running") ? 0 : quiet + 1;
      if (quiet === 3) done();
      else setTimeout(look, 150);
    };
    look();
  });
}
const idle = () => new Promise((done) => (window.requestIdleCallback ? requestIdleCallback(done, { timeout: 2000 }) : setTimeout(done, 200)));

// Vanta's clouds and the pointer's wake (vantaSky.js), over a still of their own first frame (hero.css), which is the
// sky until they draw. Nothing of theirs runs during the hero's load moment: three.js is a large script to start, and
// starting it part-way through made the entrance stutter. So it loads once the moment is over and the page is idle.
export default function VantaSky() {
  const host = useRef(null);
  useEffect(() => {
    let stop, gone = false;
    settled(host.current.closest(".stage")).then(idle).then(() => !gone && import("./vantaSky.js"))
      .then((sky) => { if (sky && !gone) stop = sky.default(host.current); })
      .catch((e) => console.warn("sky:", e.message));
    return () => { gone = true; stop?.(); };
  }, []);
  return <div className="clouds" ref={host}></div>;
}
