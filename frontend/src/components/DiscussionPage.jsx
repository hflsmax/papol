import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ItemActions from '../../../shared/ui/ItemActions.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  deleteDiscussionPost, editDiscussionPost, findDiscussion, getDiscussion, replyToDiscussion, startDiscussion,
} from '../../../shared/api/projects.js';
import { paperName } from '../../../shared/paperName.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath } from '../base';
import Avatar from './Avatar';
import AutoTextarea from './AutoTextarea';
import Markdown, { MarkdownHint } from './Markdown';

const POST_LIMIT = appLimits.text.discussion_post;
const INVITE = 'Take your time: what does it show, what doesn’t hold up, and what should we do about it?';

function when(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(thisYear ? {} : { year: 'numeric' }),
  });
}

// What the discussion is about, and a way back to it.
function Subject({ project, subject, action }) {
  const projectHref = appPath(`/project/${project.uuid}`);
  const paperHref = subject.paper_sha256 ? appPath(`/paper/${paperName(subject.paper_sha256)}`) : null;
  const boardHref = subject.board_uuid ? appPath(`/boards/${subject.board_uuid}`) : null;
  const about = {
    project: 'Digging into the project',
    paper: 'Digging into a paper',
    take: <>Digging into {subject.by ? `${subject.by}’s` : 'a'} thought on <a href={paperHref}>{subject.paper_title ?? 'a paper'}</a></>,
    board: 'Digging into a board',
    card: <>Digging into a card on <a href={boardHref}>{subject.board_name}</a></>,
  }[subject.kind];
  const title = {
    paper: <a className="paper-title-link" href={paperHref}>{subject.label}</a>,
    board: <a className="paper-title-link" href={boardHref}>{subject.label}</a>,
    card: <span className="discussion-card-label">{subject.label}</span>,
    take: <span className="discussion-card-label">{subject.label}</span>,
  }[subject.kind] ?? subject.label;
  return (
    <header className="discussion-head">
      <p className="kicker"><a href={projectHref}>{project.name}</a>{' · '}{about}</p>
      <h2 className="discussion-title">{title}</h2>
      {action}
    </header>
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
        <MarkdownHint />
        {onCancel && <button type="button" className="project-quiet" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={!body.trim() || busy}>{busy ? 'Posting…' : submitLabel}</button>
      </div>
    </form>
  );
}

function Post({ post, canModerate, selected, onSelect, onEdit, onDelete, onDig }) {
  const [editing, setEditing] = useState(false);
  const self = useRef(null);
  const actions = [
    { key: 'dig', label: 'Dig into this', icon: <ActionGlyph name="dig" />, onSelect: () => onDig(self) },
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
        {selected && !editing && actions.length > 0 && <ItemActions actions={actions} label="Post actions" placement="below-end" />}
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
    </li>
  );
}

// One discussion: its subject, every post in order, and room to write more.
export function DiscussionPage({ discussionUuid, currentUser, onBack, backHref }) {
  const [discussion, setDiscussion] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [digging, setDigging] = useState(null);
  const replyBox = useRef(null);

  useEffect(() => {
    let active = true;
    getDiscussion(discussionUuid)
      .then((next) => { if (active) setDiscussion(next); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [discussionUuid]);

  useEffect(() => {
    if (!selected) return undefined;
    const away = (e) => { if (!e.target.closest?.('.discussion-post')) setSelected(null); };
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

  return (
    <div className="discussion-page">
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <Subject
        project={discussion.project}
        subject={discussion.subject}
        action={discussion.posts.length > 1 && (
          <button
            type="button" className="discussion-jump"
            onClick={() => { replyBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); replyBox.current?.querySelector('textarea')?.focus({ preventScroll: true }); }}
          >
            <ActionGlyph name="discuss" />Reply
          </button>
        )}
      />
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
            onDig={(anchor) => setDigging({ post, anchor })}
          />
        ))}
      </ol>
      {digging && createPortal(
        <TalkCard
          anchor={digging.anchor} projectUuid={discussion.project.uuid} subject={discussion.subject.key}
          label={discussion.subject.label} currentUser={currentUser} drift={digging.post}
          onChanged={(next) => setDiscussion(next)} onClose={() => setDigging(null)}
        />,
        document.body,
      )}
      <section ref={replyBox} className="discussion-reply" aria-label="Reply">
        <h3 className="discussion-reply-heading">{currentUser && <Avatar user={currentUser} className="mini-avatar" />}Your reply</h3>
        <Composer label="Your reply" placeholder={INVITE} submitLabel="Post reply" onSubmit={(body) => act(() => replyToDiscussion(discussion.uuid, body))} />
      </section>
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
    <div className="discussion-page">
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <Subject project={found.project} subject={found.subject} />
      {notice && <div className="error" role="alert">{notice}</div>}
      <section className="discussion-start" aria-label="Start the discussion">
        <h3 className="discussion-reply-heading">{currentUser && <Avatar user={currentUser} className="mini-avatar" />}Start the discussion</h3>
        <p className="discussion-start-note">Everyone in {found.project.name} can read and reply.</p>
        <Composer
          label="First post" placeholder={INVITE} submitLabel="Start discussion"
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
      </section>
    </div>
  );
}
