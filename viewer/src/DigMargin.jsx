import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Avatar from '../../shared/ui/Avatar.jsx';
import { PhaseGlyph, TalkCard } from '../../shared/ui/Talk.jsx';
import { useDismiss } from '../../shared/useDismiss.js';

// How wide the margin is, and how far it stands from the sheet.
export const MARGIN_WIDTH = 300;
export const MARGIN_GAP = 20;
// The least room between one line and the next.
const LINE_GAP = 10;
// From a line's top to the middle of its name: the head's 8px padding and
// half its 20px name line. The name, not the box, is what stands level
// with the thing it is about.
const NAME_MID = 18;

// With a project on and room beside the sheets, the viewer's margin holds
// every dig on the paper: the paper's own at the head of the first page,
// then each dig inside it level with its anchor, ink or clip. It is the
// brief, beside the paper. It lives in the pages' own scroller, so it
// moves with them and nothing scrolls on its own.
//
// Each line is a thing that holds digs: whose it opens on, where that dig
// stands and how it begins. Pressing it opens the thing's dig card right
// there, and the lines below make room; pressing anywhere else folds it.
// When lines would meet, a line gives way downward and never upward, so
// nothing sits above the place it is about.
export default function DigMargin({ scrollerRef, lines, layoutKey, open, picked, onOpen, onClose, project, onChanged }) {
  const [places, setPlaces] = useState({});
  const elements = useRef(new Map());
  const openLine = useRef(null);
  // A line just opened is kept in view while its card fills in.
  const revealUntil = useRef(0);

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {};
    let floor = -Infinity;
    for (const line of lines) {
      const pageEl = scroller.querySelector(`.pdf-page[data-page="${line.page}"]`);
      if (!pageEl) continue;
      const wanted = pageEl.offsetTop + Math.max(0, line.down * pageEl.offsetHeight - NAME_MID);
      const top = Math.max(wanted, floor);
      next[line.key] = { top: Math.round(top), left: Math.round(pageEl.offsetLeft + pageEl.offsetWidth + MARGIN_GAP) };
      floor = top + (elements.current.get(line.key)?.offsetHeight ?? 0) + LINE_GAP;
    }
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [lines, scrollerRef]);

  // Placed once the pages are laid, again whenever they or a line change
  // size: a zoom, a window resized, a card opened or written in.
  // The pages are watched too: pdf.js gives a page its true height only
  // once it has read it, which moves every page below without resizing
  // the scroller.
  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(() => {
      place();
      if (Date.now() < revealUntil.current) {
        window.requestAnimationFrame(() => openLine.current?.scrollIntoView({ block: 'nearest' }));
      }
    });
    elements.current.forEach((el) => observer.observe(el));
    const scroller = scrollerRef.current;
    if (scroller) {
      observer.observe(scroller);
      scroller.querySelectorAll('.pdf-page').forEach((el) => observer.observe(el));
    }
    return () => observer.disconnect();
  }, [place, layoutKey, open?.key]);

  // Opened from the margin or a pin, a line near the foot of the window
  // would grow its card out of sight; it is brought up as far as it needs.
  // A landing has already put its thing in the middle, so it is left be.
  useLayoutEffect(() => {
    revealUntil.current = open && !open.landed ? Date.now() + 800 : 0;
  }, [open?.key]);

  useDismiss(Boolean(open), (event) => Boolean(
    openLine.current?.contains(event.target)
    || event.target.closest?.('.talk-pin, .dig-margin-head, .confirm-dialog, [role="dialog"], [role="listbox"]'),
  ), onClose, { escape: false });

  return (
    <div className="dig-margin" aria-label="Digs">
      {lines.map((line) => {
        const at = places[line.key];
        const isOpen = open?.key === line.key;
        const lead = line.pin.lead ?? {};
        const mine = lead.owner && lead.owner.uuid === project.me?.uuid;
        return (
          <div
            key={line.key}
            ref={(el) => {
              if (el) elements.current.set(line.key, el);
              else elements.current.delete(line.key);
              if (isOpen) openLine.current = el;
              else if (openLine.current === el) openLine.current = null;
            }}
            className={`dig-margin-line${isOpen ? ' is-open' : ''}${!isOpen && line.annotation && line.annotation === picked ? ' is-picked' : ''}`}
            data-key={line.key}
            data-subject={line.subject}
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, width: MARGIN_WIDTH, visibility: at ? 'visible' : 'hidden' }}
          >
            {isOpen && line.quote && (
              <p className="dig-margin-quote">
                {line.quote.name && <b>{line.quote.name}</b>}
                <span>{line.quote.text}</span>
              </p>
            )}
            {isOpen ? (
              <TalkCard
                inline focus phaseInHead projectUuid={project.uuid} subject={line.subject} label={line.label}
                dig={open.dig ?? line.pin.uuid} currentUser={project.me}
                onChanged={(discussion, total) => onChanged(line.subject, discussion, total)}
              />
            ) : (
              <button type="button" className="dig-margin-head" aria-expanded="false" onClick={() => onOpen(line)}>
                <span className="visually-hidden">{line.label}</span>
                <span className="dig-margin-who">
                  {lead.owner && <Avatar user={lead.owner} className="mini-avatar" />}
                  <span className="dig-margin-name">{mine ? 'You' : lead.owner?.display_name}</span>
                  {line.pin.dig_count > 1 && <span className="dig-margin-more">+{line.pin.dig_count - 1}</span>}
                  {lead.phase && <PhaseGlyph phase={lead.phase} />}
                  {line.pin.is_new && <span className="news-dot" role="img" aria-label="New" />}
                </span>
                {lead.excerpt && <span className="dig-margin-text">{lead.excerpt}</span>}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
