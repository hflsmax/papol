import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { createProject, listProjects } from '../../../shared/api/projects.js';
import { appPath } from '../base';
import ProjectMembers, { keeperNames } from './ProjectMembers';
import { forgetArrivals } from './ProjectPage';

// Every project: mine first, where the work is, then everyone else's by
// name and members, so anyone can see who to ask to be let in.
export default function ProjectsPage({ currentUser, onOpenProject, onChanged }) {
  const [projects, setProjects] = useState(null);
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

  if (!projects && !error) return <div className="loading"><Working label="Loading projects…" /></div>;
  const mine = (projects || []).filter((p) => p.is_member);
  const others = (projects || []).filter((p) => !p.is_member);

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h2>Projects</h2>
        {!naming && (
          <button type="button" className="primary" onClick={() => setNaming(true)}>New project</button>
        )}
      </div>
      {naming && (
        <form className="project-name-form" onSubmit={create}>
          <input
            autoFocus
            value={name}
            maxLength={80}
            placeholder="What is the project about?"
            aria-label="Project name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }}
          />
          <button type="submit" className="primary" disabled={busy || !name.trim()}>Create</button>
          <button type="button" onClick={() => setNaming(false)}>Cancel</button>
        </form>
      )}
      {error && <div className="error" role="alert">{error}</div>}

      {mine.length > 0 ? (
        <ul className="project-list">
          {mine.map((project) => (
            <li key={project.uuid} className="project-row">
              <a className="project-row-name" href={appPath(`/project/${project.uuid}`)}>{project.name}</a>
              {project.new_count > 0 && <span className="badge project-new">{project.new_count} new</span>}
              <ProjectMembers members={project.members} currentUser={currentUser} />
            </li>
          ))}
        </ul>
      ) : (
        !naming && <p className="panel-note">A project gathers the papers and thinking for one question. Start one alone and invite others when you like.</p>
      )}

      {others.length > 0 && (
        <>
          <h3 className="projects-subhead">Other projects</h3>
          <ul className="project-list">
            {others.map((project) => (
              <li key={project.uuid} className="project-row closed">
                <a className="project-row-name" href={appPath(`/project/${project.uuid}`)}>{project.name}</a>
                <span className="project-row-note">By invitation · ask {keeperNames(project.members)}</span>
                <ProjectMembers members={project.members} currentUser={currentUser} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
