import React from 'react';
import { appPath } from '../base';

// Pastel grounds for the transparent demo portraits, picked per reader so
// each character keeps their own. The matching colours for readers with no
// picture at all are the --identity-* tokens, applied through the
// avatar-tint-N classes below.
const DEMO_BG = [
  '#f5eeda', // sand
  '#dce9f5', // blue
  '#f7e0e0', // pink
  '#e3f0dc', // green
  '#e9e0f2', // lavender
  '#dff0ee', // teal
];

const INITIAL_TINTS = 6;

const tintOf = (user) => (user?.id || 0) % INITIAL_TINTS;

// Circular avatar: the user's uploaded image, or their initial as fallback.
// Size comes from the className (e.g. entry-avatar, nook-chip-avatar).
export default function Avatar({ user, className }) {
  if (user?.avatar_path) {
    // Bundled images (demo characters) live under assets/; uploaded ones
    // are served from uploads/.
    const bundled = user.avatar_path.startsWith('assets/');
    const src = bundled ? appPath(`/${user.avatar_path}`) : appPath(`/uploads/${user.avatar_path}`);
    return (
      <img
        className={`avatar-img ${bundled ? 'head-crop ' : ''}${className}`}
        style={
          bundled
            ? { background: DEMO_BG[(user.id || 0) % DEMO_BG.length] }
            : undefined
        }
        src={src}
        alt=""
      />
    );
  }
  return (
    <span className={`avatar-initial avatar-tint-${tintOf(user)} ${className}`}>
      {(user?.display_name || '?').charAt(0).toUpperCase()}
    </span>
  );
}
