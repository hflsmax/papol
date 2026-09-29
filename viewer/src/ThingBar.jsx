import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '../../shared/ui/Avatar.jsx';
import ItemActions from '../../shared/ui/ItemActions.jsx';
import { TalkCard, TalkPin } from '../../shared/ui/Talk.jsx';
import { subjectKey } from '../../shared/api/projects.js';
import { memberInk } from './project.js';

// Any annotation the reader can see can hold a dig — the project's with a
// project on, else the reader's own. Never one still being saved, which
// has no name yet. `digs` is what the viewer knows of them (App's
// pageProject): whose, the pins, and where a press should open.
const diggable = (digs, annotation) => Boolean(digs) && typeof annotation.uuid === 'string' && !annotation.uuid.startsWith('wet-');

export function DigPin({ digs, annotation, label, startOpen = false }) {
  if (!diggable(digs, annotation)) return null;
  return (
    <TalkPin
      projectUuid={digs.uuid}
      subject={{ annotation: annotation.uuid }}
      label={label}
      summary={digs.digs[annotation.uuid]}
      currentUser={digs.me}
      onChanged={digs.onDigChanged}
      size="sm"
      openOn={digs.landing?.annotation === annotation.uuid ? digs.landing.dig : null}
      startOpen={startOpen}
      onPress={digs.inMargin?.(annotation.uuid)}
    />
  );
}

// Another member's thing is theirs, so it wears their face and nothing
// else: pressing the face opens the digs on it, where the spade would for
// the reader's own. A gold dot on the face says someone wrote since the
// reader looked.
function FaceDig({ digs, annotation, label, startOpen = false }) {
  const who = annotation.user;
  const uuid = annotation.uuid;
  const summary = digs?.digs[uuid];
  const openOn = digs?.landing?.annotation === uuid ? digs.landing.dig : null;
  const [open, setOpen] = useState(Boolean(openOn) || startOpen);
  const [asked, setAsked] = useState(openOn);
  const [seen, setSeen] = useState(false);
  const face = useRef(null);
  const key = subjectKey({ annotation: uuid });
  const inMargin = digs?.inMargin?.(uuid);
  useEffect(() => { setSeen(false); }, [summary?.post_count, summary?.uuid]);
  const changed = useCallback((discussion, total) => {
    const next = discussion
      ? { uuid: discussion.uuid, dig_count: total?.digs ?? 1, post_count: total?.posts ?? discussion.posts.length, is_new: false, digs: total?.list }
      : { uuid: null, post_count: 0, is_new: false };
    setSeen(true);
    digs?.onDigChanged?.(key, next, discussion);
  }, [key, digs]);
  const fresh = !seen && Boolean(summary?.is_new);
  return (
    <>
      <button
        ref={face}
        type="button"
        className={`thing-face${open ? ' is-open' : ''}`}
        style={{ '--who': memberInk(who) }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${who.display_name}: the digs on ${label}${fresh ? ', new' : ''}`}
        title={who.display_name}
        onClick={() => { setSeen(true); if (inMargin) inMargin(); else setOpen(!open); }}
      >
        <Avatar user={who} className="mini-avatar" />
        {fresh && <span className="news-dot" role="img" aria-label="New" />}
      </button>
      {open && !inMargin && createPortal(
        <TalkCard
          anchor={face}
          projectUuid={digs.uuid}
          subject={key}
          label={label}
          dig={asked}
          currentUser={digs.me}
          onChanged={changed}
          onClose={() => { setOpen(false); setAsked(null); face.current?.focus({ preventScroll: true }); }}
        />,
        document.body,
      )}
    </>
  );
}

// The bar over an anchor, ink or clip picked out: one bar the same for all
// three. The reader's own: the dig first, always the spade, then what else
// can be done to it. Another member's: only their face, which opens the
// digs on it.
export default function ThingBar({ digs, annotation, label, actions = [], actionsLabel, startOpen = false, className = '', style }) {
  const can = diggable(digs, annotation);
  const theirs = annotation.theirs && annotation.user;
  const dig = can && !theirs && <DigPin digs={digs} annotation={annotation} label={label} startOpen={startOpen} />;
  if (!dig && !(theirs && can) && !actions.length) return null;
  const stop = (event) => event.stopPropagation();
  return (
    <span
      className={`thing-bar${theirs ? ' is-theirs' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {theirs && can && <FaceDig digs={digs} annotation={annotation} label={label} startOpen={startOpen} />}
      {dig && <span className="thing-dig">{dig}</span>}
      {actions.length > 0 && <ItemActions label={actionsLabel} placement="above-end" actions={actions} />}
    </span>
  );
}
