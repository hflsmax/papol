import React, { useEffect, useRef, useState } from 'react';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { annotationViewerPath, removePaperFromProject } from '../../../shared/api/projects.js';
import { addToNook, getPaper, updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat.js';
import Face from '../../../shared/ui/Face.jsx';
import { RATING_DIMENSIONS } from './Rating';
import { SectionHead } from './ProjectPage';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';

// A take shows the two ratings a project compares by; expertise is the
// reader's own, not the paper's.
const TAKE_RATINGS = RATING_DIMENSIONS.filter((d) => d.key !== 'rating_expertise');

// The year only when it is not this one.
function day(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

// A paper's brief: the paper as one project sees it, shown in the Papers
// tab beside the list (or under its row on a narrow window). Where the
// Library's jacket says what the paper is, the brief says what this group
// makes of it: every member's take, then the dig about it.
export default function PaperBrief({ project, paper, currentUser, unread = 0, underRow = false, onChanged, onRead }) {
  const [notice, setNotice] = useState(null);
  const [writing, setWriting] = useState(false);

  const act = async (work) => {
    setNotice(null);
    try {
      await work();
      await onChanged();
      return true;
    } catch (err) {
      setNotice(err.message);
      return false;
    }
  };

  const isMe = (user) => user.uuid === currentUser?.uuid;
  const nameOf = (user) => (isMe(user) ? 'You' : user.display_name);
  // Others first, yours last, just above where you would write.
  const takes = paper.users.filter((u) => u.thought || TAKE_RATINGS.some((d) => u[d.key]))
    .sort((a, b) => isMe(a.user) - isMe(b.user));
  const myTake = paper.users.find((u) => isMe(u.user));
  const canTakeOut = project.is_keeper || isMe(paper.added_by);
  // The paper opens with this project on: every member's marks on it.
  const viewer = appPath(annotationViewerPath(project.uuid, paper.sha256));
  const where = [paper.journal, paper.year].filter(Boolean).join(' · ');

  const share = (thought) => act(async () => {
    if (!paper.in_my_nook) await addToNook(paper.sha256);
    await updatePaper(paper.sha256, { thought, thought_public: true });
  });
  const takeOut = async () => {
    const ok = await confirmAction(`Take this paper out of ${project.name}? Its takes stay on each member’s copy, and its dig stays in the project.`, { confirmLabel: 'Take out', destructive: true });
    if (ok) await act(() => removePaperFromProject(project.uuid, paper.sha256));
  };

  return (
    <article className="paper-brief" aria-label="Brief">
      <header className="paper-brief-head">
        {/* Under its row, the row already names the paper and its authors. */}
        {!underRow && <h3 className="paper-brief-title"><PaperTitle title={paper.title} /></h3>}
        {(!underRow || where) && (
          <p className="paper-brief-cite">
            {!underRow && <span className="paper-brief-authors">{formatAuthors(paper.authors)}</span>}
            {where && <span>{where}</span>}
          </p>
        )}
        <div className="paper-brief-actions">
          <a
            className="button primary" href={viewer} data-document
            onClick={(e) => {
              if (!onRead || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onRead(viewer);
            }}
          >
            Read
          </a>
          {!paper.in_my_nook && (
            <button type="button" className="paper-brief-quiet" onClick={() => act(() => addToNook(paper.sha256))}><ActionGlyph name="add" />Add to my nook</button>
          )}
          {canTakeOut && <button type="button" className="paper-brief-quiet paper-brief-take-out" onClick={takeOut}>Take out</button>}
        </div>
      </header>
      {notice && <div className="error" role="alert">{notice}</div>}

      <section className="project-section" aria-labelledby={`brief-takes-${paper.sha256}`}>
        <SectionHead id={`brief-takes-${paper.sha256}`} title="Takes" count={takes.length} />
        <ul className="project-takes">
          {takes.map((entry) => {
            const mine = isMe(entry.user);
            const composing = mine && (writing || !entry.thought);
            return (
              <li key={entry.user.uuid} className={`project-take${composing ? ' is-composing' : ''}`}>
                <Face user={entry.user} />
                <p className="project-take-who">
                  <b>{nameOf(entry.user)}</b>
                  {TAKE_RATINGS.filter((d) => entry[d.key]).map((d) => (
                    <span key={d.key} title={d.hint}>{d.label} {entry[d.key]}/5</span>
                  ))}
                  {!composing && mine && entry.thought && (
                    <span className="project-take-options">
                      <button type="button" className="project-quiet" onClick={() => setWriting(true)}>Edit</button>
                    </span>
                  )}
                </p>
                {composing ? (
                  <ThoughtComposer
                    key={paper.sha256}
                    paper={paper}
                    initial={myTake?.thought ?? ''}
                    autoFocus={writing}
                    onCancel={writing ? () => setWriting(false) : null}
                    onSave={async (thought) => { const ok = await share(thought); if (ok) setWriting(false); return ok; }}
                  />
                ) : entry.thought && (mine ? (
                  <button type="button" className="project-take-thought is-mine" title="Edit" onClick={() => setWriting(true)}>“{entry.thought}”</button>
                ) : <p className="project-take-thought">“{entry.thought}”</p>)}
              </li>
            );
          })}
          {!takes.some((entry) => isMe(entry.user)) && (
            <li className="project-take is-composing">
              <Face user={currentUser} />
              <p className="project-take-who"><b>You</b></p>
              <ThoughtComposer key={paper.sha256} paper={paper} initial="" onSave={share} />
            </li>
          )}
        </ul>
        {paper.added_by && (
          <p className="project-paper-added">Added by {isMe(paper.added_by) ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}</p>
        )}
      </section>

      <section className="paper-brief-dig" aria-label="Dig">
        <TalkCard
          key={paper.sha256} inline unread={unread} seekUnread={() => false}
          projectUuid={project.uuid} subject={`paper:${paper.sha256}`} label={paper.title} currentUser={currentUser}
          onChanged={() => { onChanged().catch(() => {}); }}
        />
      </section>
    </article>
  );
}

// Your one line on a paper, which everyone in the project reads beside it.
// A thought kept private on your copy is offered back to edit, and saving
// shares it here.
function ThoughtComposer({ paper, initial, autoFocus, onCancel, onSave }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    if (initial || !paper.in_my_nook) return undefined;
    let active = true;
    getPaper(paper.sha256)
      .then((copy) => { if (active && copy?.thought && !touched.current) setDraft(copy.thought); })
      .catch(() => {});
    return () => { active = false; };
  }, [paper.sha256]);
  const save = async (e) => {
    e.preventDefault();
    const thought = draft.trim();
    if (!thought || busy) return;
    setBusy(true);
    await onSave(thought);
    setBusy(false);
  };
  return (
    <form className="project-thought-form" onSubmit={save}>
      <input
        type="text"
        autoFocus={autoFocus}
        value={draft}
        maxLength={appLimits.text.paper_thought}
        aria-label="Your thought on this paper"
        placeholder="Your thought"
        onChange={(e) => { touched.current = true; setDraft(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.nativeEvent.stopImmediatePropagation(); onCancel(); } }}
      />
      {onCancel && <button type="button" className="project-quiet" onClick={onCancel}>Cancel</button>}
      {draft.trim() && <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Share'}</button>}
    </form>
  );
}
