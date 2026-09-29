import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Avatar from '../../shared/ui/Avatar.jsx';
import { PhaseGlyph, TalkCard } from '../../shared/ui/Talk.jsx';
import { useDismiss } from '../../shared/useDismiss.js';

// How wide the margin is, and how far it stands from the sheet.
export const MARGIN_WIDTH = 300;
const MARGIN_GAP = 28;
// The least room between one line and the next.
const LINE_GAP = 10;

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
export default function DigMargin({ scrollerRef, lines, layoutKey, open, onOpen, onClose, project, onChanged }) {
  const [places, setPlaces] = useState({});
  const elements = useRef(new Map());
  const openLine = useRef(null);

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {};
    let floor = -Infinity;
    for (const line of lines) {
      const pageEl = scroller.querySelector(`.pdf-page[data-page="${line.page}"]`);
      if (!pageEl) continue;
      const wanted = pageEl.offsetTop + line.down * pageEl.offsetHeight;
      const top = Math.max(wanted, floor);
      next[line.key] = { top: Math.round(top), left: Math.round(pageEl.offsetLeft + pageEl.offsetWidth + MARGIN_GAP) };
      floor = top + (elements.current.get(line.key)?.offsetHeight ?? 0) + LINE_GAP;
    }
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [lines, scrollerRef]);

  // Placed once the pages are laid, again whenever they or a line change
  // size: a zoom, a window resized, a card opened or written in.
  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(() => place());
    elements.current.forEach((el) => observer.observe(el));
    if (scrollerRef.current) observer.observe(scrollerRef.current);
    return () => observer.disconnect();
  }, [place, layoutKey, open?.key]);

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
            }}
            className={`dig-margin-line${isOpen ? ' is-open' : ''}`}
            data-subject={line.subject}
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, width: MARGIN_WIDTH, visibility: at ? 'visible' : 'hidden' }}
          >
            {isOpen ? (
              <TalkCard
                inline focus projectUuid={project.uuid} subject={line.subject} label={line.label}
                dig={open.dig ?? line.pin.uuid} currentUser={project.me}
                onChanged={(discussion, total) => onChanged(line.subject, discussion, total)}
              />
            ) : (
              <button type="button" className="dig-margin-head" aria-expanded="false" onClick={() => onOpen(line)}>
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
