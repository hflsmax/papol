import React, { useRef, useState } from 'react';
import { setReaction, takeBackReaction } from '../api/reactions.js';
import EMOJIS from '../reactionEmojis.js';
import { useDismiss } from '../useDismiss.js';

// Reactions: the emoji set on something said. A thread, a reply in one, a
// dig and a post in one each take them (`kind` is 'thread', 'reply', 'dig'
// or 'post'), and whoever sees the thing sees them and sets their own.
//
// Two parts, drawn apart: the button that offers the emoji, on the line
// that says who and when, beside Edit and Delete; and the chips, under
// the words, one per emoji, with how many set it once more than one has, there only
// once somebody has. A chip pressed sets that emoji or takes the reader's own back.
// Both answer with the reactions as they now stand (`onChanged`).

// Who set an emoji, as a chip's title says it.
function names(reaction) {
  const who = reaction.who ?? [];
  const shown = who.slice(0, 8).join(', ');
  return who.length > 8 ? `${shown} and ${who.length - 8} more` : shown;
}

// What is drawn at once, before the server answers.
function toggled(reactions, emoji) {
  const at = reactions.find((r) => r.emoji === emoji);
  if (!at) return [...reactions, { emoji, count: 1, mine: true, who: ['You'] }];
  if (at.mine) return reactions.flatMap((r) => (r !== at ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1, mine: false }] : []));
  return reactions.map((r) => (r === at ? { ...r, count: r.count + 1, mine: true } : r));
}

// Setting an emoji, or taking one's own back: shown at once, then as the
// server says it stands; put back if it could not be done.
function useToggle(kind, uuid, reactions, onChanged) {
  const busy = useRef(false);
  return async (emoji) => {
    if (busy.current) return;
    busy.current = true;
    const mine = reactions.some((r) => r.emoji === emoji && r.mine);
    onChanged(toggled(reactions, emoji));
    try {
      onChanged((await (mine ? takeBackReaction(kind, uuid, emoji) : setReaction(kind, uuid, emoji))).reactions);
    } catch {
      onChanged(reactions);
    } finally {
      busy.current = false;
    }
  };
}

function ReactGlyph() {
  return (
    <svg className="action-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.4 12.6a8.5 8.5 0 1 1-9-9" />
      <path d="M8.6 14.2c.8 1.2 2 1.9 3.4 1.9s2.6-.7 3.4-1.9" />
      <circle cx="9.2" cy="10" r="1" className="action-glyph-fill" /><circle cx="14.8" cy="10" r="1" className="action-glyph-fill" />
      <path d="M18.5 2.5v5M16 5h5" />
    </svg>
  );
}

// The button that offers the emoji. Pressed, they open in a row under it;
// one picked is set (or, if the reader had set it, taken back).
export function ReactionAdd({ kind, uuid, reactions = [], onChanged, className = '' }) {
  const [open, setOpen] = useState(false);
  const self = useRef(null);
  const toggle = useToggle(kind, uuid, reactions, onChanged);
  useDismiss(open, self, () => setOpen(false));
  // Left and right walk the emoji.
  const walk = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll('button')];
    items[(items.indexOf(document.activeElement) + step + items.length) % items.length]?.focus();
  };
  return (
    <span ref={self} className={`reaction-add${open ? ' is-open' : ''} ${className}`}>
      <button
        type="button" className="reaction-add-button" aria-label="React" title="React" aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <ReactGlyph />
      </button>
      {open && (
        <span className="reaction-menu" role="group" aria-label="React with" onKeyDown={walk}>
          {EMOJIS.map((emoji, at) => {
            const mine = reactions.some((r) => r.emoji === emoji && r.mine);
            return (
              <button
                key={emoji} type="button" className={mine ? 'is-mine' : ''} aria-pressed={mine} aria-label={`React with ${emoji}`} autoFocus={at === 0}
                onClick={() => { setOpen(false); toggle(emoji); }}
              >
                {emoji}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

// The chips: each emoji set on the thing, with how many set it; the
// reader's own are marked. `withAdd` ends the row with the button that
// offers the emoji, where the thing has no line of its own to hold it.
// With nothing set and no button, nothing is drawn.
export function ReactionChips({ kind, uuid, reactions = [], onChanged, withAdd = false, className = '' }) {
  const toggle = useToggle(kind, uuid, reactions, onChanged);
  if (!reactions.length && !withAdd) return null;
  return (
    <p className={`reactions ${className}`} role="group" aria-label="Reactions">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji} type="button" className={`reaction${reaction.mine ? ' is-mine' : ''}`} aria-pressed={reaction.mine}
          aria-label={`${reaction.emoji} ${reaction.count}, set by ${names(reaction)}${reaction.mine ? '. Take yours back' : '. Set it too'}`} title={names(reaction)}
          onClick={() => toggle(reaction.emoji)}
        >
          <span className="reaction-emoji" aria-hidden="true">{reaction.emoji}</span>
          {reaction.count > 1 && <span className="reaction-count" aria-hidden="true">{reaction.count}</span>}
        </button>
      ))}
      {withAdd && <ReactionAdd kind={kind} uuid={uuid} reactions={reactions} onChanged={onChanged} />}
    </p>
  );
}

// The emoji set on a thing, to be read and not pressed: in a list's row.
export function ReactionTally({ reactions = [], className = '' }) {
  if (!reactions.length) return null;
  return (
    <span className={`reaction-tally ${className}`} aria-label={`Reactions: ${reactions.map((r) => `${r.emoji} ${r.count}`).join(', ')}`}>
      {reactions.map((r) => <span key={r.emoji} aria-hidden="true">{r.emoji}{r.count > 1 ? ` ${r.count}` : ''}</span>)}
    </span>
  );
}
