// Where the hero's cloud tops start, as a share of the first screen's height, placed from the layout. On wide screens
// the words and the pass stand side by side on clear sky, and the cloud tops start a little below the lower of them:
// at 70% of the screen, or lower when they reach further, down to 88%. On narrower screens only the words do, and
// the pass stands in the clouds below them. The live sky (vantaSky.js) and the still that stands in for it until it
// has drawn (Hero.jsx, hero.css) both ask here, so the one takes over from the other in place.
export function horizon(stage) {
  const copy = stage.querySelector(".hero-copy"), pass = stage.querySelector(".pass");
  const wide = matchMedia("(min-width: 900px)").matches;   // hero.css's wide layout
  const height = stage.offsetHeight || 1;
  const ref = Math.min(height, document.documentElement.clientHeight || height);   // the first screen's height
  const button = copy.lastElementChild, foot = copy.offsetTop + button.offsetTop + button.offsetHeight;   // of the words
  const floor = wide ? Math.max(foot, pass.offsetTop + pass.offsetHeight) + 64 : foot + 24;
  return { ref, at: Math.min(.88, Math.max(wide ? .7 : .45, floor / ref)) };
}
