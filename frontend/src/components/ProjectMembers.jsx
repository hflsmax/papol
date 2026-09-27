import React from 'react';
import Avatar from './Avatar';
import { appPath } from '../base';

// Who is in a project, keepers marked: what anyone signed in may see of it.
export default function ProjectMembers({ members, currentUser }) {
  return (
    <div className="project-members">
      {members.map((member) => (
        <a
          key={member.user.uuid}
          className={member.is_keeper ? 'avatar-chip has-pop mini project-keeper' : 'avatar-chip has-pop mini'}
          href={appPath(`/u/${member.user.uuid}`)}
          aria-label={`${member.user.display_name}${member.is_keeper ? ', keeper' : ''}`}
        >
          <Avatar user={member.user} className="mini-avatar" />
          <span className="chip-pop">
            <span className="chip-pop-name">
              {member.user.display_name}
              {member.user.uuid === currentUser?.uuid ? ' (you)' : ''}
            </span>
            {member.is_keeper && <span className="chip-pop-aff">Keeper</span>}
          </span>
        </a>
      ))}
    </div>
  );
}

// The keepers by name, for someone who needs to ask one.
export function keeperNames(members) {
  const names = members.filter((m) => m.is_keeper).map((m) => m.user.display_name);
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
