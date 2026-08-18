import React, { useState } from 'react';
import SeminarFlow from './SeminarFlow';

const LABELS = {
  open: 'called',
  planning: 'planning',
  scheduled: 'scheduled',
  finished: 'finished',
};

// The one seminar-state chip, used identically everywhere.
// status: 'open' | 'planning' | 'scheduled' | 'finished' | null
// Clicking it pops up the explanation of the seminar stages.
export default function StatePill({ status, link = true }) {
  const [open, setOpen] = useState(false);
  const cls = status ? (status === 'open' ? 'called' : status) : 'none';
  const label = status ? LABELS[status] : 'none called';
  if (!link) {
    return <span className={`state-pill ${cls}`}>{label}</span>;
  }
  return (
    <>
      <button
        className={`state-pill ${cls}`}
        title="How seminars work"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <SeminarFlow />
          </div>
        </div>
      )}
    </>
  );
}
