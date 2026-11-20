"""Run: python posters.py, after npm run build in web/. It photographs the hero's sky, once by day and once by night,
and writes web/public/sky/day.webp and night.webp: the stills that stand under the live clouds until they have drawn
(web/src/styles/sections/hero.css). Run it again whenever web/src/vantaSky.js or its colours change, then rebuild.

Each still is the live sky's own first frame, so the canvas can take over from it unseen. The page is opened with
?still (no stars) and reduced motion (one frame, drawn at once), with everything over the sky hidden, on a stage 3.6
screens wide and two tall whose words reach low enough to put the cloud tops .88 of a screen down, which is how
hero.css draws the picture. It needs a GPU: software GL gets no canvas at all."""
import base64
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

import server

SCREEN = 900          # the first screen's height the sky is drawn for, in CSS pixels
WIDE, TALL = 3.6, 2   # the still's size in screens, as in hero.css
SAVED = (2160, 1200)  # the file's pixels: the clouds are soft, marched at half resolution, and scale up cleanly
OUT = Path(__file__).parent / "web" / "public" / "sky"
BARE = f"""
.hero {{ height: auto !important; }}
.stage {{ position: relative !important; height: {SCREEN * TALL}px !important; min-height: 0 !important; }}
.hero-copy .btn {{ margin-top: {SCREEN}px !important; }}
.nav, .hero-copy, .pass, .mist {{ visibility: hidden !important; }}
.clouds {{ transform: none !important; filter: none !important; }}
.clouds::before {{ display: none !important; }}
.clouds > canvas {{ opacity: 1 !important; transition: none !important; }}
"""
WEBP = """async ([png, w, h]) => {
  const img = new Image();
  img.src = "data:image/png;base64," + png;
  await img.decode();
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/webp", .8).split(",")[1];
}"""

assert (server.SITE / "index.html").is_file(), "build the site first: cd web && npm run build"
server.ROOT = Path(tempfile.mkdtemp(prefix="altaria-sky-"))   # no saved searches: nothing is written, and the pass stays empty
server.Handler.log_message = lambda *args: None
httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chromium", args=["--use-angle=metal" if sys.platform == "darwin" else "--use-angle=default",
                                                          "--enable-gpu", "--ignore-gpu-blocklist"])
    for theme, name in (("light", "day"), ("dark", "night")):
        page = browser.new_context(viewport={"width": round(SCREEN * WIDE), "height": SCREEN}, reduced_motion="reduce").new_page()
        page.add_init_script(f"try {{ localStorage.setItem('theme', '{theme}') }} catch (e) {{}}")
        page.goto(f"http://127.0.0.1:{httpd.server_address[1]}/?still", wait_until="networkidle")
        page.add_style_tag(content=BARE)
        page.wait_for_selector(".clouds > canvas.live")
        page.wait_for_timeout(1000)   # the stage's new size reaches the canvas, which redraws
        sky = page.locator(".clouds")
        box = sky.bounding_box()
        assert (box["width"], box["height"]) == (SCREEN * WIDE, SCREEN * TALL), box
        top = page.evaluate("+getComputedStyle(document.querySelector('.hero')).getPropertyValue('--cloud-top')")
        assert top == .88, f"the cloud tops are {top} of a screen down, not .88"
        webp = page.evaluate(WEBP, [base64.b64encode(sky.screenshot()).decode(), *SAVED])
        (OUT / f"{name}.webp").write_bytes(base64.b64decode(webp))
        print(f"{name}.webp", (OUT / f"{name}.webp").stat().st_size, "bytes")
        page.context.close()
    browser.close()
httpd.shutdown()
