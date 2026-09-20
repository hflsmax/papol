import { commonStyles } from '../../shared/commonStyles.js';
import { designTokens } from '../../shared/designTokens.js';
import { itemActionsStyles } from '../../shared/itemActionsStyles.js';
import { macHandoffStyles } from '../../shared/macHandoffStyles.js';

export const styles = `
:root {
  ${designTokens}

  /* Viewer-only annotation colors. These identify tools and annotations rather
     than product state, so they intentionally stay outside the core set. */
  --orange: #d2691e;
  --orange-soft: #fbeee2;
  --orange-line: #efd2b6;

}

${itemActionsStyles}

${commonStyles}

* { box-sizing: border-box; }

/* The viewer is one screenful: the bar on top, the pages filling the rest
   and scrolling inside themselves. dvh rather than vh so
   a phone's retracting address bar does not leave a strip of nothing at
   the bottom. */
#root {
  display: flex;
  flex-direction: column;
  /* height, not min-height, and the difference is not cosmetic. The pages
     below need a definite height to scroll inside. Given only a minimum,
     the flex item under it has no free space to divide, so it grows to the
     length of the whole document, .pages stops being a scroller, and
     nothing in the viewer scrolls at all. */
  height: 100vh;
  height: 100dvh;
}

button {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  cursor: pointer;
  line-height: 1.5;
  transition: color var(--motion-fast) var(--ease-out),
    background-color var(--motion-fast) var(--ease-out),
    border-color var(--motion-fast) var(--ease-out),
    box-shadow var(--motion-fast) var(--ease-out);
}

button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

${macHandoffStyles}

.shell { max-width: 640px; margin: 80px auto; padding: 0 20px; }
.loading, .hint { color: var(--ink-faint); }
/* Something failed while reading: said plainly, without taking the page
   away. */
.error-bar {
  position: fixed;
  z-index: 40;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 90vw;
  padding: 8px 14px;
  border: 1px solid var(--red-line);
  border-radius: var(--radius);
  background: var(--red-soft);
  color: var(--red);
  font-size: var(--fs-sm);
  box-shadow: 0 4px 16px rgba(25, 35, 50, 0.25);
}

.error-bar .link-button { color: var(--red); }

.error-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.error-actions button {
  min-height: 40px;
}

/* ---------- Bar ---------- */

.viewer-bar {
  position: sticky;
  top: 0;
  /* Above everything that lies over the pages (the return pill, 36). The
     bar makes a stacking context, so a sheet hanging off a button in it can
     never rise past this number, whatever the sheet's own z-index says.
     Still under the error bar and the help sheet, which are the two things
     that should cover it. */
  z-index: 38;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

/* In Papol macOS the bar is the window's title bar: the same height as
   the app's toolbar, draggable, and clear of the macOS traffic lights. */
/* Every control in the bar keeps its size; only the spacer gives way. */
[data-shell='desktop'] .viewer-bar > :not(.spacer) {
  flex-shrink: 0;
}

/* Only the bar's own controls keep to one line. Its wrappers also hold
   pop-ups (the paper's info, search, the brush), whose text must wrap. */
[data-shell='desktop'] .viewer-bar > :is(button, a),
[data-shell='desktop'] .viewer-bar > * > :is(button, a) {
  white-space: nowrap;
}

/* Feedback lives in the app's sidebar. */
[data-shell='desktop'] .feedback-button {
  display: none;
}

/* ---------- Navigator ---------- */

/* The paper drawn to length across the bar, in the room the spacer used to
   hold, as tall as the bar's other controls and centred among them. Two
   lanes at one scale: the strip of sections takes six parts of the height
   to the lane's five, and the anchors and notes stand in the lane, under
   it, each pointing up at its place — so a triangle under the middle of
   Results is in Results and nothing has to say so. Flat by construction — there is
   nothing to open. It is pressed and drawn along like a scrubber, so the
   browser's own gestures are kept off it. */
.navigator {
  position: relative;
  flex: 1;
  align-self: center;
  min-width: 72px;
  /* Three lanes at one scale, and all the room the desktop title bar has
     to give (40px): the subsections' ticks over the strip, the strip, and
     the anchors and notes under it. Strip to lower lane is six parts to
     five. The upper lane is kept even when
     it is empty, because it is also what sets the strip a little below
     centre: the strip is a solid band and the marks under it are specks on
     the bar's white, so a pair centred by the ruler reads as sitting
     high. */
  --nav-top: 7px;
  --nav-strip: 18px;
  --nav-lane: 15px;
  height: calc(var(--nav-top) + var(--nav-strip) + var(--nav-lane));
  font-family: var(--font-ui);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

/* What is centred in the bar is what can be seen. A lane with nothing in it
   is not seen, so it takes no room: no marks, no lower lane; and with
   neither marks nor ticks the box is only the strip, centred exactly. */
.navigator.unmarked { --nav-lane: 0px; }
.navigator.unmarked.unticked { --nav-top: 0px; }
.navigator.unmarked .navigator-lane { display: none; }

/* A groove, so the strip reads as one object on the bar's white ground and
   a section that is only a few pixels wide is still visibly a section. */
.navigator-track {
  position: absolute;
  inset: var(--nav-top) 0 auto;
  /* A stacking context of its own: the segments inside are ordered among
     themselves, and none of that should reach the marker laid over them. */
  z-index: 0;
  height: var(--nav-strip);
  border-radius: var(--radius);
  background: var(--paper-sunken);
  overflow: hidden;
}

.viewer-bar .navigator-seg,
.viewer-bar .navigator-seg:hover:not(:disabled) {
  /* Each at its own place on the scale, to the pixel: the left edge of a
     segment is where its section begins, and its rule is drawn inside the
     box so the edge and the rule are the same line. How wide it is comes
     from the Navigator's scale, which gives a short section a minimum and
     takes the room from the long ones. */
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  min-width: 0;
  /* So its name can ask how much room there is (see .navigator-name). */
  container-type: inline-size;
  display: flex;
  align-items: center;
  /* Tight, because every section is named and the short ones have no room
     to spend on air. */
  padding: 0 0 0 4px;
  border: 0;
  border-left: 1px solid var(--card);
  border-radius: 0;
  background: var(--paper);
  box-shadow: none;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  line-height: 1;
  overflow: hidden;
  transition: background-color var(--motion-fast) var(--ease-out),
    color var(--motion-fast) var(--ease-out);
}

.navigator-seg:first-child { border-left: 0; }

/* The front of the paper — title, authors, abstract. The one stretch of a
   paper with no heading of its own, so it is set back from the sections
   rather than counted as one. */
.navigator-seg.front { background: var(--paper-sunken); }

/* Back matter. The appendix is a part of the document, not a state of it,
   so it takes a ground rather than a colour. */
.navigator-seg.back { background: var(--accent-soft); }

/* Every other section is a shade darker, so where one ends and the next
   begins is read off the grounds themselves and not off a hairline between
   them — which is all that separated two short sections side by side. The
   two grounds of the body and the two of the appendix keep to their own
   families, so the alternation never hides where the back matter starts.
   A name on the darker ground is set a step darker to stay legible. */
.viewer-bar .navigator-seg.alt { background: var(--line); color: var(--ink-soft); }
.viewer-bar .navigator-seg.alt.back { background: var(--accent-line); }

/* Hover names the section under the pointer. Nothing marks the section
   being read: the marker already says where the reader is, to the line,
   and a lit segment said the same thing again more loudly and less
   exactly. */
.viewer-bar .navigator-seg:hover:not(:disabled) {
  /* Darker than any ground a segment can have, the alternate ones
     included, so hover shows on all of them. */
  background: var(--line-strong);
  color: var(--ink);
}

.navigator-seg:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

/* The subsections, in a lane over the strip: a small caret pointing down at
   the top edge of its section, at its place. Sections are the grounds and the
   names; this is the level below, kept to a mark so the two can never be
   taken for each other — drawn as segments of their own, subsections made
   a barcode of the strip and passed for chapters. The ticks stand above
   and the anchors hang below, so what the paper says about itself and what
   the reader has put on it are on opposite sides of it; and a tick is the
   smaller of the two, because it is the paper's detail and the marks are
   the reader's own. */
.navigator-subs {
  position: absolute;
  inset: 0 0 auto;
  height: var(--nav-top);
}

.viewer-bar .navigator-subs .navigator-sub,
.viewer-bar .navigator-subs .navigator-sub:hover:not(:disabled) {
  position: absolute;
  top: 0;
  /* Reaching a little into the strip, and wider than the caret it holds:
     the mark and the thing you press are not the same size. */
  height: calc(var(--nav-top) + 4px);
  width: 13px;
  margin-left: -6.5px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  cursor: pointer;
}

.navigator-sub svg {
  position: absolute;
  left: 1.5px;
  /* Its point on the strip's top edge. */
  top: calc(var(--nav-top) - 7px);
  width: 10px;
  height: 7px;
  color: var(--ink-faint);
  transition: color var(--motion-fast) var(--ease-out);
}

.viewer-bar .navigator-sub:hover:not(:disabled) svg,
.navigator-sub:focus-visible svg { color: var(--ink); }

.navigator-sub:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; }

.navigator-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Every section is named, down to the width where what is left of the name
   is not a letter but the edge of one — a stray stroke in a sliver, which
   reads as a fault in the strip rather than as a word cut short. */
@container (max-width: 20px) {
  .navigator-name { display: none; }
}

/* The anchors and notes, under the strip and at its scale. The lane is
   part of the scrubber like the strip above it: a press between two marks
   goes to that place, and only a mark itself keeps its own click. */
.navigator-lane {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--nav-lane);
}

.viewer-bar .navigator-lane .navigator-anchor,
.viewer-bar .navigator-lane .navigator-anchor:hover:not(:disabled) {
  position: absolute;
  top: 0;
  bottom: 0;
  /* A little wider than the mark: the mark and the thing you press are
     not the same size. */
  width: 20px;
  margin-left: -10px;
  padding: 0;
  display: grid;
  /* Hard against the strip, so the point of each mark touches the place it
     is pointing at. */
  place-items: start center;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  /* The colours the pins wear on the page: an anchor, and an anchor with
     something written on it. The shapes differ too — a triangle and a
     dialog box — so the difference does not rest on colour. */
  color: var(--accent);
  cursor: pointer;
  transition: color var(--motion-fast) var(--ease-out);
}

.viewer-bar .navigator-lane .navigator-anchor.written,
.viewer-bar .navigator-lane .navigator-anchor.written:hover:not(:disabled) {
  color: var(--accent-strong);
}

.navigator-anchor svg {
  display: block;
  width: 15px;
  height: 15px;
}

.viewer-bar .navigator-lane .navigator-anchor:hover:not(:disabled),
.viewer-bar .navigator-lane .navigator-anchor:focus-visible { color: var(--ink); }

.navigator-anchor:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

/* The exact place: the middle of the window, on the strip's scale. It is
   moved by the scroll itself, a frame at a time, so it has no transition
   to lag behind the paper with. It crosses the strip and stops short of
   the lane, where the marks are doing their own pointing. The halo keeps
   it legible on the appendix's ground. */
.navigator-here {
  display: none;
  position: absolute;
  top: calc(var(--nav-top) - 2px);
  height: calc(var(--nav-strip) + 4px);
  left: var(--here, 0%);
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--ink);
  box-shadow: 0 0 0 1px var(--card);
  pointer-events: none;
}

.navigator[data-located] .navigator-here { display: block; }

/* The name of what is under the pointer, shown the moment it is there and
   moved with it (see Navigator's tell). It hangs under the bar, over the
   top of the page, where it covers nothing the pointer is choosing among. */
.navigator-tip {
  position: absolute;
  z-index: 2000;
  top: calc(100% + 8px);
  transform: translateX(-50%);
  max-width: min(420px, 100%);
  padding: 4px 8px;
  border-radius: 5px;
  background: var(--ink);
  color: var(--ink-inverse);
  font-size: var(--fs-xs);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: var(--shadow-md);
  pointer-events: none;
}

.navigator-tip[hidden] { display: none; }

/* In Papol macOS the bar is the title bar, and the map is the one control
   in it that should give way — it has a whole document to show and will
   use whatever it is given. */
[data-shell='desktop'] .viewer-bar > .navigator {
  flex-shrink: 1;
  min-width: 72px;
}

.learn-papol {
  position: absolute;
  z-index: 42;
  top: calc(100% + 14px);
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: min(290px, calc(100vw - 24px));
  padding: 14px 16px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--card);
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(29, 33, 41, 0.2);
}

.learn-papol::before {
  content: '';
  position: absolute;
  left: 22px;
  top: -7px;
  width: 12px;
  height: 12px;
  border-top: 1px solid var(--accent);
  border-left: 1px solid var(--accent);
  background: var(--card);
  transform: rotate(45deg);
}

.learn-papol strong { color: var(--ink); font-size: var(--fs-md); }
.learn-papol-kicker {
  color: var(--accent);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.learn-papol kbd {
  display: inline-block;
  min-width: 20px;
  padding: 0 4px;
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--paper);
  color: var(--ink);
  font: 600 var(--fs-xs) var(--font-ui);
  text-align: center;
}
.learn-papol .learn-papol-close {
  align-self: flex-end;
  margin-top: 2px;
  padding: 4px 9px;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--ink-inverse);
}

.viewer-bar .spacer { flex: 1; }

.pdf-search { position: relative; flex: none; font-family: var(--font-ui); }
.search-pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 9px);
  right: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  width: max-content;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 6px 18px rgba(29, 33, 41, 0.18);
}
.pdf-search input {
  width: 190px;
  min-width: 90px;
  padding: 4px 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  font: inherit;
  color: var(--ink);
  background: var(--card);
}
.pdf-search input:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.search-pop button { min-width: 28px; height: 28px; padding: 2px 7px; }
.search-count { min-width: 58px; color: var(--ink-faint); font-size: var(--fs-2xs); text-align: center; white-space: nowrap; }

.search-wrap-sign {
  position: fixed;
  z-index: 50;
  left: 50%;
  top: 50%;
  display: grid;
  place-items: center;
  width: 112px;
  height: 112px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 50%;
  background: rgba(30, 55, 82, 0.88);
  color: var(--ink-inverse);
  font: 74px/1 var(--font-ui);
  box-shadow: 0 8px 30px rgba(25, 35, 50, 0.3);
  pointer-events: none;
  animation: search-wrap-fade 1.15s ease-out forwards;
}

@keyframes search-wrap-fade {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.78); }
  14% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  58% { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.06); }
}

/* A bar action that navigates rather than acts on the page. */
.viewer-bar .bar-link {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  color: var(--ink);
  text-decoration: none;
  line-height: 1.5;
}

.viewer-bar .bar-link:hover { border-color: var(--accent); color: var(--accent); }
.paper-menu { position: relative; display: flex; align-items: center; gap: 6px; }
.viewer-bar button.bar-link { cursor: pointer; background: var(--card); }
.viewer-bar button.bar-link:disabled { cursor: default; opacity: 0.6; }
.viewer-bar .nook-add-button { border-color: var(--accent); color: var(--accent); }

/* Whose reading this is. Not a control: it does not sit in a box or take a
   hover, because there is nothing to press. */
.viewer-bar .shared-reading {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  white-space: nowrap;
}
.nook-ask { display: flex; flex-direction: column; gap: 8px; width: min(300px, calc(100vw - 24px)); }
.nook-ask strong { font-size: var(--fs-md); }
.nook-ask p { color: var(--ink-soft); font-size: var(--fs-sm); line-height: 1.45; }
.nook-ask-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.learn-papol.pdf-viewer-tip { left: auto; right: 0; }
.learn-papol.pdf-viewer-tip::before { left: auto; right: 22px; }
.pdf-viewer-tip-actions { display: flex; align-self: flex-end; align-items: center; gap: 6px; margin-top: 2px; }
.pdf-viewer-tip-actions button { padding: 4px 9px; }
.learn-papol .pdf-viewer-tip-actions .learn-papol-close { margin-top: 0; }
/* The same 32px square as the tools it stands beside, holding the same 18px
   glyph. Three classes, because two were not enough: written as
   .paper-info-button alone, its padding of nothing lost to the bar-link's
   6px 12px, which left a 28px box two pixels of room and pushed the letter
   off to one side. */
.viewer-bar .bar-link.paper-info-button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: var(--card);
  cursor: pointer;
}

/* A ringed i, drawn rather than set: a letter centres on its font's
   metrics, which is nowhere near its ink, and a drawing centres where it
   is put. */
.info-glyph {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}
.info-glyph .info-dot { fill: currentColor; stroke: none; }
.paper-info-pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 9px);
  right: 0;
  width: min(400px, calc(100vw - 24px));
  padding: 14px 16px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  box-shadow: 0 8px 28px rgba(29, 33, 41, 0.18);
  text-align: left;
  font-family: var(--font-ui);
  -webkit-user-select: text;
  user-select: text;
}

/* An abstract can run to four hundred words, and a box that grows to hold
   one reaches the bottom of the window and covers the paper it describes.
   So the box stops well short of that and its contents scroll — the
   contents, not the box, because the × is pinned to the box's corner and
   has to stay there while the text moves. The band above the scroller is
   the ×'s own: nothing scrolls under it, so no line is ever read through
   it. And the scroller keeps the wheel to itself, so reaching the end of an
   abstract does not start turning the pages behind it. */
.paper-info-pop:not(.nook-ask) { padding-top: 26px; padding-right: 6px; }

.paper-info-scroll {
  max-height: min(60vh, 480px);
  padding-right: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* What the user is holding. Icon buttons rather than a menu: the choice
   changes often enough while marking a paper up that it should cost one
   click and no reading.
 *
 * At rest the rack shows that one tool and nothing else, because the rest
 * of the bar is a map of the paper and the paper deserves the room. The
 * others are a pointer-move away, not a click away, so choosing a tool
 * still costs the single click it always did.
 *
 * It opens downwards, out of the bar and over the page. Opening sideways
 * would have it reach back across the map it just made room for, and the
 * stretch it would cover is the map's end — the appendix, which is the
 * part of a paper a reader is least likely to be holding in mind and most
 * likely to be looking for. Below the bar it covers a few lines of a page
 * that is still there when the rack closes.
 *
 * The tool in hand is the face of the rack and stays at the top of it, so
 * the glyph under the pointer when the rack opens is the same glyph that
 * was under it a moment before. Letting the palette keep its printed order
 * instead would slide a different tool into that spot — hold the brush,
 * reach for the rack, click without looking, and you are holding the arrow.
 * The other five keep their order relative to one another.
 *
 * Hover is not the only way in — focus opens it too, and a touch screen,
 * which has no hover to give, is served the whole rack at the bottom of
 * this sheet. */
.tools {
  position: relative;
  flex: none;
  width: 32px;
  height: 32px;
}

.tools-rack {
  position: absolute;
  /* The same layer the bar's other sheets hang on. */
  z-index: 30;
  /* Back by its own border and padding, so the tool in hand stays exactly
     where it sat before the rack opened. */
  top: -2px;
  right: -2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 1px;
  border: 1px solid transparent;
  border-radius: var(--radius);
}

/* Only the tool in hand, until the rack is opened — and it keeps the top
   of the rack once it is. */
.tools .tool-slot { display: none; }
.tools .tool-slot.held { display: flex; order: -1; }

.tools:hover .tool-slot,
.tools:focus-within .tool-slot,
.tools.open .tool-slot { display: flex; }

/* Open, it hangs off the bar over the page, which is what --shadow-md is
   for. */
.tools:hover .tools-rack,
.tools:focus-within .tools-rack,
.tools.open .tools-rack {
  border-color: var(--line);
  background: var(--card);
  box-shadow: var(--shadow-md);
}
.tool-slot { position: relative; display: flex; }

/* Hung under the brush, pointing at it.
 *
 * Every control is one cell of the same size, so the four rows line up
 * down the sheet however different the samples inside them are — a swatch,
 * a patch of ink, a nib and a weight are all different shapes, and only
 * the cells they sit in can make them a grid. */
.brush-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: -6px;
  z-index: 30;
  /* A column of names beside a column of rows, so each row says what it is
     without a legend to look up. */
  display: grid;
  grid-template-columns: max-content 1fr;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 10px 26px rgba(29, 33, 41, 0.2);
}

.swatches, .weights { display: flex; align-items: center; gap: 6px; }

.brush-pop .swatch,
.brush-pop .shade,
.brush-pop .shape,
.brush-pop .weight {
  display: grid;
  place-items: center;
  width: 32px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

/* Chosen, said with a soft ground rather than a hard edge. A black rule
   drawn round a sample competes with the sample — and in a sheet whose
   whole job is to show what the annotation will look like, nothing should be
   drawn on top of the annotation. */
.brush-pop .swatch.on,
.brush-pop .shade.on,
.brush-pop .shape.on,
.brush-pop .weight.on { background: var(--accent-soft); }

/* The colour itself, round, and rimmed so a pale one still has an edge. */
.brush-pop .swatch::after {
  content: '';
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--swatch);
  box-shadow: inset 0 0 0 1px rgba(29, 33, 41, 0.16);
}

/* The menagerie. Each animal shown as the drawing that will land
   on the page rather than as the button's glyph — the sheet has room for
   the animal, and the animal is what is being chosen between. Three
   across, which is one row and the whole choice at once. */
.beasts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.brush-pop .beast {
  display: grid;
  justify-items: center;
  gap: 1px;
  padding: 5px 4px 4px;
  border: none;
  border-radius: var(--radius);
  background: none;
  cursor: pointer;
}

.brush-pop .beast.on { background: var(--accent-soft); }

.brush-pop .beast svg {
  width: 46px;
  height: 32px;
  display: block;
}

.beast-name {
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  line-height: 1;
}

.brush-pop .beast.on .beast-name { color: var(--ink); }

.animal-control {
  display: flex;
  align-items: center;
  min-width: 180px;
}

.animal-control input[type='range'] {
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}

.brush-pop .magic-wand-beast { color: var(--ink); }
.brush-pop .magic-wand-beast:hover {
  background: linear-gradient(145deg, var(--accent-soft), var(--paper));
}

.animal-follow-control {
  gap: 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}

.animal-follow-control input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}

/* One colour at three strengths, on the white the ink will be on. Anything
   put underneath to show what survives — a rule of type, a half-black
   patch — reads as a second colour being offered, in a row whose whole
   point is that the colour is already settled. */
.brush-pop .shade-sample {
  position: relative;
  display: block;
  width: 24px;
  height: 16px;
  border-radius: 3px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(29, 33, 41, 0.18);
}

.brush-pop .shade-ink { position: absolute; inset: 0; display: block; }

/* The nib's shape, at a size of its own: what is chosen here is which nib,
   and the row below already says how big it is. */
.brush-pop .nib { display: block; border-radius: 1px; }
.brush-pop .nib-flat { width: 8px; height: 24px; }
.brush-pop .nib-round { width: 24px; height: 24px; border-radius: 50%; }

.brush-pop .weight-strip { border-radius: 1px; display: block; }

/* How long a trail stays, in seconds, because that is what it is. */
.brush-pop .weight-strip.round { border-radius: 50%; }

.brush-pop .brush-label {
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  text-align: right;
  white-space: nowrap;
}

.brush-pop .brush-tip {
  grid-column: 1 / -1;
  margin: 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
  white-space: nowrap;
}

.viewer-bar .tool {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--ink-soft);
  cursor: pointer;
}

.viewer-bar .tool svg { width: 18px; height: 18px; display: block; }

/* Tucked into the corner the glyph leaves empty, and small enough to be
   read as a label on the button rather than as part of the drawing. */
.viewer-bar .tool-key {
  position: absolute;
  left: 3px;
  bottom: 1px;
  font-family: var(--font-ui);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  opacity: 0.65;
  pointer-events: none;
}

.viewer-bar .tool.on .tool-key { opacity: 0.85; }

/* Two characters need the room a single one did not, and taking it from
   the left keeps the badge off the glyph above it. */
.viewer-bar .tool-key[data-wide] { left: 0; letter-spacing: -0.02em; }
.viewer-bar .tool:hover { border-color: var(--line-strong); color: var(--ink); }


/* The held tool, said with fill rather than only with a border: at this
   size a border alone is easy to miss, and which tool is in your hand is
   the thing the page's behaviour depends on. */
/* Held. Lighter than the hover below it, so that hovering a tool already
   in hand still visibly answers the pointer — the brush opens its colours
   on a second click, and a button that does not respond looks spent. */
.viewer-bar .tool.on {
  --glyph-cutout: var(--accent);
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
  opacity: 0.82;
}

.viewer-bar .tool.on:hover {
  --glyph-cutout: var(--accent-strong);
  background: var(--accent-strong);
  border-color: var(--accent-strong);
  color: #ffffff;
  opacity: 1;
}

/* The gold one keeps being gold when it is held, so it darkens instead. */
.viewer-bar .tool[aria-label='Here'].on,
.viewer-bar .tool[aria-label='Here'].on:hover { color: #ffffff; }


/* ---------- Pages ---------- */

.viewer-body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  /* Whatever the bar leaves — measured rather than assumed, so the bar can
     change height without the pages hanging off the bottom of the window. */
  flex: 1;
  min-height: 0;
}

/* ---------- Return pill ---------- */

/* Where a followed link ("see Section 3") left the user: a pill over the
   pages naming the page to go back to, the document's own history. It is
   kept apart from the bar, whose navigation only leaves for Papol, and it
   exists only while there is somewhere to return to. Centred over the pages,
   not the window. */
.link-return {
  position: absolute;
  z-index: 36;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
  background: var(--card);
  box-shadow: 0 6px 20px rgba(29, 33, 41, 0.16), 0 1px 3px rgba(29, 33, 41, 0.1);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  white-space: nowrap;
}


.link-return .link-return-button,
.link-return .link-return-button:hover:not(:disabled) {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  box-shadow: none;
  color: var(--ink);
  font: inherit;
  line-height: 1.3;
  cursor: pointer;
}

.link-return .link-return-button:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.link-return-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.link-return kbd {
  min-width: 16px;
  padding: 0 4px;
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 3px;
  background: var(--paper);
  color: var(--ink-faint);
  font: 600 var(--fs-xs) var(--font-ui);
  line-height: 1.35;
  text-align: center;
}

.link-return-divider {
  align-self: stretch;
  width: 1px;
  margin: 5px 1px;
  background: var(--line);
}

/* The pill's own way out: quiet until pointed at, like a tab's close box. */
.link-return .link-return-hide,
.link-return .link-return-hide:hover:not(:disabled) {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 1px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  box-shadow: none;
  color: var(--ink-faint);
  cursor: pointer;
}

.link-return .link-return-hide:hover:not(:disabled) {
  background: var(--paper);
  color: var(--ink);
}

.link-return-hide svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

/* Where the pill stood, the Learn Papol card that explains hiding it: the
   same card as the pill's own lesson, drawn in place rather than hung off an
   anchor, since the pill it would point at is gone. */
.link-return-notice {
  position: absolute;
  z-index: 42;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
}


.link-return-notice .learn-papol {
  position: static;
  transform: none;
}

.link-return-notice .learn-papol::before { display: none; }

.learn-papol-actions {
  display: flex;
  align-self: stretch;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 2px;
}

.learn-papol .learn-papol-actions .learn-papol-close { margin-top: 0; }

.learn-papol .learn-papol-undo {
  padding: 4px 9px;
  border-color: var(--line-strong);
  background: var(--card);
  color: var(--ink);
}

/* The card's buttons keep their own colours under the pointer. The viewer's
   general button hover turns text accent, which on Got it's accent fill made
   the label vanish. */
.learn-papol .learn-papol-close:hover:not(:disabled) {
  border-color: var(--accent-strong);
  background: var(--accent-strong);
  color: var(--ink-inverse);
}

.learn-papol .learn-papol-undo:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--card);
  color: var(--accent);
}

/* The lesson on getting back opens above the pill it is about. */
.link-return .learn-papol {
  top: auto;
  bottom: calc(100% + 14px);
  left: 50%;
  transform: translateX(-50%);
  white-space: normal;
}

.link-return .learn-papol::before {
  top: auto;
  bottom: -7px;
  left: calc(50% - 6px);
  border: 0;
  border-right: 1px solid var(--accent);
  border-bottom: 1px solid var(--accent);
}


.pages {
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: safe center;
  gap: 0;
  background: var(--paper-sunken);
}

.animal-gutter {
  position: relative;
  z-index: 4;
  width: 100%;
  height: 20px;
  flex: 0 0 20px;
  background: transparent;
}

/* Over the page skeletons, saying what they alone do not: whether the
   file is actually moving, and how much of it is left. */
.pdf-loading {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.pdf-loading-card {
  width: min(260px, 80vw);
  padding: 16px 20px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 6px 20px rgba(29, 33, 41, 0.18);
  text-align: center;
  animation: pdfLoadingArrive 160ms ease-out both;
}

@keyframes pdfLoadingArrive {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

.pdf-loading-card p {
  margin: 0 0 10px;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  color: var(--ink-soft);
}

.pdf-progress-track {
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--paper-sunken);
  overflow: hidden;
}

.pdf-progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--accent);
  transition: width 0.2s ease;
}

/* No total to measure against yet: a segment sweeps the track rather than
   sitting at a width that would claim to know how far along this is. */
.pdf-progress-track.indeterminate .pdf-progress-fill {
  width: 40% !important;
  animation: pdfProgressSweep 1.2s ease-in-out infinite;
}

@keyframes pdfProgressSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}

.pdf-progress-pct {
  display: block;
  margin-top: 8px;
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  color: var(--ink-faint);
}

/* The shape of a page before there is one, so the viewer opens into
   something rather than a sentence. */
.page-skeleton {
  flex: none;
  width: min(100%, 1100px);
  aspect-ratio: 1 / 1.294;
  border-radius: 2px;
  background: linear-gradient(100deg, var(--card) 30%, var(--paper) 50%, var(--card) 70%);
  background-size: 300% 100%;
  animation: skeletonSweep 1.4s ease-in-out infinite;
  box-shadow: 0 1px 6px rgba(25, 35, 50, 0.12);
}

@keyframes skeletonSweep {
  from { background-position: 150% 0; }
  to { background-position: -50% 0; }
}

.pdf-page {
  position: relative;
  background: var(--card);
  box-shadow: 0 1px 6px rgba(25, 35, 50, 0.18);
  flex: none;
}

.page-inner {
  position: relative;
  transform-origin: 0 0;
}

.pdf-page canvas { display: block; }
/* The drawing fills the page whatever scale it was made at, so between a
   zoom and the sharp redraw the last one stretches rather than jumps. */
.page-canvas { position: absolute; inset: 0; }
.page-canvas canvas { width: 100%; height: 100%; }
/* Over a limited drawing, the part on screen at full sharpness; placed in
   fractions of the page by PdfPage. */
.page-canvas .page-detail { position: absolute; }

.page-number {
  position: absolute;
  bottom: -18px;
  right: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-2xs);
  color: var(--ink-faint);
}

/* Papol's own touches on pdf.js's text layer; the layout rules come from
   the library's stylesheet. */
/* Where PdfPage puts the text layer, above the drawing: laid out at one zoom
   and scaled to the zoom shown. */
.text-host { position: absolute; inset: 0; z-index: 2; }
.text-scale { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
/* While a pinch is under way. The spans are invisible anyway, but WebKit
   still paints them, and resizing pages under a dense paper's text layers
   cost about 10ms a frame; hidden, pinching out went from about 22 to 54
   frames a second. Every page's text, not only the text on screen: hiding
   just that measured slower, because text beside the view still repaints.
   Selection and search highlights come back once the view is still. */
.pages.zooming .text-host { visibility: hidden; }
.textLayer ::selection { background: rgba(43, 74, 111, 0.3); }
.provenance-box {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border: 3px solid #f0b822;
  background: rgba(246, 203, 65, .12);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .9) inset;
  animation: provenanceBoxFade 3.2s ease-out forwards;
}

@keyframes provenanceBoxFade {
  0%, 42% { opacity: 1; }
  100% { opacity: 0; }
}
.textLayer .search-highlight {
  position: absolute;
  z-index: -1;
  margin: 0;
  padding: 0;
  border-radius: 1px;
  background: rgba(246, 203, 65, 0.52);
  pointer-events: none;
}
.textLayer .search-highlight-active {
  background: rgba(255, 145, 32, 0.72);
  /* Keep a small reading margin when search navigation has to follow it. */
  scroll-margin: 72px 28px;
}

.selection-actions {
  position: absolute;
  z-index: 30;
  display: inline-flex;
  transform: translate3d(-50%, 0, 0);
  will-change: transform;
}

/* WebKit occasionally leaves a newly mounted backdrop-filter surface waiting
   for a later pointer-driven composite. Selection actions must appear in the
   same frame as mouseup, so give this transient toolbar an opaque, dedicated
   compositing surface instead of sharing the generic blurred menu treatment. */
.selection-actions .item-actions-surface {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--card);
  transform: translateZ(0);
}

.provenance-highlight {
  pointer-events: none;
  animation: provenance-highlight-fade 6s 0.8s ease-out forwards;
}

.text-selection-highlight {
  pointer-events: none;
}

@keyframes provenance-highlight-fade {
  0%, 18% { opacity: 1; }
  100% { opacity: 0; }
}

.send-selection-sheet { width: min(520px, 100%); }
.send-selection-field {
  display: grid;
  gap: 5px;
  margin-bottom: 14px;
  color: var(--ink-soft);
  font-family: var(--font-ui);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.send-selection-field textarea,
.send-selection-field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  appearance: none;
  background-color: var(--card);
  color: var(--ink);
  font: var(--fs-sm) var(--font-ui);
}
.send-selection-field select {
  padding-right: 32px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%234d5561' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: right 10px center;
  background-repeat: no-repeat;
  cursor: pointer;
}
.send-selection-field textarea { resize: vertical; line-height: 1.5; }
.send-selection-field small { color: var(--ink-faint); font-size: inherit; font-weight: 400; }
.send-selection-field textarea:focus,
.send-selection-field select:focus { outline: 2px solid var(--accent-soft); border-color: var(--accent); }
.send-selection-source {
  margin: 0 0 14px;
  color: var(--ink-faint);
  font: var(--fs-xs) var(--font-ui);
}

/* The PDF's own links. Invisible until pointed at, like the citations:
   a paper is not improved by underlining every cross-reference in it. */
.link-layer { position: absolute; inset: 0; pointer-events: none; z-index: 2; }

.pdf-link {
  position: absolute;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

.pdf-link:hover,
.pdf-link:focus-visible {
  background: rgba(43, 74, 111, 0.14);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.14);
  outline: none;
}

/* A citation marker in the text. Nothing is drawn over the page until the
   user is near it: the PDF already shows "[12]", and a box around every
   one of them would be a rash across the paper. */
.cite-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }

.cite {
  position: absolute;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  box-shadow: none;
  /* Pointer clicks are delegated from the page by coordinates so this box
     never breaks a text selection dragged across a citation. It remains a
     real button for keyboard focus and activation. */
  pointer-events: none;
  transition: background 0.12s ease, box-shadow 0.12s ease;
}

/* The highlight has to be translucent, not merely pale: this layer is
   drawn over the page, so an opaque wash — however light — would hide the
   very "[12]" the user is pointing at. */
.cite.hovered,
.cite:focus-visible {
  background: rgba(43, 74, 111, 0.14);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.14);
  outline: none;
}

.cite.open {
  background: rgba(43, 74, 111, 0.16);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, 0.16), inset 0 -2px 0 var(--accent);
}

/* Matched by counting rather than by the analyzer, so it is marked as the
   guess it is — a dotted underline instead of a solid one. */
.cite.guessed.open {
  box-shadow: 0 0 0 2px var(--accent-soft);
  border-bottom: 1px dotted var(--accent);
}

.ref-card {
  position: absolute;
  z-index: 20;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 28px rgba(29, 33, 41, 0.18);
  padding: 14px 16px 12px;
  /* A starting cap, for the pass that measures the card. ReferenceCard
     then sets the real one from the room beside the marker. */
  max-height: 62vh;
  max-width: calc(100vw - 24px);
  overflow-y: auto;
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
}

.ref-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 24px;
  margin: -2px 24px 8px 0;
}
.ref-experimental { margin: 0; }
.ref-range-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
}
.ref-range-nav button {
  width: 28px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
}
.ref-range-nav button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ref-range-nav button:disabled { opacity: .35; cursor: default; }

.ref-looking { margin: 2px 0; color: var(--ink-faint); font-style: italic; }

.ref-title {
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: var(--fs-lg);
  line-height: 1.35;
  margin: 0 22px 6px 0;
}

.ref-title a { color: var(--accent); text-decoration: none; }
.ref-title a:hover { text-decoration: underline; }

.ref-authors { margin: 0 0 2px; color: var(--ink-soft); font-size: var(--fs-xs); }

.ref-where {
  margin: 0 0 8px;
  color: var(--ink-faint);
  font-size: var(--fs-xs);
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.ref-cited {
  color: var(--gold-ink);
  background: var(--gold-soft);
  border: 1px solid var(--gold-line);
  border-radius: var(--radius-pill);
  padding: 0 8px;
  white-space: nowrap;
}

.ref-abstract {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--fs-sm);
  line-height: 1.55;
  color: var(--ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ref-abstract.full { display: block; overflow: visible; }

.ref-more { margin: 2px 0 0; padding: 0; }

.ref-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--line);
}

.ref-link {
  font-size: var(--fs-xs);
  color: var(--accent);
  text-decoration: none;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 2px 9px;
}

.ref-link:hover { background: var(--accent-soft); }

/* A paper Papol already holds is the one link worth leading with. */
.ref-link.here {
  color: var(--ink-inverse);
  background: var(--accent);
  border-color: var(--accent);
}

.ref-link.here:hover { background: var(--accent-strong); }

.ref-unmatched { margin: 0 22px 6px 0; color: var(--ink-soft); }

.ref-raw {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-serif);
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--ink);
  background: var(--paper-sunken);
  border-left: 2px solid var(--line-strong);
  padding: 7px 10px;
}

.pin-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }


/* Under the eraser. The same lift a pointer gives it, and nothing else:
   an anchor about to be rubbed out is still that anchor, and recolouring
   it says something about it that is not true. */
.pin.going {
  transform: translate(-50%, -50%) scale(1.12);
}

/* ---------- Ink ---------- */

/* Over the page and under the pins: an annotation belongs to the paper, a pin is
   a control sitting on top of it. Never in the way of a pointer — the
   surface below is what listens. */
.ink-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* The layer itself lets everything through; only .ink-grab inside it
     listens, and only while the arrow is in hand. */
  pointer-events: none;
  z-index: 3;
  /* Animals may stand in the gray gutter between sheets. Ink paths remain
     page-normalized and never use coordinates outside the viewBox. */
  overflow: visible;
}

/* A cow is taken hold of anywhere on it. */
.cow-grab { pointer-events: bounding-box; cursor: grab; }
.ink-layer .cow.going { opacity: 0.55; }

/* The handle on a stroke. pointer-events: stroke means only the line
   itself listens, so the page around it still selects as text. */
.ink-grab {
  pointer-events: stroke;
  cursor: grab;
}

.ink-layer g.carrying { cursor: grabbing; opacity: 0.85; }
.ink-layer g.carrying .ink-grab { cursor: grabbing; }

/* With a tool in hand, this covers the page above the text layer, so a
   drag lays ink instead of selecting words. It does not exist while the
   user is holding the arrow, and reading is then exactly as it was. */
.ink-surface {
  position: absolute;
  inset: 0;
  z-index: 5;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

/* The brush has no cursor image: its annotation is drawn on the page itself, at
   the ink's own size, which a cursor cannot be past about 128px. */
.ink-surface.tool-brush { cursor: none; }
.ink-surface.tool-clipper { cursor: crosshair; }

.clipper-overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: rgba(40, 45, 52, .48);
  pointer-events: none;
}
.clipper-overlay.selecting { background: transparent; }
.clip-window {
  position: absolute;
  display: none;
  border: 2px solid var(--accent);
  background: transparent;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8) inset;
}
.clipper-overlay.selecting .clip-window {
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.8) inset,
    0 0 0 9999px rgba(40, 45, 52, .48);
}
.clip-guide {
  position: absolute;
  z-index: 1;
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 0 0 1px rgba(43, 74, 111, .48);
}
.clip-guide.vertical { top: 0; bottom: 0; width: 1px; display: none; }
.clip-guide.horizontal { left: 0; right: 0; height: 1px; display: none; }
.clip-window,
.clip-guide { pointer-events: none; }

.paper-clip {
  position: absolute;
  z-index: 12;
  min-width: 54px;
  min-height: 48px;
  display: flex;
  flex-direction: column;
  overflow: visible;
  background: var(--card);
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  box-shadow: 0 5px 18px rgba(25, 35, 50, 0.28);
  touch-action: none;
  cursor: grab;
  user-select: none;
}

.paper-clip:active { cursor: grabbing; }
.paper-clip.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(43, 74, 111, .2), 0 5px 18px rgba(25, 35, 50, 0.28);
}
.clip-actions {
  position: absolute;
  z-index: 2;
  right: -1px;
  top: 0;
  display: inline-flex;
  cursor: default;
}
.clip-canvas {
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1;
  border-radius: 4px;
}
.clip-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 52%, rgba(43, 74, 111, .65) 54%, rgba(43, 74, 111, .65) 62%, transparent 64%, transparent 72%, rgba(43, 74, 111, .65) 74%, rgba(43, 74, 111, .65) 82%, transparent 84%);
}

/* The other cursors are drawn rather than named, so the pointer is the
   tool: each has its hotspot at the end that touches the page. The brush's is not here —
   it is the width and colour of the ink it will lay down, which depends on
   the zoom, so PdfPage draws it. */

.ink-surface.tool-eraser {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect x='4' y='11' width='15' height='9' rx='2' transform='rotate(-40 4 11)' fill='%23f5f6f8' stroke='%232b4a6f' stroke-width='1.6'/%3E%3C/svg%3E") 5 19, cell;
}

/* Holding an anchor: the pointer is the annotation it will leave, with its point
   at the hotspot so it lands where it looks like it will. */
.ink-surface.tool-anchor {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Cg stroke='%23ffffff' stroke-width='3.4' fill='none'%3E%3Ccircle cx='13' cy='5.6' r='2.6'/%3E%3Cpath d='M13 8.4v13M8 12.4h10M6.6 16.4a7 7 0 0 0 12.8 0'/%3E%3C/g%3E%3Cg stroke='%232b4a6f' stroke-width='1.9' fill='none' stroke-linecap='round'%3E%3Ccircle cx='13' cy='5.6' r='2.6'/%3E%3Cpath d='M13 8.4v13M8 12.4h10M6.6 16.4a7 7 0 0 0 12.8 0'/%3E%3C/g%3E%3C/svg%3E") 13 4, copy;
}

.pin {
  position: absolute;
  /* Centred on the spot it annotations. It used to hang from its ring, which put
     the drawing below the point and the point above the drawing — fine
     while a pin was only ever read, and wrong the moment one is aimed,
     dragged and rubbed out. */
  transform: translate(-50%, -50%);
  pointer-events: auto;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  color: var(--accent-strong);
  cursor: grab;
  touch-action: none;
}

.pin svg { display: block; width: 100%; height: 100%; }

/* No lift on hover. The anchor in your hand is drawn at the size the pin
   will be, and the pin lands under the pointer — so growing it by a tenth
   the moment it arrived made the annotation disagree with the cursor that had
   just promised it. The pointer already turns to a grab over a pin, which
   says the same thing without resizing the annotation. */
.pin:hover:not(:disabled) {
  border: none;
  background: none;
}

/* Never a box. An anchor is an annotation on a page, not a control on a form, and
   a focus ring drawn around one reads as a selection the user did not
   make — which is exactly what it looked like after clicking one and then
   picking up another tool. Keyboard focus still shows, as the same lift a
   pointer gives it, so it is findable without being boxed. */
.pin:focus { outline: none; }

.pin:focus-visible {
  outline: none;
  transform: translate(-50%, -50%) scale(1.12);
}

.pin.active { opacity: 1; }
.pin:not(.active) { opacity: 0.9; }

/* An anchor with nothing written on it yet: an annotation, not a note. */
.pin.bare { color: var(--accent); }

.pin.dragging { cursor: grabbing; opacity: 0.85; }

/* ---------- Anchor card ---------- */

/* An anchor's card, hung off its pin on the page: its name, what is
   written on it, and the way to delete it. It is the only place an anchor
   is edited — the list of them is the Navigator, and the rail that used to
   hold both is gone. Set in the page's own percentages, so it keeps its
   place through any zoom; centred under the pin and held inside the sheet,
   because the next sheet is painted over whatever hangs past this one. */
.note-pop {
  --note-pop-w: min(280px, calc(100% - 16px));
  position: absolute;
  z-index: 6;
  left: clamp(8px, calc(var(--pin-x) - var(--note-pop-w) / 2), calc(100% - var(--note-pop-w) - 8px));
  width: var(--note-pop-w);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  box-shadow: var(--shadow-md);
  font-family: var(--font-ui);
  pointer-events: auto;
  cursor: default;
  user-select: text;
  -webkit-user-select: text;
}

.note-pop-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* The glyph its pin is wearing, and it changes with the pin: an anchor
   until something is written, a note from the first letter. */
.note-pop-glyph {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--accent);
}

.note-pop-glyph svg { display: block; width: 100%; height: 100%; }

/* The name is a field that does not look like one until it is wanted. Empty,
   it asks for a title rather than showing the page: a page number there
   read as the anchor's name, and it is only the lack of one. */
.note-pop .note-pop-name {
  flex: 1;
  min-width: 0;
  padding: 3px 5px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: none;
  box-shadow: none;
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.note-pop input.note-pop-name::placeholder { color: var(--ink-faint); font-weight: 500; }
.note-pop input.note-pop-name:hover { border-color: var(--line); }
.note-pop input.note-pop-name:focus {
  border-color: var(--accent);
  background: var(--card);
  outline: none;
}

.note-pop .note-pop-delete,
.note-pop .note-pop-delete:hover:not(:disabled) {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: none;
  box-shadow: none;
  color: var(--ink-faint);
}

.note-pop .note-pop-delete:hover:not(:disabled) {
  background: var(--red-soft);
  color: var(--red);
}

.note-pop-delete svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Words about a paper are set in the paper's own kind of type. */
.note-pop .note-pop-text {
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: var(--fs-md);
  line-height: 1.45;
  resize: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.note-pop textarea.note-pop-text:focus {
  border-color: var(--accent);
  background: var(--card);
  outline: none;
}

.note-pop p.note-pop-text { max-height: 220px; overflow: auto; }

/* Closing buttons of the cards that have them. */
.card-x {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: none;
  color: var(--ink-faint);
  font-size: var(--fs-lg);
  line-height: 1;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.card-x:hover:not(:disabled) {
  border: none;
  background: var(--red-soft);
  color: var(--red);
}

/* ---------- Narrower windows ---------- */

@media (max-width: 860px) {
  .pages { padding: 12px; }
  .search-pop { position: fixed; left: 12px; right: 12px; top: 64px; width: auto; }
  .search-pop input { flex: 1; width: auto; }
}

/* A phone. The bar has to hold a way back, the file and the zoom in about
   320 points, so the paddings tighten. The way back is already a glyph and
   costs the same at every width. */
@media (max-width: 560px) {
  .viewer-bar { gap: 8px; padding: 8px 12px; }
  .viewer-bar .bar-link { padding: 6px 9px; }
  .search-pop { left: 8px; right: 8px; }
  /* Too little room for a name to survive being cut to three letters, and
     a wrong-looking word is worse than none. The map keeps its shape, its
     anchors and its marker, which is what it is for. */
  .navigator-name { display: none; }
  .navigator { min-width: 56px; }
}

/* A touch screen has no hover, so anything that was only revealed by one
   is simply there, and the small annotations are given a finger's worth of
   room. */
@media (hover: none) {
  /* No hover to open the rack with, so it is never closed: the tools stand
     in a row across the bar, as they always did, and take their own room
     back from the map. */
  .tools { position: static; width: auto; height: auto; }
  .tools .tools-rack {
    position: static;
    flex-direction: row;
    padding: 0;
    border-color: transparent;
    background: none;
    box-shadow: none;
  }
  /* Nothing is ever hidden here, so nothing has to be lifted to the front
     of the row to be found: the palette keeps its printed order. */
  .tools .tool-slot { display: flex; }
  .tools .tool-slot.held { order: 0; }
  /* The name looks like a field on hover; with no hover to give, it just
     looks like one. */
  .note-pop input.note-pop-name { border-color: var(--line); }
  .note-pop .note-pop-delete { width: 30px; height: 30px; }
  .card-x { width: 26px; height: 26px; }
}

`;
