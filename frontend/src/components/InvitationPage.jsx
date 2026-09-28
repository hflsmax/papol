import React, { useEffect, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { acceptInvitation, previewInvitation } from '../../../shared/api/projects.js';
import ProjectMembers from './ProjectMembers';

// "Dana", "Dana and Lee", "Dana, Lee and Ari".
const joinNames = (names) => (names.length < 2 ? names[0] || ''
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Where an invitation link lands: which project, who keeps it, and one
// button to join. A centred card, like the other one-decision pages.
export default function InvitationPage({ code, currentUser, onOpenProject, onChanged }) {
  const [project, setProject] = useState(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let active = true;
    previewInvitation(code)
      .then((next) => { if (active) setProject(next); })
      .catch((err) => {
        if (!active) return;
        if (err.status === 404) setClosed(true);
        else setError(err.message);
      });
    return () => { active = false; };
  }, [code]);

  if (!project && !closed && error) return <div className="panel"><div className="error" role="alert">{error}</div></div>;
  if (!project && !closed) return <div className="loading"><Working label="Opening invitation…" /></div>;

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      const joined = await acceptInvitation(code);
      onChanged?.();
      onOpenProject(joined.uuid, { replace: true });
    } catch (err) {
      setError(err.message);
      setJoining(false);
    }
  };

  const keepers = project ? project.members.filter((m) => m.is_keeper).map((m) => m.user.display_name) : [];
  const count = project?.members.length ?? 0;

  return (
    <div className="project-invitation">
      <div className="panel project-invitation-card">
        <p className="kicker">Invitation</p>
        {closed ? (
          <>
            <h2>Invitation closed</h2>
          </>
        ) : (
          <>
            <h2>{project.name}</h2>
            <p className="meta project-invitation-meta">
              Kept by {joinNames(keepers)} · {count} {count === 1 ? 'member' : 'members'}
            </p>
            <ProjectMembers members={project.members} currentUser={currentUser} />
            {project.is_member && <p className="hint project-invitation-note">You’re a member.</p>}
            {error && <div className="error" role="alert">{error}</div>}
            {project.is_member ? (
              <button type="button" className="primary full-width" onClick={() => onOpenProject(project.uuid, { replace: true })}>
                Open project
              </button>
            ) : (
              <button type="button" className="primary full-width" onClick={join} disabled={joining}>
                {joining ? 'Joining…' : 'Join project'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
