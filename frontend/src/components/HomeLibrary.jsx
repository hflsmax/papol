import React, { useState } from 'react';
import StatePill from './StatePill';

// The landing page's Library: the jacket of the specimen's paper, with the
// people who read it and a line from each. The visitor can add a line of
// their own and call a seminar; nothing leaves the page.

const READERS = [
  { initial: 'M', tint: 0, name: 'Mei', thought: 'The carbon-atom comparison is the whole pitch.' },
  { initial: 'T', tint: 2, name: 'Tomás', thought: 'The supplement is where the method lives.' },
  { initial: 'A', tint: 4, name: 'Aisha', thought: 'Read Senior 2020 first.' },
];

export default function HomeLibrary() {
  const [draft, setDraft] = useState('');
  const [mine, setMine] = useState(null);
  const [called, setCalled] = useState(false);

  const readers = mine ? [...READERS, { initial: 'Y', tint: 1, name: 'You', thought: mine, own: true }] : READERS;

  return (
    <div className="landing-jacket">
      <p className="landing-jacket-kicker">Library</p>
      <p className="landing-jacket-title">Highly accurate protein structure prediction with AlphaFold</p>
      <p className="landing-jacket-meta">Jumper et al. · Nature, 2021 · {readers.length} readers</p>
      <ul className="landing-readers">
        {readers.map((reader) => (
          <li key={reader.name} className={reader.own ? 'own' : ''}>
            <span className={`landing-avatar tint-${reader.tint}`}>{reader.initial}</span>
            <span>
              <b>{reader.name}</b>
              <q>{reader.thought}</q>
            </span>
          </li>
        ))}
      </ul>
      {!mine && (
        <form
          className="landing-thought-form"
          onSubmit={(e) => { e.preventDefault(); if (draft.trim()) setMine(draft.trim()); }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your line on this paper"
            maxLength={90}
            aria-label="Your line on this paper"
          />
          <button type="submit" disabled={!draft.trim()}>Add</button>
        </form>
      )}
      <div className="landing-jacket-seminar">
        <span>Seminar</span>
        <StatePill status={called ? 'open' : null} link={false} />
        {called
          ? <span>{readers.length} readers notified · waiting for a leader</span>
          : <button type="button" className="landing-call" onClick={() => setCalled(true)}>Call a seminar</button>}
      </div>
    </div>
  );
}
