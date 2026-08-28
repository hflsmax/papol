#!/usr/bin/env python3
"""Lay the viewer's stylesheet out at a range of screen sizes and report.

Reading CSS is not the same as laying it out. This script exists because a
change that looked right in the cascade — `min-height` where `height` was
meant — left the viewer unable to scroll at any size, and no amount of
re-reading the rules would have shown it.

It renders viewer/src/styles.js against the viewer's DOM shape in a real
browser and asserts the things that are easy to break and hard to see:

  * the pages scroll inside themselves, and the document does not scroll —
    every jump in the viewer scrolls the .pages element, so if the window
    becomes the scroller instead, going to an anchor silently stops working
  * nothing overflows horizontally
  * the bar's contents fit, at every width
  * the rail is a column on wide screens and a drawer on narrow ones

Run it from the dev shell (see flake.nix, which provides the browser):

    python tools/check-viewer-layout.py

Exits non-zero if any size fails, so it can go in front of a commit.
"""

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
STYLES = ROOT / "viewer" / "src" / "styles.js"

# Two phones, a small phone, a tablet in both orientations, the breakpoints
# themselves from either side, and a couple of laptops.
SIZES = [
    (320, 568), (360, 640), (390, 844), (414, 896),
    (559, 800), (561, 800),          # the 560px bar breakpoint, both sides
    (768, 1024), (860, 900), (861, 900),  # the 860px rail breakpoint
    (1024, 768), (1280, 800), (1440, 900), (1920, 1080),
]

NARROW = 860   # below this the rail stops having a column of its own
COMPACT = 560  # below this the bar sheds words


def stylesheet() -> str:
    """The CSS out of styles.js, which is a JS template literal."""
    src = STYLES.read_text()
    return src.split("export const styles = `", 1)[1].rsplit("`", 1)[0]


def page_html(css: str) -> str:
    """The viewer's DOM shape: a bar, then a grid of pages and a rail."""
    pages = "\n".join(
        f'<div class="pdf-page" data-page="{n}" style="width:800px;height:1035px"></div>'
        for n in range(1, 13)
    )
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>{css}</style></head><body><div id="root">
<header class="viewer-bar">
  <a class="back" href="#">&larr; <span class="back-word">Back to </span>Papol</a>
  <span class="link-navigation"><button class="history-arrow">&larr;</button><button class="history-arrow">&rarr;</button></span>
  <span class="spacer"></span>
  <a class="bar-link" href="#">Download</a>
  <span class="zoom"><button>&minus;</button
    ><span class="zoom-level">100%</span><button>+</button></span>
</header>
<div class="viewer-body">
  <button class="rail-handle">&rsaquo;</button>
  <div class="pages">{pages}</div>
  <aside class="rail"><h2>My anchors <span class="count">3</span></h2>
    <div class="anchor-row"><span class="anchor-where">page 4</span>
      <button class="link anchor-write">add a note</button>
      <button class="card-x">&times;</button></div>
    <div class="note-card"><button class="card-x">&times;</button>
      <p class="note-where">page 7</p>
      <p class="note-text">A note long enough to wrap in a narrow rail.</p></div>
  </aside>
</div></div></body></html>"""


MEASURE = """() => {
  const q = (s) => document.querySelector(s);
  const de = document.documentElement;
  const bar = q('.viewer-bar');
  const pages = q('.pages');
  const rail = q('.rail');
  return {
    barHeight: bar.offsetHeight,
    barOverflowsX: bar.scrollWidth > bar.clientWidth,
    docScrollsX: de.scrollWidth > de.clientWidth,
    docScrollsY: de.scrollHeight > de.clientHeight,
    pagesScrollY: pages.scrollHeight > pages.clientHeight,
    pagesFillsWidth: Math.round(pages.getBoundingClientRect().width),
    railPosition: getComputedStyle(rail).position,
    railWidth: Math.round(rail.getBoundingClientRect().width),
    backWordShown: q('.back-word').offsetWidth > 0,
    // The handle has to sit against the rail's leading edge, not float.
    handleMeetsRail: Math.abs(
      q('.rail-handle').getBoundingClientRect().right
      - rail.getBoundingClientRect().left) < 1,
  };
}"""


def failures(width: int, m: dict) -> list:
    out = []
    if not m["pagesScrollY"]:
        out.append("the pages do not scroll inside themselves")
    if m["docScrollsY"]:
        out.append("the document scrolls (it should not; .pages is the scroller)")
    if m["docScrollsX"]:
        out.append("the document scrolls sideways")
    if m["barOverflowsX"]:
        out.append("the bar's contents overflow it")
    if not m["handleMeetsRail"]:
        out.append("the rail handle is not against the rail's edge")
    want = "absolute" if width <= NARROW else "static"
    if m["railPosition"] != want:
        out.append(
            f"the rail is {m['railPosition']}, expected {want} at {width}px")
    if m["backWordShown"] != (width > COMPACT):
        out.append(
            f"the back link is {'long' if m['backWordShown'] else 'short'}"
            f" at {width}px")
    return out


def main() -> int:
    html = page_html(stylesheet())
    bad = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in SIZES:
            page = browser.new_page(viewport={"width": width, "height": height})
            page.set_content(html)
            m = page.evaluate(MEASURE)
            problems = failures(width, m)
            mark = "ok  " if not problems else "FAIL"
            print(f"{mark} {width:>5}x{height:<5} bar {m['barHeight']:>3}px  "
                  f"rail {m['railPosition']:<8} {m['railWidth']:>3}px  "
                  f"pages {m['pagesFillsWidth']:>4}px")
            for problem in problems:
                print(f"       - {problem}")
            bad += len(problems)
            page.close()
        browser.close()
    if bad:
        print(f"\n{bad} problem(s). Details above.", file=sys.stderr)
        return 1
    print(f"\nAll {len(SIZES)} sizes lay out correctly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
