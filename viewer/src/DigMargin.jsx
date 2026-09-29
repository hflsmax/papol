import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Avatar from '../../shared/ui/Avatar.jsx';
import { TalkCard } from '../../shared/ui/Talk.jsx';
import { useDismiss } from '../../shared/useDismiss.js';
import { memberInk } from './project.js';

// How far the margin stands from the sheet, and how wide it is: one face.
// It is the same at every zoom and every size of page, so a zoom only
// moves it.
export const MARGIN_GAP = 20;
export const MARGIN_WIDTH = 32;
// How wide a dig opened from a face is. It stands beside the faces, over
// the edge of the page when there is no room past them.
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
// the digs inside it level with their anchor, ink or clip. It lives in the
// pages' own scroller, so it moves with them and nothing scrolls on its
// own. A gold dot on a face says there is news in that dig.
//
// Pressing a face opens that dig and the posts under it beside the face;
// pressing anywhere else closes it. When faces would meet, a thing's faces
// give way downward and never upward, so nothing sits above the place it
// is about.
export default function DigMargin({
  scrollerRef, lines, layoutKey, open, picked, onOpen, onClose, project, onChanged,
}) {
  const [places, setPlaces] = useState({});
  const [seen, setSeen] = useState(() => new Set());
  const elements = useRef(new Map());
  const card = useRef(null);
  // A dig just opened is kept in view while its card fills in.
  const revealUntil = useRef(0);
  const openLine = open ? lines.find((line) => line.key === open.key) : null;

  const place = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = {};
    let floor = -Infinity;
    for (const line of lines) {
      const pageEl = scroller.querySelector(`.pdf-page[data-page="${line.page}"]`);
      if (!pageEl) continue;
      const wanted = pageEl.offsetTop + Math.max(0, line.down * pageEl.offsetHeight - MARGIN_WIDTH / 2);
      const top = Math.max(wanted, floor);
      const left = pageEl.offsetLeft + pageEl.offsetWidth + MARGIN_GAP;
      next[line.key] = { top: Math.round(top), left: Math.round(left) };
      floor = top + (elements.current.get(line.key)?.offsetHeight ?? MARGIN_WIDTH) + THING_GAP;
    }
    // The open dig beside its faces: past them when the window has room
    // there, else over the page's edge.
    const at = openLine && next[openLine.key];
    if (at) {
      const past = at.left + MARGIN_WIDTH + CARD_GAP;
      const fits = past + CARD_WIDTH <= scroller.scrollWidth - CARD_GAP;
      next.card = { top: at.top, left: fits ? past : Math.max(CARD_GAP, at.left - CARD_GAP - CARD_WIDTH) };
    }
    setPlaces((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
  }, [lines, scrollerRef, openLine]);

  // Placed once the pages are laid, again whenever they change size: a
  // zoom, a window resized. The pages are watched too: pdf.js gives a page
  // its true height only once it has read it, which moves every page below
  // without resizing the scroller.
  useLayoutEffect(() => {
    place();
    const observer = new ResizeObserver(() => {
      place();
      if (Date.now() < revealUntil.current) {
        window.requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'nearest' }));
      }
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

  return (
    <div className="dig-margin" aria-label="Digs">
      {lines.map((line) => {
        const at = places[line.key];
        const faces = facesOf(line.pin);
        // A dig still being written wears the reader's face.
        const shown = faces.length || !project.me ? faces : [{ uuid: null, owner: project.me, is_new: false }];
        return (
          <div
            key={line.key}
            ref={(el) => { if (el) elements.current.set(line.key, el); else elements.current.delete(line.key); }}
            className={`dig-margin-line${line.annotation && line.annotation === picked ? ' is-picked' : ''}`}
            data-key={line.key}
            data-subject={line.subject}
            style={{ top: at?.top ?? 0, left: at?.left ?? 0, width: MARGIN_WIDTH, gap: FACE_GAP, visibility: at ? 'visible' : 'hidden' }}
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
          </div>
        );
      })}
      {openLine && (
        <div
          ref={card}
          className="dig-margin-card"
          data-key={openLine.key}
          style={{ top: places.card?.top ?? 0, left: places.card?.left ?? 0, width: CARD_WIDTH, visibility: places.card ? 'visible' : 'hidden' }}
        >
          <TalkCard
            key={`${openLine.key}|${openDig ?? 'mine'}`}
            inline focus single phaseInHead projectUuid={project.uuid} subject={openLine.subject} label={openLine.label}
            dig={openDig ?? 'mine'} currentUser={project.me}
            onChanged={(discussion, total) => onChanged(openLine.subject, discussion, total)}
          />
        </div>
      )}
    </div>
  );
}
