import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addIdeaCard, createProjectBoard, findDiscussion, getDiscussion, getProject, replyToDiscussion, startDiscussion, subjectKey,
} from '../api/projects.js';
import { appPath } from '../appUrls.js';
import appLimits from '../appLimits.js';
import ActionGlyph from './ActionGlyph.jsx';
import Face from './Face.jsx';
import Markdown from './Markdown.jsx';
import PaperTitle from './PaperTitle.jsx';
import { plainTitle } from '../texTitle.js';

// A dig: a conversation, among any number of members, about one thing the
// project holds. A pin, drawn like a note pin in the viewer, sits beside
// the thing; pressing it opens a dig card, drawn like a card on a board,
// right where you are. The same pin and card serve a paper, a member's
// thought, a board and a card on it; never the project as a whole, which
// is no one thing. (In code the pin and
// card keep their first name, Talk; the store calls a dig a discussion.)

const POST_LIMIT = appLimits.text.discussion_post;

const KINDS = {
  paper: { word: 'Paper' },
  take: { word: 'Thought' },
  board: { word: 'Board' },
  card: { word: 'Card' },
  annotation: { word: 'Annotation' },
};

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
  const count = state?.post_count ?? 0;
  const fresh = !local && Boolean(summary?.is_new);

  useEffect(() => { setLocal(null); }, [summary?.post_count, summary?.uuid]);

  const changed = useCallback((discussion) => {
    const next = discussion
      ? { uuid: discussion.uuid, post_count: discussion.posts.length, is_new: false, voices: uniqueVoices(discussion.posts) }
      : { uuid: null, post_count: 0, is_new: false, voices: [] };
    setLocal(next);
    onChanged?.(key, next, discussion);
  }, [key, onChanged]);

  const words = count
    ? `${plural(count, 'post', 'posts')} about ${plainTitle(label)}${fresh ? ', new' : ''}. Open the dig`
    : `Dig into ${plainTitle(label)}`;
  return (
    <span className={`talk-pin-wrap talk-${size} ${className}`}>
      <button
        ref={pin}
        type="button"
        className={`talk-pin${count ? '' : ' is-empty'}${fresh ? ' is-new' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={words}
        title={title ?? (count ? plural(count, 'post', 'posts') : 'Dig into this')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
      >
        <TalkGlyph outline={!count} />
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
export function TalkOpener({ projectUuid, subject, label, currentUser, onChanged, onClosed, className = '', title, children }) {
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

// A dig is always about something: a paper, a member's thought, a board
// or a card. Nothing here is a free-floating chat room.
// When a dig drifts onto something else, any post in it can be dug into:
// say what the new thing is, as something the project already holds or as
// a new idea (a card on a board), and the card moves to that dig with the
// post quoted, leaving a pointer behind in the dig it came from.
const IDEA_LIMIT = 200;

function excerptOf(text, length = 220) {
  const flat = String(text).replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function quoteOf(post) {
  return `> ${post.user.display_name}: ${excerptOf(post.body, 400)}\n\n`;
}

function DigChooser({ projectUuid, post, current, boardUuid, onPick, onCancel }) {
  const [project, setProject] = useState(null);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    let active = true;
    getProject(projectUuid).then((next) => { if (active) setProject(next); }).catch(() => { if (active) setProject({ papers: [], boards: [] }); });
    input.current?.focus({ preventScroll: true });
    return () => { active = false; };
  }, [projectUuid]);

  const boards = project?.boards ?? [];
  const home = boards.find((b) => b.uuid === boardUuid) ?? boards[0] ?? null;
  const things = [
    ...(project?.papers ?? []).map((p) => ({ subject: `paper:${p.sha256}`, kind: 'paper', label: p.title ?? 'Untitled paper' })),
    ...boards.map((b) => ({ subject: `board:${b.uuid}`, kind: 'board', label: b.name })),
  ].filter((t) => t.subject !== current);

  const makeIdea = async (e) => {
    e.preventDefault();
    const name = idea.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const board = home ?? await createProjectBoard(projectUuid, 'Ideas');
      const card = await addIdeaCard(board.uuid, name);
      onPick({ subject: `card:${card.uuid}`, label: name });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="dig-chooser">
      <blockquote className="dig-chooser-quote">{excerptOf(post.body)}</blockquote>
      {things.length > 0 && (
        <>
          <p className="dig-chooser-or">In the project</p>
          <ul className="dig-chooser-list">
            {things.map((t) => (
              <li key={t.subject}>
                <button type="button" onClick={() => onPick({ subject: t.subject, label: t.label })}>
                  <span className="dig-chooser-kind">{KINDS[t.kind].word}</span>
                  <span className="dig-chooser-label"><PaperTitle title={t.label} /></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <form className="dig-chooser-idea" onSubmit={makeIdea}>
        <input
          ref={input} value={idea} maxLength={IDEA_LIMIT} placeholder="A new idea" aria-label="The new idea"
          onChange={(e) => setIdea(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!idea.trim() || busy}>Dig in</button>
      </form>
      {error && <p className="talk-card-error" role="alert">{error}</p>}
      <button type="button" className="dig-chooser-cancel" onClick={onCancel}>Cancel</button>
    </div>
  );
}

// Inline, the card is part of a page (a paper's brief) rather than a
// popover: it is not placed, closes on nothing, and opens at its first post,
// the one that says what the dig is about.
export function TalkCard({
  anchor, projectUuid, subject, label, currentUser, onChanged, onClose, drift: startDrift = null, inline = false, focus = false, unread = 0,
}) {
  const [topic, setTopic] = useState({ subject, label });
  const [from, setFrom] = useState(null);
  const [drift, setDrift] = useState(startDrift);
  const [picked, setPicked] = useState(null);
  const [discussion, setDiscussion] = useState(undefined);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState(null);
  const card = useRef(null);
  const list = useRef(null);
  const box = useRef(null);
  const kind = kindOf(topic.subject);
  const words = KINDS[kind] ?? KINDS.paper;
  const onHome = topic.subject === subject;

  useEffect(() => {
    let active = true;
    setDiscussion(undefined);
    findDiscussion(projectUuid, topic.subject)
      .then((found) => (found.discussion_uuid ? getDiscussion(found.discussion_uuid) : null))
      .then((next) => { if (active) setDiscussion(next); })
      .catch((err) => { if (active) { setError(err.message); setDiscussion(null); } });
    return () => { active = false; };
  }, [projectUuid, topic.subject]);

  const reposition = useCallback(() => {
    if (!inline && anchor.current) setSpot(place(anchor.current, card.current));
  }, [anchor, inline]);
  useLayoutEffect(() => { reposition(); }, [reposition, discussion, drift]);
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
      onClose();
    };
    const escape = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose, inline]);

  useEffect(() => {
    if (discussion === undefined || drift) return;
    const field = box.current;
    if (!inline || body || focus) field?.focus({ preventScroll: true });
    field?.setSelectionRange(field.value.length, field.value.length);
    if (list.current && !inline) list.current.scrollTop = list.current.scrollHeight;
    // In a page, the reader lands on the first post they have not read.
    if (inline && discussion && unread > 0) {
      const fresh = list.current?.querySelector('.talk-post.is-new');
      if (fresh && fresh.getBoundingClientRect().top > window.innerHeight) fresh.scrollIntoView({ block: 'center' });
    }
  }, [discussion, drift]);
  const toEnd = () => requestAnimationFrame(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; });

  // Dug into: the card moves to the new thing, with the post quoted to
  // start from. The pointer back is left once the first post is sent.
  const dugInto = (next) => {
    setFrom({ ...topic, uuid: discussion?.uuid ?? null, pending: true });
    setBody(quoteOf(drift));
    setDrift(null);
    setPicked(null);
    setTopic(next);
  };
  const goBack = () => {
    setTopic({ subject: from.subject, label: from.label });
    setFrom(null);
    setBody('');
  };

  const send = async (e) => {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = !discussion ? await startDiscussion(projectUuid, topic.subject, text) : await replyToDiscussion(discussion.uuid, text);
      setDiscussion(next);
      setBody('');
      toEnd();
      if (onHome) onChanged?.(next);
      if (from?.pending && from.uuid) {
        const back = await replyToDiscussion(from.uuid, `Dug into [${plainTitle(topic.label).replace(/[[\]]/g, '')}](${appPath(`/discussion/${next.uuid}`)})`);
        setFrom({ ...from, pending: false });
        if (from.subject === subject) onChanged?.(back);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const posts = discussion?.posts ?? [];
  const style = spot && !spot.sheet
    ? { left: spot.left, top: spot.top, width: spot.width, transformOrigin: `${spot.originX}px ${spot.originY}px` }
    : undefined;

  return (
    <section
      ref={card}
      className={`talk-card${inline ? ' is-inline' : ''}${spot?.sheet ? ' is-sheet' : ''}${spot ? ' is-placed' : ''}`}
      style={style}
      role={inline ? 'region' : 'dialog'}
      aria-label={`Dig into ${plainTitle(topic.label)}`}
      {...CONTAINED}
    >
      <header className="talk-card-header">
        <span className="talk-card-kind"><i><TalkGlyph /></i>Dig{!inline && <> · {words.word}</>}</span>
        {!inline && discussion && discussion.posts.length > 0 && <span className="talk-card-count">{plural(posts.length, 'post', 'posts')}</span>}
        {!inline && <button type="button" className="talk-card-close" aria-label="Close" onClick={onClose}>×</button>}
      </header>
      {from && (
        <button type="button" className="talk-card-back" onClick={goBack}>
          <span aria-hidden="true">←</span> Dug out of <PaperTitle title={from.label} />
        </button>
      )}
      {(!inline || !onHome) && <p className="talk-card-subject"><PaperTitle title={topic.label} /></p>}

      <div className="talk-card-body" ref={list}>
        {drift ? (
          <DigChooser
            projectUuid={projectUuid} post={drift} current={topic.subject} boardUuid={discussion?.subject?.board_uuid}
            onPick={dugInto} onCancel={() => (startDrift && !from ? onClose?.() : setDrift(null))}
          />
        ) : discussion === undefined ? (
          <p className="talk-card-quiet">Opening…</p>
        ) : posts.length === 0 ? null : (
          <>
            <ol className="talk-posts">
              {posts.map((post, index) => (
                <li
                  key={post.uuid} tabIndex={0}
                  className={`talk-post${post.is_mine ? ' is-mine' : ''}${picked === post.uuid ? ' is-selected' : ''}${unread > 0 && index >= posts.length - unread ? ' is-new' : ''}`}
                  onClick={(e) => { if (!e.target.closest('a, button')) setPicked(picked === post.uuid ? null : post.uuid); }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(picked === post.uuid ? null : post.uuid); }
                  }}
                >
                  <p className="talk-post-head">
                    <Face user={post.user} />
                    <b>{post.is_mine ? 'You' : post.user.display_name}</b>
                    <time dateTime={post.created_at}>{when(post.created_at, { time: true })}</time>
                  </p>
                  <Markdown className="talk-post-body" text={post.body} />
                  {picked === post.uuid && (
                    <div className="talk-post-actions">
                      <button type="button" onClick={() => setDrift(post)}><ActionGlyph name="dig" />Dig into this</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {error && <p className="talk-card-error" role="alert">{error}</p>}
      {!drift && (
        <form className="talk-compose" onSubmit={send}>
          {currentUser && <Face user={currentUser} />}
          <textarea
            ref={box}
            rows={body ? 4 : posts.length ? 2 : 3}
            value={body}
            maxLength={POST_LIMIT}
            placeholder={posts.length ? 'Reply' : 'Post'}
            aria-label="Your post"
            onChange={(e) => setBody(e.target.value)}
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
