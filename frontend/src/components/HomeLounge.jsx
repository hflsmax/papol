import React, { useState } from 'react';

// The landing page's Lounge: the specimen's paper as friends' news, with
// the friends who read it and a line from each. The visitor can add a line
// of their own; nothing leaves the page.

const READERS = [
  { initial: 'M', tint: 0, name: 'Mei', thought: 'The typing rules read best next to the example in Section 3.' },
  { initial: 'T', tint: 2, name: 'Tomás', thought: 'The lifetime logic is the part I keep coming back to.' },
  { initial: 'A', tint: 4, name: 'Aisha', thought: 'I trust Arc and Mutex a little more now.' },
];

export default function HomeLounge({ beckoning, onTried }) {
  const [draft, setDraft] = useState('');
  const [mine, setMine] = useState(null);

  const readers = mine ? [...READERS, { initial: 'Y', tint: 1, name: 'You', thought: mine, own: true }] : READERS;

  return (
    <div className="landing-jacket">
      <p className="landing-jacket-title">RustBelt: Securing the Foundations of the Rust Programming Language</p>
      <p className="landing-jacket-meta">Jung et al. · POPL, 2018 · {readers.length} friends</p>
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
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            setMine(draft.trim());
            onTried('line');
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={beckoning === 'line' ? 'beckon' : ''}
            placeholder="Your line on this paper"
            maxLength={90}
            aria-label="Your line on this paper"
          />
          <button type="submit" disabled={!draft.trim()}>Add</button>
        </form>
      )}
    </div>
  );
}
