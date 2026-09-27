import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findDiscussion, getDiscussion, replyToDiscussion, startDiscussion, subjectKey } from '../api/projects.js';
import { appPath } from '../appUrls.js';
import appLimits from '../appLimits.js';
import Avatar from './Avatar.jsx';
import Markdown from './Markdown.jsx';

// Talk: one element for discussing anything in a project. A pin, drawn
// like a note pin in the viewer, sits beside the thing; pressing it opens
// a talk card, drawn like a card on a board, right where you are. The
// same pin and card serve the project itself, a paper, a member's thought,
// a board and a card on it.

const POST_LIMIT = appLimits.text.discussion_post;

const KINDS = {
  project: { word: 'Project', invite: 'Anything on your mind for the project?' },
  paper: { word: 'Paper', invite: 'What stands out in this paper?' },
  take: { word: 'Thought', invite: 'Ask about this thought, or answer it.' },
  board: { word: 'Board', invite: 'Anything about this board?' },
  card: { word: 'Card', invite: 'What do you make of this card?' },
};

export function kindOf(subject) {
  return subjectKey(subject).split(':')[0];
}

// The viewer's note glyph: a speech bubble, filled or drawn as an outline.
export function TalkGlyph({ outline = false }) {
  return (
    <svg className="talk-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill={outline ? 'none' : 'currentColor'}
        stroke={outline ? 'currentColor' : 'none'}
        strokeWidth={outline ? 1.7 : 0}
        strokeLinejoin="round"
        d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8.6L6 21.4V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
      />
    </svg>
  );
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function when(iso) {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

// The pin. Empty, it is an outline that fills in when you reach for the
// thing it sits on; with talk, it carries the count, and a gold dot when
// others have written since you looked.
export function TalkPin({
  projectUuid, subject, label, summary, currentUser, onChanged, faces = false, size = 'md', className = '', title, caption,
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(null);
  const pin = useRef(null);
  const key = subjectKey(subject);
  const state = local ?? summary ?? null;
  const count = state?.post_count ?? 0;
  const fresh = !local && Boolean(summary?.is_new);
  const voices = state?.voices ?? [];

  useEffect(() => { setLocal(null); }, [summary?.post_count, summary?.uuid]);

  const changed = useCallback((discussion) => {
    const next = discussion
      ? { uuid: discussion.uuid, post_count: discussion.posts.length, is_new: false, voices: uniqueVoices(discussion.posts) }
      : { uuid: null, post_count: 0, is_new: false, voices: [] };
    setLocal(next);
    onChanged?.(key, next, discussion);
  }, [key, onChanged]);

  const captionText = typeof caption === 'function' ? caption(count) : caption;
  const words = count
    ? `${plural(count, 'post', 'posts')} about ${label}${fresh ? ', new' : ''}. Open the talk`
    : `Talk about ${label}`;
  return (
    <span className={`talk-pin-wrap talk-${size}${faces && voices.length ? ' has-faces' : ''} ${className}`}>
      <button
        ref={pin}
        type="button"
        className={`talk-pin${count ? '' : ' is-empty'}${fresh ? ' is-new' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={words}
        title={title ?? (count ? plural(count, 'post', 'posts') : 'Talk about this')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        <TalkGlyph outline={!count} />
        {count > 0
          ? <span className="talk-count">{count > 99 ? '99+' : count}</span>
          : <span className="talk-plus" aria-hidden="true">+</span>}
      </button>
      {captionText && (
        <button
          type="button" className="talk-caption" tabIndex={-1} aria-hidden="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        >
          {captionText}
        </button>
      )}
      {faces && voices.length > 0 && (
        <span className="talk-faces" aria-hidden="true">
          {voices.slice(0, 3).map((user) => <Avatar key={user.uuid} user={user} className="mini-avatar" />)}
        </span>
      )}
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
export function TalkOpener({ projectUuid, subject, label, currentUser, onChanged, className = '', title, children }) {
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
          anchor={self} projectUuid={projectUuid} subject={key} label={label} currentUser={currentUser}
          onChanged={changed} onClose={() => { setOpen(false); self.current?.focus({ preventScroll: true }); }}
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

export function TalkCard({ anchor, projectUuid, subject, label, currentUser, onChanged, onClose }) {
  const [discussion, setDiscussion] = useState(undefined);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState(null);
  const card = useRef(null);
  const list = useRef(null);
  const box = useRef(null);
  const kind = kindOf(subject);
  const words = KINDS[kind] ?? KINDS.project;

  useEffect(() => {
    let active = true;
    findDiscussion(projectUuid, subject)
      .then((found) => (found.discussion_uuid ? getDiscussion(found.discussion_uuid) : null))
      .then((next) => { if (active) setDiscussion(next); })
      .catch((err) => { if (active) { setError(err.message); setDiscussion(null); } });
    return () => { active = false; };
  }, [projectUuid, subject]);

  const reposition = useCallback(() => {
    if (anchor.current) setSpot(place(anchor.current, card.current));
  }, [anchor]);
  useLayoutEffect(() => { reposition(); }, [reposition, discussion]);
  useEffect(() => {
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [reposition]);

  useEffect(() => {
    const away = (e) => {
      if (card.current?.contains(e.target) || anchor.current?.contains(e.target)) return;
      onClose();
    };
    const escape = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose]);

  useEffect(() => {
    if (discussion === undefined) return;
    box.current?.focus({ preventScroll: true });
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [discussion]);

  const send = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = !discussion ? await startDiscussion(projectUuid, subject, text) : await replyToDiscussion(discussion.uuid, text);
      setDiscussion(next);
      setBody('');
      onChanged?.(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const posts = discussion?.posts ?? [];
  const page = discussion ? `/discussion/${discussion.uuid}` : null;
  const style = spot && !spot.sheet
    ? { left: spot.left, top: spot.top, width: spot.width, transformOrigin: `${spot.originX}px ${spot.originY}px` }
    : undefined;

  return (
    <section
      ref={card}
      className={`talk-card${spot?.sheet ? ' is-sheet' : ''}${spot ? ' is-placed' : ''}`}
      style={style}
      role="dialog"
      aria-label={`Talk about ${label}`}
      {...CONTAINED}
    >
      <header className="talk-card-header">
        <span className="talk-card-kind"><i><TalkGlyph /></i>Talk · {words.word}</span>
        {discussion && discussion.posts.length > 0 && <span className="talk-card-count">{plural(posts.length, 'post', 'posts')}</span>}
        {page && (
          <a className="talk-card-open" href={appPath(page)} title="Open as a page" aria-label="Open as a page">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5h6v6M19 5l-9 9" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></svg>
          </a>
        )}
        <button type="button" className="talk-card-close" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <p className="talk-card-subject">{label}</p>

      <div className="talk-card-body" ref={list}>
        {discussion === undefined ? (
          <p className="talk-card-quiet">Opening…</p>
        ) : posts.length === 0 ? (
          <p className="talk-card-quiet talk-card-invite">Nobody has said anything here yet. Start it off.</p>
        ) : (
          <ol className="talk-posts">
            {posts.map((post) => (
              <li key={post.uuid} className={`talk-post${post.is_mine ? ' is-mine' : ''}`}>
                <p className="talk-post-head">
                  <Avatar user={post.user} className="mini-avatar" />
                  <b>{post.is_mine ? 'You' : post.user.display_name}</b>
                  <time dateTime={post.created_at}>{when(post.created_at)}</time>
                </p>
                <Markdown className="talk-post-body" text={post.body} />
              </li>
            ))}
          </ol>
        )}
      </div>

      {error && <p className="talk-card-error" role="alert">{error}</p>}
      <form className="talk-compose" onSubmit={send}>
        {currentUser && <Avatar user={currentUser} className="mini-avatar" />}
        <textarea
          ref={box}
          rows={posts.length ? 2 : 3}
          value={body}
          maxLength={POST_LIMIT}
          placeholder={words.invite}
          aria-label="Your post"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }}
        />
        <button type="submit" className="talk-send" disabled={!body.trim() || busy} aria-label="Post" title="Post (⌘↩)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
      </form>
    </section>
  );
}
