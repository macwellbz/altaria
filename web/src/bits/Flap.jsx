/* Split-flap text, after React Bits' SplitFlapText (github.com/DavidHDev/react-bits,
   src/content/TextAnimations/SplitFlapText). MIT + Commons Clause: using it in a site is fine, redistributing
   the component itself is not. Taken from it: each character turns over a hinge as two halves, the upper flap
   falling forward and the lower one swinging down into place, while the halves behind are uncovered and covered
   right at the moving flap's edge, so the old and new characters never overlap and no tile is needed behind
   them. Rewritten for this page: the edge is worked out from the flap's real perspective, characters step along
   a drum (digits, then letters) rather than through random ones, it drives the browser's own animations instead
   of re-rendering React each step, and the real text never leaves the page.

   <Flap text="1,147" /> holds its final text in place from the first paint, unseen while the flaps turn, so the
   accessible name, the copy and the line box are final from the start, and nothing moves when the flaps go.
   The moving characters are a layer over it that assistive tech never sees. Under reduced motion the text is
   simply there.
     from   what the flaps show before they turn: blank by default. On a later change of text, the old text.
     intro  flip in on first showing (default), or show the first text at once and flip only on changes.
     go     false holds the board as it is until it turns true (a board waiting to be seen).
     delay  milliseconds before the first character turns.
     pace   milliseconds between one character starting and the next. */
import { useEffect, useLayoutEffect, useRef } from "react";
import { still } from "../helpers.js";

const DRUMS = ["0123456789", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"];
const STEP = 90;      // one turn of a flap, in ms
const STAGGER = 34;   // between neighbouring characters starting
const TURNS = 3;      // the most turns a character takes along its drum

// The characters a flap shows on its way to `to`: up to TURNS steps along the drum that holds it, ending on it.
// Characters on no drum (punctuation, spaces) turn over once.
function turns(from, to) {
  if (from === to) return [];
  const drum = DRUMS.find((d) => d.includes(to));
  if (!drum) return [to];
  const end = drum.indexOf(to), start = drum.indexOf(from), n = drum.length;
  const k = start < 0 ? TURNS : Math.min(TURNS, (end - start + n) % n);
  return Array.from({ length: k }, (_, i) => drum[(end - k + 1 + i + n) % n]);
}

// A flap's free edge, h from the hinge and turned phi from flat toward the viewer, seen from p in front of the
// hinge: how far from the hinge it appears. The half behind is uncovered (or covered) exactly up to there.
const edge = (h, p, phi) => (h * Math.cos(phi) * p) / (p - h * Math.sin(phi));
const easeIn = (x) => x ** 2.2;
const easeOut = (x) => 1 - (1 - x) ** 2.2;

// The four animations of one turn, as keyframes for a cell whose halves are `top` and `bot` tall.
function keyframes(top, bot) {
  const p = 4 * (top + bot), N = 10, deg = (r) => (r * 180) / Math.PI;
  const fall = [], reveal = [], land = [], cover = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N, offset = x / 2;
    const down = (Math.PI / 2) * easeIn(x);              // the upper flap, falling from flat to edge-on
    const up = (Math.PI / 2) * (1 - easeOut(x));         // the lower flap, from edge-on to flat
    fall.push({ offset, transform: `perspective(${p}px) rotateX(${-deg(down)}deg)`, opacity: 1 - .4 * easeIn(x) });
    reveal.push({ offset, clipPath: `inset(0 0 ${Math.min(top, edge(top, p, down)).toFixed(2)}px 0)` });
    land.push({ offset: .5 + offset, transform: `perspective(${p}px) rotateX(${deg(up)}deg)`, opacity: .6 + .4 * easeOut(x) });
    cover.push({ offset: .5 + offset, clipPath: `inset(${Math.min(bot, edge(bot, p, up)).toFixed(2)}px 0 0 0)` });
  }
  fall.push({ offset: 1, transform: fall.at(-1).transform, opacity: 0 });
  reveal.push({ offset: 1, clipPath: "inset(0 0 0 0)" });
  land.unshift({ offset: 0, transform: land[0].transform, opacity: 0 });
  cover.unshift({ offset: 0, clipPath: "inset(0 0 0 0)" });
  return { fall, reveal, land, cover };
}

const span = (cls, parent) => {
  const el = document.createElement("span");
  el.className = cls;
  parent?.append(el);
  return el;
};

// Lays the flaps over the host's text and turns them; returns { go, stop }.
function board(host, from, to, pace, onDone) {
  const node = host.firstChild.firstChild;   // the real text, in .flap-text
  const layer = span("flap-board", host);
  layer.setAttribute("aria-hidden", "true");
  let cells = [], frame = 0, timer = 0, began = 0, asked = false, gone = false;

  // One cell per character of the final text, measured where the browser set it, kerning and all.
  if (node) {
    const origin = layer.getBoundingClientRect(), range = document.createRange(), olds = [...from];
    let at = 0;
    cells = [...to].map((ch, i) => {
      range.setStart(node, at);
      range.setEnd(node, (at += ch.length));
      const b = range.getBoundingClientRect();
      const el = span("flap-cell", layer);
      const top = Math.round(b.height / 2), bot = b.height - top;
      Object.assign(el.style, { left: `${b.left - origin.left}px`, top: `${b.top - origin.top}px`, width: `${b.width}px`, height: `${b.height}px` });
      el.style.setProperty("--h", `${b.height}px`);
      el.style.setProperty("--hinge", `${top}px`);
      const halves = ["t", "b", "f", "k"].map((c) => span(`flap-half ${c}`, el));
      const glyphs = halves.map((h) => span("flap-glyph", h));
      const shown = olds[i] ?? " ";
      glyphs[0].textContent = glyphs[1].textContent = shown;
      return { el, halves, glyphs, shown, plan: turns(shown, ch), step: 0, frames: keyframes(top, bot), running: [] };
    });
  }

  const turn = (c) => {
    const next = c.plan[c.step++], [t, b, f, k] = c.halves, [gt, gb, gf, gk] = c.glyphs;
    c.running.forEach((a) => a.cancel());
    gt.textContent = gk.textContent = next;     // behind the falling flap, and on the flap that lands
    gf.textContent = gb.textContent = c.shown;  // the old character, falling away and being covered
    const o = { duration: STEP, fill: "forwards" };
    c.running = [t.animate(c.frames.reveal, o), f.animate(c.frames.fall, o), k.animate(c.frames.land, o), b.animate(c.frames.cover, o)];
    c.shown = next;
  };

  const finish = () => {
    if (gone) return;
    gone = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    removeEventListener("resize", finish);
    layer.remove();
    onDone();
  };

  const tick = (now) => {
    let busy = false;
    cells.forEach((c, i) => {
      const due = began + i * pace + c.step * STEP;
      if (c.step < c.plan.length) {
        busy = true;
        if (now >= due) turn(c);
      }
    });
    // the last turn plays out, then the real text takes over, glyph for glyph where the flaps left off
    if (busy) frame = requestAnimationFrame(tick);
    else timer = setTimeout(finish, STEP);
  };

  return {
    go(delay) {
      if (asked || gone) return;
      asked = true;
      addEventListener("resize", finish);   // the cells were measured for this layout
      timer = setTimeout(() => {
        began = performance.now();
        frame = requestAnimationFrame(tick);
      }, delay);
    },
    stop() {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      removeEventListener("resize", finish);
      layer.remove();
    },
  };
}

export default function Flap({ text, from = "", intro = true, go = true, delay = 0, pace = STAGGER, className }) {
  const host = useRef(null), job = useRef(null);
  const shown = useRef(intro ? from : text);   // what the flaps start from: updated once a turn completes
  const live = useRef(go);
  live.current = go;

  useLayoutEffect(() => {
    const el = host.current, start = shown.current;
    if (start === text || still()) {
      shown.current = text;
      return;
    }
    el.dataset.flipping = "";
    let ended = false;
    const end = () => {
      ended = true;
      shown.current = text;
      delete el.dataset.flipping;
    };
    // the cells are measured in the page's own fonts
    let j = null;
    document.fonts.ready.then(() => {
      if (ended || !el.isConnected) return;
      j = job.current = board(el, start, text, pace, end);
      if (live.current) j.go(delay);
    });
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const quit = () => { j?.stop(); end(); };
    reduce.addEventListener("change", quit);
    return () => {
      reduce.removeEventListener("change", quit);
      ended = true;
      j?.stop();
      job.current = null;
      delete el.dataset.flipping;
    };
  }, [text]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (go) job.current?.go(delay);
  }, [go]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className={className ? `flap ${className}` : "flap"} ref={host}>
      <span className="flap-text">{text}</span>
    </span>
  );
}
