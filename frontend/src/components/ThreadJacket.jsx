import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { getThread, removeThread, removeThreadReply, replyInThread, threadPlacePath } from '../../../shared/api/friends.js';
import appLimits from '../../../shared/appLimits.js';
import { confirmAction } from '../../../shared/confirmAction';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import BackLink from '../../../shared/ui/BackLink.jsx';
import Face from '../../../shared/ui/Face.jsx';
import Markdown from '../../../shared/ui/Markdown.jsx';
import MarkdownField from '../../../shared/ui/MarkdownField.jsx';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import { when } from '../../../shared/ui/Talk.jsx';
import { appPath, backendPath } from '../base';
import { formatAuthors } from '../paperFormat';
import { keep, kept } from '../lastMember';
import { loungeState, setLounge, withThread } from '../loungeStore';
import Avatar from './Avatar';

/**
 * A thread's jacket: the one screen a thread has.
 *
 * A thread is found in the Lounge and opened here, as a paper and a board
 * open on theirs: the passage or the picture it started from, the paper
 * and the way back to that place in it (a thread started in the Lounge
 * itself has neither), everything said, and a box to
 * reply in. Free talk: no votes, nothing counted for approval.
 *
 * A thread lives in the Lounge alone, so Back always leads there.
 */

const metaOf = (paper) => [formatAuthors(paper.authors), paper.year, paper.journal].filter(Boolean).join(' · ');

// One thing said: who, when, and their words. Its writer can take it back.
function Said({ user, at, mine, words, removeLabel, onRemove }) {
  return (
    <li className={`talk-post${mine ? ' is-mine' : ''}`}>
      <p className="talk-post-head">
        <Face user={user} />
        <b>{mine ? 'You' : user.display_name}</b>
        <time dateTime={at}>{when(at, { time: true })}</time>
        {mine && onRemove && (
          <span className="talk-post-actions" role="group" aria-label={removeLabel}>
            <button type="button" className="is-danger" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
              <ActionGlyph name="trash" />
            </button>
          </span>
        )}
      </p>
      {words && <Markdown className="talk-post-body" text={words} />}
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

  useEffect(() => {
    let gone = false;
    setThread(kept(`thread:${threadUuid}`));
    setError(null);
    setBody('');
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
            {thread.words && <Said user={thread.user} at={thread.created_at} mine={thread.is_mine} words={thread.words} />}
            {thread.replies.map((reply) => (
              <Said
                key={reply.uuid} user={reply.user} at={reply.created_at} mine={reply.is_mine} words={reply.body}
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
