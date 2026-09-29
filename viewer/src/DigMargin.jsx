import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Avatar from '../../shared/ui/Avatar.jsx';
import { PhaseGlyph, TalkCard } from '../../shared/ui/Talk.jsx';
import { useDismiss } from '../../shared/useDismiss.js';

// How wide the margin may be, the least it is shown at, and how far it
// stands from the sheet. It takes only the room the page leaves.
export const MARGIN_MAX = 280;
export const MARGIN_MIN = 220;
export const MARGIN_GAP = 20;
// Folded, the margin is a column of faces this wide.
export const MARGIN_FOLDED = 32;
// How wide a line opened from the folded column is: it stands over the
// edge of the page rather than widen the column.
const FOLDED_CARD = 300;
// Room kept at the head of the column for the fold control.
const FOLD_HEAD = 34;
// The least room between one line and the next.
const LINE_GAP = 10;
// From a line's top to the middle of its name: the head's 8px padding and
// half its 20px name line. The name, not the box, is what stands level
// with the thing it is about.
const NAME_MID = 18;

// With room beside the sheets, the viewer's margin holds every dig on the
// paper — the project's with one on, else the reader's own: the paper's
// own at the head of the first page, then each dig inside it level with
// its anchor, ink or clip. It is the brief, beside the paper. It lives in the pages' own scroller, so it
// moves with them and nothing scrolls on its own.
//
// Each line is a thing that holds digs: whose it opens on, where that dig
// stands and how it begins. Pressing it opens the thing's dig card right
// there, and the lines below make room; pressing anywhere else folds it.
// When lines would meet, a line gives way downward and never upward, so
// nothing sits above the place it is about.
//
// Folded (`folded`), each line is only the face of whoever wrote it, still
// level with its place; pressing a face opens that line in full, over the
// edge of the page, and the page keeps its size. The control at the head
// of the column folds and unfolds it (`onFold`), when the room beside the
// page is enough for the lines (`canUnfold`).
export default function DigMargin({
  scrollerRef, lines, layoutKey, width, folded = false, canUnfold = true, onFold, open, picked, onOpen, onClose, project, onChanged,
}) {
  const [places, setPlaces] = useState({});
  const elements = useRef(new Map());
  const openLine = useRef(null);
  // A line just opened is kept in view while its card fills in.
  const revealUntil = useRef(0);

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {};
    const first = scroller.querySelector('.pdf-page[data-page="1"]');
    if (first) {
      const left = first.offsetLeft + first.offsetWidth + MARGIN_GAP;
      next.head = { top: first.offsetTop, left: Math.round(folded ? left : left + width - 28) };
    }
    let floor = first ? first.offsetTop + FOLD_HEAD : -Infinity;
    for (const line of lines) {
      const pageEl = scroller.querySelector(`.pdf-page[data-page="${line.page}"]`);
      if (!pageEl) continue;
      const wanted = pageEl.offsetTop + Math.max(0, line.down * pageEl.offsetHeight - (folded ? MARGIN_FOLDED / 2 : NAME_MID));
      const top = Math.max(wanted, floor);
      const left = pageEl.offsetLeft + pageEl.offsetWidth + MARGIN_GAP;
      // Folded, an open line stands over the page's edge, right-aligned
      // with the column, and the faces below it keep their places.
      const cardOver = folded && open?.key === line.key;
      next[line.key] = {
        top: Math.round(top),
        left: Math.round(cardOver ? Math.max(8, left + MARGIN_FOLDED - FOLDED_CARD) : left),
      };
      floor = top + (cardOver ? MARGIN_FOLDED : elements.current.get(line.key)?.offsetHeight ?? 0) + (folded ? 4 : LINE_GAP);
    }
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [lines, scrollerRef, folded, width, open?.key]);

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
    || event.target.closest?.('.talk-pin, .thing-face, .dig-margin-head, .dig-margin-face, .dig-margin-fold, .papol-confirm-overlay, [role="dialog"], [role="listbox"]'),
  ), onClose, { escape: false });

  return (
    <div className={`dig-margin${folded ? ' is-folded' : ''}`} aria-label="Digs">
      {(!folded || canUnfold) && (
        <button
          type="button"
          className="dig-margin-fold"
          aria-label={folded ? 'Unfold the digs' : 'Fold the digs'}
          aria-expanded={!folded}
          title={folded ? 'Unfold' : 'Fold'}
          style={{ top: places.head?.top ?? 0, left: places.head?.left ?? 0, visibility: places.head ? 'visible' : 'hidden' }}
          onClick={() => onFold?.(!folded)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d={folded ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} /></svg>
        </button>
      )}
      {lines.map((line) => {
        const at = places[line.key];
        const isOpen = open?.key === line.key;
        const lead = line.pin.lead ?? {};
        // With no project on, every dig here is the reader's own.
        const mine = !project.uuid || (lead.owner && lead.owner.uuid === project.me?.uuid);
        return (
          <div
            key={line.key}
            ref={(el) => {
              if (el) elements.current.set(line.key, el);
              else elements.current.delete(line.key);
              if (isOpen) openLine.current = el;
              else if (openLine.current === el) openLine.current = null;
            }}
            className={`dig-margin-line${isOpen ? ' is-open' : ''}${folded && !isOpen ? ' is-face' : ''}${!isOpen && line.annotation && line.annotation === picked ? ' is-picked' : ''}`}
            data-key={line.key}
            data-subject={line.subject}
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, width: folded ? (isOpen ? FOLDED_CARD : MARGIN_FOLDED) : width, visibility: at ? 'visible' : 'hidden' }}
          >
            {isOpen ? (
              <TalkCard
                inline focus phaseInHead projectUuid={project.uuid} subject={line.subject} label={line.label}
                dig={open.dig ?? line.pin.uuid} currentUser={project.me}
                onChanged={(discussion, total) => onChanged(line.subject, discussion, total)}
              />
            ) : folded ? (
              <button type="button" className="dig-margin-face" aria-expanded="false" title={mine ? 'You' : lead.owner?.display_name} onClick={() => onOpen(line)}>
                <span className="visually-hidden">{line.label}</span>
                {lead.owner && <Avatar user={lead.owner} className="mini-avatar" />}
                {line.pin.is_new && <span className="news-dot" role="img" aria-label="New" />}
              </button>
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
