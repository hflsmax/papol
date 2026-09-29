import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '../../shared/ui/Avatar.jsx';
import { TalkCard } from '../../shared/ui/Talk.jsx';
import { useDismiss } from '../../shared/useDismiss.js';
import { memberInk } from './project.js';

// How far the margin stands from the sheet, and how wide it is: one face.
// It is the same at every zoom and every size of page, so a zoom only
// moves it.
export const MARGIN_GAP = 20;
export const MARGIN_WIDTH = 32;
// How wide a dig opened from a face is. It stands beside the faces, or,
// with no room past them, over the edge of the page under them.
const CARD_WIDTH = 300;
const CARD_GAP = 8;
// Between the faces of one thing, and between one thing and the next.
const FACE_GAP = 2;
const THING_GAP = 10;

// The faces of the digs on a thing, oldest first. A pin from before the
// server listed them has its lead's face.
export function facesOf(pin) {
  if (pin?.digs?.length) return pin.digs;
  return pin?.uuid ? [{ uuid: pin.uuid, owner: pin.lead?.owner ?? null, is_new: Boolean(pin.is_new) }] : [];
}

// With room beside the sheets, the viewer's margin holds every dig on the
// paper — the project's with one on, else the reader's own — as the face
// of whoever wrote it: the paper's own at the head of the first page, then
// the digs inside it level with their anchor, ink or clip. Each thing's
// faces live in its own page, placed in fractions of it, so a zoom — which
// resizes the pages directly, frame by frame — carries them with the page
// with nothing to measure first: they never flicker or lag. A gold dot on
// a face says there is news in that dig.
//
// Pressing a face opens that dig and the posts under it beside the face;
// pressing anywhere else closes it. When faces would meet, a thing's faces
// give way downward and never upward, so nothing sits above the place it
// is about.
export default function DigMargin({
  scrollerRef, lines, layoutKey, open, picked, onOpen, onClose, project, onChanged,
}) {
  // Each page by number, once laid; how far each thing's faces give way
  // below their place (px); and which side of its faces the open dig
  // stands.
  const [pages, setPages] = useState({});
  const [pushes, setPushes] = useState({});
  const [past, setPast] = useState(false);
  const [seen, setSeen] = useState(() => new Set());
  const elements = useRef(new Map());
  const card = useRef(null);
  // A dig just opened is kept in view while its card fills in.
  const revealUntil = useRef(0);
  const openLine = open ? lines.find((line) => line.key === open.key) : null;

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const found = {};
    const next = {};
    let floor = -Infinity;
    for (const line of lines) {
      const pageEl = found[line.page] ?? scroller.querySelector(`.pdf-page[data-page="${line.page}"]`);
      if (!pageEl) continue;
      found[line.page] = pageEl;
      const wanted = pageEl.offsetTop + line.down * pageEl.offsetHeight - MARGIN_WIDTH / 2;
      const top = Math.max(wanted, floor);
      if (top - wanted > 0.5) next[line.key] = Math.round(top - wanted);
      floor = top + (elements.current.get(line.key)?.offsetHeight ?? MARGIN_WIDTH) + THING_GAP;
    }
    setPages((was) => (Object.keys(found).length === Object.keys(was).length && Object.entries(found).every(([k, el]) => was[k] === el) ? was : found));
    setPushes((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    const pageEl = openLine && found[openLine.page];
    if (pageEl) setPast(pageEl.offsetLeft + pageEl.offsetWidth + MARGIN_GAP + MARGIN_WIDTH + CARD_GAP + CARD_WIDTH <= scroller.scrollWidth - CARD_GAP);
  }, [lines, scrollerRef, openLine]);

  // Placed once the pages are laid, again whenever they change size. The
  // faces already move with their page; this only settles which give way.
  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(() => {
      place();
      if (Date.now() < revealUntil.current) card.current?.scrollIntoView({ block: 'nearest' });
    });
    elements.current.forEach((el) => observer.observe(el));
    if (card.current) observer.observe(card.current);
    const scroller = scrollerRef.current;
    if (scroller) {
      observer.observe(scroller);
      scroller.querySelectorAll('.pdf-page').forEach((el) => observer.observe(el));
    }
    return () => observer.disconnect();
  }, [place, layoutKey, open?.key, open?.dig]);

  // Opened from the margin or a pin, a dig near the foot of the window
  // would grow its card out of sight; it is brought up as far as it needs.
  // A landing has already put its thing in the middle, so it is left be.
  useLayoutEffect(() => {
    revealUntil.current = open && !open.landed ? Date.now() + 800 : 0;
  }, [open?.key, open?.dig]);

  useDismiss(Boolean(open), (event) => Boolean(
    card.current?.contains(event.target)
    || event.target.closest?.('.thing-bar, .talk-pin, .thing-face, .dig-margin-face, .papol-confirm-overlay, [role="dialog"], [role="listbox"]'),
  ), onClose, { escape: false });

  // Which face the open dig is: the one asked for, else the reader's own,
  // else the one the thing opens on.
  const openDig = openLine && (open.dig && open.dig !== 'mine' ? open.dig : (openLine.pin.mine || (open.dig === 'mine' ? null : openLine.pin.uuid)));

  // Where a thing's faces stand in its page: level with its place, and
  // as far below as they gave way.
  const topOf = (line) => `calc(${(line.down * 100).toFixed(4)}% - ${MARGIN_WIDTH / 2}px + ${pushes[line.key] ?? 0}px)`;
  // Over the page, the open dig stands under its thing's faces, so the
  // thing, its bar and its faces all stay in sight above it.
  const openFaces = openLine ? Math.max(1, facesOf(openLine.pin).length) : 0;
  const openBelow = openFaces * MARGIN_WIDTH + (openFaces - 1) * FACE_GAP + CARD_GAP;

  return (
    <>
      {lines.map((line) => {
        const pageEl = pages[line.page];
        if (!pageEl) return null;
        const faces = facesOf(line.pin);
        // A dig still being written wears the reader's face.
        const shown = faces.length || !project.me ? faces : [{ uuid: null, owner: project.me, is_new: false }];
        return createPortal(
          <div
            key={line.key}
            ref={(el) => { if (el) elements.current.set(line.key, el); else elements.current.delete(line.key); }}
            className={`dig-margin-line${line.annotation && line.annotation === picked ? ' is-picked' : ''}`}
            data-key={line.key}
            data-subject={line.subject}
            aria-label="Digs"
            style={{ top: topOf(line), left: `calc(100% + ${MARGIN_GAP}px)`, width: MARGIN_WIDTH, gap: FACE_GAP }}
          >
            {shown.map((face) => {
              const isOpen = openLine?.key === line.key && (face.uuid ?? null) === (openDig ?? null);
              const fresh = face.is_new && !seen.has(face.uuid);
              // With a project on, each face is ringed in its member's colour.
              const worn = Boolean(project.uuid && face.owner);
              const who = face.owner?.uuid && face.owner.uuid === project.me?.uuid ? 'You' : face.owner?.display_name;
              return (
                <button
                  key={face.uuid ?? 'new'}
                  type="button"
                  className={`dig-margin-face${isOpen ? ' is-open' : ''}${worn ? ' worn' : ''}`}
                  style={worn ? { '--who': memberInk(face.owner) } : undefined}
                  aria-expanded={isOpen}
                  aria-label={`${who ?? 'A dig'}: ${line.label}${fresh ? ', new' : ''}`}
                  title={who}
                  data-dig={face.uuid ?? undefined}
                  onClick={() => {
                    if (face.uuid) setSeen((was) => new Set(was).add(face.uuid));
                    if (isOpen) onClose();
                    else onOpen(line, face.uuid);
                  }}
                >
                  {face.owner && <Avatar user={face.owner} className="mini-avatar" />}
                  {fresh && <span className="news-dot" role="img" aria-label="New" />}
                </button>
              );
            })}
          </div>,
          pageEl,
          line.key,
        );
      })}
      {openLine && pages[openLine.page] && createPortal(
        <div
          ref={card}
          className="dig-margin-card"
          data-key={openLine.key}
          style={{
            top: past ? topOf(openLine) : `calc(${topOf(openLine)} + ${openBelow}px)`,
            left: past ? `calc(100% + ${MARGIN_GAP + MARGIN_WIDTH + CARD_GAP}px)` : `calc(100% + ${MARGIN_GAP - CARD_GAP - CARD_WIDTH}px)`,
            width: CARD_WIDTH,
          }}
        >
          <TalkCard
            key={`${openLine.key}|${openDig ?? 'mine'}`}
            inline focus single phaseInHead tucked={!open.writing} projectUuid={project.uuid} subject={openLine.subject} label={openLine.label}
            dig={openDig ?? 'mine'} currentUser={project.me} askBeforeRemoving={false}
            onChanged={(discussion, total) => onChanged(openLine.subject, discussion, total)}
          />
        </div>,
        pages[openLine.page],
      )}
    </>
  );
}
