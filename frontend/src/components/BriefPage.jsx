import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard, TalkOpener, TalkPin, when } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { getProject, removePaperFromProject } from '../../../shared/api/projects.js';
import { addToNook, getPaper, updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { paperName } from '../../../shared/paperName.js';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { InToolbar } from './DesktopChrome';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import { RATING_DIMENSIONS } from './Rating';
import { SectionHead, firstName, markArrivals } from './ProjectPage';

// A take shows the two ratings a project compares by; expertise is the
// reader's own, not the paper's.
const TAKE_RATINGS = RATING_DIMENSIONS.filter((d) => d.key !== 'rating_expertise');

// The year only when it is not this one.
function day(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

// A paper's brief: the paper as one project sees it. Where the Library's
// jacket says what the paper is, the brief says what this group makes of
// it: every member's take, the dig about it open beside them, the digs on
// their thoughts, the boards it is on, and who brought it in.
export default function BriefPage({ projectUuid, paper: name, currentUser, onBack, backHref, onRead, onRemoved }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [writing, setWriting] = useState(false);

  const load = useCallback(() => getProject(projectUuid).then((next) => setProject(markArrivals(projectUuid, next))), [projectUuid]);
  useEffect(() => { load().catch((err) => setError(err.message)); }, [load]);

  const act = async (work) => {
    setNotice(null);
    try {
      await work();
      await load();
      return true;
    } catch (err) {
      setNotice(err.message);
      return false;
    }
  };

  const paper = project?.papers?.find((p) => paperName(p.sha256) === name);
  const failure = error ?? (project && !project.is_member ? 'Only the project’s members see its briefs.' : project && !paper ? `This paper is no longer in ${project.name}.` : null);
  if (failure) {
    return (
      <div className="panel">
        <div className="error" role="alert">{failure}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!project) return <div className="loading"><Working label="Loading brief…" /></div>;

  const isMe = (user) => user.uuid === currentUser?.uuid;
  const nameOf = (user) => (isMe(user) ? 'You' : user.display_name);
  // Others first, yours last, just above where you would write.
  const takes = paper.users.filter((u) => u.thought || TAKE_RATINGS.some((d) => u[d.key]))
    .sort((a, b) => isMe(a.user) - isMe(b.user));
  const myTake = paper.users.find((u) => isMe(u.user));
  const canTakeOut = project.is_keeper || isMe(paper.added_by);
  const viewer = appPath(`/viewer/?pdf=${paper.sha256}`);
  const talk = new Map((project.discussions ?? []).map((d) => [d.subject.key, d]));
  const onThoughts = (project.discussions ?? []).filter((d) => d.subject.kind === 'take' && d.subject.paper_sha256 === paper.sha256 && d.last_post);
  const boards = (project.boards ?? []).filter((b) => paper.board_uuids?.includes(b.uuid));
  const talked = () => { load().catch(() => {}); };

  const share = (thought) => act(async () => {
    if (!paper.in_my_nook) await addToNook(paper.sha256);
    await updatePaper(paper.sha256, { thought, thought_public: true });
  });
  const takeOut = async () => {
    const ok = await confirmAction(`Take this paper out of ${project.name}? Its takes stay on each member’s copy.`, { confirmLabel: 'Take out', destructive: true });
    if (ok && await act(() => removePaperFromProject(project.uuid, paper.sha256))) onRemoved?.();
  };

  const actions = (
    <div className={`brief-actions${DESKTOP ? ' brief-toolbar-actions' : ''}`}>
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
        <button type="button" onClick={() => act(() => addToNook(paper.sha256))}><ActionGlyph name="add" />Add to my nook</button>
      )}
      <a className="brief-jacket" href={appPath(`/paper/${name}`)}>In the Library</a>
      {canTakeOut && <button type="button" className="project-quiet project-danger brief-take-out" onClick={takeOut}>Take out</button>}
    </div>
  );

  // In the Mac app the toolbar names the project and carries the actions,
  // and the sidebar is the way back, so the page starts with the paper.
  return (
    <div className="brief-page">
      {DESKTOP ? <InToolbar>{actions}</InToolbar> : <BackLink className="back-button" href={backHref} onBack={onBack} />}
      <header className="brief-head">
        {!DESKTOP && <p className="kicker"><a href={appPath(`/project/${project.uuid}`)}>{project.name}</a> · Brief</p>}
        <h1 className="brief-title">{paper.title}</h1>
        <p className="brief-cite">
          <span className="brief-authors">{formatAuthors(paper.authors)}</span>
          {[paper.journal, paper.year].filter(Boolean).length > 0 && <span>{[paper.journal, paper.year].filter(Boolean).join(' · ')}</span>}
        </p>
        {!DESKTOP && actions}
      </header>
      {notice && <div className="error" role="alert">{notice}</div>}

      <div className="brief-layout">
        <div className="brief-main">
          <section className="project-section" aria-labelledby="brief-takes-heading">
            <SectionHead
              id="brief-takes-heading" title="Takes" count={takes.length}
              action={myTake?.thought && !writing && (
                <button type="button" className="project-board-start" onClick={() => setWriting(true)}><ActionGlyph name="edit" />Edit your thought</button>
              )}
            />
            {takes.length > 0 && (
              <ul className="project-takes">
                {takes.map((entry) => {
                  if (isMe(entry.user) && writing) return null;
                  const subject = `take:${paper.sha256}:${entry.user.uuid}`;
                  return (
                    <li key={entry.user.uuid} className="project-take talk-host">
                      <Avatar user={entry.user} className="mini-avatar" />
                      <p className="project-take-who">
                        <b>{nameOf(entry.user)}</b>
                        {TAKE_RATINGS.filter((d) => entry[d.key]).map((d) => (
                          <span key={d.key} title={d.hint}>{d.label} {entry[d.key]}/5</span>
                        ))}
                      </p>
                      {entry.thought && <p className="project-take-thought">“{entry.thought}”</p>}
                      <span className="project-take-talk">
                        <TalkPin
                          projectUuid={project.uuid} subject={subject} summary={talk.get(subject)} currentUser={currentUser} onChanged={talked} size="sm"
                          label={entry.thought ? `“${entry.thought}”` : `${nameOf(entry.user)}’s take on ${paper.title}`}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {(!myTake?.thought || writing) && (
              <ThoughtComposer
                key={paper.sha256}
                paper={paper}
                currentUser={currentUser}
                initial={myTake?.thought ?? ''}
                autoFocus={writing}
                onCancel={writing ? () => setWriting(false) : null}
                onSave={async (thought) => { const ok = await share(thought); if (ok) setWriting(false); return ok; }}
              />
            )}
          </section>

          {onThoughts.length > 0 && (
            <section className="project-section" aria-labelledby="brief-digs-heading">
              <SectionHead id="brief-digs-heading" title="Digs on thoughts" count={onThoughts.length} />
              <ul className="project-talk-list">
                {onThoughts.map((d) => (
                  <li key={d.uuid}>
                    <TalkOpener
                      projectUuid={project.uuid} subject={d.subject.key} label={d.subject.label} currentUser={currentUser} onChanged={talked}
                      className={`project-talk-item${d.is_new ? ' is-new' : ''}`}
                    >
                      <span className="project-talk-subject">
                        <span className="project-card-kind">{d.subject.by ? `${d.subject.by}’s thought` : 'Thought'}</span>
                        <span className="project-talk-label">{d.subject.label}</span>
                      </span>
                      <span className="project-talk-excerpt">{d.last_post.excerpt}</span>
                      <span className="project-talk-meta">
                        <Avatar user={d.last_post.user} className="mini-avatar" />
                        <b>{isMe(d.last_post.user) ? 'You' : firstName(d.last_post.user)}</b>
                        <span>{when(d.updated_at)}</span>
                        {d.is_new && <span className="visually-hidden">New</span>}
                      </span>
                    </TalkOpener>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {boards.length > 0 && (
            <section className="project-section" aria-labelledby="brief-boards-heading">
              <SectionHead id="brief-boards-heading" title="On boards" count={boards.length} />
              <ul className="brief-boards">
                {boards.map((board) => (
                  <li key={board.uuid}><a href={appPath(`/boards/${board.uuid}`)}>{board.name}</a></li>
                ))}
              </ul>
            </section>
          )}

          <p className="project-paper-added">
            Added by {isMe(paper.added_by) ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}
          </p>
        </div>

        <aside className="brief-dig" aria-label="Dig">
          <TalkCard inline projectUuid={project.uuid} subject={`paper:${paper.sha256}`} label={paper.title} currentUser={currentUser} onChanged={talked} />
        </aside>
      </div>
    </div>
  );
}

// Your one line on a paper, which everyone in the project reads beside it.
// A thought kept private on your copy is offered back to edit, and saving
// shares it here.
function ThoughtComposer({ paper, currentUser, initial, autoFocus, onCancel, onSave }) {
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
      <Avatar user={currentUser} className="mini-avatar" />
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
      <button type="submit" className="primary" disabled={!draft.trim() || busy}>{busy ? 'Saving…' : 'Share'}</button>
      {!paper.in_my_nook && <p className="project-thought-note">Adds the paper to your nook.</p>}
    </form>
  );
}

