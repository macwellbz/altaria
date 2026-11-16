// Altaria's sky: Vanta's clouds effect (vanta/src/vanta.clouds.js, on three.js r134) in the site's colours, with
// the pointer's wake from sky.js spliced into its shader: the clouds thin and part along the pointer's path and
// close again over about a second.
// Vanta's clouds always drift, so they're drawn 30 times a second while the hero is on screen (60 during a wake),
// and not at all once it isn't. Reduced motion and software GL get one still frame. Without WebGL the CSS gradient
// behind the sky stays.
// startVantaSky(host) fills an empty element (VantaSky.jsx) and returns a function that stops it.
import { Camera, Color, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer } from "three";
import CLOUDS from "vanta/src/vanta.clouds.js";

const TRAIL = 24;
const RENDER = 0.5;   // pixels drawn per CSS pixel: the clouds are soft, and the shader marches every pixel every frame

// Vanta's options per theme, as in sky.js's THEMES and kept in step with the CSS tokens.
// Light: morning above the clouds. Dark: a night flight, the moon low on the horizon.
const THEMES = {
  light: { skyColor: 0x96b6f9, cloudColor: 0xa0b5da, cloudShadowColor: 0x4a72a0, sunColor: 0xffb24c,
           sunGlareColor: 0xe6b380, sunlightColor: 0xf0f5ff, groundColor: 0x507889, hazeColor: 0xeef5ff, lightsColor: 0x000000,
           starColor: 0x000000 },
  dark:  { skyColor: 0x000e2b, cloudColor: 0x122a45, cloudShadowColor: 0x030a12, sunColor: 0x40738c,
           sunGlareColor: 0x26404d, sunlightColor: 0x7fa3bd, groundColor: 0x041622, hazeColor: 0x193d4d, lightsColor: 0xffe2b8,
           starColor: 0xc8d6e4 },
};
const themeName = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

// The wake, spliced into Vanta's shader. Each pixel's clouds are thinned by the wake over it, wisps first, so the
// gaps take the clouds' shape; the view is nudged aside round it; and where the clouds part, the ground shows.
function withWake(src) {
  const put = (find, text) => {
    if (!src.includes(find)) throw new Error(`the clouds shader has changed: no "${find}"`);
    src = src.replaceAll(find, text);
  };
  put("uniform vec3 backgroundColor;", `uniform vec3 backgroundColor;
uniform float iDpr;
uniform vec3 groundColor, hazeColor, lightsColor, starColor;
uniform vec4 uTrail[${TRAIL}];   // the wake: x, y, radius (CSS px from the canvas's top left), strength
uniform vec2 uCss;                // the canvas in CSS px
uniform vec4 uWords[8];           // the hero's lines of text: left, top, right, bottom, in CSS px on the canvas
float thin = 0.;                  // how hard the wake is thinning this pixel's clouds, 0 to 1
float starsHere = 1.;             // none behind the header, as in sky.js, and faint behind the words
float wake(vec2 p) {
  float w = 0.;
  for (int i = 0; i < ${TRAIL - 1}; i++) {
    vec4 a = uTrail[i], b = uTrail[i + 1];
    if (a.w <= .001 || b.w <= .001) continue;
    vec2 pa = p - a.xy, ba = b.xy - a.xy;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1.), 0., 1.);
    float r = mix(a.z, b.z, k);
    w = max(w, mix(a.w, b.w, k) * smoothstep(r, r * .2, length(pa - ba * k)));
  }
  return w;
}
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise2(vec2 x) {
  vec2 i = floor(x), f = fract(x), u = f * f * (3. - 2. * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
// A sparse sky of stars, fixed to the heavens so they turn with the camera. The sky is gridded by bearing (from the
// camera's middle heading, so the seam stays behind it) and elevation, and about one cell in six holds a star, set well
// inside it. Each is projected to the screen and drawn about a pixel wide, so it stays a point even at the wide
// edges of the view, and glides rather than flickers as the view sways.
mat3 cam;                         // the camera, and this pixel's place in its view
vec2 view;
float stars(vec3 rd) {
  vec2 s = vec2(atan(dot(rd.xz, vec2(-.431, .902)), dot(rd.xz, vec2(-.902, -.431))), asin(rd.y)) * 22.;
  vec2 c = floor(s);
  float h = hash2(c);
  if (h < .84) return 0.;
  vec2 a = (c + .3 + .4 * vec2(hash2(c + 3.1), hash2(c + 5.7))) / 22.;   // the star's bearing and elevation
  vec3 q = vec3(cos(a.y) * vec2(dot(vec2(sin(a.x), cos(a.x)), vec2(-.431, -.902)), dot(vec2(sin(a.x), cos(a.x)), vec2(.902, -.431))), sin(a.y)).xzy * cam;
  if (q.z <= 0.) return 0.;
  float d = length(q.xy * 1.5 / q.z - view) * iResolution.y * iDpr / 4.;   // in drawn pixels
  float m = pow(fract(h * 17.3), 1.5);                                      // most faint, a few bright
  return m * (.85 + .15 * sin(iTime * 2. + h * 61.)) * exp(-d * d * .7);    // with a slow, faint twinkle
}`);
  // wisps go first, so the gaps take the clouds' shape
  put("1.75*f, 0.0, 1.0 );", "1.75*f - .6*thin, 0.0, 1.0 );");
  put("col = col*(1.0-res.w) + res.xyz;", `float open = smoothstep(.15, .95, thin);
    if (open > 0. && rd.y < 0.) {
      // where the clouds part, the land far below: fields, and at night the lights of towns, deep in haze
      float d = (ro.y + 6.) / max(-rd.y, .01);
      vec2 g = (ro + rd * d).xz;
      // farmland from cruising height: plots, each its own tone and some a little warmer. No lanes between them:
      // seen this flat they are thinner than a pixel, and break up into rows of dots
      vec2 cell = floor(g * 1.1 + noise2(g * .2) * 1.5);   // a slow wander, so the plots aren't ruler-straight
      vec3 land = mix(groundColor, mix(groundColor, hazeColor, .55), hash2(cell));
      land *= mix(vec3(1.), vec3(1.1, 1.04, .84), step(.6, hash2(cell + 7.3)));
      float town = smoothstep(.45, .75, noise2(g * .3 + 9.));
      vec2 lc = g * 2.5;
      land += lightsColor * (step(.8, hash2(floor(lc))) * smoothstep(.45, .05, length(fract(lc) - .5)) + .12) * town;
      col = mix(col, mix(hazeColor, land, .2 + .5 * exp(-d * .05)), smoothstep(.02, .25, -rd.y));
      res *= 1. - open;
    }
    // stars at night, only in open sky: gone into the haze near the horizon and the moon's glow, hidden by clouds
    if (rd.y > 0. && dot(starColor, starColor) > 0.) col += starColor * stars(rd) * starsHere * smoothstep(.03, .3, rd.y) * (1. - pow(sun, 4.));
    col = col*(1.0-res.w) + res.xyz;`);
  // The view as Vanta's gallery shows it on a retina screen, whatever the pixel ratio. Its iResolution leaves the
  // ratio out, so at 2x the frame spans twice the angle and the horizon drops to about 60% down: sky above, where
  // the words are, and clouds below. At 1x the camera sits in the clouds and the whole frame is fog.
  // A phone's first screen is mostly words, so there the horizon rises to about halfway, as in sky.js.
  // The wake pushes the view aside round the pointer's path, so the clouds there are shoved outward as they thin.
  put("vec2 p = (-iResolution.xy + 2.0*gl_FragCoord.xy)/ iResolution.y;", `vec2 css = vec2(gl_FragCoord.x, iResolution.y * iDpr - gl_FragCoord.y) / (iResolution.xy * iDpr) * uCss;
    float gap = 1e4;
    for (int i = 0; i < 8; i++) gap = min(gap, length(max(max(uWords[i].xy - css, css - uWords[i].zw), 0.)));
    starsHere = smoothstep(60., 110., css.y) * mix(.3, 1., smoothstep(24., 64., gap));
    float w = wake(css);
    if (w > 0.) css +=vec2(wake(css + vec2(3., 0.)) - w, wake(css + vec2(0., 3.)) - w) / 3. * 26.;
    thin = w;
    vec2 p = (4. * vec2(css.x, uCss.y - css.y) - uCss) / uCss.y - vec2(0., uCss.x < 700. ? .4 : 0.);
    view = p;`);
  put("mat3 ca = setCamera( ro, ta, 0.0 );", "mat3 ca = setCamera( ro, ta, 0.0 );\n    cam = ca;");
  return src;
}

// Is there a GPU? Software WebGL gets one still frame, drawn small.
function probe() {
  const c = document.createElement("canvas");
  let gl = c.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  const flagged = !gl;
  if (flagged) gl = c.getContext("webgl");
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const soft = flagged || /swiftshader|llvmpipe|software/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { soft };
}

export default function startVantaSky(host) {
  const gpu = probe();
  if (!gpu) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => gpu.soft || reduce.matches;

  // Vanta builds its scene from the three.js it's handed: here, the parts it uses, a renderer without the
  // multisampling a full-screen shader can't use, and a material that adds the wake to the clouds shader.
  const flat = new Float32Array(TRAIL * 4);
  const css = new Vector2(host.offsetWidth || 1, host.offsetHeight || 1);
  const words = new Float32Array(8 * 4).fill(-1e4);   // up to eight lines of text, far off the canvas when unused
  class WakeMaterial extends ShaderMaterial {
    constructor(params) {
      Object.assign(params.uniforms, { uTrail: { value: flat }, uCss: { value: css }, uWords: { value: words } });
      super({ ...params, fragmentShader: withWake(params.fragmentShader) });
    }
  }
  class Renderer extends WebGLRenderer {
    constructor(params) { super({ ...params, antialias: false, powerPreference: "low-power" }); }
  }
  const scale = (devicePixelRatio || 1) / (gpu.soft ? RENDER / 2 : RENDER);
  let effect;
  try {
    effect = CLOUDS({
      el: host,
      THREE: { Camera, Color, Mesh, PlaneGeometry, Scene, Vector2, Vector3, ShaderMaterial: WakeMaterial, WebGLRenderer: Renderer },
      mouseControls: false, touchControls: false, gyroControls: false,   // the pointer parts the clouds instead of turning the camera
      scale, scaleMobile: scale,
      speed: 0.5,
      ...THEMES[themeName()],
    });
  } catch (e) {
    console.warn("sky:", e.message);
    return;
  }
  if (!effect.camera) return;   // Vanta has already reported why
  const { renderer, uniforms: u } = effect;
  const canvas = renderer.domElement;
  const draw = () => renderer.render(effect.scene, effect.camera);
  let visible = true;   // whether the hero is on screen
  const pause = () => { cancelAnimationFrame(effect.req); effect.req = 0; };
  const resume = () => { if (!effect.req && visible && !still()) effect.animationLoop(); };
  if (still()) pause();

  // Where the hero's lines of text sit on the canvas, so the stars stay faint behind them and the words keep their
  // contrast. Measured again once the fonts are in and the words have risen into place; the scroll scene fades them
  // as they go. The button needs no room: its label sits on its own fill.
  const stage = host.closest(".stage"), copy = stage.querySelector(".hero-copy");
  const measure = () => {
    const r = host.getBoundingClientRect(), k = effect.width / r.width, range = document.createRange(), lines = [];
    for (const el of copy.querySelectorAll("h1, .lede")) {
      // each line of text, not the full-width blocks it sits in (the headline's lines are blocks, for their masks)
      const texts = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (texts.nextNode()) {
        range.selectNodeContents(texts.currentNode);
        for (const b of range.getClientRects()) if (b.width > 2) lines.push(b);
      }
    }
    words.fill(-1e4);
    lines.slice(0, 8).forEach((b, i) => words.set([(b.left - r.left) * k, (b.top - r.top) * k, (b.right - r.left) * k, (b.bottom - r.top) * k], i * 4));
  };
  let stopped = false;
  const remeasure = () => { if (stopped) return; measure(); if (still()) draw(); };
  measure();
  document.fonts.ready.then(remeasure);
  copy.addEventListener("animationend", measure);

  effect.onResize = () => {
    css.set(effect.width, effect.height);
    u.iDpr.value = devicePixelRatio || 1;
    measure();
    if (still()) requestAnimationFrame(draw);   // resizing cleared the canvas
  };

  // The wake: recent pointer positions, each fading out over about a second.
  const trail = [];

  // Vanta draws on every animation frame, 120 a second on some screens. The clouds drift slowly, so they're drawn
  // 30 times a second, and 60 while a wake is fading.
  const loop = effect.animationLoop;
  let drawn = 0;
  effect.animationLoop = () => {
    const now = performance.now();
    if (now - drawn < (trail.length ? 15 : 31)) effect.req = requestAnimationFrame(effect.animationLoop);
    else { drawn = now; loop(); }
  };
  let blend = null;   // a new theme's colours, blending in
  effect.onUpdate = () => {
    const now = performance.now();
    for (const p of trail) p.s = Math.exp(-(now - p.t) / 900);
    while (trail.length && trail[0].s < 0.01) trail.shift();
    flat.fill(0);
    trail.forEach((p, i) => flat.set([p.x, p.y, p.r, p.s], i * 4));
    if (blend) {
      const k = Math.min(1, (now - blend.start) / 600);
      for (const key in blend.to) u[key].value.lerpVectors(blend.from[key], blend.to[key], k);
      if (k === 1) blend = null;
    }
  };

  // A new theme blends in over 600ms, or at once when the sky is still.
  const themer = new MutationObserver(() => {
    const next = THEMES[themeName()];
    const from = {}, to = {};
    for (const key in next) {
      from[key] = u[key].value.clone();
      to[key] = new Color(next[key]).toVector();
    }
    Object.assign(effect.options, next);
    if (still()) { effect.updateUniforms(); draw(); } else blend = { from, to, start: performance.now() };
  });
  themer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const seen = new IntersectionObserver(([e]) => ((visible = e.isIntersecting) ? resume() : pause()));
  seen.observe(host);
  const motion = () => { if (still()) { pause(); trail.length = 0; flat.fill(0); draw(); } else resume(); };
  reduce.addEventListener("change", motion);

  let last = null;
  const move = (e) => {
    if (still()) return;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
    if (last && Math.hypot(x - last.x, y - last.y) < 6) return;
    const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(8, now - last.t) : 0;   // px per ms
    last = { x, y, t: now };
    trail.push({ x: x * (effect.width / r.width), y: y * (effect.height / r.height), r: Math.min(160, 70 + speed * 55), s: 1, t: now });
    if (trail.length > TRAIL) trail.shift();
  };
  const leave = () => (last = null);
  const lost = () => { pause(); canvas.hidden = true; };
  stage.addEventListener("pointermove", move, { passive: true });
  stage.addEventListener("pointerleave", leave);
  canvas.addEventListener("webglcontextlost", lost);

  return () => {
    stopped = true;
    seen.disconnect();
    themer.disconnect();
    reduce.removeEventListener("change", motion);
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerleave", leave);
    copy.removeEventListener("animationend", measure);
    canvas.removeEventListener("webglcontextlost", lost);
    effect.destroy();
    renderer.dispose();
    renderer.forceContextLoss();   // Vanta leaves the context open, and a hot reload would pile them up
  };
}
