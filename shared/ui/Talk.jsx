import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deletePost, editDig, editPost, findDigs, getDig, moveDig, postInDig, removeDig, startDig, subjectKey,
} from '../api/projects.js';
import appLimits from '../appLimits.js';
import { confirmAction } from '../confirmAction';
import ItemActions from './ItemActions.jsx';
import ActionGlyph from './ActionGlyph.jsx';
import Face from './Face.jsx';
import Markdown from './Markdown.jsx';
import MarkdownField from './MarkdownField.jsx';
import PaperTitle from './PaperTitle.jsx';
import { plainTitle } from '../texTitle.js';
import { useDismiss } from '../useDismiss.js';

// A dig: one member's writing about one thing the project holds, which
// anyone in the project can post in. A thing holds one dig per member who
// dug it. Digging and posting are two acts: a dig is written as its own
// text, and a post is added to a dig that is there. The pin opens the
// card, drawn like a card on a board, right where you are, on your own dig
// if you have one. The same pin and card serve a paper, a card on a board
// and an annotation; never the project, a board as a whole, or another
// dig. (In code the pin and card keep their first name, Talk.)
// With no project (`projectUuid` null) the dig is personal: the reader's
// own alone, which nobody else sees, so it has no posts and no phase.

const POST_LIMIT = appLimits.text.dig_post;

// Where a dig stands. Anyone in the project moves it; nothing else does.
export const PHASES = [
  { key: 'digging', word: 'Digging' },
  { key: 'stashed', word: 'Stashed' },
  { key: 'gold', word: 'Gold' },
  { key: 'buried', word: 'Buried' },
];
export const phaseWord = (phase) => PHASES.find((p) => p.key === phase)?.word ?? 'Digging';

// One glyph per phase, drawn like the spade: the spade in the ground while
// digging, a box for what is stashed, stacked ingots for gold, a headstone
// for what is buried. Each has its own colour: green while it grows, blue
// when put away, gold, and grey underground. Gold's glint is drawn solid.
const GLINT = 'M19.5 1.8c.3 1.5.9 2.1 2.3 2.4-1.4.3-2 .9-2.3 2.4-.3-1.5-.9-2.1-2.3-2.4 1.4-.3 2-.9 2.3-2.4Z';
// Gold's three ingots, tinted with their colour.
const INGOTS = 'M1.8 21h9.6l-1.7-6H3.5ZM12.6 21h9.6l-1.7-6h-6.2ZM7.2 14h9.6l-1.7-6H8.9Z';
const PHASE_PATHS = {
  digging: ['M3 16.5h4.6M16.4 16.5H21', 'M12 4.2v4.3M9.6 2.2h4.8v2H9.6Z', 'M7.5 8.5h9v4c0 2.6-2 4.8-4.5 6-2.5-1.2-4.5-3.4-4.5-6Z'],
  stashed: ['M3.5 6h17v4h-17Z', 'M5 10h14v8.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5Z', 'M10 13.5h4'],
  gold: [INGOTS, GLINT],
  buried: ['M3.5 20h17', 'M7.5 20V10a4.5 4.5 0 0 1 9 0v10', 'M10.5 12.5h3'],
};
// Each drawing moved to sit on the middle of its box, so every glyph lines
// up with the word beside it.
const PHASE_NUDGE = { digging: 1.6, stashed: -1, gold: 0.5, buried: -0.8 };
export function PhaseGlyph({ phase }) {
  return (
    <svg className={`phase-glyph is-${PHASE_PATHS[phase] ? phase : 'digging'}`} viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`translate(0 ${PHASE_NUDGE[phase] ?? 0})`}>
        {(PHASE_PATHS[phase] ?? PHASE_PATHS.digging).map((d) => <path key={d} d={d} className={d === GLINT ? 'is-solid' : d === INGOTS ? 'is-tinted' : undefined} />)}
      </g>
    </svg>
  );
}
// Digging first, then stashed, gold and buried: how lists of digs run.
export const phaseRank = (phase) => Math.max(0, PHASES.findIndex((p) => p.key === phase));

// A dig's phase: its glyph and word. Pressed, the four phases drop down
// under it, one per line; picking one moves the dig.
export function PhasePicker({ dig, onMoved, className = '' }) {
  const current = dig.phase ?? 'digging';
  const [shown, setShown] = useState(current);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = useRef(null);
  useEffect(() => setShown(current), [current]);
  useDismiss(open, pick, () => setOpen(false));
  useEffect(() => {
    if (open) pick.current?.querySelector('[aria-selected="true"]')?.focus();
  }, [open]);
  const move = async (phase) => {
    setOpen(false);
    pick.current?.querySelector('.dig-phase-word')?.focus();
    if (phase === shown || busy) return;
    setShown(phase);
    setBusy(true);
    try { onMoved?.(await moveDig(dig.uuid, phase)); } catch { setShown(current); } finally { setBusy(false); }
  };
  // Up and down walk the phases; Enter or Space moves the dig.
  const walk = (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...e.currentTarget.querySelectorAll('[role="option"]')];
    const at = items.indexOf(document.activeElement);
    items[(at + step + items.length) % items.length]?.focus();
  };
  return (
    <span ref={pick} className={`dig-phase-pick ${className}`}>
      <button
        type="button" className={`dig-phase-word is-${shown}${busy ? ' is-busy' : ''}`} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Phase: ${phaseWord(shown)}`} onClick={() => setOpen((was) => !was)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
      >
        <PhaseGlyph phase={shown} />{phaseWord(shown)}
      </button>
      {open && (
        <div className="dig-phase-menu" role="listbox" aria-label="Phase" onKeyDown={walk}>
          {PHASES.map((p) => (
            <button
              key={p.key} type="button" role="option" aria-selected={shown === p.key}
              className={shown === p.key ? 'is-on' : ''} onClick={() => move(p.key)}
            >
              <PhaseGlyph phase={p.key} />{p.word}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function kindOf(subject) {
  return subjectKey(subject).split(':')[0];
}

// The dig mark: a spade, tipped as if in use. Its blade takes the accent
// wash once there is a dig to open.
export function TalkGlyph({ outline = false }) {
  return (
    <svg className={`talk-glyph${outline ? ' is-outline' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <g transform="rotate(32 12 12)"><path className="talk-glyph-blade" d="M6.8 10.5h10.4v4.6c0 3-2.4 5.6-5.2 7.1-2.8-1.5-5.2-4.1-5.2-7.1Z" /><path d="M12 10.5V4.2M9.6 2.2h4.8v2H9.6Z" /></g>
    </svg>
  );
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// One clock everywhere: a date for a fact, the time as well on a post, so
// nothing on a page counts minutes beside a neighbour that names a day.
export function when(iso, { time = false } = {}) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }), ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

// The pin: the one mark for a dig, and the one way to attach a dig to
// anything. Every thing that can hold a dig wears one, at the right end of
// its header line. Empty, it is a faint outline with a plus that shows when
// you reach for its thing; with a dig, it is filled and carries the count,
// and a gold dot when others have written since you looked. Pressing it
// opens the dig card beside it. Anything else that opens a dig (a row in a
// list, the latest words on a card) opens the same card, with no mark of
// its own.
// A pin can arrive open on one of its digs (`openOn`): a link to that dig
// lands on its thing with the dig already showing. Where the dig is shown
// somewhere else already (the viewer's margin), `onPress` takes the press
// instead of opening a card of the pin's own.
export function TalkPin({
  projectUuid, subject, label, summary, currentUser, onChanged, size = 'md', className = '', title, openOn = null, onPress = null, startOpen = false,
}) {
  const [open, setOpen] = useState(Boolean(openOn) || startOpen);
  const [asked, setAsked] = useState(openOn);
  const [local, setLocal] = useState(null);
  const pin = useRef(null);
  const host = useTalkHost(pin, open);
  const key = subjectKey(subject);
  const state = local ?? summary ?? null;
  // Every dig on the thing and every post in them.
  const count = (state?.dig_count ?? (state?.uuid ? 1 : 0)) + (state?.post_count ?? 0);
  const dug = count > 0;
  const fresh = !local && Boolean(summary?.is_new);

  useEffect(() => { setLocal(null); }, [summary?.post_count, summary?.uuid]);

  const changed = useCallback((discussion, total) => {
    const next = discussion
      ? { uuid: discussion.uuid, dig_count: total?.digs ?? 1, post_count: total?.posts ?? discussion.posts.length, is_new: false, voices: uniqueVoices([{ user: discussion.owner }, ...discussion.posts]), digs: total?.list }
      : { uuid: null, post_count: 0, is_new: false, voices: [] };
    setLocal(next);
    onChanged?.(key, next, discussion);
  }, [key, onChanged]);

  const words = dug
    ? `${plural(count, 'piece', 'pieces')} of writing about ${plainTitle(label)}${fresh ? ', new' : ''}. Open the dig`
    : `Dig ${plainTitle(label)}`;
  return (
    <span className={`talk-pin-wrap talk-${size} ${className}`}>
      <button
        ref={pin}
        type="button"
        className={`talk-pin${dug ? '' : ' is-empty'}${fresh ? ' is-new' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={words}
        title={title ?? 'Dig'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (onPress) onPress(); else setOpen(!open); }}
      >
        <TalkGlyph outline={!dug} />
        {count > 0 && <span className="talk-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {host && createPortal(
        <TalkCard
          anchor={pin}
          projectUuid={projectUuid}
          subject={key}
          label={label}
          dig={asked}
          currentUser={currentUser}
          onChanged={changed}
          onClose={() => { setOpen(false); setAsked(null); pin.current?.focus({ preventScroll: true }); }}
        />,
        host,
      )}
    </span>
  );
}

// Anything can open a talk card, not only a pin: a row in a list of what
// is being said opens the same card beside itself.
export function TalkOpener({ projectUuid, subject, label, dig, currentUser, onChanged, onClosed, className = '', title, children }) {
  const [open, setOpen] = useState(false);
  const self = useRef(null);
  const key = subjectKey(subject);
  const changed = useCallback((discussion) => { onChanged?.(key, null, discussion); }, [key, onChanged]);
  return (
    <>
      <button
        ref={self} type="button" className={className} title={title} aria-expanded={open} aria-haspopup="dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        {children}
      </button>
      {open && createPortal(
        <TalkCard
          anchor={self} projectUuid={projectUuid} subject={key} label={label} dig={dig} currentUser={currentUser}
          onChanged={changed} onClose={() => { setOpen(false); self.current?.focus({ preventScroll: true }); onClosed?.(); }}
        />,
        document.body,
      )}
    </>
  );
}

function uniqueVoices(posts) {
  const seen = new Map();
  posts.forEach((post) => { if (!seen.has(post.user.uuid)) seen.set(post.user.uuid, post.user); });
  return [...seen.values()];
}

// The card is drawn in a portal, but React still passes its events up to
// whatever holds the pin: a paper row that selects itself on focus, a board
// card that drags on pointerdown. They stop at the card.
const stop = (e) => e.stopPropagation();
const CONTAINED = {
  onPointerDown: stop, onMouseDown: stop, onClick: stop, onDoubleClick: stop, onFocus: stop, onBlur: stop,
  onKeyDown: stop, onKeyUp: stop, onWheel: stop, onTouchStart: stop,
};

const CARD_WIDTH = 360;
const GAP = 10;

// Where the card goes: beside the pin, below it when there is room and
// above it when not, and never off the screen. On a phone it is a sheet.
function place(anchor, card) {
  const pin = anchor.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - 16);
  if (window.innerWidth <= 560) return { sheet: true, width: window.innerWidth };
  const height = card?.offsetHeight ?? 320;
  // Opened from a list at the side, the card sits beside the list, not over it.
  if (anchor.closest('.project-talk') && pin.left - width - GAP >= 8) {
    const left = pin.left - width - GAP;
    const top = Math.max(8, Math.min(pin.top, window.innerHeight - height - 8));
    return { sheet: false, width, left, top, originX: width, originY: 0 };
  }
  const left = Math.max(8, Math.min(pin.left + pin.width / 2 - 28, window.innerWidth - width - 8));
  const below = pin.bottom + GAP;
  const above = pin.top - GAP - height;
  const top = below + height <= window.innerHeight - 8 || above < 8 ? Math.max(8, Math.min(below, window.innerHeight - height - 8)) : above;
  return {
    sheet: false, width, left, top,
    originX: pin.left + pin.width / 2 - left, originY: top >= pin.bottom ? 0 : height,
  };
}

// Where a card opened from an element goes: into the scrolling page that
// holds it, when that page asks for its cards (data-talk-host), so the card
// scrolls with what it is about in the same frame; else over everything.
// On a phone the card is a sheet over everything.
function talkHost(element) {
  if (window.innerWidth <= 560) return document.body;
  return element?.closest?.('[data-talk-host]') ?? document.body;
}
// The host for a card opened from `ref`, known once that element is laid
// (a card can open on the first render, before it is).
export function useTalkHost(ref, open) {
  const [host, setHost] = useState(null);
  useLayoutEffect(() => { if (open) setHost(talkHost(ref.current)); }, [open, ref]);
  return open ? host : null;
}

// Digs seen in this tab, by where they were opened, so opening one again
// shows it at once while it is fetched again.
const seenTalk = new Map();
const talkKey = (projectUuid, topic) => `${projectUuid}|${topic.subject}|${topic.dig ?? ''}`;

// Inline, the card is part of a page (a paper's brief) rather than a
// popover: it is not placed, closes on nothing, and opens at its first post,
// the one that says what the dig is about.
// With phaseInHead the phase word sits on the dig's own line, after its date,
// and dates name only the day (the time shows on hover).
// With tucked a new dig's box stays folded to one word until it is pressed,
// and the box that posts is one thin line that opens downward when pressed.
// What a change leaves on the thing: how many digs and posts it holds, and
// each dig, oldest first, whose it is.
function tally(next, all) {
  const others = all.filter((d) => d.uuid !== next.uuid);
  const list = [...others, { uuid: next.uuid, owner: next.owner, created_at: next.created_at, is_mine: next.is_mine }]
    .map((d) => ({ uuid: d.uuid, owner: d.owner, created_at: d.created_at, is_new: false }))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  return { digs: others.length + 1, posts: others.reduce((n, d) => n + Number(d.post_count ?? 0), next.posts.length), list };
}

export function TalkCard({
  anchor, projectUuid, subject, label, dig = null, currentUser, onChanged, onClose, inline = false, askBeforeRemoving = true, focus = false, unread = 0, seekUnread = () => true,
  single = false, phaseInHead = false, tucked = false,
}) {
  const [topic, setTopic] = useState({ subject, label, dig });
  const [digs, setDigs] = useState(() => seenTalk.get(talkKey(projectUuid, topic))?.digs ?? []);
  const [discussion, setDiscussion] = useState(() => seenTalk.get(talkKey(projectUuid, topic))?.discussion);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [unfolded, setUnfolded] = useState(false);
  const folded = tucked && !unfolded && !body;
  useEffect(() => { if (unfolded) box.current?.focus(); }, [unfolded]);
  // An emptied box folds away again when it is left.
  const leave = () => { if (!body.trim()) setUnfolded(false); };
  const [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState(null);
  const [editing, setEditing] = useState(null);
  const card = useRef(null);
  const list = useRef(null);
  const box = useRef(null);
  const onHome = topic.subject === subject;
  const personal = !projectUuid;

  useEffect(() => {
    let active = true;
    const last = seenTalk.get(talkKey(projectUuid, topic));
    setDigs(last?.digs ?? []);
    setDiscussion(last?.discussion);
    // The dig asked for, else the reader's own, else the latest; a thing
    // nobody has dug opens on the reader's own, to be written. A dig asked
    // for by name is read alongside the list.
    const named = topic.dig && topic.dig !== 'mine' ? topic.dig : null;
    Promise.all([findDigs(projectUuid, topic.subject), named ? getDig(named) : null])
      .then(([found, fetched]) => {
        if (active) setDigs(found.digs ?? []);
        if (named) return fetched;
        const open = topic.dig === 'mine' ? found.mine : found.mine ?? found.digs?.[0]?.uuid ?? null;
        return open ? getDig(open) : null;
      })
      .then((next) => { if (active) setDiscussion(next); })
      .catch((err) => { if (active) { setError(err.message); setDiscussion(null); } });
    return () => { active = false; };
  }, [projectUuid, topic.subject, topic.dig]);

  useEffect(() => {
    if (discussion !== undefined) seenTalk.set(talkKey(projectUuid, topic), { digs, discussion });
  }, [discussion, digs]);

  const reposition = useCallback(() => {
    if (inline || !anchor.current) return;
    const next = place(anchor.current, card.current);
    // Hosted in a scrolling page, the card stands in the page's own terms.
    const host = card.current?.parentElement;
    if (!next.sheet && host && host !== document.body && host.matches('[data-talk-host]')) {
      const box = host.getBoundingClientRect();
      next.left += host.scrollLeft - box.left;
      next.top += host.scrollTop - box.top;
      // Never past the page's own edge, which stops short of its scroll bar.
      next.left = Math.min(next.left, host.scrollLeft + host.clientWidth - next.width - 8);
      next.hosted = true;
    }
    setSpot(next);
  }, [anchor, inline]);
  useLayoutEffect(() => { reposition(); }, [reposition, discussion]);
  useEffect(() => {
    if (inline) return undefined;
    // A hosted card scrolls with its page by itself; only a card over
    // everything follows its anchor on a scroll.
    const follow = () => { if (!card.current?.parentElement?.matches?.('[data-talk-host]')) reposition(); };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', follow, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', follow, true); };
  }, [reposition, inline]);

  useEffect(() => {
    if (inline) return undefined;
    const away = (e) => {
      if (card.current?.contains(e.target) || anchor.current?.contains(e.target)) return;
      // Answering "Delete this?" is not leaving the card.
      if (e.target.closest?.('.papol-confirm-overlay')) return;
      onClose();
    };
    // Escape while rewording drops the edit, not the card.
    const escape = (e) => {
      if (e.key !== 'Escape' || e.target.closest?.('.talk-post-edit')) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose, inline]);

  useEffect(() => {
    if (discussion === undefined) return;
    const field = box.current;
    // A tucked box that posts stays one thin line until it is pressed.
    if ((!inline || body || focus) && !(tucked && discussion)) field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
    if (list.current && !inline) list.current.scrollTop = list.current.scrollHeight;
    // In a page, the reader lands on the first post they have not read,
    // unless the page says to stay where it opened.
    if (inline && discussion && unread > 0 && seekUnread()) {
      const fresh = list.current?.querySelector('.talk-post.is-new');
      if (fresh && fresh.getBoundingClientRect().top > window.innerHeight) fresh.scrollIntoView({ block: 'center' });
    }
  }, [discussion]);
  const toEnd = () => requestAnimationFrame(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; });

  const send = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = !discussion ? await startDig(projectUuid, topic.subject, text) : await postInDig(discussion.uuid, text);
      setDiscussion(next);
      setDigs((all) => (all.some((d) => d.uuid === next.uuid) ? all : [...all, { uuid: next.uuid, owner: next.owner, is_mine: next.is_mine }]));
      setBody('');
      setUnfolded(false);
      toEnd();
      // The pin counts every dig on its thing and every post, this dig as
      // it now stands.
      if (onHome) onChanged?.(next, tally(next, digs));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // The pin counts every dig on its thing and every post, this dig as it
  // now stands.
  const report = (next, all = digs) => {
    if (!onHome) return;
    onChanged?.(next, next ? tally(next, all) : undefined);
  };

  // Its writer rewords a post, or its owner the dig's own words.
  const save = async () => {
    const text = editing?.body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = editing.uuid === discussion.uuid ? await editDig(editing.uuid, text) : await editPost(editing.uuid, text);
      setDiscussion(next);
      setEditing(null);
      report(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Taking back a post leaves the dig; removing the dig takes its posts,
  // and the card moves on to the next dig on the thing, if any.
  const remove = async (post) => {
    const whole = post.uuid === discussion.uuid;
    // The viewer's margin removes a dig at once (askBeforeRemoving off).
    if ((!whole || askBeforeRemoving) && !(await confirmAction(whole ? (personal ? 'Remove this dig?' : 'Remove this dig and its posts?') : 'Delete this post?', { confirmLabel: 'Delete', destructive: true }))) return;
    setError(null);
    try {
      if (!whole) {
        const next = await deletePost(post.uuid);
        setDiscussion(next);
        report(next);
        return;
      }
      await removeDig(post.uuid);
      const rest = digs.filter((d) => d.uuid !== post.uuid);
      setDigs(rest);
      const after = rest.length ? await getDig(rest[rest.length - 1].uuid) : null;
      report(after, rest);
      setTopic({ ...topic, dig: after ? after.uuid : 'mine' });
    } catch (err) {
      setError(err.message);
    }
  };

  // The dig's own words come first, then every post in it.
  const posts = discussion
    ? [{ uuid: discussion.uuid, user: discussion.owner, body: discussion.text, created_at: discussion.created_at, edited_at: discussion.edited_at, is_mine: discussion.is_mine }, ...discussion.posts]
    : [];
  const style = spot && !spot.sheet
    ? { left: spot.left, top: spot.top, width: spot.width, transformOrigin: `${spot.originX}px ${spot.originY}px` }
    : undefined;

  // Whose dig this is, when there is a choice, it is not yours, or yours is
  // still to be written: starting a dig always happens on your own chip. A
  // card opened on one dig alone (single) shows only that one.
  const owners = !single && !personal && discussion !== undefined && (digs.length > 1 || !digs.some((d) => d.is_mine));
  // A dig is started in the body, where its words will stand; the box at
  // the foot only ever adds a post to the dig that is open.
  const writing = discussion === null && currentUser;
  const whose = discussion && (discussion.is_mine ? 'your' : `${discussion.owner?.display_name?.split(' ')[0]}'s`);
  const picker = discussion && !personal && (
    <PhasePicker
      dig={discussion}
      onMoved={(next) => {
        setDiscussion(next);
        if (onHome) onChanged?.(next, tally(next, digs));
      }}
    />
  );
  // Inline, the phase sits at the end of the owners' row rather than on a
  // line of its own.
  const pickerWithOwners = inline && owners;
  return (
    <section
      ref={card}
      className={`talk-card${inline ? ' is-inline' : ''}${spot?.sheet ? ' is-sheet' : ''}${spot?.hosted ? ' is-hosted' : ''}${spot ? ' is-placed' : ''}`}
      style={style}
      role={inline ? 'region' : 'dialog'}
      aria-label={`Digs on ${plainTitle(topic.label)}`}
      {...CONTAINED}
    >
      {(!inline || (picker && !pickerWithOwners && !phaseInHead)) && (
      <header className="talk-card-header">
        {!pickerWithOwners && picker}
        {!inline && <button type="button" className="talk-card-close" aria-label="Close" onClick={onClose}>×</button>}
      </header>
      )}
      {(!inline || !onHome) && <p className="talk-card-subject"><PaperTitle title={topic.label} /></p>}
      {owners && (
        <nav className="talk-card-owners" aria-label="Whose dig">
          {digs.map((d) => (
            <button
              key={d.uuid} type="button" aria-pressed={discussion?.uuid === d.uuid}
              className={discussion?.uuid === d.uuid ? 'is-on' : ''}
              onClick={() => setTopic({ ...topic, dig: d.uuid })}
            >
              {d.owner && <Face user={d.owner} />}{d.is_mine ? 'You' : d.owner?.display_name}
            </button>
          ))}
          {/* Yours, not yet written: the same chip as the others', marked
              only by its dashed edge. */}
          {!digs.some((d) => d.is_mine) && currentUser && (
            <button
              type="button" className={`talk-card-yours${!discussion ? ' is-on' : ''}`} aria-pressed={!discussion}
              onClick={() => setTopic({ ...topic, dig: 'mine' })}
            >
              <Face user={currentUser} />You
            </button>
          )}
          {pickerWithOwners && !phaseInHead && picker}
        </nav>
      )}

      <div className="talk-card-body" ref={list}>
        {discussion === undefined ? null : writing && folded ? (
          <button type="button" className="talk-unfold" onClick={() => setUnfolded(true)}><Face user={currentUser} />Dig</button>
        ) : writing ? (
          <form className="talk-dig-new" onSubmit={send}>
            <Face user={currentUser} />
            <MarkdownField
              ref={box} rows={1} value={body} maxLength={POST_LIMIT} placeholder="Your dig" aria-label="Your dig"
              onChange={(e) => setBody(e.target.value)} onBlur={leave}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
            />
            <span className="talk-dig-new-foot">
              <button type="submit" className="primary" disabled={busy || !body.trim()} title="Dig (⌘↩)">Dig</button>
            </span>
          </form>
        ) : posts.length === 0 ? null : (
          <>
            <ol className="talk-posts">
              {posts.map((post, index) => (
                <li
                  key={post.uuid}
                  className={`talk-post${post.is_mine ? ' is-mine' : ''}${unread > 0 && index >= posts.length - unread ? ' is-new' : ''}`}
                >
                  <p className="talk-post-head">
                    <Face user={post.user} />
                    <b>{post.is_mine ? 'You' : post.user.display_name}</b>
                    <time dateTime={post.created_at} title={phaseInHead ? when(post.created_at, { time: true }) : undefined}>{when(post.created_at, { time: !phaseInHead })}</time>
                    {phaseInHead && index === 0 && picker}
                    {unread > 0 && index >= posts.length - unread && <span className="visually-hidden">New</span>}
                    {editing?.uuid !== post.uuid && (post.is_mine || discussion.can_moderate) && (
                      <ItemActions
                        label={post.uuid === discussion.uuid ? 'Dig actions' : 'Post actions'}
                        placement="below-end"
                        actions={[
                          post.is_mine && { key: 'edit', label: 'Edit', icon: <ActionGlyph name="edit" />, onSelect: () => setEditing({ uuid: post.uuid, body: post.body }) },
                          { key: 'delete', label: 'Delete', danger: true, icon: <ActionGlyph name="trash" />, onSelect: () => remove(post) },
                        ].filter(Boolean)}
                      />
                    )}
                  </p>
                  {editing?.uuid === post.uuid ? (
                    <form className="talk-post-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
                      <MarkdownField
                        rows={Math.min(14, Math.max(3, Math.ceil(editing.body.length / 110) + editing.body.split('\n').length))} value={editing.body} maxLength={POST_LIMIT} aria-label="Edit" autoFocus
                        onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
                          if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                        }}
                      />
                      <span className="talk-post-edit-foot">
                        <button type="button" className="project-quiet" onClick={() => setEditing(null)}>Cancel</button>
                        <button type="submit" className="primary" disabled={!editing.body.trim() || busy}>Save</button>
                      </span>
                    </form>
                  ) : <Markdown className="talk-post-body" text={post.body} />}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {error && <p className="talk-card-error" role="alert">{error}</p>}
      {discussion && !personal && (
        <form className={`talk-compose${tucked ? ' is-tucked' : ''}`} onSubmit={send}>
          {currentUser && !tucked && <Face user={currentUser} />}
          <MarkdownField
            ref={box}
            rows={tucked ? 1 : 2}
            value={body}
            maxLength={POST_LIMIT}
            placeholder={tucked ? 'Post' : `Post to ${whose} dig`}
            aria-label={`Post to ${whose} dig`}
            onChange={(e) => setBody(e.target.value)}
            onFocus={tucked ? (e) => { const field = e.target; requestAnimationFrame(() => field.scrollIntoView({ block: 'nearest' })); } : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
          />
          <button type="submit" className="talk-send" disabled={!body.trim() || busy} aria-label="Post" title="Post (⌘↩)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      )}
    </section>
  );
}
