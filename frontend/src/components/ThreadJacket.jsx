import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { editThread, editThreadReply, getThread, removeThread, removeThreadReply, replyInThread, threadPlacePath } from '../../../shared/api/friends.js';
import appLimits from '../../../shared/appLimits.js';
import { confirmAction } from '../../../shared/confirmAction';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import BackLink from '../../../shared/ui/BackLink.jsx';
import Face from '../../../shared/ui/Face.jsx';
import Markdown from '../../../shared/ui/Markdown.jsx';
import MarkdownField from '../../../shared/ui/MarkdownField.jsx';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import { ReactionAdd, ReactionChips } from '../../../shared/ui/Reactions.jsx';
import { when } from '../../../shared/ui/Talk.jsx';
import { appPath, backendPath } from '../base';
import { formatAuthors } from '../paperFormat';
import { keep, kept } from '../lastMember';
import { loungeState, setLounge, withThread } from '../loungeStore';
import { formatBytes } from '../../../shared/waiting.js';
import Avatar from './Avatar';
import { FileGlyph } from './ThreadComposer';

/**
 * A thread's jacket: the one screen a thread has.
 *
 * A thread is found in the Lounge and opened here, as a paper and a board
 * open on theirs: the passage or the picture it started from, the paper
 * and the way back to that place in it (a thread started in the Lounge
 * itself has neither), everything said, and a box to
 * reply in. Free talk: no votes, nothing counted for approval.
 *
 * Whoever sees the thread sets an emoji on it, or on a reply: a reply of
 * a special sort, drawn as a chip under what it is on.
 *
 * What was said is reworded in place by whoever said it: the starter's
 * own words and each reply, with the pencil a dig's post has. What was
 * selected in the paper and what was attached stay as sent.
 *
 * A thread lives in the Lounge alone, so Back always leads there.
 */

const metaOf = (paper) => [formatAuthors(paper.authors), paper.year, paper.journal].filter(Boolean).join(' · ');

// Where something attached is fetched from: the bucket's own address, or
// the service's route for it.
const fetched = (url) => (url.startsWith('/') ? backendPath(url) : url);

// What a thread's starter attached: the pictures shown, each opening
// whole in a tab of its own, and the files by name, to open.
function Attached({ files }) {
  const pictures = files.filter((f) => f.is_picture);
  const others = files.filter((f) => !f.is_picture);
  return (
    <div className="thread-attached">
      {pictures.length > 0 && (
        <ul className={`thread-attached-pictures${pictures.length === 1 ? ' is-one' : ''}`}>
          {pictures.map((f) => (
            <li key={f.uuid}><a href={fetched(f.url)} target="_blank" rel="noopener noreferrer" title={f.name}><img src={fetched(f.url)} alt={f.name} loading="lazy" /></a></li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="thread-attached-files">
          {others.map((f) => (
            <li key={f.uuid}>
              <a href={fetched(f.url)} target="_blank" rel="noopener noreferrer" download={f.name}>
                <FileGlyph />
                <span className="thread-attached-name">{f.name}</span>
                <span className="thread-attached-size">{formatBytes(f.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One thing said: who, when, and their words. Its writer rewords it in
// place and can take it back. `edit` is the rewording under way, if this
// is the one being reworded: its words so far, and what Save and Cancel do.
// `react` is its reactions and what setting one does (Reactions.jsx).
function Said({ user, at, mine, words, files = [], editLabel, onEdit, removeLabel, onRemove, edit, react }) {
  return (
    <li className={`talk-post${mine ? ' is-mine' : ''}`}>
      <p className="talk-post-head">
        <Face user={user} />
        <b>{mine ? 'You' : user.display_name}</b>
        <time dateTime={at}>{when(at, { time: true })}</time>
        {!edit && (react || (mine && (onEdit || onRemove))) && (
          <span className="talk-post-actions" role="group" aria-label={onRemove ? 'Reply actions' : 'Thread actions'}>
            {react && <ReactionAdd {...react} />}
            {mine && onEdit && (
              <button type="button" aria-label={editLabel} title={editLabel} onClick={onEdit}>
                <ActionGlyph name="edit" />
              </button>
            )}
            {mine && onRemove && (
              <button type="button" className="is-danger" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
                <ActionGlyph name="trash" />
              </button>
            )}
          </span>
        )}
      </p>
      {edit ? (
        <form className="talk-post-edit" onSubmit={(event) => { event.preventDefault(); edit.save(); }}>
          <MarkdownField
            rows={Math.min(14, Math.max(3, Math.ceil(edit.body.length / 110) + edit.body.split('\n').length))} value={edit.body}
            maxLength={appLimits.text.thread_words} aria-label={editLabel} autoFocus
            onChange={(event) => edit.change(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); edit.save(); }
              if (event.key === 'Escape') { event.stopPropagation(); edit.cancel(); }
            }}
          />
          <span className="talk-post-edit-foot">
            <button type="button" className="project-quiet" onClick={edit.cancel}>Cancel</button>
            <button type="submit" className="primary" disabled={!edit.ready}>Save</button>
          </span>
        </form>
      ) : words && <Markdown className="talk-post-body" text={words} />}
      {files.length > 0 && <Attached files={files} />}
      {react && <ReactionChips {...react} />}
    </li>
  );
}

// The Lounge as last read, kept in step with what was done here, so
// stepping back shows the thread as it now stands, or gone.
function tellLounge(uuid, next) {
  const room = kept('room');
  if (room?.rows) keep('room', { ...room, rows: withThread(room.rows, uuid, next) });
  const { rows } = loungeState();
  if (rows) setLounge({ rows: withThread(rows, uuid, next) });
}

export default function ThreadJacket({
  threadUuid, currentUser, onBack, backHref, backLabel = 'Lounge', hideBack = false, onRemoved,
}) {
  const [thread, setThread] = useState(() => kept(`thread:${threadUuid}`));
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // What is being reworded: the thread's uuid for its starter's words, or
  // a reply's, with the words so far.
  const [editing, setEditing] = useState(null);
  // The thread as last drawn, for a reaction answered after another was set.
  const latest = useRef(thread);
  latest.current = thread;

  useEffect(() => {
    let gone = false;
    setThread(kept(`thread:${threadUuid}`));
    setError(null);
    setBody('');
    setEditing(null);
    getThread(threadUuid)
      .then((found) => { if (!gone) setThread(found); })
      .catch((err) => { if (!gone) setError(err?.message || String(err)); });
    return () => { gone = true; };
  }, [threadUuid]);

  useEffect(() => {
    if (thread?.uuid === threadUuid) keep(`thread:${threadUuid}`, thread);
  }, [thread, threadUuid]);

  const back = !hideBack && (
    <BackLink className="back-button" href={backHref} onBack={onBack}>&larr; {backLabel}</BackLink>
  );

  if (error && !thread) {
    return (
      <div className="board-jacket thread-jacket">
        {back}
        <div className="panel"><div className="error" role="alert">{error}</div></div>
      </div>
    );
  }
  if (!thread) return <div className="loading"><Working label="Loading thread…" /></div>;

  const { paper } = thread;
  const picture = thread.picture_url && (thread.picture_url.startsWith('/') ? backendPath(thread.picture_url) : thread.picture_url);
  // A thread started in the Lounge itself came from no paper: it has
  // no passage, and no place to open.
  const placePath = threadPlacePath(thread);
  const place = placePath && appPath(placePath);
  const from = Boolean(thread.excerpt || picture);
  const replies = thread.replies.length;
  const attached = thread.files ?? [];

  const act = async (work) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (err) { setError(err?.message || String(err)); } finally { setBusy(false); }
  };
  // The thread as it now stands, with the paper it was read with.
  const changed = (next) => {
    setThread({ ...next, paper: next.paper ?? paper });
    tellLounge(thread.uuid, next);
  };
  const send = (event) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    act(async () => { changed(await replyInThread(thread.uuid, text)); setBody(''); });
  };
  const remove = async () => {
    if (!(await confirmAction(replies ? 'Remove this thread and its replies?' : 'Remove this thread?', { confirmLabel: 'Remove', destructive: true }))) return;
    act(async () => {
      await removeThread(thread.uuid);
      tellLounge(thread.uuid, null);
      onRemoved?.();
    });
  };
  // The rewording of one thing said, for its row. A thread's own words
  // can be emptied where the passage, the clip or a file is left to read.
  const edit = (uuid, mayBeEmpty = false) => {
    if (editing?.uuid !== uuid) return null;
    const text = editing.body.trim();
    const ready = !busy && (mayBeEmpty || Boolean(text));
    return {
      body: editing.body, ready,
      change: (next) => setEditing({ uuid, body: next }),
      cancel: () => setEditing(null),
      save: () => {
        if (!ready) return;
        act(async () => {
          changed(uuid === thread.uuid ? await editThread(uuid, text) : await editThreadReply(uuid, text));
          setEditing(null);
        });
      },
    };
  };
  const editingWords = edit(thread.uuid, from || attached.length > 0);
  // The emoji set on the thread itself, or on one reply, as they now stand.
  const onThread = {
    kind: 'thread', uuid: thread.uuid, reactions: thread.reactions ?? [],
    onChanged: (reactions) => changed({ ...latest.current, reactions }),
  };
  const onReply = (reply) => ({
    kind: 'reply', uuid: reply.uuid, reactions: reply.reactions ?? [],
    onChanged: (reactions) => changed({ ...latest.current, replies: latest.current.replies.map((r) => (r.uuid === reply.uuid ? { ...r, reactions } : r)) }),
  });
  // A thread's own reactions go under its starter's words; a passage or
  // a clip sent with no words wears them itself.
  const worded = Boolean(thread.words || attached.length > 0 || editingWords);
  const takeBack = async (reply) => {
    if (!(await confirmAction('Delete this reply?', { confirmLabel: 'Delete', destructive: true }))) return;
    act(async () => changed(await removeThreadReply(reply.uuid)));
  };

  return (
    <div className="board-jacket thread-jacket">
      {back}
      <div className="panel">
        <div className="detail-title-row thread-jacket-title-row">
            <h2 className="kicker thread-jacket-kind">Thread</h2>
            {thread.is_mine && (
              <div className="detail-toggle">
                {/* Words there already are reworded where they stand. */}
                {!thread.words && attached.length === 0 && !editingWords && (
                  <button
                    type="button" className="icon-button" onClick={() => setEditing({ uuid: thread.uuid, body: '' })} disabled={busy}
                    title="Add words of your own" aria-label="Add words of your own"
                  >
                    <ActionGlyph name="edit" />
                  </button>
                )}
                <button
                  type="button" className="icon-button danger-icon" onClick={remove} disabled={busy}
                  title={replies ? 'Remove this thread, and its replies with it' : 'Remove this thread'} aria-label="Remove this thread"
                >
                  <ActionGlyph name="trash" />
                </button>
              </div>
            )}
        </div>

        {from && (
          <figure className="thread-jacket-from">
            {thread.excerpt && <blockquote>{thread.excerpt}</blockquote>}
            {picture && <img src={picture} alt={`A clip from page ${thread.page}`} />}
          </figure>
        )}
        {from && !worded && <ReactionChips {...onThread} withAdd className="thread-jacket-reactions" />}

        {/* Words alone say who and when on their own first line. */}
        {from && (
          <p className="board-jacket-facts thread-jacket-facts" aria-label="About this thread">
            <a className="board-jacket-owner" href={appPath(`/u/${thread.user.uuid}`)}>
              <Avatar user={thread.user} className="mini-avatar" />
              {thread.is_mine ? 'You' : thread.user.display_name}
            </a>
            <time dateTime={thread.created_at}>{when(thread.created_at, { time: true })}</time>
            <span>{replies === 0 ? 'No replies yet' : `${replies} ${replies === 1 ? 'reply' : 'replies'}`}</span>
          </p>
        )}

        {paper && (
          <p className="thread-jacket-paper">
            <span className="thread-jacket-paper-title"><PaperTitle title={paper.title} />, page {thread.page}</span>
            {metaOf(paper) && <span className="thread-jacket-paper-meta">{metaOf(paper)}</span>}
          </p>
        )}

        {place && paper && (
          <div className="paper-actions">
            <a className="button primary" href={place}>Open in the paper</a>
          </div>
        )}

        <section className={`board-jacket-section thread-jacket-said${from ? '' : ' is-all'}`} aria-label="What was said">
          <ol className="talk-posts">
            {worded && (
              <Said
                react={onThread}
                user={thread.user} at={thread.created_at} mine={thread.is_mine} words={thread.words} files={attached}
                editLabel={thread.words ? 'Edit your words' : 'Add words of your own'} onEdit={() => setEditing({ uuid: thread.uuid, body: thread.words ?? '' })} edit={editingWords}
              />
            )}
            {thread.replies.map((reply) => (
              <Said
                key={reply.uuid} react={onReply(reply)} user={reply.user} at={reply.created_at} mine={reply.is_mine} words={reply.body}
                editLabel="Edit reply" onEdit={() => setEditing({ uuid: reply.uuid, body: reply.body })} edit={edit(reply.uuid)}
                removeLabel="Delete reply" onRemove={() => takeBack(reply)}
              />
            ))}
          </ol>
          {error && <div className="error" role="alert">{error}</div>}
          <form className="talk-compose thread-jacket-reply" onSubmit={send}>
            <Face user={currentUser} />
            <MarkdownField
              rows={2} value={body} maxLength={appLimits.text.thread_words} placeholder="Reply" aria-label="Reply in this thread"
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send(event); }}
            />
            <button type="submit" className="talk-send" disabled={busy || !body.trim()} aria-label="Reply" title="Reply (⌘↩)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
