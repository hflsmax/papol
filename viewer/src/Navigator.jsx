import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  barScale, evened, laidOut, lineAtPosition, positionAtLine, shareOut,
} from './navigatorScale';
import { isBibliography, isFrontMatter, topLevel } from './sections';
import { positionOf, sectionStops } from './sectionStops';
import { NAV_KINDS, NAV_NAMES, NAV_SHOWN, floatMarks } from './navMarks';
import SectionStrip from './SectionStrip';
import { PHONE } from './styles';

/**
 * The paper, drawn to length across the bar.
 *
 * Not a menu that has to be opened: the whole document is already on
 * screen, so its shape is read rather than recalled. Each section is a
 * segment as wide as the section is long, which is why a glance says
 * Method is half the paper and Conclusion is a paragraph — a list of names
 * can never say that. Three lanes at one scale: the paper's own marks —
 * subsections, figures, tables, code, definitions, theorems, lemmas,
 * proofs, whichever the reader has the gear at its right end show — stand
 * over the strip, the strip of sections, and the
 * reader's anchors point up at it from below. So a triangle under
 * the middle of Results is *in* Results, and nothing has to say so — and
 * what the paper says about itself stands on one side of the strip, what
 * the reader has put on it on the other.
 *
 * A section is not drawn to its true length but to an evened one, because a
 * paper is mostly its longest section and a name needs room (see EVENNESS).
 * Everything on the bar is then placed through the one scale that results,
 * so a place on the bar is still one place in the paper.
 *
 * The strip is also the paper's scrubber. A press anywhere on it goes to
 * exactly that place, not to the head of the section it falls in, and the
 * press can be held and drawn along: the paper follows. The marker is the
 * other half of the same sentence — it shows where the middle of the window
 * is, and moves as the paper does — so pressing a spot and being at it are
 * the same point on the bar.
 *
 * Everything is placed in document units: 0 at the top of page one, one
 * unit per page. A section and an anchor both reduce to a number on that
 * line, which is the whole of the arithmetic here.
 *
 * All of it is for a screen with room for it. On a phone the same list of
 * sections is drawn as its names in a row instead (see SectionStrip): the
 * bar's shape is read at a glance, but the names on it are not, and
 * under 560 points there is no room for them.
 */

// What the paper says about itself, marked over the strip: one small glyph
// per kind, in one hand — a nine-point square, strokes of 1.2, the bar's
// quiet grey — so they read as one family and none of them as the
// reader's own marks under the strip, which wear the member colours. Each
// shape says its kind without a word: a subsection's tick is the anchors'
// triangle turned over, pointing down at the strip as theirs point up at
// it (a plain stub read as a stray stroke); a figure is a framed picture, a
// table a ruled box, code its angle brackets, a definition ≔, a theorem a
// solid diamond, a lemma the same diamond open (the lesser claim), and a
// proof the square that ends one (∎). All sit on the strip's top edge.
const GLYPHS = {
  subsection: <path fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" d="M1.6 4.2h5.8L4.5 8.3Z" />,
  figure: (
    <>
      <rect x="1.1" y="1.6" width="6.8" height="5.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="currentColor" d="M2.3 6.4 4 4.3l1.1 1.3.7-.8 1.1 1.6Z" />
    </>
  ),
  table: (
    <>
      <rect x="1.1" y="1.6" width="6.8" height="5.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M1.6 4h5.8M4.5 4v3" />
    </>
  ),
  algorithm: <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" d="M3.3 2.2 1.1 4.5l2.2 2.3M5.7 2.2l2.2 2.3-2.2 2.3" />,
  definition: (
    <>
      <circle cx="1.6" cy="3.2" r="0.8" fill="currentColor" />
      <circle cx="1.6" cy="5.8" r="0.8" fill="currentColor" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M3.6 3.2h4.3M3.6 5.8h4.3" />
    </>
  ),
  theorem: <path fill="currentColor" d="M4.5 1 8 4.5 4.5 8 1 4.5Z" />,
  lemma: <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" d="M4.5 1.7 7.3 4.5 4.5 7.3 1.7 4.5Z" />,
  proof: <rect x="2.2" y="1.6" width="4.6" height="5.8" fill="currentColor" />,
};

export const MarkGlyph = ({ kind }) => (
  <svg viewBox="0 0 9 9" aria-hidden="true">{GLYPHS[kind]}</svg>
);

// How far apart two marks over the strip stand at the least, in pixels:
// a glyph's nine and a pixel of air.
const MARK_ROOM = 10;
// And the most a mark is moved off its place to stand clear.
const MARK_DRIFT = 6;

// The gear the choices open from: six teeth round a hole, as small as the
// marks and in their grey.
const Gear = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M6.9 1h2.2l.4 1.9 1.2.5 1.6-1.1 1.6 1.6-1.1 1.6.5 1.2 1.9.4v2.2l-1.9.4-.5 1.2 1.1 1.6-1.6 1.6-1.6-1.1-1.2.5-.4 1.9H6.9l-.4-1.9-1.2-.5-1.6 1.1-1.6-1.6 1.1-1.6-.5-1.2L.8 9.1V6.9l1.9-.4.5-1.2-1.1-1.6 1.6-1.6 1.6 1.1 1.2-.5ZM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8Z"
    />
  </svg>
);

// The reader's mark, aimed up at the place on the strip it belongs to. An
// anchor is a place, so it is only the pointer.
const AnchorMark = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path fill="currentColor" d="M7 1.2 12.6 12a.7.7 0 0 1-.62 1H2.02a.7.7 0 0 1-.62-1Z" />
  </svg>
);

// How far the sections are evened out, and the one number to tune: 0 draws
// the paper to scale, 1 gives every section the same width. To scale, a
// paper is mostly its longest section — half the bar spent on one name —
// and the short ones are left a thumb's width between them. At 0.7, a
// section ten times as long is drawn twice as wide: longer is still wider,
// so the shape of the paper is still there to be read, and so are the names.
const EVENNESS = 0.7;

// Under that, a floor: what evening out cannot reach is the section with no
// length at all (two headings side by side in two columns start at one
// height), and the one-line sections that end a paper. Room for a few
// letters, and something to aim at.
const LEAST_WIDTH = 36;

// The two ends of a paper are given their width outright rather than evened
// out: the front of it — the title, the authors, the abstract — and the
// bibliography. Both are places to go and neither is a place to look
// *inside*; all either needs is its name and a door at the end of the bar
// it stands at. By length they would take a third of the bar between them,
// and that room belongs to the sections that are read.
const FRONT_WIDTH = 56;
const BIBLIOGRAPHY_WIDTH = 76;

// End — the notices a paper closes on, and whatever it files after them
// (see withoutEndMatter) — is narrower still: nobody reads it, it is there
// so that the last section stops where it does.
const END_WIDTH = 40;

// The least a subsection may be given of the section it is in. Small: it is
// only there so two subsections a line apart do not put their ticks on one
// pixel.
const SUB_LEAST_WIDTH = 12;

// How quickly the paper closes on the place being pressed: the time, in
// milliseconds, in which it covers about two thirds of what is left. Short
// enough that the paper feels held, long enough that a drag is a glide and
// not a run of jumps.
const GLIDE = 80;

// Further than this many windows away, the distance is only waiting — the
// same rule the anchors' own jump follows — so the paper lands this close at
// once and glides the rest.
const FAR = 1.5;

// Whether the window is a phone's, by the same measure the styles use.
// Read once and then heard, so a window dragged across the line redraws.
const usePhone = () => {
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(PHONE);
    if (!query) return undefined;
    const tell = () => setPhone(query.matches);
    tell();
    query.addEventListener('change', tell);
    return () => query.removeEventListener('change', tell);
  }, []);
  return phone;
};

export default function Navigator({
  pages = 0,
  sections = [],
  // How far a paper with no outline has been read for its printed headings,
  // 0 to 1, or null when nothing is being read.
  reading = null,
  anchors = [],
  // The paper's figures, tables, algorithms and statements, as the
  // analysis found them, and which kinds the reader has the bar mark.
  floats = [],
  kinds = NAV_SHOWN,
  // Told the kinds to mark when the reader changes them; without it (no
  // account to keep the choice on) there is no gear.
  onShown = null,
  scrollerRef,
  // Whether the pages have sizes yet. Before that there is nothing to
  // measure a place against.
  live = false,
  onSection,
  onAnchor,
  onTop,
}) {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const laneRef = useRef(null);
  const subsRef = useRef(null);
  const tipRef = useRef(null);
  const glide = useRef({ frame: 0, target: 0, at: 0, wrote: 0, then: 0 });
  const scrubbing = useRef(false);
  const phone = usePhone();

  const top = useMemo(() => topLevel(sections), [sections]);

  // The sections, one level only, in the paper's order, with the front of
  // the paper before the first heading — the one list the bar and the
  // phone's strip both draw (see sectionStops). One level, because drawn
  // as their equals the subsections turn the strip into a barcode of boxes
  // too narrow to name, which is the opposite of seeing the shape of the
  // paper. The sections are the shape; the subsections are detail inside
  // it. Abstract is not doubled by a Start beside it: the first section
  // owns the bar from its left end anyway (see the edges below), so
  // Abstract is where the top of the paper is reached.
  const segments = useMemo(() => sectionStops(sections, pages), [sections, pages]);

  // The level below the sections: a tick standing on its section, and no
  // more. A subsection is detail within the shape, so it is drawn as detail
  // — it divides nothing, it only shows that the section has parts and
  // where they fall, and takes a click to go to one. One that starts where
  // its section does (a subsection straight under the heading) is the
  // section's own edge and would only double it.
  const ticks = useMemo(() => {
    if (!pages) return [];
    const heads = segments.filter((segment) => !segment.front).map((segment) => segment.at);
    return sections
      .filter((section) => (section.level ?? 0) === top + 1)
      .map((section) => ({ ...section, at: positionOf(section.page, section.y) }))
      .filter((tick) => tick.at > 0 && tick.at < pages
        && !heads.some((head) => Math.abs(head - tick.at) < pages * 0.004));
  }, [sections, segments, pages, top]);

  // Everything marked over the strip, in the paper's order: the
  // subsections' ticks and the analysis's kinds, as the reader chose them.
  // The ticks shape the scale whether they are shown or not, so the bar
  // does not reflow when they are turned off.
  const overs = useMemo(() => [
    ...(kinds.includes('subsection') ? ticks.map((tick) => {
      const name = [tick.number, tick.title].filter(Boolean).join(' ');
      return { id: tick.id, kind: 'subsection', name, page: tick.page, at: tick.at };
    }) : []),
    ...floatMarks(floats, kinds, pages),
  ].sort((a, b) => a.at - b.at), [ticks, floats, kinds, pages]);

  const marks = useMemo(
    () => anchors.map((anchor) => ({ ...anchor, at: positionOf(anchor.page, anchor.anchorY) })),
    [anchors],
  );

  // Every paper gets the bar, whether or not it names its sections or the
  // reader has marked it: a PDF printed to PDF often carries no outline,
  // and the bar is still where the reader is in it and the way to go
  // anywhere else. With no sections it is the paper by its pages.
  const shown = pages > 0;

  // How wide the bar is, which is what a minimum in pixels is a fraction of.
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    if (!shown || !root) return undefined;
    const measure = () => setWidth(Math.round(root.getBoundingClientRect().width));
    let frame = null;
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };
    const resized = new ResizeObserver(scheduleMeasure);
    resized.observe(root);
    measure();
    return () => {
      resized.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [shown]);

  // The bar's scale. Sections are drawn by their evened lengths over a
  // floor, so it changes pace from section to section — and everything on
  // the bar has to be placed by it: a tick, a mark, the marker and a press
  // all go through this pair, or a stretched section would leave them
  // pointing at places in the paper they are not at.
  const { scale, bounds } = useMemo(() => {
    if (!pages || !segments.length) {
      return { scale: barScale([0, Math.max(pages, 1)], [1]), bounds: [0, 1] };
    }
    // The first section owns the bar from its left end, even where its
    // heading sits a line or two into the paper.
    const edges = [0, ...segments.slice(1).map((segment) => segment.at), pages];
    const spans = edges.slice(1).map((edge, index) => edge - edges[index]);

    // The two ends of the paper take their width outright; see the widths
    // above. The front is a run rather than one segment: a paper can open
    // on Abstract, or on a Start that a named Summary follows, and either
    // way the front of the paper is what stands before its first real
    // section. Only a run from the very start counts: a later section
    // called Overview is not the paper opening again.
    let front = true;
    const fixed = segments.map((segment) => {
      front = front && (segment.front || isFrontMatter(segment.title));
      if (!(width > 0)) return null;
      if (front) return FRONT_WIDTH / width;
      if (segment.end) return END_WIDTH / width;
      if (!segment.front && isBibliography(segment.title)) return BIBLIOGRAPHY_WIDTH / width;
      return null;
    });
    const shares = shareOut(evened(spans, EVENNESS), LEAST_WIDTH / Math.max(width, 1), fixed);

    // Inside a section, its subsections are evened out the same way, so a
    // section of one long part and three short ones does not draw the three
    // as one crowd against its edge. The section keeps the width it was
    // given — this only decides the pace within it — so the two levels are
    // evened by the one number and neither disturbs the other.
    const cellEdges = [0];
    const cellShares = [];
    const bars = [0];
    segments.forEach((segment, index) => {
      const from = edges[index];
      const to = edges[index + 1];
      bars.push(bars[index] + shares[index]);
      const inside = ticks
        .filter((tick) => tick.at > from && tick.at < to)
        .map((tick) => tick.at);
      if (!inside.length) {
        cellEdges.push(to);
        cellShares.push(shares[index]);
        return;
      }
      const innerEdges = [from, ...inside, to];
      const innerSpans = innerEdges.slice(1).map((edge, at) => edge - innerEdges[at]);
      // A floor here too, or two subsections a line apart put their ticks
      // on the same pixel.
      const room = Math.max(width * shares[index], 1);
      const innerShares = shareOut(evened(innerSpans, EVENNESS), SUB_LEAST_WIDTH / room);
      innerEdges.slice(1).forEach((edge, at) => {
        cellEdges.push(edge);
        cellShares.push(innerShares[at] * shares[index]);
      });
    });
    return { scale: barScale(cellEdges, cellShares), bounds: bars };
  }, [segments, ticks, pages, width]);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  // The marker: the middle of the window, on the bar's scale. Written
  // straight onto the element, once a frame, because it moves on every
  // scroll and nothing else in the viewer needs to hear about it.
  useEffect(() => {
    const scroller = scrollerRef?.current;
    const root = rootRef.current;
    if (!shown || !live || !scroller || !root) return undefined;
    let frame = 0;
    const look = () => {
      frame = 0;
      const sheets = laidOut(scroller);
      if (!sheets.some((sheet) => sheet.height > 10)) return;
      const at = positionAtLine(sheets, scroller.scrollTop + scroller.clientHeight / 2);
      root.style.setProperty('--here', `${scaleRef.current.toBar(at) * 100}%`);
      root.dataset.located = 'true';
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(look);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    // A window of a different height has a different middle.
    const resized = new ResizeObserver(schedule);
    resized.observe(scroller);
    look();
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resized.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [shown, live, pages, scrollerRef, scale]);

  useEffect(() => () => {
    if (glide.current.frame) cancelAnimationFrame(glide.current.frame);
  }, []);

  // The paper closes on the pressed place a fraction of the way each frame,
  // so a held press that keeps moving is followed rather than chased in
  // steps. The offset is kept here and not read back from the scroller,
  // which rounds it: a last half-pixel read back as no progress would never
  // be covered.
  const step = (now) => {
    const state = glide.current;
    const scroller = scrollerRef?.current;
    state.frame = 0;
    if (!scroller) return;
    // Something else moved the paper — a wheel, a zoom, a link. It wins.
    if (Math.abs(scroller.scrollTop - state.wrote) > 2) return;
    const elapsed = Math.min(64, Math.max(0, now - state.then));
    state.then = now;
    const left = state.target - state.at;
    const far = scroller.clientHeight * FAR;
    if (Math.abs(left) > far) state.at = state.target - Math.sign(left) * far;
    else state.at += left * (1 - Math.exp(-elapsed / GLIDE));
    const done = Math.abs(state.target - state.at) < 0.5;
    if (done) state.at = state.target;
    scroller.scrollTop = state.at;
    state.wrote = scroller.scrollTop;
    if (!done) state.frame = requestAnimationFrame(step);
  };

  // Bring a place on the bar to the middle of the window, which is where
  // the marker reads from — so the marker arrives under the pointer.
  const seek = (at) => {
    const scroller = scrollerRef?.current;
    if (!scroller) return;
    const state = glide.current;
    const top = lineAtPosition(laidOut(scroller), at) - scroller.clientHeight / 2;
    state.target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, top));
    if (state.frame) return;
    state.at = scroller.scrollTop;
    state.wrote = scroller.scrollTop;
    state.then = performance.now();
    state.frame = requestAnimationFrame(step);
  };

  const pressedAt = (event) => {
    const box = rootRef.current.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    return scaleRef.current.toDoc((event.clientX - box.left) / box.width);
  };

  const press = (event) => {
    // An anchor is its own destination, and keeps its own click.
    if (event.button !== 0 || event.target.closest('.navigator-anchor, .navigator-sub')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubbing.current = true;
    seek(pressedAt(event));
    tell(event);
  };

  // What is under the pointer, said at once. The browser's own tooltip
  // waits a second and then will not move until the pointer has rested
  // again — made for a toolbar of large, separate buttons. Here a whole
  // paper is ruled off along a few hundred pixels, a section can be five of
  // them wide, and the hand moves a pixel at a time asking "and this?". So
  // the name follows the pointer with no delay, written straight onto the
  // element like the marker is. It is asked of the point rather than the
  // event, because a held press captures the pointer and every move would
  // otherwise report the strip as a whole.
  const tell = (event) => {
    const tip = tipRef.current;
    const root = rootRef.current;
    if (!tip || !root) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    // A paper with no sections is named by its pages instead.
    const text = (root.contains(under) ? under?.closest('[data-tip]')?.dataset.tip : null)
      || (!segments.length && root.contains(under)
        ? `Page ${Math.min(pages, Math.floor(pressedAt(event)) + 1)}`
        : null);
    if (!text) {
      tip.hidden = true;
      return;
    }
    if (tip.textContent !== text) tip.textContent = text;
    tip.hidden = false;
    const box = root.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.max(half, Math.min(box.width - half, event.clientX - box.left));
    tip.style.left = `${x}px`;
  };

  const hush = () => {
    if (tipRef.current) tipRef.current.hidden = true;
  };

  const draw = (event) => {
    if (scrubbing.current) seek(pressedAt(event));
    tell(event);
  };

  const release = (event) => {
    scrubbing.current = false;
    // A finger has no hover to go back to once it is lifted.
    if (event?.pointerType === 'touch') hush();
  };

  // A phone gets the names, not the bar (see SectionStrip). The bar's
  // effects above find no root to work on and stand down.
  if (phone) {
    return (
      <SectionStrip
        pages={pages}
        sections={sections}
        reading={reading}
        scrollerRef={scrollerRef}
        live={live}
        onSection={onSection}
        onTop={onTop}
      />
    );
  }

  if (!shown) return <span className="spacer" />;

  const percent = (at) => `${scale.toBar(at) * 100}%`;

  // A lemma and its proof, a figure and the theorem beside it, are often
  // a line apart, and their glyphs would print over each other. So a mark
  // that would touch the one before it stands just clear of it instead, a
  // few pixels off its place, where the pair can still be told apart. Where
  // the paper is so dense that it would have to move further than that, it
  // is left out rather than let the row drift off the places it marks: the
  // mark before it already stands on that spot.
  const spaced = [];
  overs.forEach((over) => {
    const at = scale.toBar(over.at) * width;
    const prev = spaced[spaced.length - 1];
    const x = prev ? Math.max(at, prev.x + MARK_ROOM) : at;
    if (width > 0 && x - at > MARK_DRIFT) return;
    spaced.push({ ...over, x, left: width > 0 ? `${x}px` : percent(over.at) });
  });

  // One tab stop for the strip, arrows to walk it — a bar should not cost
  // twenty-five presses to get past.
  const walk = (event, container) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const stops = [...(container.current?.children || [])].filter((el) => el.tagName === 'BUTTON');
    if (!stops.length) return;
    event.preventDefault();
    const at = stops.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? stops.length - 1
        : event.key === 'ArrowRight' ? Math.min(stops.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
    stops[next]?.focus();
  };

  return (
    <div className={`navigator-frame${marks.length ? '' : ' unmarked'}${overs.length ? '' : ' unticked'}`}>
      <div
        className="navigator"
        ref={rootRef}
        data-tauri-drag-region="false"
        onPointerDown={press}
        onPointerMove={draw}
        onPointerEnter={tell}
        onPointerLeave={hush}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <div
          className="navigator-track"
          ref={trackRef}
          role="toolbar"
          aria-label="Sections"
          onKeyDown={(event) => walk(event, trackRef)}
        >
          {/* While a paper with no outline is read for its headings, the
              empty strip fills as the pages are read, and says so. */}
          {!segments.length && reading != null && (
            <div
              className="navigator-reading"
              role="progressbar"
              aria-label="Initializing"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(reading * 100)}
              data-tip="Reading this paper for its sections, references and links"
            >
              <span className="navigator-reading-fill" style={{ width: `${reading * 100}%` }} />
              <span className="navigator-reading-name">Initializing…</span>
            </div>
          )}
          {/* A paper with an outline has its sections at once; the rest of
              it, its references and links, is still being read, and a line
              along the strip's foot fills as it is. */}
          {segments.length > 0 && reading != null && (
            <span
              className="navigator-loading"
              role="progressbar"
              aria-label="Initializing"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(reading * 100)}
              style={{ width: `${reading * 100}%` }}
            />
          )}
          {segments.map((segment, index) => {
            const name = [segment.number, segment.title].filter(Boolean).join(' ');
            return (
              <button
                key={segment.id}
                type="button"
                className={`navigator-seg${segment.appendix ? ' back' : ''}${segment.front ? ' front' : ''}${segment.end ? ' end' : ''}${index % 2 ? ' alt' : ''}`}
                // Placed, not flowed. Shared out as flexible boxes, every
                // segment's padding and border took its room before the rest
                // was divided, and the heads of the sections drifted off the
                // scale the marker and the marks are on. A section begins at
                // its left edge, exactly: bring the marker to that edge and
                // the heading is at the middle of the window.
                style={{
                  left: `${bounds[index] * 100}%`,
                  width: `${(bounds[index + 1] - bounds[index]) * 100}%`,
                }}
                data-level={segment.level ?? 0}
                tabIndex={index === 0 ? 0 : -1}
                data-tip={segment.front ? 'The start of the paper'
                  : segment.end ? `The end of the paper — page ${segment.page}`
                    : `${name} — page ${segment.page}`}
                aria-label={segment.front ? 'The start of the paper'
                  : segment.end ? `The end of the paper, page ${segment.page}`
                    : `${name}, page ${segment.page}`}
                // A pointer's press has already gone to the exact spot under
                // it. What is left to arrive here is the keyboard, which has
                // no spot to point at and so goes to the head of the section.
                onClick={(event) => {
                  if (event.detail !== 0) return;
                  if (segment.front) onTop();
                  else onSection(segment);
                }}
              >
                {/* Always named. A short section shows as much of its name as
                    it has room for, which is still more than a blank box
                    says, and the tooltip has the rest. */}
                <span className="navigator-name">{segment.front ? segment.title : name}</span>
              </button>
            );
          })}
        </div>

        {overs.length > 0 && (
          <div
            className="navigator-subs"
            ref={subsRef}
            role="toolbar"
            aria-label="Marks"
            onKeyDown={(event) => walk(event, subsRef)}
          >
            {spaced.map((over, index) => (
              <button
                key={`${over.kind}-${over.id}`}
                type="button"
                className="navigator-sub"
                data-kind={over.kind}
                style={{ left: over.left }}
                tabIndex={index === 0 ? 0 : -1}
                data-tip={`${over.name} — page ${over.page}`}
                aria-label={`${over.name}, page ${over.page}`}
                // The same journey a press on the strip makes: the place
                // comes to the middle of the window, so the marker ends up
                // standing on the mark.
                onClick={() => seek(over.at)}
              >
                <MarkGlyph kind={over.kind} />
              </button>
            ))}
          </div>
        )}

        <div
          className="navigator-lane"
          ref={laneRef}
          role="toolbar"
          aria-label="Anchors"
          onKeyDown={(event) => walk(event, laneRef)}
        >
          {marks.map((mark, index) => (
            <button
              key={mark.uuid}
              type="button"
              className={`navigator-anchor${mark.who ? ' worn' : ''}`}
              style={{ left: percent(mark.at), ...(mark.who ? { '--who': mark.who } : {}) }}
              tabIndex={index === 0 ? 0 : -1}
              data-tip={`${mark.label} — page ${mark.page}`}
              aria-label={`${mark.label}, page ${mark.page}`}
              onClick={() => onAnchor(mark)}
            >
              <AnchorMark />
            </button>
          ))}
        </div>

        <span className="navigator-here" aria-hidden="true" />
        <span className="navigator-tip" ref={tipRef} role="presentation" hidden />
      </div>
      {onShown && <MarkChoices shown={kinds} onShown={onShown} />}
    </div>
  );
}

// The gear at the bar's right end, and what it opens: every kind the bar
// can mark, each with its glyph and name, pressed to mark it or not. Open
// in one step, under the gear; a press outside or Escape puts it away.
function MarkChoices({ shown, onShown }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const toggle = (kind) => onShown(shown.includes(kind)
    ? shown.filter((k) => k !== kind)
    : NAV_KINDS.filter((k) => k === kind || shown.includes(k)));
  return (
    <div className="navigator-choice" ref={boxRef} data-tauri-drag-region="false">
      <button
        type="button"
        className={`navigator-gear${open ? ' open' : ''}`}
        aria-label="Marks"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Gear />
      </button>
      {open && (
        <div className="navigator-choices" role="group" aria-label="Marks">
          {NAV_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="navigator-kind"
              aria-pressed={shown.includes(kind)}
              onClick={() => toggle(kind)}
            >
              <MarkGlyph kind={kind} />
              <span className="navigator-kind-name">{NAV_NAMES[kind]}</span>
              <svg className="navigator-kind-on" viewBox="0 0 12 12" aria-hidden="true">
                <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" d="m2.5 6.3 2.3 2.3 4.7-5" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
