import React from 'react';
import { backendPath } from '../appUrls.js';
import { tintOf } from '../identityTint.js';

// Circular avatar: the user's uploaded image, or their initial as fallback.
// Size comes from the className (e.g. entry-avatar, nook-chip-avatar).
export default function Avatar({ user, className }) {
  if (user.avatar_path) {
    return (
      <img
        className={`avatar-img ${className}`}
        src={backendPath(`/uploads/${user.avatar_path}`)}
        alt=""
      />
    );
  }
  return (
    <span className={`avatar-initial avatar-tint-${tintOf(user)} ${className}`}>
      <span className="avatar-letter">{user.display_name.charAt(0).toUpperCase()}</span>
    </span>
  );
}
