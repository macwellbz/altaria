// Altaria's sky: Vanta's clouds effect (vanta/src/vanta.clouds.js) in the site's colours, with
// the pointer's wake spliced into its shader: the clouds thin and part along the pointer's path and close again over
// about a second, showing the land far below.
// Each frame is drawn in two passes. The clouds, the costly part, are marched at half resolution into a buffer that
// also records how much of each pixel the land shows through. The sharp pass then draws that buffer to the canvas at
// the screen's own resolution and paints the land there through a soft lens of its own, so the land is as soft as a
// photograph and no softer, at any pixel ratio. Outside a wake it only copies the buffer.
// Vanta's clouds always drift, so they're drawn 30 times a second while the hero is on screen (60 during a wake),
// and not at all once it isn't. Reduced motion gets one still frame. Under the canvas is a still of this sky's first
// frame (hero.css, made by posters.py), which is all that shows until the canvas has drawn, and for good without
// WebGL or on software GL, where compiling these shaders holds the page up for a second or two.
// startVantaSky(host) fills an empty element (VantaSky.jsx) and returns a function that stops it.
import { Camera, Color, ColorManagement, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from "three";
import CLOUDS from "vanta/src/vanta.clouds.js";
import { horizon } from "./horizon.js";

const TRAIL = 24;
const RENDER = 0.5;   // the clouds' pixels per CSS pixel: they're soft, and the shader marches every pixel every frame

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
// Vanta's shader takes its colours as written, as the three.js it was built on (r134) gave them. A newer three.js
// would first convert each to linear light, which darkens them all.
ColorManagement.enabled = false;

const themeName = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
// posters.py opens the page with ?still to photograph the sky. Its stills have no stars: where the stars dim depends on
// where the words are, so they come out with the live sky.
const STILL = new URLSearchParams(location.search).has("still");

// The view, shared by both passes: where a CSS pixel on the canvas looks. Framed to the first screen's height (uRef),
// so a canvas taller than the window looks further down below it, as the view Vanta's gallery shows on a retina
// screen (its iResolution leaves the pixel ratio out, so at 2x the frame spans twice the angle: sky above, where the
// words are, and clouds below), with the horizon raised by uLift. The camera sways slowly round the clouds.
const VIEW = `
vec2 viewAt(vec2 css) { return (4. * vec2(css.x, uRef - css.y) - vec2(uCss.x, uRef)) / uRef - vec2(0., uLift); }
mat3 camera(out vec3 ro) {
  vec2 m = iMouse.xy / iResolution.xy;
  m.y = (1. - m.y) * .33 + .28;
  m.x = m.x * .25 + sin(iTime * .1 + 3.1415) * .25 + .25;
  ro = 4. * normalize(vec3(sin(3. * m.x), .4 * m.y, cos(3. * m.x)));
  vec3 cw = normalize(vec3(0., -1., 0.) - ro), cu = normalize(cross(cw, vec3(0., 1., 0.)));
  return mat3(cu, normalize(cross(cu, cw)), cw);
}`;

// The wake, spliced into Vanta's shader. Each pixel's clouds are thinned by the wake over it, wisps first, so the
// gaps take the clouds' shape; the view is nudged aside round it; and where the clouds part, the pixel records how
// much of it is land, for the sharp pass.
function withWake(src) {
  const put = (find, text) => {
    if (!src.includes(find)) throw new Error(`the clouds shader has changed: no "${find}"`);
    src = src.replaceAll(find, text);
  };
  put("uniform vec3 backgroundColor;", `uniform vec3 backgroundColor;
uniform vec3 starColor;
uniform vec4 uTrail[${TRAIL}];   // the wake: x, y, radius (CSS px from the canvas's top left), strength
uniform vec2 uCss, uBuf;          // the canvas in CSS px, and this buffer in its own pixels
uniform float uRef, uLift;        // the view's framing (VIEW)
uniform vec4 uWords[8];           // the hero's lines of text: left, top, right, bottom, in CSS px on the canvas
float thin = 0.;                 // how hard the wake is thinning this pixel's clouds, 0 to 1
float starsHere = 1.;             // none behind the header, as in sky.js, and faint behind the words
float cover = 0.;                 // how much of this pixel is the land below, which the sharp pass paints
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
${VIEW}
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
  float d = length(q.xy * 1.5 / q.z - view) * uRef / 4. * uBuf.y / uCss.y;   // in drawn pixels
  float m = pow(fract(h * 17.3), 1.5);                                      // most faint, a few bright
  return m * (.85 + .15 * sin(iTime * 2. + h * 61.)) * exp(-d * d * .7);    // with a slow, faint twinkle
}`);
  // wisps go first, so the gaps take the clouds' shape
  put("1.75*f, 0.0, 1.0 );", "1.75*f - .6*thin, 0.0, 1.0 );");
  put("col = col*(1.0-res.w) + res.xyz;", `float open = smoothstep(.15, .95, thin);
    if (open > 0. && rd.y < 0.) {
      // where the clouds part, the land far below: the sky behind the clouds makes way for it
      cover = smoothstep(.02, .25, -rd.y);
      col *= 1. - cover;
      res *= 1. - open;
    }
    // stars at night, only in open sky: gone into the haze near the horizon and the moon's glow, hidden by clouds
    if (rd.y > 0. && dot(starColor, starColor) > 0.) col += starColor * stars(rd) * starsHere * smoothstep(.03, .3, rd.y) * (1. - pow(sun, 4.));
    col = col*(1.0-res.w) + res.xyz;
    cover *= 1. - res.w;`);
  put("return vec4( col, 1.0 );", "return vec4( col, cover );");
  // The wake pushes the view aside round the pointer's path, so the clouds there are shoved outward as they thin.
  put("vec2 p = (-iResolution.xy + 2.0*gl_FragCoord.xy)/ iResolution.y;", `vec2 css = vec2(gl_FragCoord.x, uBuf.y - gl_FragCoord.y) / uBuf * uCss;
    float gap = 1e4;
    for (int i = 0; i < 8; i++) gap = min(gap, length(max(max(uWords[i].xy - css, css - uWords[i].zw), 0.)));
    starsHere = smoothstep(60., 110., css.y) * mix(.3, 1., smoothstep(24., 64., gap));
    float w = wake(css);
    if (w > 0.) css +=vec2(wake(css + vec2(3., 0.)) - w, wake(css + vec2(0., 3.)) - w) / 3. * 26.;
    thin = w;
    vec2 p = viewAt(css);
    view = p;`);
  put("mat3 ca = setCamera( ro, ta, 0.0 );", "mat3 ca = setCamera( ro, ta, 0.0 );\n    cam = ca;");
  return src;
}

// The sharp pass: the clouds' buffer, drawn at the screen's resolution, and the land wherever the clouds have parted.
// The land is a plane far below, in two tones of the ground colour like a duotone print: farm blocks of long fields,
// each block a little askew; woods; lanes and roads; a winding river; towns. At night it goes dark and its lights
// come on: each town a cluster of lamps over a faint glow, and here and there a farm.
// It is seen the way a photograph through haze shows it, with nothing drawn on. Every edge and line passes through
// one soft lens (LENS), so a field's edge takes a few pixels to cross and a road is a faint thread that fades with
// distance, never a stroke. The ground bends a little under everything, so no edge or road runs ruler-straight.
// And nothing repeats along a line: a road shows in stretches, and no lamps are strung along it.
const SHARP = `
uniform sampler2D tClouds;
uniform vec2 uCss, uOut, iMouse, iResolution;
uniform float uRef, uLift, iTime;
uniform vec3 groundColor, hazeColor, lightsColor;
${VIEW}
const float LENS = 1.25;   // the lens's reach, in CSS px: an edge is this far either side of sharp
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 x) {
  vec2 i = floor(x), f = fract(x), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// the same noise with its slope: the value, then how fast it changes along x and along y
vec3 slope(vec2 x) {
  vec2 i = floor(x), f = fract(x), u = f * f * f * (f * (f * 6. - 15.) + 10.), du = 30. * f * f * (f * (f - 2.) + 1.);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), k = a - b - c + hash(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
}
float fbm(vec2 x) { return (4. * noise(x) + 2. * noise(x * 2.03 + 17.) + noise(x * 4.07 + 31.)) / 7.; }

// A pixel covers a slanted patch of ground, longer away from the camera than across it (gx and gy are its two
// sides). reach(n) is how far the lens spreads along the ground direction n, so an edge is softened across itself
// and no further.
vec2 gx, gy;
float lens;   // the lens in device pixels
float reach(vec2 n) { return lens * (abs(dot(gx, n)) + abs(dot(gy, n))); }
// how much of a line of half-width w shows, its middle e away, through a lens reaching s: a soft thread, never a stroke
float line(float e, float w, float s) { return smoothstep(-s, s, e + w) - smoothstep(-s, s, e - w); }
// how whole a patch is, e inside its edge: none of it at the edge itself, so neighbours meet in a soft seam
float inside(float e, float s) { return smoothstep(0., s, e); }

// The land below ground point g, d away.
vec3 land(vec2 g, float d) {
  // The ground bends a little under everything, so no field edge or road runs ruler-straight for long: h is here on
  // the bent ground, and the pixel's two sides bend with it.
  vec4 w = vec4(.71 * g.y + 1.3, .43 * g.x + .37 * g.y + 4.1, .67 * g.x + 2.9, .39 * g.y - .41 * g.x + .7), ws = sin(w), wc = .3 * cos(w);
  vec2 h = g + .3 * vec2(ws.x + .6 * ws.y, ws.z + .6 * ws.w);
  mat2 bend = mat2(1. + .258 * wc.y, .67 * wc.z - .246 * wc.w, .71 * wc.x + .222 * wc.y, 1. + .234 * wc.w);
  gx = bend * gx;
  gy = bend * gy;
  float px = max(length(gx), length(gy)), soft = lens * px;

  // Farm blocks, laid like bricks so their edges never run on into a grid. Each is cut into strips, a little askew
  // or turned a quarter, and each strip into fields of its own length. Fields in one block are of a kind, and meet
  // in the block's own tone; blocks meet in the land's. Far off, that is all that is left of them.
  vec2 bg = h / 2.;
  bg.x += hash(vec2(floor(bg.y), 4.2));
  vec2 b = floor(bg), f = (bg - b - .5) * 2.;
  float hb = hash(b), a = (hb - .5) * .35 + step(.55, hash(b + 2.7)) * 1.5708;
  vec2 n1 = vec2(cos(a), -sin(a)), n2 = vec2(sin(a), cos(a)), q = vec2(dot(n1, f), dot(n2, f));
  float sw = 2. / (3. + floor(hash(b + 5.1) * 4.));
  float si = floor(q.x / sw), fl = sw * (1. + 2.5 * hash(vec2(si, hb * 37.))), fy = q.y / fl + hash(vec2(si, hb * 53.));
  float hf = hash(vec2(si, floor(fy)) + b * 17.3);
  float field = inside((.5 - abs(fract(q.x / sw) - .5)) * sw, reach(n1)) * inside((.5 - abs(fract(fy) - .5)) * fl, reach(n2));
  float block = inside(1. - abs(f.x), reach(vec2(1., 0.))) * inside(1. - abs(f.y), reach(vec2(0., 1.)));
  float v = mix(.42, .32 + .26 * hash(b + 9.1) + .24 * (hf - .5) * field, block);
  v += .07 * (noise(h * 6.) - .5) * smoothstep(.06, .02, px);   // the soil's own unevenness, close up
  float straw = smoothstep(.78, .9, hf) * field * block * smoothstep(.16, .06, px);   // a few fields of straw, close up

  // copses
  float wk = .02 + soft;
  float wood = smoothstep(.66 - wk, .66 + wk, fbm(h * .8 + 3.));
  v = mix(v, .15 + .07 * mix(.5, noise(h * 14.), smoothstep(.05, .02, px)), wood);

  // lanes along some rows of blocks and roads crossing them at a slant, each showing only in stretches
  float row = floor(bg.y + .5), s2 = dot(h, vec2(.454, .891)) / 5., rank = floor(s2 + .5);
  float road = max(step(hash(vec2(row, 7.7)), .4) * line(abs(bg.y - row) * 2., .007, reach(vec2(0., 1.))),
                   step(hash(vec2(rank, 3.3)), .35) * line(abs(s2 - rank) * 5., .012, reach(vec2(.454, .891))));
  v = mix(v, .7, road * (.3 + .6 * smoothstep(.3, .6, noise(h * .45 + 40.))));

  // a river, winding, with wooded banks: where a slow noise crosses its middle, measured on the ground
  vec3 wind = slope(h * .3), rv = slope(h * .035 + 9. + .08 * wind.x);
  vec2 fall = .035 * rv.yz + .024 * (rv.y + rv.z) * wind.yz;
  float rx = abs(rv.x - .5) / max(length(fall), 1e-4), rs = reach(normalize(fall + 1e-6));
  v = mix(v, .2, line(rx, .1, rs) * .5);
  v = mix(v, .13, line(rx, .045, rs) * .7);

  // towns: built up most at the middle and ragged at the edge, each lying its own way (tp is here, along its two axes)
  float town = -1., ta = 0.;
  vec2 tc = floor(h / 6. - .5);
  for (int j = 0; j < 4; j++) {
    vec2 cell = tc + vec2(mod(float(j), 2.), floor(float(j) / 2.));
    vec2 at = (cell + .25 + .5 * vec2(hash(cell + .3), hash(cell + 1.7))) * 6.;
    float t = 1. - length(h - at) / (.6 + 1.1 * hash(cell + 4.1));
    if (hash(cell + 8.2) < .5 && t > town) { town = t; ta = hash(cell + 6.6) * 1.57; }
  }
  float built = town * .9 + .7 * (noise(h * 1.4 + 3.) * .6 + noise(h * 3.1) * .4 - .5), bk = .02 + soft;
  float urban = smoothstep(.2 - bk, .2 + bk, built);
  vec2 t1 = vec2(cos(ta), -sin(ta)), t2 = vec2(sin(ta), cos(ta)), tp = vec2(dot(t1, h), dot(t2, h));
  float grain = mix(1., .7 + .6 * noise(tp * 6.4), smoothstep(.1, .03, px));   // its streets and roofs, too fine to tell apart
  v = mix(v, .35 + .12 * grain, urban);

  // soft shadows of the clouds overhead, drifting with them
  v *= 1. - .22 * smoothstep(.45, .75, noise(g * .16 - vec2(.25, .5) * iTime * .05));

  // The duotone: deep ground at the dark end, a pale sage toward the haze at the light end; straw fields a little
  // warmer. Then the haze itself, with distance.
  vec3 c = mix(groundColor * vec3(.36, .58, .62), mix(groundColor * vec3(.9, 1.15, 1.), hazeColor, .5), clamp(v, 0., 1.));
  c *= mix(vec3(1.), vec3(1.1, 1.05, .86), straw);
  float T = exp(-d * .035);
  c = mix(hazeColor, c, .25 + .7 * T);
  if (dot(lightsColor, lightsColor) == 0.) return c;   // by day

  // The lights. Each lamp is a round soft point as wide as the lens, measured on the screen so it stays round however
  // steeply the ground is seen. A town's lamps thicken toward its heart, whiter there and amber at its edges, over
  // a faint glow. They stand a few pixels apart at every distance, as the eye picks out only the brightest of a far
  // town: two grids of places, the finer one fading out as it crowds while one twice as coarse comes in, and each
  // pixel adds up the four nearest of each, so no lamp is ever cut off. Here and there a farm. Nothing is strung
  // along a road.
  float det = gx.x * gy.y - gx.y * gy.x, lamps = 0.;
  mat2 screen = mat2(gy.y, -gx.y, -gy.x, gx.x) / (sign(det) * max(abs(det), 1e-12) * lens);   // the ground, in lens reaches on screen
  float crowd = log2(1.6 * soft / .14), level = max(0., ceil(crowd)), t = clamp(crowd - level + 1., 0., 1.);
  if (urban > 0.) for (int j = 0; j < 8; j++) {
    float coarse = floor(float(j) / 4.), gap = .14 * exp2(level + coarse);
    vec2 node = floor(tp / gap - .5) + vec2(mod(float(j), 2.), mod(floor(float(j) / 2.), 2.)), id = node + gap * 31.;   // a place, and its own number
    vec2 at = (node + .5 + (vec2(hash(id + 1.3), hash(id + 2.6)) - .5) * .5) * gap, e = screen * (t1 * at.x + t2 * at.y - h);
    lamps += mix(1. - smoothstep(.5, 1., t), smoothstep(0., .5, t), coarse) * smoothstep(0., .25, built * 1.5 - hash(id + 3.3))
      * (.45 + .7 * hash(id + 5.5)) * exp(-dot(e, e) * 1.6);
  }
  vec2 farm = floor(h / .5), fe = screen * ((farm + .35 + .3 * vec2(hash(farm + 4.4), hash(farm + 6.6))) * .5 - h);
  float farms = step(hash(farm + 2.2), .07) * (.25 + .35 * hash(farm)) * exp(-dot(fe, fe) * 1.6) * smoothstep(3., 5., .5 / soft);
  vec3 amber = lightsColor * vec3(1., .74, .44);
  vec3 lights = mix(amber, lightsColor, smoothstep(.5, 1.1, built)) * urban * ((.03 + .22 * built * built) * T + lamps) + amber * farms;
  return c + (1. - exp(-lights * 1.4)) * (.4 + .6 * T);
}

void main() {
  vec4 clouds = texture2D(tClouds, gl_FragCoord.xy / uOut);
  // this pixel's ray, as the clouds' pass casts it (without the wake's nudge: the land stays put as the clouds part)
  vec2 css = vec2(gl_FragCoord.x, uOut.y - gl_FragCoord.y) / uOut * uCss;
  vec3 ro;
  mat3 ca = camera(ro);
  vec3 rd = ca * normalize(vec3(viewAt(css), 1.5));
  float d = (ro.y + 6.) / max(-rd.y, .01);
  vec2 g = (ro + rd * d).xz;
  gx = dFdx(g);   // the pixel's two sides on the ground, taken here where every pixel runs
  gy = dFdy(g);
  lens = max(1., LENS * uOut.x / uCss.x);   // never finer than the pixels it is drawn in
  vec3 col = clouds.rgb;
  if (clouds.a > .002) col += clouds.a * land(g, d);
  gl_FragColor = vec4(col, 1.);
}`;

// Is there a GPU to draw on? Not without WebGL, and not when it runs in software (Windows' Basic Render Driver
// included): then the still under the canvas is the sky.
function gpu() {
  const gl = document.createElement("canvas").getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) return false;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return !soft;
}

export default function startVantaSky(host) {
  if (!gpu()) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => reduce.matches;

  // The clouds' buffer, and the canvas's resolution: the screen's own (up to 2x, and about 8 million pixels) where a
  // mouse or trackpad can part the clouds, and one pixel per CSS pixel on touch screens, whose buffer has half the pixels.
  const fine = matchMedia("(any-pointer: fine)").matches;
  const clouds = fine ? RENDER : RENDER * .7;
  const sharpness = (w, h) => Math.min(devicePixelRatio || 1, fine ? 2 : 1, Math.sqrt(8e6 / (w * h)));
  const buffer = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  const sharp = new Scene();

  const flat = new Float32Array(TRAIL * 4);
  const css = new Vector2(host.offsetWidth || 1, host.offsetHeight || 1);
  const words = new Float32Array(8 * 4).fill(-1e4);   // up to eight lines of text, far off the canvas when unused
  const view = {
    uTrail: { value: flat }, uCss: { value: css }, uWords: { value: words },
    uBuf: { value: new Vector2(1, 1) }, uOut: { value: new Vector2(1, 1) }, tClouds: { value: buffer.texture },
    uRef: { value: 1 }, uLift: { value: 0 },
  };
  // The view is framed to the first screen's height, with the horizon placed in it from the layout (horizon.js). When
  // the layout changes (the pass filling in, a resize), the horizon eases to its place.
  const stage = host.closest(".stage"), copy = stage.querySelector(".hero-copy"), pass = stage.querySelector(".pass");
  let lift = null;
  const frame = () => {
    const { ref, at } = horizon(stage);
    view.uRef.value = ref;
    // VIEW runs from -1 at the screen's foot to 3 at its top, and its camera looks 23.4 degrees down, which puts the
    // horizon at .648 plus the lift
    const next = 3 - 4 * at - .648;
    if (lift === null || still()) view.uLift.value = next;
    lift = next;
  };
  frame();

  // Vanta builds its scene from the three.js it's handed: here, the parts it uses, a renderer that draws in the two
  // passes, and a material that adds the wake to the clouds shader and makes the sharp pass beside it, on the same
  // uniforms, so a new theme's colours reach both.
  class WakeMaterial extends ShaderMaterial {
    constructor(params) {
      Object.assign(params.uniforms, view);
      super({ ...params, fragmentShader: withWake(params.fragmentShader) });
      const pass = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
        uniforms: params.uniforms, vertexShader: params.vertexShader, fragmentShader: SHARP,
      }));
      pass.frustumCulled = false;
      sharp.add(pass);
    }
  }
  class Renderer extends WebGLRenderer {
    constructor(params) {
      super({ ...params, antialias: false, depth: false, powerPreference: "low-power" });
      const render = this.render, setBuffer = this.setDrawingBufferSize;
      this.ready = false;   // until both passes' shaders have compiled (below), there is nothing to draw with
      this.render = (scene, camera) => {
        if (scene === sharp || !this.ready) return;
        this.setRenderTarget(buffer);
        render.call(this, scene, camera);
        this.setRenderTarget(null);
        render.call(this, sharp, camera);
      };
      // The canvas's size and resolution are ours, whatever pixel ratio Vanta asks for.
      this.setSize = (w, h) => {
        setBuffer.call(this, w, h, sharpness(w, h));
        Object.assign(this.domElement.style, { width: `${w}px`, height: `${h}px` });
        buffer.setSize(Math.max(1, Math.round(w * clouds)), Math.max(1, Math.round(h * clouds)));
        view.uBuf.value.set(buffer.width, buffer.height);
        view.uOut.value.set(this.domElement.width, this.domElement.height);
      };
      this.setPixelRatio = () => {};
    }
  }
  let effect;
  try {
    effect = CLOUDS({
      el: host,
      THREE: { Camera, Color, Mesh, PlaneGeometry, Scene, Vector2, Vector3, ShaderMaterial: WakeMaterial, WebGLRenderer: Renderer },
      mouseControls: false, touchControls: false, gyroControls: false,   // the pointer parts the clouds instead of turning the camera
      scale: 1, scaleMobile: 1,
      speed: 0.5,
      ...THEMES[themeName()],
      ...(STILL && { starColor: 0 }),
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
  let stopped = false;
  const pause = () => { cancelAnimationFrame(effect.req); effect.req = 0; };
  const resume = () => { if (!effect.req && visible && renderer.ready && !still()) effect.animationLoop(); };
  // The shaders compile in the background (the GPU process's own time, where the browser can say when they're done),
  // so the page goes on answering while they do: through Windows' Direct3D these two take a second or more, and
  // drawing with them at once would hold everything up for as long. Each pass compiles for the target it draws to.
  // Until they're ready nothing is drawn and the clock waits, so the first frame is the very one the still shows
  // (Vanta's clock starts at one second), and the canvas comes in over it unseen (hero.css fades it).
  pause();
  effect.t2 = 60;   // one second, in Vanta's sixtieths, where its clock would otherwise jump back to zero
  renderer.setRenderTarget(buffer);
  const clouded = renderer.compileAsync(effect.scene, effect.camera);
  renderer.setRenderTarget(null);
  Promise.all([clouded, renderer.compileAsync(sharp, effect.camera)]).then(() => {
    if (stopped) return;
    renderer.ready = true;
    draw();
    requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add("live")));
    resume();
  });

  // Where the hero's lines of text sit on the canvas, so the stars stay faint behind them and the words keep their
  // contrast. Measured again once the fonts are in and the words have risen into place; the scroll scene fades them
  // as they go. The button needs no room: its label sits on its own fill.
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
  const remeasure = () => { if (stopped) return; measure(); if (still()) draw(); };
  measure();
  document.fonts.ready.then(remeasure);
  copy.addEventListener("animationend", measure);

  effect.onResize = () => {
    css.set(effect.width, effect.height);
    u.iMouse.value.set(effect.width / 2, effect.height / 2);   // the camera's height comes from it: the same at every size
    frame();
    measure();
    draw();   // resizing cleared the canvas: redraw before it's painted, not on the next (throttled) frame
  };
  // The canvas follows the stage, whose height its content sets on narrow screens (the pass filling in), not only the
  // window; and the horizon follows the words and the pass.
  const sized = new ResizeObserver(() => {
    if (host.offsetWidth !== effect.width || host.offsetHeight !== effect.height) effect.resize();
    else { frame(); measure(); if (still()) draw(); }
  });
  for (const el of [host, copy, pass]) sized.observe(el);

  // The wake: recent pointer positions, each fading out over about a second. A finger leaves none: on a touch screen
  // it is scrolling the page, and a wake would only double the frame rate as it starts.
  const trail = [];

  // Vanta draws on every animation frame, 120 a second on some screens. The clouds drift slowly, so they're drawn
  // 30 times a second (24 on touch screens, whose GPUs are a phone's), and 60 while a wake is fading. Each frame is
  // due a whole gap after the last was due, so 24 a second holds on a 60Hz screen, alternating two and three refreshes.
  const loop = effect.animationLoop;
  let drawn = 0;
  effect.animationLoop = () => {
    const now = performance.now(), gap = 1000 / (trail.length ? 60 : fine ? 30 : 24);
    if (now - drawn < gap - 2) effect.req = requestAnimationFrame(effect.animationLoop);
    else { drawn = now - drawn < 2 * gap ? drawn + gap : now; loop(); }
  };
  let blend = null;   // a new theme's colours, blending in
  effect.onUpdate = () => {
    const now = performance.now();
    for (const p of trail) p.s = Math.exp(-(now - p.t) / 900);
    while (trail.length && trail[0].s < 0.01) trail.shift();
    flat.fill(0);
    trail.forEach((p, i) => flat.set([p.x, p.y, p.r, p.s], i * 4));
    view.uLift.value += (lift - view.uLift.value) * .25;
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
    if (still() || e.pointerType === "touch") return;
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
    sized.disconnect();
    themer.disconnect();
    reduce.removeEventListener("change", motion);
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerleave", leave);
    copy.removeEventListener("animationend", measure);
    canvas.removeEventListener("webglcontextlost", lost);
    effect.destroy();
    for (const m of sharp.children) { m.geometry.dispose(); m.material.dispose(); }
    buffer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();   // Vanta leaves the context open, and a hot reload would pile them up
  };
}
