import React from 'react';

// The public/private chip beside one of a copy's fields, which turns it
// the other way when pressed. Being public only counts while the paper is
// on a public shelf; the chip still says what the field is set to, and
// its title says the rest.
export default function VisibilityChip({ shown, onDisplay, onToggle }) {
  const said = shown ? 'public' : 'private';
  const title = shown
    ? onDisplay
      ? 'Others see this. Click to keep it to yourself.'
      : 'Others will see this once the paper is on a public shelf. Click to keep it to yourself.'
    : 'Only you see this. Click to let others see it.';
  return (
    <button
      type="button"
      className={`badge visibility-badge ${said} visibility-toggle`}
      onClick={onToggle}
      title={title}
      aria-label={`${said}: ${title}`}
    >
      {said}
    </button>
  );
}
