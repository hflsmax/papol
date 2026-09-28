import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ItemActions from '../../../shared/ui/ItemActions.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard, TalkGlyph } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  deleteDiscussionPost, editDiscussionPost, findDiscussion, getDiscussion, replyToDiscussion, startDiscussion,
} from '../../../shared/api/projects.js';
import { briefPath } from '../../../shared/api/projects.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { InToolbar } from './DesktopChrome';
import Avatar from './Avatar';
import AutoTextarea from './AutoTextarea';
import Markdown from './Markdown';
import { ProjectWay, SUBJECT_WORDS } from './ProjectPage';

const POST_LIMIT = appLimits.text.discussion_post;

function when(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(thisYear ? {} : { year: 'numeric' }),
  });
}

// What the dig is about, and the ways out of it: the project, and the
// thing itself, at its brief or on its board.
function Subject({ project, subject, posts = [] }) {
  const projectHref = appPath(`/project/${project.uuid}`);
  const home = subject.paper_sha256 ? appPath(briefPath(project.uuid, subject.paper_sha256))
    : subject.board_uuid ? appPath(`/boards/${subject.board_uuid}`) : null;
  const under = {
    take: subject.by && <>{subject.by}’s thought on <a href={home}>{subject.paper_title ?? 'a paper'}</a></>,
    card: subject.board_name && <>On <a href={home}>{subject.board_name}</a></>,
  }[subject.kind];
  const voices = [];
  posts.forEach((post) => { if (!voices.some((u) => u.uuid === post.user.uuid)) voices.push(post.user); });
  const word = SUBJECT_WORDS[subject.kind] ?? 'Dig';
  return (
    <>
      {DESKTOP && (
        <InToolbar>
          <p className="discussion-toolbar-where" data-toolbar-title><a href={projectHref}>{project.name}</a>{' · '}{word}</p>
        </InToolbar>
      )}
      <aside className="dig-rail">
        <ProjectWay project={project} />
        <p className="dig-kind"><TalkGlyph />{word}</p>
        <h2 className="dig-subject-title">
          {home && subject.kind !== 'take' ? <a href={home}>{subject.label}</a> : <span className="discussion-card-label">{subject.label}</span>}
        </h2>
        {under && <p className="dig-subject-under">{under}</p>}
        {posts.length > 0 && (
          <p className="dig-voices">
            <span className="project-faces">{voices.slice(0, 5).map((u) => <Avatar key={u.uuid} user={u} className="mini-avatar" />)}</span>
            <span>{posts.length === 1 ? '1 post' : `${posts.length} posts`}</span>
          </p>
        )}
      </aside>
    </>
  );
}

// The box a post is written in: long form is the point, so it opens tall.
function Composer({ initial = '', label, placeholder, submitLabel, onSubmit, onCancel }) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(body.trim());
    setBusy(false);
    if (ok && !initial) setBody('');
  };
  return (
    <form className="discussion-composer" onSubmit={submit}>
      <AutoTextarea
        rows={initial ? 6 : 8}
        value={body}
        maxLength={POST_LIMIT}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
      />
      <div className="discussion-composer-foot">
        {onCancel && <button type="button" className="project-quiet" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={!body.trim() || busy}>{busy ? 'Posting…' : submitLabel}</button>
      </div>
    </form>
  );
}

function Post({ post, canModerate, selected, onSelect, onEdit, onDelete, onDig, digging }) {
  const [editing, setEditing] = useState(false);
  const self = useRef(null);
  const actions = [
    { key: 'dig', label: 'Dig into this', icon: <ActionGlyph name="dig" />, onSelect: () => onDig() },
    post.is_mine && { key: 'edit', label: 'Edit', icon: <ActionGlyph name="edit" />, onSelect: () => setEditing(true) },
    (post.is_mine || canModerate) && { key: 'delete', label: 'Delete', danger: true, icon: <ActionGlyph name="trash" />, onSelect: onDelete },
  ].filter(Boolean);
  return (
    <li
      ref={self}
      className={`discussion-post${selected ? ' is-selected' : ''}`}
      onClick={(e) => { if (!editing && !e.target.closest('a, button, textarea')) onSelect(); }}
    >
      <div className="discussion-post-head">
        <Avatar user={post.user} className="mini-avatar" />
        <span className="discussion-post-author">{post.is_mine ? 'You' : post.user.display_name}</span>
        <time className="discussion-post-time" dateTime={post.created_at}>{when(post.created_at)}{post.edited_at && ' · edited'}</time>
        {selected && !editing && !digging && actions.length > 0 && <ItemActions actions={actions} label="Post actions" placement="below-end" />}
      </div>
      {editing ? (
        <Composer
          initial={post.body} label="Edit post" submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => { const ok = await onEdit(body); if (ok) setEditing(false); return ok; }}
        />
      ) : (
        <Markdown className="discussion-post-body" text={post.body} />
      )}
      {digging}
    </li>
  );
}

// The reply bar at the foot of the posts, always in reach: a line at
// rest, room to write once it has your attention.
function ReplyBar({ currentUser, placeholder, submitLabel, onSubmit, tall = false }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(body.trim());
    setBusy(false);
    if (ok) setBody('');
  };
  const open = tall || focused || body;
  return (
    <form className={`dig-compose${open ? ' is-open' : ''}`} onSubmit={submit} aria-label={submitLabel}>
      {currentUser && <Avatar user={currentUser} className="mini-avatar" />}
      <AutoTextarea
        rows={open ? 6 : 2}
        value={body}
        maxLength={POST_LIMIT}
        aria-label={placeholder}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
      />
      <button type="submit" className="talk-send" disabled={!body.trim() || busy} aria-label={submitLabel} title={`${submitLabel} (⌘↩)`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      </button>
    </form>
  );
}

// One discussion: its subject, every post in order, and room to write more.
export function DiscussionPage({ discussionUuid, currentUser, onBack, backHref }) {
  const [discussion, setDiscussion] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [digging, setDigging] = useState(null);

  useEffect(() => {
    let active = true;
    getDiscussion(discussionUuid)
      .then((next) => { if (active) setDiscussion(next); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [discussionUuid]);

  useEffect(() => {
    if (!selected) return undefined;
    const away = (e) => { if (!e.target.closest?.('.discussion-post, .talk-card')) setSelected(null); };
    const escape = (e) => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [selected]);

  const act = useCallback(async (work) => {
    setNotice(null);
    try {
      const next = await work();
      if (next) setDiscussion(next);
      return true;
    } catch (err) {
      setNotice(err.message);
      return false;
    }
  }, []);

  if (error) {
    return (
      <div className="panel">
        <div className="error" role="alert">{error}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!discussion) return <div className="loading"><Working label="Loading discussion…" /></div>;

  const remove = async (post) => {
    const last = discussion.posts.length === 1;
    const ok = await confirmAction(last ? 'Delete this post? The discussion ends with it.' : 'Delete this post?', { confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    setSelected(null);
    const done = await act(() => deleteDiscussionPost(post.uuid));
    if (done && last) window.location.replace(appPath(`/project/${discussion.project.uuid}`));
  };

  // Dug into: the card opens under the post, where the drift happened.
  const drift = (post) => (
    <div className="discussion-post-drift">
      <TalkCard
        inline projectUuid={discussion.project.uuid} subject={discussion.subject.key}
        label={discussion.subject.label} currentUser={currentUser} drift={post}
        onChanged={(next) => setDiscussion(next)} onClose={() => setDigging(null)}
      />
    </div>
  );
  return (
    <div className="discussion-page dig-page">
      <Subject project={discussion.project} subject={discussion.subject} posts={discussion.posts} />
      <div className="dig-main">
        {notice && <div className="error" role="alert">{notice}</div>}
        <ol className="discussion-posts">
          {discussion.posts.map((post) => (
            <Post
              key={post.uuid}
              post={post}
              canModerate={discussion.can_moderate}
              selected={selected === post.uuid}
              onSelect={() => setSelected(post.uuid)}
              onEdit={(body) => act(() => editDiscussionPost(post.uuid, body))}
              onDelete={() => remove(post)}
              onDig={() => setDigging(post.uuid)}
              digging={digging === post.uuid ? drift(post) : null}
            />
          ))}
        </ol>
        <ReplyBar currentUser={currentUser} placeholder="Reply" submitLabel="Post reply" onSubmit={(body) => act(() => replyToDiscussion(discussion.uuid, body))} />
      </div>
    </div>
  );
}

// "Discuss" on a subject: its discussion if it has one, and otherwise the
// first post to open it with.
export function StartDiscussionPage({ projectUuid, subject, currentUser, onBack, backHref, onOpen }) {
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;
    findDiscussion(projectUuid, subject)
      .then((next) => {
        if (!active) return;
        if (next.discussion_uuid) onOpen(next.discussion_uuid);
        else setFound(next);
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectUuid, subject]);

  if (error) {
    return (
      <div className="panel">
        <div className="error" role="alert">{error}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!found) return <div className="loading"><Working label="Loading…" /></div>;

  return (
    <div className="discussion-page dig-page">
      <Subject project={found.project} subject={found.subject} />
      <div className="dig-main">
        {notice && <div className="error" role="alert">{notice}</div>}
        <ReplyBar
          tall currentUser={currentUser} placeholder="Post" submitLabel="Start dig"
          onSubmit={async (body) => {
            setNotice(null);
            try {
              const next = await startDiscussion(projectUuid, subject, body);
              onOpen(next.uuid);
              return true;
            } catch (err) {
              setNotice(err.message);
              return false;
            }
          }}
        />
      </div>
    </div>
  );
}
