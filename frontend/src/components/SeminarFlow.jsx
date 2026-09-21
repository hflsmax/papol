import React from 'react';
import StatePill from './StatePill';

const STATES = [
  {
    status: 'open',
    cls: 'live',
    desc: 'Any user calls for a spontaneous seminar on a paper. Every user of it is notified, and a cohort forms, waiting for a leader.',
  },
  {
    status: 'planning',
    cls: 'gold',
    desc: 'A user answers the call and leads the seminar. Participants share availability and discuss what they want from the seminar.',
  },
  {
    status: 'scheduled',
    cls: 'done',
    desc: 'The leader announces the time, place, and style of the seminar, and everyone is notified.',
  },
];

// On the home page the flow is a panel of its own, with its kicker. Inside
// a section that already has both (the About page's Seminars), `framed`
// false renders just the three steps.
export default function SeminarFlow({ framed = true }) {
  const steps = (
    <ol className="flow-list">
      {STATES.map((state, i) => (
        <li key={state.status}>
          <span className={`flow-dot ${state.cls}`}>{i + 1}</span>
          <div className="flow-body">
            <p className="flow-step-title">
              <StatePill status={state.status} link={false} />
            </p>
            <p className="flow-step-desc">{state.desc}</p>
          </div>
        </li>
      ))}
    </ol>
  );
  if (!framed) return steps;
  return (
    <div className="panel">
      <h6 className="kicker">How a spontaneous seminar comes together</h6>
      {steps}
    </div>
  );
}
