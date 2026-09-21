import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { GlyphFor } from './glyphs';

/**
 * An anchor's card: what it is called and what is written on it, opened on
 * the page beside its pin.
 *
 * This is the whole of editing an anchor. There used to be a rail down the
 * side of the window listing every one, and an anchor was edited there, a
 * window's width from the place it was about. The list is the Navigator
 * now — every anchor and note already stands on it, at its place — so what
 * was left for the rail was the editing, and editing belongs where the
 * anchor is: the card hangs off the pin, the paper it is about stays under
 * the reader's eyes, and nothing has to be opened first or closed after.
 *
 * There is no Save. A field is kept when it is left, and the card is left
 * by clicking anywhere else. Escape takes back what was typed in the field
 * it is pressed in; undo takes back anything already kept.
 */

// The place of the card is the place of the pin, so it is set in the page's
// own percentages and survives any zoom. It hangs below the pin and turns
// upwards near the foot of the page, where hanging would put it over the
// gap and under the next sheet.
const FLIP_BELOW = 0.38;

export default function NoteCard({
  note,
  readOnly = false,
  focusField = null,
  onRename,
  onWrite,
  onDelete,
  onClose,
}) {
  const [name, setName] = useState(note.name || '');
  const [text, setText] = useState(note.content || '');
  const nameRef = useRef(null);
  const textRef = useRef(null);
  // What is typed and not yet kept, for the moment the card goes away with
  // a field still in hand — a click on another pin, a jump along the bar
  // (which goes to a place and puts away whatever card was open).
  const live = useRef(null);
  live.current = { name, text, note, onRename, onWrite };
  const dropped = useRef(false);
  // What has already been sent. Leaving a field and leaving the card are
  // often the same click, and the note itself only catches up a moment
  // later — so it is this, not the note, that says a field is already kept.
  const kept = useRef({ name: note.name || '', text: note.content || '' });

  const keepName = () => {
    const next = live.current.name.trim();
    if (next === kept.current.name) return;
    kept.current.name = next;
    live.current.onRename(live.current.note.uuid, next);
  };
  const keepText = () => {
    const next = live.current.text.trim();
    if (next === kept.current.text) return;
    kept.current.text = next;
    live.current.onWrite(live.current.note.uuid, next);
  };

  // Changed from elsewhere while the card is open — an undo, mostly.
  useEffect(() => {
    if ((note.name || '') === kept.current.name) return;
    kept.current.name = note.name || '';
    setName(note.name || '');
  }, [note.name]);
  useEffect(() => {
    if ((note.content || '') === kept.current.text) return;
    kept.current.text = note.content || '';
    setText(note.content || '');
  }, [note.content]);

  useEffect(() => () => {
    if (readOnly || dropped.current) return;
    keepName();
    keepText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (readOnly || !focusField) return;
    const field = focusField === 'name' ? nameRef.current : textRef.current;
    // Without scrolling: the card was placed where the reader is already
    // looking, and the browser's idea of bringing a field into view is to
    // move the paper.
    const take = () => {
      if (!field || document.activeElement === field) return;
      field.focus({ preventScroll: true });
      if (focusField === 'name') field.select();
    };
    take();
    // An anchor is dropped on the press, not the release, so this card
    // opens in the middle of a click — and the rest of that click then
    // takes the keyboard away again, as any press on the bare page does.
    // The field is handed it back once the click has finished.
    const released = () => setTimeout(take, 0);
    window.addEventListener('pointerup', released, { capture: true, once: true });
    const settle = setTimeout(() => window.removeEventListener('pointerup', released, true), 800);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('pointerup', released, true);
    };
  }, [focusField, readOnly]);

  // As tall as what is written, up to a point.
  useLayoutEffect(() => {
    const field = textRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(220, field.scrollHeight + 2)}px`;
  }, [text]);

  const { x, y } = note.anchor;
  const above = y < FLIP_BELOW;
  const style = {
    '--pin-x': `${x * 100}%`,
    ...(above ? { bottom: `calc(${y * 100}% + 20px)` } : { top: `calc(${(1 - y) * 100}% + 20px)` }),
  };

  // The page underneath is listening for ink, anchors and clips. Nothing
  // done to the card is meant for it.
  const own = (event) => event.stopPropagation();

  const place = `page ${note.page}`;

  return (
    <div
      className={`note-pop${above ? ' above' : ''}`}
      style={style}
      role="dialog"
      aria-label={note.name || `Anchor on ${place}`}
      data-note={note.uuid}
      onPointerDown={own}
      onPointerUp={own}
      onMouseDown={own}
      onClick={own}
      onDoubleClick={own}
      onContextMenu={own}
      onWheel={own}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="note-pop-head">
        <span className="note-pop-glyph" aria-hidden="true">
          <GlyphFor note={{ content: text.trim() }} />
        </span>
        {readOnly ? (
          <span className="note-pop-name">{note.name || place}</span>
        ) : (
          <input
            ref={nameRef}
            className="note-pop-name"
            value={name}
            placeholder="Write a title…"
            aria-label="Name"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onBlur={keepName}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                textRef.current?.focus({ preventScroll: true });
              }
              if (event.key === 'Escape') {
                setName(kept.current.name);
                live.current.name = kept.current.name;
                onClose();
              }
            }}
          />
        )}
        {!readOnly && (
          <button
            type="button"
            className="note-pop-delete"
            title="Delete this anchor (Delete)"
            aria-label="Delete this anchor"
            onClick={() => {
              dropped.current = true;
              onDelete(note.uuid);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4" />
            </svg>
          </button>
        )}
      </div>
      {readOnly ? (
        note.content && <p className="note-pop-text">{note.content}</p>
      ) : (
        <textarea
          ref={textRef}
          className="note-pop-text"
          rows={2}
          value={text}
          placeholder="Write a note…"
          aria-label="Note"
          onChange={(event) => setText(event.target.value)}
          onBlur={keepText}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setText(kept.current.text);
              live.current.text = kept.current.text;
              onClose();
            }
          }}
        />
      )}
    </div>
  );
}
