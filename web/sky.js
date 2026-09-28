// Altaria AI sky: the view from above a layer of clouds, drawn with WebGL.
// Pass 1 (costly, once per size, spread over frames): march each pixel's ray through a layer of cumulus domes and store
//   its lighting: R = sunlight, G = ambient depth, B = rim light, A = thickness.
// Pass 2 (cheap, only while something moves): paint sky, ground haze and clouds from that texture,
//   in the current theme's colours, carving the wake the pointer leaves.
// Nothing renders while the scene is still. Without WebGL the CSS gradient behind the canvas stays.
(() => {
  const canvas = document.getElementById("clouds");
  const opts = { antialias: false, depth: false, stencil: false, powerPreference: "low-power" };
  let gl = canvas && canvas.getContext("webgl", { ...opts, failIfMajorPerformanceCaveat: true });
  const flagged = !gl;
  if (flagged) gl = canvas && canvas.getContext("webgl", opts);
  if (!gl) return;
  // No GPU: WebGL runs on the CPU, so draw the clouds once, smaller, and keep them still. Not every
  // software renderer raises the caveat above, so its name is checked too.
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const soft = flagged || /swiftshader|llvmpipe|software/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const TRAIL = 24;
  const still = () => soft || reduce.matches;

  const common = `
    precision highp float;
    uniform vec2 uCss;       // canvas size in CSS px
    uniform float uHorizon;  // horizon, CSS px from the top
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float noise(vec2 x) {
      vec2 i = floor(x), f = fract(x), u = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    // the view ray for a point on screen: camera 1 unit above the cloud base, looking at the horizon
    vec3 ray(vec2 css) { return normalize(vec3((css.x - .5 * uCss.x) / uCss.y, (uHorizon - css.y) / uCss.y, 1.35)); }
  `;

  const vert = `attribute vec2 a; void main() { gl_Position = vec4(a, 0, 1); }`;

  const pass1 = common + `
    uniform vec2 uRes;
    const float TOP = .82;    // cloud tops reach this high above the base; the camera sits at 1
    const vec3 SUN = vec3(.78, .34, .52);
    // A cumulus is a heap of round puffs: in each cell of a jittered grid sits one ball, and the
    // surface is the height of the balls' tops. Three sizes of ball, summed, give the cauliflower.
    float smax(float a, float b, float k) { float h = clamp(.5 + .5 * (a - b) / k, 0., 1.); return mix(b, a, h) + k * h * (1. - h); }
    float balls(vec2 p, float seed) {
      vec2 i = floor(p), f = fract(p);
      float h = 0.;
      for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 c = vec2(float(x), float(y)), k = i + c + seed;
        vec2 d = c + vec2(hash(k), hash(k + 19.1)) - f;
        float r = .42 + .5 * hash(k + 7.7);
        h = smax(h, sqrt(max(r * r - dot(d, d), 0.)), .18);   // soft creases between puffs
      }
      return h;
    }
    float cloud(vec2 xz, float lod) {
      vec2 q = xz * .95;
      q += vec2(noise(q * .3), noise(q * .3 + 5.2)) * 1.4;   // warp: clusters and lanes instead of a grid
      float size = smoothstep(.12, .75, noise(q * .21 + 2.)) * 1.3;   // some regions tower, some lie low, a few open up
      float h = balls(q, 0.) * size;
      h += balls(q * 2.2 + 3.1, 11.) / 2.2 * (.4 + h) * clamp(lod, 0., 1.);
      h += balls(q * 4.7 + 7.7, 23.) / 4.7 * (.3 + h) * clamp(lod - 1., 0., 1.);
      h += balls(q * 9.8 + 1.3, 37.) / 9.8 * (.2 + h) * clamp(lod - 2., 0., 1.);
      h += (noise(q * 7.3) + .5 * noise(q * 15.1) - .75) * .07 * clamp(lod - 2., 0., 1.);   // fine fluff up close
      h = max(h, .09 + .07 * noise(q * 1.3));   // an unbroken floor deep in the valleys: the ground shows only where the pointer parts it
      return TOP * (1. - exp(-.8 * h));   // tall heaps round off below the ceiling instead of flattening
    }
    vec4 trace(vec2 css) {
      vec3 rd = ray(css);
      float t0 = (1. - TOP) / max(-rd.y, 1e-4);
      if (t0 > 60.) return vec4(0);   // beyond this the horizon haze covers everything
      vec3 ro = vec3(0, 1, 0);
      float t1 = min(1. / -rd.y, t0 + 30.);
      float lod = clamp(3.4 - log2(t0) * 1.1, 0., 3.);     // drop the small puffs far away
      // Step with the gap between the ray and the cloud tops: long strides in open air, tiny ones
      // near a surface, so no puff is skipped and every silhouette comes out clean.
      float t = t0, prev = t0, hit = -1., clear = 1.;
      bool away = false;
      for (int i = 0; i < 110; i++) {
        vec3 p = ro + rd * t;
        float d = p.y - cloud(p.xz, lod);
        if (d < .0004 * t) { hit = t; break; }
        clear = min(clear, d / t);   // how narrowly the ray cleared the clouds, as an angle
        if (t > t1) { away = true; break; }
        prev = t;
        t += max(d * .45, .0015 * t);
      }
      if (hit < 0. && !away) hit = t;   // out of steps while skimming the floor: that is a hit
      if (hit > 0.) {   // refine the entry point between the last two steps
        float a = prev, b = hit;
        for (int j = 0; j < 5; j++) { float m = .5 * (a + b); vec3 q = ro + rd * m; if (cloud(q.xz, lod) > q.y) b = m; else a = m; }
        hit = b;
      }
      float cover = hit > 0. ? 1. : 1. - smoothstep(0., .0035, clear);   // near misses fade out: soft edges
      if (hit < 0.) return vec4(.6, .5, 0, cover);   // a near miss: lit like its surroundings
      vec3 p = ro + rd * hit;
      float e = .012 * hit;   // a wide step: smooth normals, no speckled shading
      float h = cloud(p.xz, lod);
      vec3 n = normalize(vec3(h - cloud(p.xz + vec2(e, 0), lod), e, h - cloud(p.xz + vec2(0, e), lod)));
      vec3 l = normalize(SUN);
      float sun = clamp((dot(n, l) + .12) / 1.12, 0., 1.);
      float shade = 1.;
      for (int i = 1; i <= 5; i++) {
        vec3 q = p + l * (.1 * float(i));
        shade -= .13 * smoothstep(0., .05, cloud(q.xz, lod - 1.) - q.y);
      }
      float ao = clamp(p.y / TOP, 0., 1.);
      // a faint silver lining toward the sun, kept off the very edge where it would bead into dots
      float rim = pow(1. - clamp(dot(n, -rd), 0., 1.), 3.) * .35 * clamp(dot(normalize(rd.xz), normalize(l.xz)) * .5 + .5, 0., 1.);
      return vec4(sun * max(shade, 0.), ao, rim, cover);
    }
    uniform float uSamples;   // rays per pixel: 4 with a GPU, 1 without
    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y), k = uCss / uRes;
      if (uSamples < 2.) { gl_FragColor = trace(px * k); return; }
      // Four rays on a rotated grid, averaged: a ridge against the clouds behind it gets four steps
      // of blend instead of a hard, stair-stepped edge.
      vec4 sum = vec4(0);
      for (int i = 0; i < 4; i++) {
        float a = 1.249 - 1.5708 * float(i);
        sum += trace((px + .395 * vec2(cos(a), sin(a))) * k);
      }
      gl_FragColor = sum * .25;
    }
  `;

  const pass2 = common + `
    uniform sampler2D uTex;
    uniform vec2 uRes, uSun;
    uniform float uReveal, uStars;
    uniform vec3 uSkyTop, uSkyMid, uHaze, uGlow, uLit, uShade, uDeep, uRim, uGround, uFar, uLights;
    uniform vec4 uTrail[${TRAIL}];   // x, y, radius (CSS px), strength
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
    void main() {
      vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * uCss / uRes;
      float H = uCss.y;
      // sky: a gradient down to a warm haze at the horizon, a soft glow round the sun, stars at night
      float up = clamp(css.y / uHorizon, 0., 1.);
      vec3 sky = mix(uSkyTop, uSkyMid, smoothstep(0., 1., up));
      sky = mix(sky, uHaze, pow(up, 6.));
      float glow = exp(-length((css - uSun) / H) * 2.4);
      sky += uGlow * glow;
      vec2 cell = floor(css / 2.5);
      float star = step(.9972, hash(cell)) * hash(cell + 7.) * (1. - up) * smoothstep(70., 130., css.y) * uStars;   // none behind the header
      sky += star * .9;
      vec3 col = sky;
      if (css.y > uHorizon) {
        // the ground, far below and deep in haze, seen through gaps in the clouds
        vec3 rd = ray(css);
        vec2 g = rd.xz * (4. / -rd.y);
        float f = noise(g * .9) * .6 + noise(g * 3.1) * .4;
        vec3 ground = mix(uGround, uFar, smoothstep(.3, .7, f));
        vec2 lc = g * 7.;
        float town = smoothstep(.45, .75, noise(g * .5 + 9.));
        float light = step(.8, hash(floor(lc))) * smoothstep(.45, .1, length(fract(lc) - .5)) * town;
        ground += uLights * (light + town * .12);   // at night, towns glitter and their streets glow faintly
        float away = clamp((css.y - uHorizon) / (H - uHorizon), 0., 1.);
        ground = mix(uHaze, ground, .25 + .45 * smoothstep(0., 1., away));
        // clouds, pushed aside and thinned by the pointer's wake
        float e = 3.;
        float w = wake(css);
        vec2 push = vec2(wake(css + vec2(e, 0)) - w, wake(css + vec2(0, e)) - w) / e;
        vec2 uv = (css - push * 26.) / uCss * vec2(1, -1) + vec2(0, 1), px = 1. / uRes;
        vec4 c = texture2D(uTex, uv) * .4;   // a small tent filter softens the silhouettes
        c += (texture2D(uTex, uv + vec2(px.x, 0)) + texture2D(uTex, uv - vec2(px.x, 0)) + texture2D(uTex, uv + vec2(0, px.y)) + texture2D(uTex, uv - vec2(0, px.y))) * .15;
        vec3 cloud = mix(uShade, uLit, c.r);
        cloud = mix(uDeep, cloud, .45 + .55 * smoothstep(.05, .7, c.g));
        cloud += uRim * c.b;
        // the clouds gather as the page opens; the wake thins them, valleys first, so holes take the clouds' shape
        float th = 1. - uReveal;
        float thin = smoothstep(.08, .75, w * (1.45 - .9 * c.g));
        float cover = smoothstep(th, th + .2, c.a) * (1. - thin);
        col = mix(ground, cloud, cover);
        // aerial perspective: everything melts into the horizon haze with distance
        float haze = exp(-(css.y - uHorizon) / (H * .11));
        col = mix(col, uHaze + uGlow * glow * .6, clamp(haze, 0., 1.));
        col += uGlow * glow * .25 * cover;
      }
      col += (hash(gl_FragCoord.xy + 17.) - .5) / 255.;   // dither, so gradients never band
      gl_FragColor = vec4(col, 1);
    }
  `;

  function program(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) {
      const name = gl.getActiveUniform(p, i).name.replace("[0]", "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  let light, paint;
  try { light = program(pass1); paint = program(pass2); } catch (e) { console.warn("sky:", e.message); return; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();

  // Colours per theme, as 0..1 RGB. Light: morning above the clouds. Dark: a night flight over a lit-up country.
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const THEMES = {
    light: { skyTop: "#86B6F6", skyMid: "#B4D4FF", haze: "#EEF5FF", glow: "#23272C", lit: "#FFFFFF", shade: "#A6CBFC",
             deep: "#7A9BC6", rim: "#FFFFFF", ground: "#507889", far: "#97AFBA", lights: "#000000", stars: 0 },
    dark:  { skyTop: "#010C17", skyMid: "#002135", haze: "#193D4D", glow: "#041824", lit: "#93B7CD", shade: "#305A75",
             deep: "#123449", rim: "#B2CFE1", ground: "#041622", far: "#081F2D", lights: "#FFE2B8", stars: 1 },
  };
  const themeName = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const palette = (name) => Object.fromEntries(Object.entries(THEMES[name]).map(([k, v]) => [k, typeof v === "string" ? hex(v) : v]));
  let colors = palette(themeName()), from = colors, to = colors, blendStart = 0;

  let css = [1, 1], res = [1, 1], horizon = 1, sun = [0, 0];
  function size() {
    const scale = soft ? 0.5 : Math.min(devicePixelRatio || 1, 1.5);
    css = [Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight)];   // layout size: the scroll scene scales the canvas
    res = [Math.round(css[0] * scale), Math.round(css[1] * scale)];
    if (canvas.width === res[0] && canvas.height === res[1]) return false;
    canvas.width = res[0];
    canvas.height = res[1];
    horizon = css[1] * (css[0] < 700 ? 0.5 : 0.63);   // a phone's first screen is mostly words: lift the horizon to leave room for the clouds
    sun = [css[0] * 0.86, horizon - css[1] * 0.3];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, res[0], res[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    todo = STRIPS;
    return true;
  }

  // The lighting pass is the costly one: about half a second on a laptop GPU, more without one. So it runs in
  // strips of the rows below the horizon, one strip per frame, and the page never freezes. The clouds gather once it's done.
  const STRIPS = 36;   // about 12ms each on a laptop GPU
  let todo = 0;   // strips still to compute
  function lightStrip() {
    const rows = Math.ceil(res[1] * (1 - horizon / css[1])) + 2;   // GL rows count up from the bottom edge
    const h = Math.ceil(rows / STRIPS), i = STRIPS - todo--;
    const y = Math.max(0, rows - (i + 1) * h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, res[0], res[1]);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, y, res[0], Math.max(0, rows - i * h - y));
    gl.useProgram(light.p);
    gl.uniform2f(light.u.uCss, ...css);
    gl.uniform2f(light.u.uRes, ...res);
    gl.uniform1f(light.u.uHorizon, horizon);
    gl.uniform1f(light.u.uSamples, soft ? 1 : 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // The wake: recent pointer positions, each fading out over about a second.
  const trail = [];
  let reveal = still() ? 1 : 0, revealStart = 0;
  function draw(now) {
    gl.viewport(0, 0, res[0], res[1]);
    gl.useProgram(paint.p);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const u = paint.u;
    gl.uniform2f(u.uCss, ...css);
    gl.uniform2f(u.uRes, ...res);
    gl.uniform1f(u.uHorizon, horizon);
    gl.uniform2f(u.uSun, ...sun);
    gl.uniform1f(u.uReveal, reveal);
    const k = Math.min(1, (now - blendStart) / 600);
    const mixed = (key) => from[key].map((v, i) => v + (to[key][i] - v) * k);
    for (const key of ["skyTop", "skyMid", "haze", "glow", "lit", "shade", "deep", "rim", "ground", "far", "lights"])
      gl.uniform3f(u["u" + key[0].toUpperCase() + key.slice(1)], ...mixed(key));
    gl.uniform1f(u.uStars, from.stars + (to.stars - from.stars) * k);
    const flat = new Float32Array(TRAIL * 4);
    trail.forEach((p, i) => flat.set([p.x, p.y, p.r, p.s], i * 4));
    gl.uniform4fv(u.uTrail, flat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return k < 1;
  }

  let frame = 0;
  function tick(now) {
    frame = 0;
    if (todo) {
      lightStrip();
      if (!todo) revealStart = now;
      if (still() && todo) { frame = requestAnimationFrame(tick); return; }   // a still sky appears whole, never strip by strip
    }
    if (reveal < 1 && !todo) reveal = 1 - Math.pow(1 - Math.min(1, (now - revealStart) / 1900), 3);
    for (const p of trail) p.s = Math.exp(-(now - p.t) / 900);
    while (trail.length && trail[0].s < 0.01) trail.shift();
    const blending = draw(now);
    if (todo || reveal < 1 || trail.length || blending) frame = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };

  function start() {
    size();
    wake();
  }
  let resizing = 0;   // the lighting pass is the costly one: redo it once the size settles
  new ResizeObserver(() => {
    clearTimeout(resizing);
    resizing = setTimeout(() => {
      if (!size()) return;
      while (todo) lightStrip();   // after a resize, all at once: better one pause than clouds going missing
      if (!frame) draw(performance.now());
    }, 160);
  }).observe(canvas);
  new MutationObserver(() => {
    const next = palette(themeName());
    from = still() ? next : colors;
    colors = to = next;
    blendStart = performance.now();
    wake();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  let last = null;
  canvas.closest(".stage").addEventListener("pointermove", (e) => {
    if (still()) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top, now = performance.now();
    if (last && Math.hypot(x - last.x, y - last.y) < 6) return;
    const speed = last ? Math.hypot(x - last.x, y - last.y) / Math.max(8, now - last.t) : 0;   // px per ms
    last = { x, y, t: now };
    trail.push({ x: x * (css[0] / r.width), y: y * (css[1] / r.height), r: Math.min(160, 70 + speed * 55), s: 1, t: now });
    if (trail.length > TRAIL) trail.shift();
    wake();
  }, { passive: true });
  canvas.closest(".stage").addEventListener("pointerleave", () => (last = null));

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); cancelAnimationFrame(frame); canvas.hidden = true; });
  start();
})();
