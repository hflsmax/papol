import React from 'react';
import { backendPath } from '../base';

// The colours for users with no picture are the --identity-* tokens,
// applied through the avatar-tint-N classes below.
const INITIAL_TINTS = 6;

// A user keeps one colour: their UUID, folded to a small number.
const tintOf = (user) => [...user.uuid]
  .reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 65521, 0) % INITIAL_TINTS;

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
      {user.display_name.charAt(0).toUpperCase()}
    </span>
  );
}
