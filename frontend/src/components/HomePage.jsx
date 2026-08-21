import React from 'react';
import SeminarFlow from './SeminarFlow';

export default function HomePage({ currentUser, onDemo }) {
  return (
    <div>
      <div className="panel home-hero">
        <h2 className="home-title">Papol</h2>
        <p className="home-subtitle">make spontaneous seminars happen</p>
        <hr className="home-rule" />
        <p className="home-tagline">
          Papol is a place to keep the papers you read and discuss them with
          other readers. You can rate papers, write private notes, and call a
          spontaneous seminar on any paper. Other readers of that paper are
          notified and can join.
        </p>
        {onDemo && (
          <div className="demo-cta-block">
            <button className="primary demo-cta" onClick={onDemo}>
              Explore the demo
            </button>
          </div>
        )}
        <p className="incubation-note">
          Papol is in incubation. Once it gains traction, it will move to an
          independent domain with better support.
        </p>
        {/* Papol is open source, and a reader who wants to know how their
            notes are stored can go and read it. The mark alone: a line
            saying "GitHub" beside the GitHub logo says it twice. */}
        <a
          className="home-source"
          href="https://github.com/hflsmax/papol"
          target="_blank"
          rel="noreferrer"
          title="Papol on GitHub"
          aria-label="Papol on GitHub"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                 -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                 .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                 -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
                 .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
                 .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
                 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42
                 -3.58-8-8-8Z"
            />
          </svg>
        </a>
      </div>

      <SeminarFlow />

    </div>
  );
}
