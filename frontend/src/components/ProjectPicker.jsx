import React, { useRef, useState } from 'react';
import { useDismiss } from '../../../shared/useDismiss.js';
import { addPaperToProject, createProject, listProjects } from '../../../shared/api/projects.js';
import { updatePaper } from '../../../shared/api/papers.js';
import appLimits from '../../../shared/appLimits.js';

const membersLabel = (project) => {
  const count = project.members?.length ?? 1;
  return count > 1 ? `${count} members` : 'Just you';
};

// Adding this paper to one of my projects. Until I have said why the
// paper matters, the menu asks once, in a line: members read it beside it.
export default function ProjectPicker({ paper, onThought }) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState('');
  const ref = useRef(null);
  useDismiss(open, ref, () => setOpen(false));

  // The first time, the menu opens once its projects are read, rather than
  // on a wait that then fills; after that it opens at once and refreshes.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    const known = Boolean(projects);
    if (known) setOpen(true);
    setError(null);
    listProjects({ paperSha256: paper.sha256 })
      .then((list) => setProjects(list.filter((project) => project.is_member)))
      .catch((err) => setError(err.message))
      .finally(() => { if (!known) setOpen(true); });
  };

  const add = async (project) => {
    if (project.has_paper || busy) return;
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

  // With no project yet, the menu starts one by its name, this paper in it.
  const start = async (event) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy('new');
    setError(null);
    try {
      const project = await createProject(name.trim());
      await addPaperToProject(project.uuid, paper.sha256);
      setProjects([{ ...project, has_paper: true }]);
      setName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (project) => {
    if (project.has_paper) return <span className="project-picker-state is-added">✓ Added</span>;
    if (busy === project.uuid) return <span className="project-picker-state is-busy">Adding…</span>;
    return <span className="project-picker-state">Add</span>;
  };

  return (
    <div className="share-control" ref={ref}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
        Add to project <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="share-menu project-picker" role="menu">
          {projects?.length === 0 && (
            <form className="share-menu-section" onSubmit={start}>
              <input
                autoFocus
                value={name}
                maxLength={appLimits.text.project_name}
                placeholder="Project name"
                aria-label="Project name"
                disabled={busy === 'new'}
                onChange={(e) => setName(e.target.value)}
              />
            </form>
          )}
          {projects?.length > 0 && !paper.thought && (
            <div className="share-menu-section project-picker-why">
              <label className="share-menu-heading" htmlFor="project-picker-why">Why this paper?</label>
              <input
                id="project-picker-why"
                value={why}
                maxLength={appLimits.text.paper_thought}
                placeholder="Optional"
                onChange={(e) => setWhy(e.target.value)}
              />
            </div>
          )}
          {projects?.length > 0 && <span className="share-menu-heading">My projects</span>}
          {projects?.map((project) => (
            <button
              key={project.uuid}
              type="button"
              role="menuitem"
              className={project.has_paper ? 'project-picker-item is-added' : 'project-picker-item'}
              aria-disabled={project.has_paper || undefined}
              disabled={busy != null && busy !== project.uuid && !project.has_paper}
              onClick={() => add(project)}
            >
              <strong>{project.name}</strong>
              <span className="project-picker-meta">{membersLabel(project)}</span>
              {stateOf(project)}
            </button>
          ))}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
