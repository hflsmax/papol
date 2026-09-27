import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ItemActions from '../../../shared/ui/ItemActions.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  createProjectBoard, discussPath, getProject, invitationPath, openInvitation, removeMember, removePaperFromProject, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { addToNook } from '../../../shared/api/papers.js';
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

// A small accent dot for what is new since the last visit.
function NewDot() {
  return <span className="project-new-dot"><span className="visually-hidden">New</span></span>;
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

  // A keeper alone in a project has one thing to do next: invite.
  const open = peopleOpen ?? (project.is_keeper && project.members.length === 1);
  const people = project.members.map((m) => m.user);
  const count = plural(people.length, 'member', 'members');

  return (
    <div className="project-page">
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <header className="project-head">
        <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />
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
          <ProjectPapers
            project={project}
            currentUser={currentUser}
            onAddToNook={(paper) => act(async () => { await addToNook(paper.sha256); return getProject(project.uuid); })}
            onRemove={(paper) => act(() => removePaperFromProject(project.uuid, paper.sha256))}
          />
          <ProjectDiscussions project={project} currentUser={currentUser} />
          <ProjectBoards project={project} act={act} />
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
// they think, and how they rated it, opens when the paper is selected.
function ProjectPapers({ project, currentUser, onAddToNook, onRemove }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (!selected) return undefined;
    const away = (e) => { if (!e.target.closest?.('.project-paper')) setSelected(null); };
    const escape = (e) => { if (e.key === 'Escape') setSelected(null); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [selected]);

  const discussionOf = new Map((project.discussions ?? [])
    .filter((d) => d.subject.kind === 'paper').map((d) => [d.subject.paper_sha256, d]));
  const nameOf = (user) => (user.uuid === currentUser?.uuid ? 'You' : user.display_name);

  return (
    <section className="project-section" aria-labelledby="project-papers-heading">
      <SectionHead id="project-papers-heading" title="Papers" count={project.papers.length} />
      {!project.papers.length ? (
        <p className="project-empty">No papers yet. Open a paper and choose <b>Add to project</b>.</p>
      ) : (
        <ul className="project-papers">
          {project.papers.map((paper) => {
            const mine = paper.added_by.uuid === currentUser?.uuid;
            const discussion = discussionOf.get(paper.sha256);
            const takes = paper.users.filter((u) => u.thought || TAKE_RATINGS.some((d) => u[d.key]));
            const thoughts = paper.users.filter((u) => u.thought).length;
            const isSelected = selected === paper.sha256;
            const actions = [
              { key: 'discuss', label: discussion ? 'Open discussion' : 'Discuss', icon: <ActionGlyph name="discuss" />, onSelect: () => window.location.assign(appPath(discussion ? `/discussion/${discussion.uuid}` : discussPath(project.uuid, { paper: paper.sha256 }))) },
              !paper.in_my_nook && { key: 'nook', label: 'Add to my nook', tone: 'accent', icon: <ActionGlyph name="add" />, onSelect: () => onAddToNook(paper) },
              (project.is_keeper || mine) && { key: 'out', label: 'Take out', danger: true, icon: <ActionGlyph name="take-out" />, onSelect: () => { setSelected(null); onRemove(paper); } },
            ].filter(Boolean);
            return (
              <li
                key={paper.sha256}
                className={`project-paper${isSelected ? ' is-selected' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input')) setSelected(paper.sha256); }}
                onFocus={() => setSelected(paper.sha256)}
              >
                <div className="project-paper-main">
                  <h4>
                    {paper.is_new && <NewDot />}
                    <a className="paper-title-link" href={appPath(`/paper/${paperName(paper.sha256)}`)}>{paper.title}</a>
                  </h4>
                  <p className="paper-meta">
                    {formatAuthors(paper.authors)}{paper.year && ` (${paper.year})`}{paper.journal && ` · ${paper.journal}`}
                  </p>
                </div>

                {isSelected ? (
                  actions.length > 0 && <ItemActions actions={actions} label={`${paper.title}: actions`} placement="below-end" />
                ) : (
                  <div className="project-paper-summary">
                    {discussion && (
                      <a
                        className={`project-discussion-mark${discussion.is_new ? ' is-new' : ''}`}
                        href={appPath(`/discussion/${discussion.uuid}`)}
                        aria-label={`Discussion, ${plural(discussion.post_count, 'post', 'posts')}${discussion.is_new ? ', new' : ''}`}
                      >
                        <ActionGlyph name="discuss" />{discussion.post_count}
                      </a>
                    )}
                    {paper.users.length > 0 && (
                      <button
                        type="button" className="project-takes-toggle" aria-expanded={false}
                        aria-label={`${paper.users.map((u) => nameOf(u.user)).join(', ')}${thoughts ? `; ${plural(thoughts, 'thought', 'thoughts')}` : ''}. Show takes`}
                        onClick={() => setSelected(paper.sha256)}
                      >
                        <Faces users={paper.users.map((u) => u.user)} max={3} />
                        {thoughts > 0 && <span>{plural(thoughts, 'thought', 'thoughts')}</span>}
                      </button>
                    )}
                  </div>
                )}

                {isSelected && (
                  <div className="project-paper-more">
                    {takes.length > 0 && (
                      <ul className="project-takes">
                        {takes.map((entry) => (
                          <li key={entry.user.uuid} className="project-take">
                            <Avatar user={entry.user} className="mini-avatar" />
                            <p className="project-take-who">
                              <b>{nameOf(entry.user)}</b>
                              {TAKE_RATINGS.filter((d) => entry[d.key]).map((d) => (
                                <span key={d.key} title={d.hint}>{d.label} {entry[d.key]}/5</span>
                              ))}
                            </p>
                            {entry.thought && <p className="project-take-thought">“{entry.thought}”</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="project-paper-added">
                      Added by {mine ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}
                      {discussion && (
                        <> · <a href={appPath(`/discussion/${discussion.uuid}`)}>{plural(discussion.post_count, 'post', 'posts')}</a></>
                      )}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The latest few discussions, each with one line of its newest post; the
// rest are a click away.
const DISCUSSIONS_SHOWN = 3;

function ProjectDiscussions({ project, currentUser }) {
  const [all, setAll] = useState(false);
  const discussions = project.discussions ?? [];
  const shown = all ? discussions : discussions.slice(0, DISCUSSIONS_SHOWN);
  return (
    <section className="project-section" aria-labelledby="project-discussions-heading">
      <SectionHead id="project-discussions-heading" title="Discussions" count={discussions.length} />
      {!discussions.length ? (
        <p className="project-empty">No discussions yet. Select a paper or a board card and choose <b>Discuss</b>.</p>
      ) : (
        <>
          <ul className="project-discussions">
            {shown.map((d) => {
              const last = d.last_post;
              return (
                <li key={d.uuid}>
                  <a className="project-discussion" href={appPath(`/discussion/${d.uuid}`)}>
                    <strong className="project-discussion-subject">{d.is_new && <NewDot />}{d.subject.label}</strong>
                    {last && (
                      <span className="project-discussion-excerpt">
                        <b>{last.user.uuid === currentUser?.uuid ? 'You' : last.user.display_name}</b> {last.excerpt}
                      </span>
                    )}
                    <span className="project-discussion-meta">
                      {d.subject.kind !== 'paper' && `On ${d.subject.board_name} · `}
                      {plural(d.post_count, 'post', 'posts')} · {day(d.updated_at)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {discussions.length > DISCUSSIONS_SHOWN && (
            <button type="button" className="project-quiet project-more" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${discussions.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// The project's boards, which every member arranges; one more is a name away.
function ProjectBoards({ project, act }) {
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
      <SectionHead
        id="project-boards-heading" title="Boards" count={boards.length}
        action={!naming && <button type="button" className="project-quiet project-section-action" onClick={() => setNaming(true)}>New board</button>}
      />
      {naming && (
        <form className="project-board-form" onSubmit={create}>
          <input
            autoFocus value={name} maxLength={200} placeholder="Board name" aria-label="Board name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') stop(); }}
          />
          <button type="submit" className="primary" disabled={!name.trim() || busy}>{busy ? 'Making…' : 'Make board'}</button>
          <button type="button" className="project-quiet" onClick={stop}>Cancel</button>
        </form>
      )}
      {!boards.length ? (
        !naming && <p className="project-empty">No boards yet. A board lays out papers, notes and figures for everyone here.</p>
      ) : (
        <ul className="project-boards">
          {boards.map((board) => (
            <li key={board.uuid}>
              <a className="project-board" href={appPath(`/boards/${board.uuid}`)}>
                <strong className="project-board-name">{board.name}</strong>
                <span className="project-board-meta">{plural(board.item_count ?? 0, 'card', 'cards')} · {day(board.updated_at)}</span>
                {board.description && <span className="project-board-description">{board.description}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
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
