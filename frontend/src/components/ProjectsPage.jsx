import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { createProject, listProjects } from '../../../shared/api/projects.js';
import { appPath } from '../base';
import ProjectMembers from './ProjectMembers';
import { forgetArrivals } from './ProjectPage';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import { keep, kept } from '../lastMember';

const SHOWN = 5;

// Keepers first, and never more faces than the row can hold.
function Crowd({ members, currentUser }) {
  const ordered = [...members].sort((a, b) => Number(b.is_keeper) - Number(a.is_keeper));
  const cut = ordered.length > SHOWN ? SHOWN - 1 : ordered.length;
  return (
    <div className="projects-crowd">
      <ProjectMembers members={ordered.slice(0, cut)} currentUser={currentUser} />
      {ordered.length > cut && <span className="projects-more">+{ordered.length - cut}</span>}
    </div>
  );
}

// Every project: mine first, where the work is, then everyone else's by
// name and keepers, so anyone can see who to ask to be let in. On the web
// it is a section of the Bazaar, beside everyone's papers and boards.
export default function ProjectsPage({ currentUser, onOpenProject, onChanged, section = false }) {
  const Title = section ? 'h3' : 'h2';
  const [projects, setProjects] = useState(() => kept('projects'));
  const [error, setError] = useState(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    forgetArrivals();
    listProjects()
      .then((list) => { if (active) setProjects(list); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (projects) keep('projects', projects);
  }, [projects]);

  const create = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(name.trim());
      onChanged?.();
      onOpenProject(project.uuid);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const stopNaming = () => { setNaming(false); setName(''); };
  const mine = (projects || []).filter((p) => p.is_member);
  const others = (projects || []).filter((p) => !p.is_member);

  return (
    <div className={section ? 'projects-page is-section' : 'projects-page'}>
      <div className="projects-head">
        <Title>Projects</Title>
        <ExperimentalBadge />
        {projects && !naming && (
          <button type="button" onClick={() => setNaming(true)}>New project</button>
        )}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!projects && !error && <div className="loading"><Working label="Loading projects…" /></div>}

      {projects && (
        <>
          {others.length > 0 && <p className="kicker projects-kicker">My projects</p>}
          <div className="panel projects-panel">
            {naming && (
              <form className="projects-create" onSubmit={create}>
                <input
                  autoFocus
                  value={name}
                  maxLength={80}
                  placeholder="Project name"
                  aria-label="Project name"
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') stopNaming(); }}
                />
                <button type="submit" className="primary" disabled={busy || !name.trim()}>Create</button>
                <button type="button" onClick={stopNaming}>Cancel</button>
              </form>
            )}
            {mine.length > 0 ? (
              <ul className="projects-list">
                {mine.map((project) => (
                  <li key={project.uuid} className="projects-row">
                    <div className="projects-row-text">
                      <a className="projects-row-name" href={appPath(`/project/${project.uuid}`)}>{project.name}</a>
                      {project.new_count > 0 && <span className="badge project-new">{project.new_count} new</span>}
                    </div>
                    <Crowd members={project.members} currentUser={currentUser} />
                  </li>
                ))}
              </ul>
            ) : (
              !naming && (
                <p className="projects-empty">
                  A project gathers papers and thinking for one question. Start one alone; invite others when you like.
                </p>
              )
            )}
          </div>

          {others.length > 0 && (
            <>
              <p className="kicker projects-kicker">Other projects</p>
              <div className="panel projects-panel">
                <ul className="projects-list">
                  {others.map((project) => (
                    <li key={project.uuid} className="projects-row closed">
                      <div className="projects-row-text">
                        <span className="projects-row-name">{project.name}</span>
                        <span className="projects-row-note">Ask for an invitation to join</span>
                      </div>
                      <Crowd members={project.members} currentUser={currentUser} />
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
