import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkCard, TalkGlyph } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import { getProject, removePaperFromProject } from '../../../shared/api/projects.js';
import { addToNook, getPaper, updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { paperName } from '../../../shared/paperName.js';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import { RATING_DIMENSIONS } from './Rating';
import { ProjectWay, SectionHead, firstName, markArrivals, plural } from './ProjectPage';

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
// it: every member's take, the dig about it open beside them (or about a
// thought, picked by its pin), the boards it is on, and who brought it in.
export default function BriefPage({ projectUuid, paper: name, currentUser, onBack, backHref, onRead, onRemoved }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [writing, setWriting] = useState(false);
  const [digOn, setDigOn] = useState(null);
  const [digOpen, setDigOpen] = useState(false);
  const aside = useRef(null);

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
  // One dig shows at a time beside the takes: the paper's, or a thought's
  // picked by its pin. The column appears once there is a dig to show.
  const paperKey = `paper:${paper.sha256}`;
  const takeKey = (user) => `take:${paper.sha256}:${user.uuid}`;
  const takeLabel = (entry) => (entry.thought ? `“${entry.thought}”` : `${nameOf(entry.user)}’s take on ${paper.title}`);
  const whose = (key) => paper.users.find((u) => takeKey(u.user) === key);
  const labelOf = (key) => (key === paperKey ? paper.title : takeLabel(whose(key)));
  const hasDig = (key) => (talk.get(key)?.post_count ?? 0) > 0;
  // Until one is picked, the paper's own dig, or else the first thought's.
  const shown = digOn ?? (hasDig(paperKey) || digOpen || !onThoughts.length ? paperKey : onThoughts[0].subject.key);
  const withDig = hasDig(paperKey) || digOpen || digOn !== null || onThoughts.length > 0;
  const choices = [paperKey, ...onThoughts.map((d) => d.subject.key), ...(digOn && digOn !== paperKey && !talk.get(digOn)?.last_post ? [digOn] : [])];
  const choiceName = (key) => {
    if (key === paperKey) return 'Paper';
    const entry = whose(key);
    return entry ? `${isMe(entry.user) ? 'Your' : `${firstName(entry.user)}’s`} thought` : 'Thought';
  };
  const openDig = (key) => {
    setDigOn(key);
    setDigOpen(true);
    requestAnimationFrame(() => {
      const box = aside.current?.getBoundingClientRect();
      if (box && (box.top > window.innerHeight || box.bottom < 0)) aside.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };
  // The pin at the end of a name line: the paper's, or a take's. Pressing
  // it shows that dig in the dig column.
  const pin = (key, about, size = 'sm') => {
    const summary = talk.get(key);
    const count = summary?.post_count ?? 0;
    const on = shown === key && withDig;
    return (
      <span className={`talk-pin-wrap talk-${size}`}>
        <button
          type="button"
          className={`talk-pin${count ? '' : ' is-empty'}${summary?.is_new ? ' is-new' : ''}${on ? ' is-open' : ''}`}
          aria-pressed={on}
          aria-label={count ? `${plural(count, 'post', 'posts')} about ${about}. Open the dig` : `Dig into ${about}`}
          title={count ? plural(count, 'post', 'posts') : 'Dig into this'}
          onClick={() => openDig(key)}
        >
          <TalkGlyph outline={!count} />
          {count > 0 && <span className="talk-count">{count > 99 ? '99+' : count}</span>}
        </button>
      </span>
    );
  };
  const pinFor = (entry) => pin(takeKey(entry.user), takeLabel(entry));
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

  // In the Mac app the toolbar names the project and the sidebar is the way
  // back, so the page starts with the paper.
  return (
    <div className="brief-page">
      <ProjectWay project={project} />
      <div className="brief-layout">
        <div className="brief-main">
          <header className="brief-head">
            <h1 className="brief-title talk-host">{paper.title}{pin(paperKey, paper.title, 'md')}</h1>
            <p className="brief-cite">
              <span className="brief-authors">{formatAuthors(paper.authors)}</span>
              {[paper.journal, paper.year].filter(Boolean).length > 0 && <span>{[paper.journal, paper.year].filter(Boolean).join(' · ')}</span>}
            </p>
            <div className="brief-actions">
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
              <a className="brief-jacket" href={appPath(`/paper/${name}`)}>In the Library</a>
              {!paper.in_my_nook && (
                <button type="button" className="brief-jacket brief-nook" onClick={() => act(() => addToNook(paper.sha256))}><ActionGlyph name="add" />Add to my nook</button>
              )}
            </div>
          </header>
          {notice && <div className="error" role="alert">{notice}</div>}

          <section className="project-section" aria-labelledby="brief-takes-heading">
            <SectionHead id="brief-takes-heading" title="Takes" count={takes.length} />
            <ul className="project-takes">
              {takes.map((entry) => {
                const mine = isMe(entry.user);
                const composing = mine && (writing || !entry.thought);
                return (
                  <li key={entry.user.uuid} className={`project-take talk-host${composing ? ' is-composing' : ''}`}>
                    <Avatar user={entry.user} className="mini-avatar" />
                    <p className="project-take-who">
                      <b>{nameOf(entry.user)}</b>
                      {TAKE_RATINGS.filter((d) => entry[d.key]).map((d) => (
                        <span key={d.key} title={d.hint}>{d.label} {entry[d.key]}/5</span>
                      ))}
                      {!composing && pinFor(entry)}
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
                  <Avatar user={currentUser} className="mini-avatar" />
                  <p className="project-take-who"><b>You</b></p>
                  <ThoughtComposer
                    key={paper.sha256}
                    paper={paper}
                    initial=""
                    onSave={share}
                  />
                </li>
              )}
            </ul>
          </section>

          <footer className="brief-foot">
            {boards.length > 0 && (
              <p className="brief-boards">
                On {boards.map((board, i) => (
                  <React.Fragment key={board.uuid}>{i > 0 && ', '}<a href={appPath(`/boards/${board.uuid}`)}>{board.name}</a></React.Fragment>
                ))}
              </p>
            )}
            <p className="project-paper-added">
              Added by {isMe(paper.added_by) ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}
              {canTakeOut && <> · <button type="button" className="brief-take-out" onClick={takeOut}>Take out</button></>}
            </p>
          </footer>
        </div>

        {!withDig ? (
          <aside className="brief-dig is-empty" aria-label="Dig" ref={aside} />
        ) : (
          <aside className="brief-dig" aria-label="Dig" ref={aside}>
            {choices.length > 1 && (
              <nav className="brief-dig-choices" aria-label="Which dig">
                {choices.map((key) => (
                  <button
                    key={key} type="button" aria-pressed={shown === key}
                    className={`brief-dig-choice${shown === key ? ' is-on' : ''}${talk.get(key)?.is_new ? ' is-new' : ''}`}
                    onClick={() => openDig(key)}
                  >
                    {choiceName(key)}
                  </button>
                ))}
              </nav>
            )}
            <TalkCard
              key={shown} inline focus={digOpen && !hasDig(shown)}
              projectUuid={project.uuid} subject={shown} label={labelOf(shown)} currentUser={currentUser} onChanged={talked}
            />
          </aside>
        )}
      </div>
    </div>
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

