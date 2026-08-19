import React from 'react';
import StatePill from './StatePill';

const STATES = [
  {
    status: 'open',
    cls: 'live',
    desc: 'Any reader calls for a spontaneous seminar on a paper. Every reader of it is notified, and a cohort forms, waiting for a host.',
  },
  {
    status: 'planning',
    cls: 'gold',
    desc: 'A reader answers the call and hosts the seminar. Participants share availability and discuss what they want from the seminar.',
  },
  {
    status: 'scheduled',
    cls: 'done',
    desc: 'The host announces the time, place, and style of the seminar, and everyone is notified.',
  },
];

export default function SeminarFlow() {
  return (
    <div className="panel">
      <h6 className="mini-title">How a spontaneous seminar comes together</h6>
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
    </div>
  );
}
