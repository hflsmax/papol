import React, { useRef, useState } from 'react';
import { useDismiss } from '../../../shared/useDismiss.js';
import { addPaperToProject, listProjects } from '../../../shared/api/projects.js';
import { updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath } from '../base';

// Adding this paper to one of my projects. When I have not said why the
// paper matters yet, the menu asks once, in a line, since that is what the
// other members will read beside it.
export default function ProjectPicker({ paper, onThought }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const ref = useRef(null);
  useDismiss(open, ref, () => setOpen(false));

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setError(null);
    listProjects({ paperSha256: paper.sha256 })
      .then((list) => setProjects(list.filter((project) => project.is_member)))
      .catch((err) => setError(err.message));
  };

  const add = async (project) => {
    setBusy(project.uuid);
    setError(null);
    try {
      if (!paper.thought && why.trim()) {
        const saved = await updatePaper(paper.sha256, { thought: why.trim() });
        onThought?.(saved?.thought ?? why.trim());
        setWhy('');
      }
      await addPaperToProject(project.uuid, paper.sha256);
      setProjects((list) => list.map((p) => (p.uuid === project.uuid ? { ...p, has_paper: true } : p)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="share-control" ref={ref}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
        Add to project <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="share-menu project-picker" role="menu">
          {!projects && !error && <p className="share-note">Loading…</p>}
          {projects && projects.length === 0 && (
            <p className="share-note">
              No projects yet. <a href={appPath('/projects')}>Start one</a>
            </p>
          )}
          {projects && projects.length > 0 && !paper.thought && (
            <input
              className="project-picker-why"
              value={why}
              maxLength={appLimits.text.paper_thought}
              placeholder="Why this paper? (optional)"
              aria-label="Why this paper"
              onChange={(e) => setWhy(e.target.value)}
            />
          )}
          {projects?.map((project) => (
            <button
              key={project.uuid}
              type="button"
              role="menuitem"
              className="project-picker-item"
              disabled={project.has_paper || busy != null}
              onClick={() => add(project)}
            >
              <span>{project.name}</span>
              <span className="project-picker-state">
                {project.has_paper ? 'Added' : busy === project.uuid ? 'Adding…' : ''}
              </span>
            </button>
          ))}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
