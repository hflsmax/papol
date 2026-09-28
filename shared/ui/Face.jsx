import React, { createContext, useContext } from 'react';
import Avatar from './Avatar.jsx';
import { appPath } from '../appUrls.js';

// Whether a face leads to its person's nook. The Library, where a nook
// opens in place, says yes; a document or a board keeps its reader where
// they are, so there a face is only a face.
export const FacesLead = createContext(false);

// A person's face, which leads to their nook where it can.
export default function Face({ user, className = 'mini-avatar' }) {
  const leads = useContext(FacesLead);
  const face = <Avatar user={user} className={className} />;
  if (!leads || !user?.uuid) return face;
  return (
    <a className="face-link" href={appPath(`/u/${user.uuid}`)} title={user.display_name} aria-label={user.display_name}>
      {face}
    </a>
  );
}
