import React from 'react';

// Distinct pastel backgrounds for the transparent demo-character images,
// picked per user so each character gets their own color.
const DEMO_BG = [
  '#f5eeda', // sand
  '#dce9f5', // blue
  '#f7e0e0', // pink
  '#e3f0dc', // green
  '#e9e0f2', // lavender
  '#dff0ee', // teal
];

// Circular avatar: the user's uploaded image, or their initial as fallback.
// Size comes from the className (e.g. entry-avatar, nook-chip-avatar).
export default function Avatar({ user, className }) {
  if (user?.avatar_path) {
    // Bundled images (demo characters) live under assets/; uploaded ones
    // are served from uploads/.
    const bundled = user.avatar_path.startsWith('assets/');
    const src = bundled ? user.avatar_path : `uploads/${user.avatar_path}`;
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
    <span className={className}>
      {(user?.display_name || '?').charAt(0).toUpperCase()}
    </span>
  );
}
