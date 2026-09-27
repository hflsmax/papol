import React, { useCallback, useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import {
  getProject, invitationPath, openInvitation, removeMember, removePaperFromProject, renameProject,
  revokeInvitation, setKeeper,
} from '../../../shared/api/projects.js';
import { addToNook } from '../../../shared/api/papers.js';
import { paperName } from '../../../shared/paperName.js';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat.js';
import Avatar from './Avatar';
import { RatingSummary } from './Rating';
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

function day(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// One project. Its members see its papers, each with who added it and
// every member's take on it; anyone else sees who is in it, and whom to
// ask to be let in.
export default function ProjectPage({ projectUuid, currentUser, onBack, backHref, onChanged, onLeft }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
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

  return (
    <div className="project-page">
      <BackLink className="back-button" href={backHref} onBack={onBack} />
      <ProjectHeader project={project} currentUser={currentUser} onRename={(name) => act(() => renameProject(project.uuid, name))} />
      {notice && <div className="error" role="alert">{notice}</div>}

      {!project.is_member ? (
        <p className="panel-note project-closed-note">
          Joining is by invitation. Ask {keeperNames(project.members)} for a link.
        </p>
      ) : (
        <>
          {project.is_keeper && <Invitation project={project} act={act} />}
          <ProjectPapers
            project={project}
            onAddToNook={(paper) => act(async () => { await addToNook(paper.sha256); return getProject(project.uuid); })}
            onRemove={(paper) => act(() => removePaperFromProject(project.uuid, paper.sha256))}
            currentUser={currentUser}
          />
          <Membership
            project={project}
            currentUser={currentUser}
            act={act}
            onLeft={onLeft}
          />
        </>
      )}
    </div>
  );
}

function ProjectHeader({ project, currentUser, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  if (renaming) {
    return (
      <form
        className="project-name-form"
        onSubmit={async (e) => { e.preventDefault(); if (name.trim() && await onRename(name.trim())) setRenaming(false); }}
      >
        <input autoFocus value={name} maxLength={80} aria-label="Project name" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="primary" disabled={!name.trim()}>Save</button>
        <button type="button" onClick={() => { setName(project.name); setRenaming(false); }}>Cancel</button>
      </form>
    );
  }
  return (
    <div className="projects-header project-header">
      <h2>
        {project.name}
        {project.is_keeper && (
          <button type="button" className="link-button project-rename" onClick={() => setRenaming(true)}>Rename</button>
        )}
      </h2>
      <ProjectMembers members={project.members} currentUser={currentUser} />
    </div>
  );
}

// The one invitation link a project has, for a keeper to hand out or stop.
function Invitation({ project, act }) {
  const [copied, setCopied] = useState(false);
  const link = project.invite_code ? `${window.location.origin}${appPath(invitationPath(project.invite_code))}` : null;
  if (!link) {
    return (
      <div className="project-invite">
        <button type="button" onClick={() => act(async () => { await openInvitation(project.uuid); return getProject(project.uuid); })}>
          Invite
        </button>
      </div>
    );
  }
  return (
    <div className="project-invite">
      <input readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* the field can be copied by hand */ }
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <button type="button" className="link-button" onClick={() => act(async () => { await revokeInvitation(project.uuid); return getProject(project.uuid); })}>
        Stop link
      </button>
    </div>
  );
}

function ProjectPapers({ project, currentUser, onAddToNook, onRemove }) {
  if (!project.papers.length) {
    return <p className="panel-note">No papers yet. Add one from its page with Add to project.</p>;
  }
  return (
    <ul className="project-papers">
      {project.papers.map((paper) => (
        <li key={paper.sha256} className={paper.is_new ? 'project-paper is-new' : 'project-paper'}>
          <div className="project-paper-head">
            <a className="paper-title-link" href={appPath(`/paper/${paperName(paper.sha256)}`)}>{paper.title}</a>
            {paper.is_new && <span className="badge project-new">new</span>}
          </div>
          <p className="paper-meta">
            {formatAuthors(paper.authors)}
            {paper.year && ` (${paper.year})`}
          </p>
          <p className="project-paper-added">
            Added by {paper.added_by.uuid === currentUser?.uuid ? 'you' : paper.added_by.display_name} · {day(paper.added_at)}
            {!paper.in_my_nook && (
              <button type="button" className="link-button" onClick={() => onAddToNook(paper)}>Add to my nook</button>
            )}
            {(project.is_keeper || paper.added_by.uuid === currentUser?.uuid) && (
              <button type="button" className="link-button" onClick={() => onRemove(paper)}>Take out</button>
            )}
          </p>
          {paper.users.length > 0 && (
            <ul className="project-takes">
              {paper.users.map((entry) => (
                <li key={entry.user.uuid} className="project-take">
                  <Avatar user={entry.user} className="mini-avatar" />
                  <span className="project-take-name">{entry.user.uuid === currentUser?.uuid ? 'You' : entry.user.display_name}</span>
                  {entry.thought ? <span className="project-take-thought">“{entry.thought}”</span> : <span className="project-take-none">no thought yet</span>}
                  <RatingSummary paper={entry} compact />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

// Who is in it, and for a keeper, who else keeps it. Leaving is always here.
function Membership({ project, currentUser, act, onLeft }) {
  const others = project.members.filter((m) => m.user.uuid !== currentUser?.uuid);
  return (
    <details className="project-membership">
      <summary>Members</summary>
      <ul>
        {others.map((member) => (
          <li key={member.user.uuid}>
            <Avatar user={member.user} className="mini-avatar" />
            <span>{member.user.display_name}{member.is_keeper ? ' · keeper' : ''}</span>
            {project.is_keeper && (
              <>
                <button type="button" className="link-button" onClick={() => act(() => setKeeper(project.uuid, member.user.uuid, !member.is_keeper))}>
                  {member.is_keeper ? 'Not a keeper' : 'Make keeper'}
                </button>
                <button type="button" className="link-button" onClick={() => act(async () => { await removeMember(project.uuid, member.user.uuid); return getProject(project.uuid); })}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="link-button danger"
        onClick={async () => {
          if (!window.confirm(others.length ? `Leave ${project.name}?` : `Leave ${project.name}? It ends when its last member leaves.`)) return;
          const left = await act(() => removeMember(project.uuid, currentUser.uuid));
          if (left) onLeft?.();
        }}
      >
        Leave project
      </button>
    </details>
  );
}
