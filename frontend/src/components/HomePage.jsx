import React from 'react';
import SeminarFlow from './SeminarFlow';

export default function HomePage({ currentUser, onJoin, onDemo }) {
  return (
    <div>
      <div className="panel home-hero">
        <h2 className="home-title">Papol</h2>
        <p className="home-subtitle">make spontaneous seminars happen</p>
        <hr className="home-rule" />
        <p className="home-tagline">
          Papol is a place to keep the papers you read and discuss them with
          other readers. You can rate papers, write private notes, and call a
          seminar on any paper. Other readers of that paper are notified and
          can join.
        </p>
        {onDemo && (
          <button className="primary demo-cta" onClick={onDemo}>
            Explore the demo
          </button>
        )}
      </div>

      <SeminarFlow />

    </div>
  );
}
