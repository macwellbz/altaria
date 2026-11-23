// The page's scroll, from one place.
//
// While motion is allowed, Lenis smooths wheel and trackpad scrolling. Touch, the keyboard, the scrollbar
// and find-in-page stay native, and Lenis follows them. A visitor who asks for less motion never gets
// Lenis, and the browser scrolls on its own; the preference is followed as it changes. Either way:
// - onScroll(fn) runs fn once a frame while the page scrolls, so the hero's scene reads one position
//   whichever is in charge;
// - links to a place on the page glide there through Lenis, or jump as plain anchors without it;
// - scrollToElement, focusOn and showIn are how the app scrolls anything itself.
// Every stop is the one the browser would make: the target's scroll-margin box just below html's
// scroll-padding-top, which keeps it clear of the fixed header.
//
// Lenis's recommended stylesheet isn't included: it serves a Lenis that stays stopped (here it stops only for
// an instant, on Back and Forward), data-lenis-prevent, iframes and autoToggle, and pages that set
// html or body to a fixed height, none of which this page has.
import Lenis from "lenis";

const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set();
let lenis = null;
let frame = 0;
let following = false;

const emit = () => listeners.forEach((fn) => fn());
const onNativeScroll = () => {
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    emit();
  });
};

// Lists inside the page scroll natively, with Lenis leaving their wheel events alone: the finder's matches
// (Lenis keeps a scroller's size for two seconds, and the matches change with every key) and an open
// select's list (appearance: base-select, which Lenis can't see as a scroller). allowNestedScroll finds the
// rest as they scroll, such as a table wider than its frame.
const canOpen = CSS.supports("selector(:open)");
const prevent = (node) => node.matches('[role="listbox"]') || (canOpen && node.matches("select:open"));

function follow() {
  if (reduce.matches) {
    lenis?.destroy();
    lenis = null;
    addEventListener("scroll", onNativeScroll, { passive: true });
  } else if (!lenis) {
    removeEventListener("scroll", onNativeScroll);
    lenis = new Lenis({
      autoRaf: true,
      lerp: .15,                 // a touch quicker than the default .1: the page settles rather than floats
      allowNestedScroll: true,
      naiveDimensions: true,     // measured at each scroll, since a search's results grow the page
      prevent,
    });
    lenis.on("scroll", emit);
  }
  emit();
}

export function startScroll() {
  follow();
  reduce.addEventListener("change", follow);
  document.addEventListener("click", followLink);
  // Back and Forward restore the browser's own position; a glide still under way mustn't carry on past it.
  // Following a link to a place on the page fires popstate too, and that glide carries on.
  addEventListener("popstate", () => {
    if (following) return;
    lenis?.stop();
    lenis?.start();
  });
}

export function onScroll(fn) {
  listeners.add(fn);
  fn();
  return () => listeners.delete(fn);
}

// A link to a place on the page. The browser still follows it, so the address, history and the keyboard's
// place in the page all move to the target, and Lenis's first frame lands before the browser paints its jump.
function followLink(e) {
  if (!lenis || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.('a[href^="#"]');
  const target = link && document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (!target) return;
  scrollToElement(target);
  following = true;   // until the browser has followed the link, just after this click
  setTimeout(() => (following = false));
}

// The page's own moves ease in and out, over longer for longer distances, so a long one never lurches.
const glide = (distance) => ({
  duration: Math.min(1.2, .5 + Math.abs(distance) / 4000),
  easing: (t) => (t < .5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2),
});

// Where the browser's scrollIntoView would take the page for el: "start" brings it to the top of the view,
// "nearest" moves only as far as it takes to show it whole, and null means it's in view already.
function destination(el, block) {
  const box = el.getBoundingClientRect();
  const own = getComputedStyle(el);
  const page = getComputedStyle(document.documentElement);
  const top = box.top - (parseFloat(own.scrollMarginTop) || 0) - (parseFloat(page.scrollPaddingTop) || 0);
  const bottom = box.bottom + (parseFloat(own.scrollMarginBottom) || 0) + (parseFloat(page.scrollPaddingBottom) || 0)
    - document.documentElement.clientHeight;
  if (block === "nearest") {
    if (top >= 0 && bottom <= 0) return null;
    if (top >= 0 && bottom - top <= 0) return scrollY + bottom;   // below, and short enough to show whole
  }
  return scrollY + top;
}

export function scrollToElement(el, { block = "start" } = {}) {
  const y = destination(el, block);
  if (y === null) return;
  if (lenis) lenis.scrollTo(y, glide(y - lenis.scroll));
  else scrollTo({ top: y, behavior: "instant" });
}

// Focuses el without the browser's own jump, then brings it, or a larger box around it, into view.
export function focusOn(el, show = el) {
  el.focus({ preventScroll: true });
  scrollToElement(show, { block: "nearest" });
}

// Scrolls a list inside the page, such as the finder's matches, just far enough to show one of its items.
// The page itself stays put. A table wider than its frame scrolls sideways the same way, with the item kept
// `clear` of whatever is stuck to the frame's left edge (its row headings).
export function showIn(list, item, clear = 0) {
  const outer = list.getBoundingClientRect();
  const inner = item.getBoundingClientRect();
  if (inner.top < outer.top) list.scrollTop -= outer.top - inner.top;
  else if (inner.bottom > outer.bottom) list.scrollTop += inner.bottom - outer.bottom;
  if (inner.left < outer.left + clear) list.scrollLeft -= outer.left + clear - inner.left;
  else if (inner.right > outer.right) list.scrollLeft += inner.right - outer.right;
}
