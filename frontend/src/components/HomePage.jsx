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
      </div>

      <SeminarFlow />

    </div>
  );
}
