import React from 'react';

/** One shared sign for features whose shape may still change. */
export default function ExperimentalBadge({ compact = false }) {
  return (
    <span
      className={`experimental-badge${compact ? ' compact' : ''}`}
      title="Experimental — this feature may change"
      aria-label="Experimental feature"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 2h4M7 2v4l-3.2 5.2A1.8 1.8 0 0 0 5.3 14h5.4a1.8 1.8 0 0 0 1.5-2.8L9 6V2M5.2 10h5.6" />
      </svg>
      {!compact && <span>Experimental</span>}
    </span>
  );
}
