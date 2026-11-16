import { useEffect, useRef } from "react";
import startSky from "./sky.js";

// The WebGL clouds and the pointer's wake (sky.js). Without WebGL, the CSS gradient behind the canvas shows.
export default function CloudSky() {
  const canvas = useRef(null);
  useEffect(() => startSky(canvas.current), []);
  return <canvas className="clouds" id="clouds" ref={canvas}></canvas>;
}
