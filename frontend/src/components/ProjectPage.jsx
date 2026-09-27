import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ItemActions from '../../../shared/ui/ItemActions.jsx';
import ActionGlyph from '../../../shared/ui/ActionGlyph.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import {
  getProject, invitationPath, openInvitation, removeMember, removePaperFromProject, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { addToNook } from '../../../shared/api/papers.js';
import { paperName } from '../../../shared/paperName.js';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import { RATING_DIMENSIONS, RatingDots } from './Rating';
import ProjectMembers, { keeperNames } from './ProjectMembers';

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

// One project. Its members see its papers, each with who added it and
// every member's take on it; anyone else sees who is in it, and whom to
// ask to be let in.
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

  return (
    <div className="project-page">
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <header className="project-head">
        <div className="project-head-main">
          <p className="kicker">Project</p>
          <ProjectTitle project={project} onRename={(name) => act(() => renameProject(project.uuid, name))} />
        </div>
        <div className="project-head-people">
          <ProjectMembers members={project.members} currentUser={currentUser} />
          {project.is_member && (
            <button type="button" className="project-quiet project-people-toggle" aria-expanded={open} aria-controls="project-people" onClick={() => setPeopleOpen(!open)}>
              Members
            </button>
          )}
        </div>
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
        </>
      )}
    </div>
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
              <span className="project-person-name">{member.user.display_name}{me && ' (you)'}</span>
              {member.is_keeper && <span className="project-person-role">Keeper</span>}
              {project.is_keeper && !me && (
                <span className="project-person-actions">
                  <button type="button" onClick={() => act(() => setKeeper(project.uuid, member.user.uuid, !member.is_keeper))}>
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
      <div className="project-people-foot">
        <button type="button" className="project-quiet project-danger" onClick={leave}>Leave project</button>
      </div>
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
        <span className="project-invite-note">Invite people with a link.</span>
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
      <span className="project-invite-note">Anyone with the link can join.</span>
      <code className="project-invite-link" title={link} tabIndex={0}>{link}</code>
      <button type="button" onClick={() => copy(link)}>{copied ? 'Copied' : 'Copy link'}</button>
      <button type="button" className="project-quiet" onClick={() => act(async () => { setCopied(false); await revokeInvitation(project.uuid); return getProject(project.uuid); })}>
        Stop link
      </button>
    </div>
  );
}

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

  const rated = project.papers.some((p) => p.users.some((u) => TAKE_RATINGS.some((d) => u[d.key])));
  return (
    <section className="project-section" aria-labelledby="project-papers-heading">
      <header className="project-section-head">
        <h3 id="project-papers-heading">Papers</h3>
        {project.papers.length > 0 && <span className="project-count">{project.papers.length}</span>}
        {rated && (
          <span className="project-rating-legend" aria-hidden="true">
            {TAKE_RATINGS.map((d) => <span key={d.key} title={d.hint}>{d.label}</span>)}
          </span>
        )}
      </header>
      {!project.papers.length ? (
        <p className="project-empty">No papers yet. Open a paper and choose <b>Add to project</b>.</p>
      ) : (
        <ul className="project-papers">
          {project.papers.map((paper) => {
            const mine = paper.added_by.uuid === currentUser?.uuid;
            const actions = [
              !paper.in_my_nook && { key: 'nook', label: 'Add to my nook', tone: 'accent', icon: <ActionGlyph name="add" />, onSelect: () => onAddToNook(paper) },
              (project.is_keeper || mine) && { key: 'out', label: 'Take out', danger: true, icon: <ActionGlyph name="take-out" />, onSelect: () => { setSelected(null); onRemove(paper); } },
            ].filter(Boolean);
            const isSelected = selected === paper.sha256;
            return (
              <li
                key={paper.sha256}
                className={`project-paper${isSelected ? ' is-selected' : ''}`}
                onClick={(e) => { if (!e.target.closest('a, button, input')) setSelected(paper.sha256); }}
                onFocus={() => setSelected(paper.sha256)}
              >
                <div className="project-paper-head">
                  <h4><a className="paper-title-link" href={appPath(`/paper/${paperName(paper.sha256)}`)}>{paper.title}</a></h4>
                  {paper.is_new && <span className="badge project-paper-new">New</span>}
                  {isSelected && actions.length > 0 && <ItemActions actions={actions} label={`${paper.title}: actions`} placement="below-end" />}
                </div>
                <p className="paper-meta">
                  {formatAuthors(paper.authors)}{paper.year && ` (${paper.year})`}{paper.journal && ` · ${paper.journal}`}
                </p>
                {paper.users.length > 0 && (
                  <ul className="project-takes">
                    {paper.users.map((entry) => (
                      <li key={entry.user.uuid} className="project-take">
                        <Avatar user={entry.user} className="mini-avatar" />
                        <span className="project-take-name">{entry.user.uuid === currentUser?.uuid ? 'You' : entry.user.display_name}</span>
                        <span className="project-take-thought">{entry.thought && `“${entry.thought}”`}</span>
                        {TAKE_RATINGS.map((d) => (entry[d.key] ? (
                          <span key={d.key} className="project-take-rating" role="img" aria-label={`${d.label}: ${entry[d.key]} of 5`} title={d.label}>
                            <RatingDots value={entry[d.key]} />
                          </span>
                        ) : <span key={d.key} className="project-take-rating is-empty" aria-hidden="true">–</span>))}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="project-paper-added">Added by {mine ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
