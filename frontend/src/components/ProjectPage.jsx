import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ItemActions from '../../../shared/ui/ItemActions.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { TalkOpener, TalkPin, when } from '../../../shared/ui/Talk.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  createProjectBoard, getProject, invitationPath, openInvitation, removeMember, removePaperFromProject, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { addToNook, getPaper, updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { paperName } from '../../../shared/paperName.js';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import { RATING_DIMENSIONS } from './Rating';
import { keeperNames } from './ProjectMembers';

// Opening a project marks what others added as seen, so every later answer
// calls nothing new, and this page may be fetched more than once as the app
// settles. What was new on arriving stays marked until another project, or
// the list of projects, is opened.
let arrivals = { project: null, papers: new Set() };

export function forgetArrivals() {
  arrivals = { project: null, papers: new Set() };
}

function markArrivals(projectUuid, project) {
  if (!project?.papers) return project;
  if (arrivals.project !== projectUuid) arrivals = { project: projectUuid, papers: new Set() };
  project.papers.forEach((paper) => { if (paper.is_new) arrivals.papers.add(paper.sha256); });
  return { ...project, papers: project.papers.map((paper) => ({ ...paper, is_new: arrivals.papers.has(paper.sha256) })) };
}

// The year only when it is not this one.
function day(iso) {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }) });
}

// A take shows the two ratings a project compares by; expertise is the
// reader's own, not the paper's.
const TAKE_RATINGS = RATING_DIMENSIONS.filter((d) => d.key !== 'rating_expertise');

// Overlapping faces, a few then a count: who is here without a row of chips.
function Faces({ users, max = 4 }) {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <span className="project-faces" aria-hidden="true">
      {shown.map((user) => <Avatar key={user.uuid} user={user} className="mini-avatar" />)}
      {more > 0 && <span className="project-faces-more">+{more}</span>}
    </span>
  );
}

// One project. Its members see its papers, discussions and boards; anyone
// else sees who is in it, and whom to ask to be let in.
export default function ProjectPage({ projectUuid, currentUser, onBack, backHref, onChanged, onLeft }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(null);
  const show = useCallback((next) => markArrivals(projectUuid, next), [projectUuid]);

  const load = useCallback(() => {
    let active = true;
    getProject(projectUuid)
      .then((next) => { const shown = show(next); if (active) { setProject(shown); onChanged?.(); } })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectUuid]);

  useEffect(() => load(), [load]);

  const act = async (work) => {
    setNotice(null);
    try {
      const next = await work();
      if (next?.uuid === projectUuid) setProject(show(next));
      return next;
    } catch (err) {
      setNotice(err.message);
      return null;
    }
  };

  if (error) {
    return (
      <div className="panel">
        <div className="error" role="alert">{error}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!project) return <div className="loading"><Working label="Loading project…" /></div>;

  // What is being said, by subject, and how a pin tells the page it spoke.
  const talk = new Map((project.discussions ?? []).map((d) => [d.subject.key, d]));
  const talked = () => { getProject(project.uuid).then((next) => setProject(show(next))).catch(() => {}); };
  const pin = (subject, label, extra = {}) => (
    <TalkPin
      projectUuid={project.uuid} subject={subject} label={label} summary={talk.get(subject)}
      currentUser={currentUser} onChanged={talked} {...extra}
    />
  );

  // A keeper alone in a project has one thing to do next: invite.
  const open = peopleOpen ?? (project.is_keeper && project.members.length === 1);
  const people = project.members.map((m) => m.user);
  const count = plural(people.length, 'member', 'members');

  const talkedAbout = project.discussions ?? [];
  const boards = project.boards ?? [];
  const latest = [
    ...project.papers.map((p) => p.added_at), ...talkedAbout.map((d) => d.updated_at), ...boards.map((b) => b.updated_at),
  ].filter(Boolean).sort().at(-1);
  const newPapers = project.papers.filter((p) => p.is_new).length;
  const newTalk = talkedAbout.filter((d) => d.is_new).length;
  const since = [newPapers && plural(newPapers, 'paper', 'papers'), newTalk && plural(newTalk, 'conversation', 'conversations')].filter(Boolean);

  return (
    <div className={`project-page${project.is_member ? ' is-desk' : ''}`}>
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <header className="project-head">
        <div className="project-head-main">
          <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />
          {project.is_member && (
            <p className="project-tally">
              {[plural(project.papers.length, 'paper', 'papers'), plural(boards.length, 'board', 'boards'), latest && `active ${when(latest)}`].filter(Boolean).join(' · ')}
            </p>
          )}
          {since.length > 0 && <p className="project-since">New since you last looked: {since.join(' and ')}</p>}
        </div>
        {project.is_member ? (
          <button
            type="button" className="project-crowd" aria-expanded={open} aria-controls="project-people"
            onClick={() => setPeopleOpen(!open)}
          >
            <Faces users={people} />
            <span>{count}</span>
          </button>
        ) : (
          <p className="project-crowd"><Faces users={people} /><span>{count}</span></p>
        )}
      </header>
      {notice && <div className="error" role="alert">{notice}</div>}

      {!project.is_member ? (
        <p className="project-closed">Joining is by invitation. Ask {keeperNames(project.members)} for a link.</p>
      ) : (
        <>
          {open && <People project={project} currentUser={currentUser} act={act} onLeft={onLeft} />}
          <div className="project-desk">
          <div className="project-desk-main">
          <ProjectPapers
            project={project}
            pin={pin}
            currentUser={currentUser}
            onAddToNook={(paper) => act(async () => { await addToNook(paper.sha256); return getProject(project.uuid); })}
            onRemove={(paper) => act(() => removePaperFromProject(project.uuid, paper.sha256))}
            onThought={(paper, thought) => act(async () => {
              if (!paper.in_my_nook) await addToNook(paper.sha256);
              await updatePaper(paper.sha256, { thought, thought_public: true });
              return getProject(project.uuid);
            })}
          />
          <ProjectBoards project={project} act={act} pin={pin} />
          </div>
          <ProjectTalk project={project} currentUser={currentUser} onTalked={talked} />
          </div>
        </>
      )}
    </div>
  );
}

// Who is in it, the one invitation link for a keeper, and leaving.
function People({ project, currentUser, act, onLeft }) {
  const alone = project.members.length === 1;
  const leave = async () => {
    const ok = await confirmAction(
      alone ? `Leave ${project.name}? It ends when its last member leaves.` : `Leave ${project.name}?`,
      { confirmLabel: 'Leave', destructive: true },
    );
    if (ok && await act(() => removeMember(project.uuid, currentUser.uuid))) onLeft?.();
  };
  return (
    <section id="project-people" className="project-people" aria-label="Members">
      {project.is_keeper && <Invitation project={project} act={act} />}
      <ul className="project-people-list">
        {project.members.map((member) => {
          const me = member.user.uuid === currentUser?.uuid;
          return (
            <li key={member.user.uuid} className="project-person">
              <Avatar user={member.user} className="mini-avatar" />
              <a className="project-person-name" href={appPath(`/u/${member.user.uuid}`)}>
                {member.user.display_name}
              </a>
              {(me || member.is_keeper) && (
                <span className="project-person-role">{[me && 'you', member.is_keeper && 'Keeper'].filter(Boolean).join(' · ')}</span>
              )}
              {project.is_keeper && !me && (
                <span className="project-person-actions">
                  <button type="button" className="project-quiet" onClick={() => act(() => setKeeper(project.uuid, member.user.uuid, !member.is_keeper))}>
                    {member.is_keeper ? 'Not keeper' : 'Make keeper'}
                  </button>
                  <button type="button" className="project-quiet project-danger" onClick={() => act(async () => { await removeMember(project.uuid, member.user.uuid); return getProject(project.uuid); })}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="project-quiet project-danger project-leave" onClick={leave}>Leave project</button>
    </section>
  );
}

// The one invitation link a project has, for a keeper to hand out or stop.
function Invitation({ project, act }) {
  const [copied, setCopied] = useState(false);
  const linkFor = (code) => `${window.location.origin}${appPath(invitationPath(code))}`;
  const link = project.invite_code ? linkFor(project.invite_code) : null;
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* the link can be selected by hand */ }
  };
  if (!link) {
    return (
      <div className="project-invite">
        <span className="project-invite-note">Invite with a link.</span>
        <button
          type="button" className="primary"
          onClick={() => act(async () => {
            await openInvitation(project.uuid);
            const next = await getProject(project.uuid);
            if (next.invite_code) copy(linkFor(next.invite_code));
            return next;
          })}
        >
          Create link
        </button>
      </div>
    );
  }
  return (
    <div className="project-invite">
      <code className="project-invite-link" title={link} tabIndex={0}>{link}</code>
      <button type="button" onClick={() => copy(link)}>{copied ? 'Copied' : 'Copy link'}</button>
      <button type="button" className="project-quiet" onClick={() => act(async () => { setCopied(false); await revokeInvitation(project.uuid); return getProject(project.uuid); })}>
        Stop link
      </button>
      <span className="project-invite-note">Anyone with the link can join.</span>
    </div>
  );
}

// A section heading: a serif word, a faint count, and at most one action.
function SectionHead({ id, title, count, action }) {
  return (
    <header className="project-section-head">
      <h3 id={id}>{title}</h3>
      {count > 0 && <span className="project-count">{count}</span>}
      {action}
    </header>
  );
}

// Each paper is a title and its citation. Who has it shows as faces; what
// they think, and how they rated it, opens when the paper is selected, with
// room for your own thought and the way into its discussion.
function ProjectPapers({ project, currentUser, pin, onAddToNook, onRemove, onThought }) {
  const [selected, setSelected] = useState(null);
  const [writing, setWriting] = useState(null);
  useEffect(() => {
    if (!selected) return undefined;
    const away = (e) => { if (!e.target.closest?.('.project-paper')) { setSelected(null); setWriting(null); } };
    const escape = (e) => { if (e.key === 'Escape') { setSelected(null); setWriting(null); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [selected]);

  const nameOf = (user) => (user.uuid === currentUser?.uuid ? 'You' : user.display_name);
  const write = (sha256) => { setSelected(sha256); setWriting(sha256); };

  return (
    <section className="project-section" aria-labelledby="project-papers-heading">
      <SectionHead id="project-papers-heading" title="Papers" count={project.papers.length} />
      {!project.papers.length ? (
        <p className="project-empty">No papers yet. Open a paper and choose <b>Add to project</b>.</p>
      ) : (
        <ul className="project-papers project-grid">
          {project.papers.map((paper) => {
            const mine = paper.added_by.uuid === currentUser?.uuid;
            const takes = paper.users.filter((u) => u.thought || TAKE_RATINGS.some((d) => u[d.key]));
            const thoughts = paper.users.filter((u) => u.thought).length;
            const myTake = paper.users.find((u) => u.user.uuid === currentUser?.uuid);
            const isSelected = selected === paper.sha256;
            const quoted = takes.find((u) => u.thought && u.user.uuid !== currentUser?.uuid) ?? takes.find((u) => u.thought);
            const actions = [
              { key: 'thought', label: myTake?.thought ? 'Edit your thought' : 'Add your thought', tone: 'accent', icon: <ActionGlyph name="edit" />, onSelect: () => write(paper.sha256) },
              !paper.in_my_nook && { key: 'nook', label: 'Add to my nook', icon: <ActionGlyph name="add" />, onSelect: () => onAddToNook(paper) },
              (project.is_keeper || mine) && { key: 'out', label: 'Take out', danger: true, icon: <ActionGlyph name="take-out" />, onSelect: () => { setSelected(null); onRemove(paper); } },
            ].filter(Boolean);
            return (
              <li
                key={paper.sha256}
                className={`project-card project-paper talk-host${isSelected ? ' is-selected' : ''}${paper.is_new ? ' is-new' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input, textarea')) setSelected(paper.sha256); }}
                onFocus={(e) => { if (!e.target.closest('.talk-pin-wrap')) setSelected(paper.sha256); }}
              >
                <header className="project-card-head">
                  <span className="project-card-kind">Paper{paper.year ? ` · ${paper.year}` : ''}</span>
                  {paper.is_new
                    ? <span className="project-card-new">New</span>
                    : paper.journal && <span className="project-card-venue">{paper.journal}</span>}
                </header>
                <div className="project-card-body">
                  <h4 className="project-card-title">
                    <a className="paper-title-link" href={appPath(`/paper/${paperName(paper.sha256)}`)}>{paper.title}</a>
                  </h4>
                  <p className="project-card-authors">{formatAuthors(paper.authors)}</p>
                  {!isSelected && quoted && (
                    <blockquote className="project-card-quote">
                      “{quoted.thought}”<cite>{nameOf(quoted.user)}</cite>
                    </blockquote>
                  )}
                </div>

                {isSelected && (
                  <div className="project-paper-more">
                    {takes.length > 0 && (
                      <ul className="project-takes">
                        {takes.map((entry) => {
                          const me = entry.user.uuid === currentUser?.uuid;
                          if (me && writing === paper.sha256) return null;
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
                                {pin(`take:${paper.sha256}:${entry.user.uuid}`, entry.thought ? `“${entry.thought}”` : `${nameOf(entry.user)}’s take on ${paper.title}`, { size: 'sm' })}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {(!myTake?.thought || writing === paper.sha256) && (
                      <ThoughtComposer
                        key={paper.sha256}
                        paper={paper}
                        currentUser={currentUser}
                        initial={myTake?.thought ?? ''}
                        autoFocus={writing === paper.sha256}
                        onCancel={myTake?.thought ? () => setWriting(null) : null}
                        onSave={async (thought) => { const ok = await onThought(paper, thought); if (ok) setWriting(null); return ok; }}
                      />
                    )}
                    <p className="project-paper-added">
                      Added by {mine ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}
                    </p>
                  </div>
                )}

                <footer className="project-card-foot">
                  {paper.users.length > 0 ? (
                    <button
                      type="button" className="project-takes-toggle" aria-expanded={isSelected}
                      aria-label={`${paper.users.map((u) => nameOf(u.user)).join(', ')}${thoughts ? `; ${plural(thoughts, 'thought', 'thoughts')}` : ''}. Show takes`}
                      onClick={() => setSelected(isSelected ? null : paper.sha256)}
                    >
                      <Faces users={paper.users.map((u) => u.user)} max={3} />
                      <span>{thoughts ? plural(thoughts, 'thought', 'thoughts') : 'No thoughts yet'}</span>
                    </button>
                  ) : <span />}
                  {pin(`paper:${paper.sha256}`, paper.title)}
                </footer>
                {isSelected && <ItemActions actions={actions} label={`${paper.title}: actions`} placement="below-start" />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
        placeholder="Your thought on this paper, in a line"
        onChange={(e) => { touched.current = true; setDraft(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); } }}
      />
      {onCancel && <button type="button" className="project-quiet" onClick={onCancel}>Cancel</button>}
      <button type="submit" className="primary" disabled={!draft.trim() || busy}>{busy ? 'Saving…' : 'Share'}</button>
      <p className="project-thought-note">
        Everyone in the project sees it.{!paper.in_my_nook && ' Sharing adds the paper to your nook.'}
      </p>
    </form>
  );
}

// Everything being talked about, latest first, beside the desk. Each is a
// card that opens its talk right there; the first line starts talk about
// the project as a whole.
const SUBJECT_WORDS = { project: 'Project', paper: 'Paper', take: 'Thought', board: 'Board', card: 'Card' };

function ProjectTalk({ project, currentUser, onTalked }) {
  const discussions = project.discussions ?? [];
  const opener = (subject, label) => ({ projectUuid: project.uuid, subject, label, currentUser, onChanged: onTalked });
  const general = discussions.some((d) => d.subject.key === 'project');
  return (
    <aside className="project-talk" aria-labelledby="project-talk-heading">
      <SectionHead id="project-talk-heading" title="Talk" count={discussions.length} />
      {!general && (
        <TalkOpener {...opener('project', project.name)} className="project-talk-start">
          <TalkMark />Anything on your mind for the project?
        </TalkOpener>
      )}
      {!discussions.length ? (
        <p className="project-empty project-talk-hint">
          Every paper, thought, board and card has a talk pin <TalkMark />. Press one to start.
        </p>
      ) : (
        <ul className="project-talk-list">
          {discussions.map((d) => {
            const last = d.last_post;
            const kind = d.subject.kind;
            return (
              <li key={d.uuid}>
                <TalkOpener {...opener(d.subject.key, d.subject.label)} className={`project-talk-card${d.is_new ? ' is-new' : ''}`}>
                  <span className="project-talk-subject">
                    <span className="project-card-kind">{SUBJECT_WORDS[kind]}</span>
                    {kind !== 'project' && <span className="project-talk-label">{d.subject.label}</span>}
                  </span>
                  {last && <span className="project-talk-excerpt">{last.excerpt}</span>}
                  <span className="project-talk-meta">
                    {last && <Avatar user={last.user} className="mini-avatar" />}
                    {last && <b>{last.user.uuid === currentUser?.uuid ? 'You' : last.user.display_name}</b>}
                    <span>{when(d.updated_at)}</span>
                    {d.post_count > 1 && <span>· {plural(d.post_count, 'post', 'posts')}</span>}
                    {d.is_new && <span className="project-card-new">New</span>}
                  </span>
                </TalkOpener>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

// The talk pin as a picture, for saying where to press.
function TalkMark() {
  return (
    <svg className="project-talk-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8.6L6 21.4V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

// The project's boards, which every member arranges; one more is a name away.
function ProjectBoards({ project, act, pin }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const boards = project.boards ?? [];
  const stop = () => { setNaming(false); setName(''); };
  const create = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    const board = await act(() => createProjectBoard(project.uuid, next));
    setBusy(false);
    if (board) window.location.assign(appPath(`/boards/${board.uuid}`));
  };
  return (
    <section className="project-section" aria-labelledby="project-boards-heading">
      <SectionHead id="project-boards-heading" title="Boards" count={boards.length} />
      <ul className="project-boards project-grid">
        {boards.map((board) => (
          <li key={board.uuid} className="project-card project-board talk-host">
            <header className="project-card-head">
              <span className="project-card-kind">Board</span>
              {pin(`board:${board.uuid}`, board.name)}
            </header>
            <a className="project-card-body project-board-link" href={appPath(`/boards/${board.uuid}`)}>
              <strong className="project-card-title">{board.name}</strong>
              {board.description && <span className="project-board-description">{board.description}</span>}
              <span className="project-board-meta">{plural(board.item_count ?? 0, 'card', 'cards')} · {day(board.updated_at)}</span>
            </a>
          </li>
        ))}
        <li className="project-board-new">
          {naming ? (
            <form className="project-board-form" onSubmit={create}>
              <input
                autoFocus value={name} maxLength={200} placeholder="Board name" aria-label="Board name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') stop(); }}
              />
              <span className="project-board-form-actions">
                <button type="button" className="project-quiet" onClick={stop}>Cancel</button>
                <button type="submit" className="primary" disabled={!name.trim() || busy}>{busy ? 'Making…' : 'Make board'}</button>
              </span>
            </form>
          ) : (
            <button type="button" className="project-board-add" onClick={() => setNaming(true)}>
              <ActionGlyph name="plus" />New board
              {!boards.length && <span>Lay out papers, notes and figures for everyone here to arrange.</span>}
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}

// The name, which a keeper renames in place: kept when left, taken back
// with Escape. There is no Save.
function ProjectTitle({ project, onRename }) {
  const [name, setName] = useState(project.name);
  const reverting = useRef(false);
  useEffect(() => setName(project.name), [project.name]);
  if (!project.is_keeper) return <h2 className="project-title">{project.name}</h2>;
  const keep = async () => {
    if (reverting.current) { reverting.current = false; return; }
    const next = name.trim();
    if (!next || next === project.name) { setName(project.name); return; }
    if (!(await onRename(next))) setName(project.name);
  };
  return (
    <h2 className="project-title">
      <input
        className="project-title-input" value={name} maxLength={80} aria-label="Project name" title="Rename"
        onChange={(e) => setName(e.target.value)}
        onBlur={keep}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { reverting.current = true; setName(project.name); e.currentTarget.blur(); }
        }}
      />
    </h2>
  );
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
