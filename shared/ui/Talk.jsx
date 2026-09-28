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

const POST_LIMIT = appLimits.text.dig_post;

// Where a dig stands. Anyone in the project moves it; nothing else does.
export const PHASES = [
  { key: 'digging', word: 'Digging' },
  { key: 'stashed', word: 'Stashed' },
  { key: 'gold', word: 'Gold' },
  { key: 'buried', word: 'Buried' },
];
export const phaseWord = (phase) => PHASES.find((p) => p.key === phase)?.word ?? 'Digging';
// Digging first, then stashed, gold and buried: how lists of digs run.
export const phaseRank = (phase) => Math.max(0, PHASES.findIndex((p) => p.key === phase));

// The four phases side by side, the current one on a white tile: one press
// moves the dig. Compact, only the current word shows until it is pressed,
// then the bar opens in its place and closes after a move or away.
export function PhasePicker({ dig, onMoved, compact = false, className = '' }) {
  const current = dig.phase ?? 'digging';
  const [shown, setShown] = useState(current);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bar = useRef(null);
  useEffect(() => setShown(current), [current]);
  useDismiss(compact && open, bar, () => setOpen(false));
  useEffect(() => {
    if (compact && open) bar.current?.querySelector('[aria-checked="true"]')?.focus();
  }, [compact, open]);
  const move = async (phase) => {
    if (compact) setOpen(false);
    if (phase === shown || busy) return;
    setShown(phase);
    setBusy(true);
    try { onMoved?.(await moveDig(dig.uuid, phase)); } catch { setShown(current); } finally { setBusy(false); }
  };
  // Arrows walk the words; Enter or Space moves the dig.
  const walk = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const words = [...e.currentTarget.querySelectorAll('button')];
    const at = words.indexOf(document.activeElement);
    words[(at + step + words.length) % words.length]?.focus();
  };
  if (compact && !open) {
    return (
      <button type="button" className={`dig-phase-word is-${shown} ${className}`} aria-haspopup="true" aria-label={`Phase: ${phaseWord(shown)}`} onClick={() => setOpen(true)}>
        {phaseWord(shown)}
      </button>
    );
  }
  return (
    <div ref={bar} className={`dig-phase${busy ? ' is-busy' : ''} ${className}`} role="radiogroup" aria-label="Phase" onKeyDown={walk}>
      {PHASES.map((p) => (
        <button
          key={p.key} type="button" role="radio" aria-checked={shown === p.key} tabIndex={shown === p.key ? 0 : -1}
          className={shown === p.key ? 'is-on' : ''} onClick={() => move(p.key)}
        >
          {p.word}
        </button>
      ))}
    </div>
  );
}

export function kindOf(subject) {
  return subjectKey(subject).split(':')[0];
}

// The viewer's note glyph: a speech bubble, filled or drawn as an outline.
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
export function TalkPin({
  projectUuid, subject, label, summary, currentUser, onChanged, size = 'md', className = '', title,
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(null);
  const pin = useRef(null);
  const key = subjectKey(subject);
  const state = local ?? summary ?? null;
  // Every dig on the thing and every post in them.
  const count = (state?.dig_count ?? (state?.uuid ? 1 : 0)) + (state?.post_count ?? 0);
  const dug = count > 0;
  const fresh = !local && Boolean(summary?.is_new);

  useEffect(() => { setLocal(null); }, [summary?.post_count, summary?.uuid]);

  const changed = useCallback((discussion, total) => {
    const next = discussion
      ? { uuid: discussion.uuid, dig_count: total?.digs ?? 1, post_count: total?.posts ?? discussion.posts.length, is_new: false, voices: uniqueVoices([{ user: discussion.owner }, ...discussion.posts]) }
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
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        <TalkGlyph outline={!dug} />
        {count > 0 && <span className="talk-count">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && createPortal(
        <TalkCard
          anchor={pin}
          projectUuid={projectUuid}
          subject={key}
          label={label}
          currentUser={currentUser}
          onChanged={changed}
          onClose={() => { setOpen(false); pin.current?.focus({ preventScroll: true }); }}
        />,
        document.body,
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

// Digs seen in this tab, by where they were opened, so opening one again
// shows it at once while it is fetched again.
const seenTalk = new Map();
const talkKey = (projectUuid, topic) => `${projectUuid}|${topic.subject}|${topic.dig ?? ''}`;

// Inline, the card is part of a page (a paper's brief) rather than a
// popover: it is not placed, closes on nothing, and opens at its first post,
// the one that says what the dig is about. With phaseBar the four phases
// stand open (the dig open in the Digs tab); else only the current one.
// With phaseInHead the phase word sits on the dig's own line, after its date.
// With tucked the writing box stays folded to one word until it is pressed.
export function TalkCard({
  anchor, projectUuid, subject, label, dig = null, currentUser, onChanged, onClose, inline = false, focus = false, unread = 0, seekUnread = () => true,
  single = false, phaseBar = false, phaseInHead = false, tucked = false,
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
    if (!inline && anchor.current) setSpot(place(anchor.current, card.current));
  }, [anchor, inline]);
  useLayoutEffect(() => { reposition(); }, [reposition, discussion]);
  useEffect(() => {
    if (inline) return undefined;
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
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
    if (!inline || body || focus) field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
    if (list.current && !inline) list.current.scrollTop = list.current.scrollHeight;
    // In a page, the reader lands on the first post they have not read,
    // unless the page says to stay where it opened.
    if (inline && discussion && unread > 0 && seekUnread()) {
      const fresh = list.current?.querySelector('.talk-post.is-new');
      if (fresh && fresh.getBoundingClientRect().top > window.innerHeight) fresh.scrollIntoView({ block: 'center' });
    }
  }, [discussion]);
  // The field grows with what is written, up to the sheet's cap.
  useLayoutEffect(() => {
    const field = box.current;
    if (!field) return;
    field.style.height = '';
    if (field.scrollHeight > field.clientHeight) field.style.height = `${field.scrollHeight + 2}px`;
  }, [body]);
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
      const others = digs.filter((d) => d.uuid !== next.uuid);
      if (onHome) onChanged?.(next, { digs: others.length + 1, posts: others.reduce((n, d) => n + Number(d.post_count ?? 0), next.posts.length) });
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
    const others = all.filter((d) => d.uuid !== next?.uuid);
    onChanged?.(next, next
      ? { digs: others.length + 1, posts: others.reduce((n, d) => n + Number(d.post_count ?? 0), next.posts.length) }
      : undefined);
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
    if (!(await confirmAction(whole ? 'Remove this dig and its posts?' : 'Delete this post?', { confirmLabel: 'Delete', destructive: true }))) return;
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
  const owners = !single && discussion !== undefined && (digs.length > 1 || !digs.some((d) => d.is_mine));
  // A dig is started in the body, where its words will stand; the box at
  // the foot only ever adds a post to the dig that is open.
  const writing = discussion === null && currentUser;
  const whose = discussion && (discussion.is_mine ? 'your' : `${discussion.owner?.display_name?.split(' ')[0]}'s`);
  const picker = discussion && (
    <PhasePicker
      dig={discussion} compact={!phaseBar}
      onMoved={(next) => {
        setDiscussion(next);
        const others = digs.filter((d) => d.uuid !== next.uuid);
        if (onHome) onChanged?.(next, { digs: others.length + 1, posts: others.reduce((n, d) => n + Number(d.post_count ?? 0), next.posts.length) });
      }}
    />
  );
  // Inline, the phase sits at the end of the owners' row rather than on a
  // line of its own.
  const pickerWithOwners = inline && owners;
  return (
    <section
      ref={card}
      className={`talk-card${inline ? ' is-inline' : ''}${spot?.sheet ? ' is-sheet' : ''}${spot ? ' is-placed' : ''}`}
      style={style}
      role={inline ? 'region' : 'dialog'}
      aria-label={`Digs on ${plainTitle(topic.label)}`}
      {...CONTAINED}
    >
      {(!inline || (discussion && !pickerWithOwners && !phaseInHead)) && (
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
          {pickerWithOwners && picker}
        </nav>
      )}

      <div className="talk-card-body" ref={list}>
        {discussion === undefined ? null : writing && folded ? (
          <button type="button" className="talk-unfold" onClick={() => setUnfolded(true)}><Face user={currentUser} />Dig</button>
        ) : writing ? (
          <form className="talk-dig-new" onSubmit={send}>
            <Face user={currentUser} />
            <textarea
              ref={box} rows={1} value={body} maxLength={POST_LIMIT} placeholder="Your dig" aria-label="Your dig"
              onChange={(e) => setBody(e.target.value)} onBlur={leave}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
            />
            {/* The button comes with the words: nothing to press before. */}
            {body.trim() && (
              <span className="talk-dig-new-foot">
                <button type="submit" className="primary" disabled={busy} title="Dig (⌘↩)">Dig</button>
              </span>
            )}
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
                    <time dateTime={post.created_at}>{when(post.created_at, { time: true })}</time>
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
                      <textarea
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
      {discussion && folded && (
        <button type="button" className="talk-unfold is-post" onClick={() => setUnfolded(true)}>Post</button>
      )}
      {discussion && !folded && (
        <form className="talk-compose" onSubmit={send}>
          {currentUser && <Face user={currentUser} />}
          <textarea
            ref={box}
            rows={body ? 4 : 2}
            value={body}
            maxLength={POST_LIMIT}
            placeholder={`Post to ${whose} dig`}
            aria-label={`Post to ${whose} dig`}
            onChange={(e) => setBody(e.target.value)} onBlur={tucked ? leave : undefined}
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
