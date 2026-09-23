import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  barScale, evened, laidOut, lineAtPosition, positionAtLine, shareOut,
} from './navigatorScale';
import { isBibliography, isFrontMatter, topLevel } from './sections';
import { positionOf, sectionStops } from './sectionStops';
import SectionStrip from './SectionStrip';
import { PHONE } from './styles';

/**
 * The paper, drawn to length across the bar.
 *
 * Not a menu that has to be opened: the whole document is already on
 * screen, so its shape is read rather than recalled. Each section is a
 * segment as wide as the section is long, which is why a glance says
 * Method is half the paper and Conclusion is a paragraph — a list of names
 * can never say that. Three lanes at one scale: the subsections' ticks
 * point down at the strip from above, the strip of sections, and the
 * reader's anchors and notes point up at it from below. So a triangle under
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

// A subsection's tick: the anchors' triangle again, smaller and turned over
// so that it points down at the strip while theirs point up at it, which
// makes the two lanes one idea seen twice. A plain stub standing over the
// strip was tried first and read as a stray stroke. Its corners are rounded
// by the stroke, as the anchor's are.
const SubMark = () => (
  <svg viewBox="0 0 10 7" aria-hidden="true">
    <path
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      d="M1.6 1.4h6.8L5 5.9Z"
    />
  </svg>
);

// The reader's two marks, told apart by silhouette rather than colour, and
// both aimed up at the place on the strip they belong to. An anchor is a
// place and nothing more, so it is only the pointer. A note has words on it,
// so it is the bubble words come in, with its tip turned upwards from the
// middle of it. Its corners are as round as the box can take and still be a
// box: square, with a tip in the middle of its lid, it reads as a briefcase
// and its handle at this size; rounder still, as an acorn. Both were tried.
const AnchorMark = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path fill="currentColor" d="M7 1.2 12.6 12a.7.7 0 0 1-.62 1H2.02a.7.7 0 0 1-.62-1Z" />
  </svg>
);

const NoteMark = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M3.8 4H10.2A3 3 0 0 1 13.2 7V10.4A3 3 0 0 1 10.2 13.4H3.8A3 3 0 0 1 .8 10.4V7A3 3 0 0 1 3.8 4ZM5.4 4.4 7 .6 8.6 4.4Z"
    />
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
  anchors = [],
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
    const resized = new ResizeObserver(measure);
    resized.observe(root);
    measure();
    return () => resized.disconnect();
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
        scrollerRef={scrollerRef}
        live={live}
        onSection={onSection}
        onTop={onTop}
      />
    );
  }

  if (!shown) return <span className="spacer" />;

  const percent = (at) => `${scale.toBar(at) * 100}%`;

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
    <div
      className={`navigator${marks.length ? '' : ' unmarked'}${ticks.length ? '' : ' unticked'}`}
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
        {segments.map((segment, index) => {
          const name = [segment.number, segment.title].filter(Boolean).join(' ');
          return (
            <button
              key={segment.id}
              type="button"
              className={`navigator-seg${segment.appendix ? ' back' : ''}${segment.front ? ' front' : ''}${index % 2 ? ' alt' : ''}`}
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
              data-tip={segment.front ? 'The start of the paper' : `${name} — page ${segment.page}`}
              aria-label={segment.front ? 'The start of the paper' : `${name}, page ${segment.page}`}
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

      {ticks.length > 0 && (
        <div
          className="navigator-subs"
          ref={subsRef}
          role="toolbar"
          aria-label="Subsections"
          onKeyDown={(event) => walk(event, subsRef)}
        >
          {ticks.map((tick, index) => {
            const name = [tick.number, tick.title].filter(Boolean).join(' ');
            return (
              <button
                key={tick.id}
                type="button"
                className="navigator-sub"
                style={{ left: percent(tick.at) }}
                tabIndex={index === 0 ? 0 : -1}
                data-tip={`${name} — page ${tick.page}`}
                aria-label={`${name}, page ${tick.page}`}
                // The same journey a press on the strip makes: the place
                // comes to the middle of the window, so the marker ends up
                // standing on the tick.
                onClick={() => seek(tick.at)}
              >
                <SubMark />
              </button>
            );
          })}
        </div>
      )}

      <div
        className="navigator-lane"
        ref={laneRef}
        role="toolbar"
        aria-label="Anchors and notes"
        onKeyDown={(event) => walk(event, laneRef)}
      >
        {marks.map((mark, index) => (
          <button
            key={mark.uuid}
            type="button"
            className={`navigator-anchor${mark.note?.content ? ' written' : ''}`}
            style={{ left: percent(mark.at) }}
            tabIndex={index === 0 ? 0 : -1}
            data-tip={`${mark.label} — page ${mark.page}`}
            aria-label={`${mark.label}, page ${mark.page}`}
            onClick={() => onAnchor(mark)}
          >
            {mark.note?.content ? <NoteMark /> : <AnchorMark />}
          </button>
        ))}
      </div>

      <span className="navigator-here" aria-hidden="true" />
      <span className="navigator-tip" ref={tipRef} role="presentation" hidden />
    </div>
  );
}
