import React, { useEffect, useMemo, useRef, useState } from 'react';

import { laidOut, lineAtPosition, positionAtLine } from './navigatorScale';
import { pageStops, sectionStops, stopAt, stopName } from './sectionStops';

/**
 * The paper's sections, named in a row, for a phone.
 *
 * The Navigator draws the paper to length across the bar, and on a desktop
 * that is the better map: a glance says Method is half the paper. Under
 * 560 points there is no room for the names on the strip, and a strip of
 * unnamed boxes says nothing a thumb can aim at. So the same list of stops
 * (see sectionStops) is drawn here as its names, one after another, in a
 * row that scrolls sideways when the paper has more sections than the
 * screen has width. The section being read is lit and kept in view, so
 * the row is a table of contents and a bookmark at once; a tap goes to the
 * head of the section, as a keyboard press on the bar does.
 *
 * A paper without an outline has no sections to name, and a strip with
 * nothing on it is worse than no strip. Its pages stand in: numbered,
 * tappable, the one being read lit.
 */

// How far down the window the reading line is, as a fraction of it. A
// section that has just been gone to has its heading near the top of the
// window (see goToSection), so the line has to be below that to count the
// reader as in it; and it stays well above the middle, because what is
// read is the upper part of the window.
const READING_LINE = 0.3;

// Beyond this many windows away the scroll jumps rather than glides — the
// rule the sections' own jump follows.
const FAR = 1.5;

export default function SectionStrip({
  pages = 0,
  sections = [],
  scrollerRef,
  live = false,
  onSection,
  onTop,
}) {
  const rowRef = useRef(null);
  const named = useMemo(() => sectionStops(sections, pages), [sections, pages]);
  const paged = !named.length;
  const stops = useMemo(() => (paged ? pageStops(pages) : named), [paged, named, pages]);

  // Where the reader is: the stop the reading line falls in, and the page
  // it is on. Set from the scroll a frame at a time, and only when it
  // changes, so scrolling within a section redraws nothing.
  const [here, setHere] = useState({ stop: -1, page: 0 });
  useEffect(() => {
    const scroller = scrollerRef?.current;
    if (!live || !scroller || !stops.length) return undefined;
    let frame = 0;
    const look = () => {
      frame = 0;
      const sheets = laidOut(scroller);
      if (!sheets.some((sheet) => sheet.height > 10)) return;
      const at = positionAtLine(sheets, scroller.scrollTop + scroller.clientHeight * READING_LINE);
      const stop = stopAt(stops, at);
      const page = Math.max(1, Math.min(sheets.length, Math.floor(at) + 1));
      setHere((was) => (was.stop === stop && was.page === page ? was : { stop, page }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(look);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    // A window of a different height has a different reading line.
    const resized = new ResizeObserver(schedule);
    resized.observe(scroller);
    look();
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resized.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [live, stops, scrollerRef]);

  // The lit name is kept on screen. Not centred on every change, which
  // would have the row sliding about under a thumb that is scrolling the
  // paper: only when it has gone out of view is it brought back, a third
  // of the way in, so the next name or two show beside it.
  useEffect(() => {
    const row = rowRef.current;
    const button = row?.children[here.stop];
    if (!row || !button) return;
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    const seen = row.scrollLeft;
    const width = row.clientWidth;
    if (left >= seen && right <= seen + width) return;
    row.scrollTo({ left: Math.max(0, left - width * 0.3), behavior: 'smooth' });
  }, [here.stop]);

  const go = (stop) => {
    if (!paged) {
      if (stop.front) onTop?.();
      else onSection?.(stop);
      return;
    }
    // A page has no heading to bring to the top, so its own top edge comes
    // there, a little way in from the bar.
    const scroller = scrollerRef?.current;
    if (!scroller) return;
    const top = Math.max(0, lineAtPosition(laidOut(scroller), stop.at) - 8);
    const far = Math.abs(top - scroller.scrollTop) > scroller.clientHeight * FAR;
    scroller.scrollTo({ top, behavior: far ? 'auto' : 'smooth' });
  };

  // One tab stop for the row, arrows to walk it — a paper of twenty
  // sections should not cost twenty presses to get past.
  const walk = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(rowRef.current?.children || [])];
    if (!buttons.length) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowRight' ? Math.min(buttons.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
    buttons[next]?.focus();
  };

  if (!stops.length) return <span className="spacer" />;

  const lit = Math.max(0, here.stop);

  return (
    <div className="section-strip" data-tauri-drag-region="false">
      <div
        className="strip-row"
        ref={rowRef}
        role="toolbar"
        aria-label={paged ? 'Pages' : 'Sections'}
        onKeyDown={walk}
      >
        {stops.map((stop, index) => (
          <button
            key={stop.id}
            type="button"
            className={`strip-stop${stop.front ? ' front' : ''}${stop.appendix ? ' back' : ''}`}
            aria-current={index === here.stop ? 'location' : undefined}
            aria-label={paged ? `Page ${stop.page}`
              : stop.front ? 'The start of the paper'
                : `${stopName(stop)}, page ${stop.page}`}
            tabIndex={index === lit ? 0 : -1}
            onClick={() => go(stop)}
          >
            {stopName(stop)}
          </button>
        ))}
      </div>
      {/* Where in the paper the section is, which the names alone do not
          say: the page under the reading line, of how many. The page
          numbers say it themselves when they are the stops. */}
      {!paged && here.page > 0 && (
        <span className="strip-page" title={`Page ${here.page} of ${pages}`}>
          {here.page}
          <span className="strip-of">/{pages}</span>
        </span>
      )}
    </div>
  );
}
