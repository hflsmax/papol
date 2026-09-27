import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { acceptInvitation, previewInvitation } from '../../../shared/api/projects.js';
import ProjectMembers from './ProjectMembers';

// Where an invitation link lands: what the project is and who is in it,
// and one button to join.
export default function InvitationPage({ code, currentUser, onOpenProject, onChanged }) {
  const [project, setProject] = useState(null);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let active = true;
    previewInvitation(code)
      .then((next) => { if (active) setProject(next); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [code]);

  if (error) return <div className="panel"><p className="panel-note">{error}</p></div>;
  if (!project) return <div className="loading"><Working label="Opening invitation…" /></div>;

  const join = async () => {
    setJoining(true);
    try {
      const joined = await acceptInvitation(code);
      onChanged?.();
      onOpenProject(joined.uuid, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="panel project-invitation">
      <p className="kicker">Project</p>
      <h2>{project.name}</h2>
      <ProjectMembers members={project.members} currentUser={currentUser} />
      {project.is_member ? (
        <button type="button" className="primary" onClick={() => onOpenProject(project.uuid, { replace: true })}>Open project</button>
      ) : (
        <button type="button" className="primary" onClick={join} disabled={joining}>
          {joining ? 'Joining…' : 'Join project'}
        </button>
      )}
    </div>
  );
}
