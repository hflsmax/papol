import React, { useState } from 'react';

// The landing page's Library: the jacket of the specimen's paper, with the
// people who read it and a line from each. The visitor can add a line of
// their own; nothing leaves the page.

const READERS = [
  { initial: 'M', tint: 0, name: 'Mei', thought: 'The per-residue confidence is what I actually use.' },
  { initial: 'T', tint: 2, name: 'Tomás', thought: 'The supplement is where the method lives.' },
  { initial: 'A', tint: 4, name: 'Aisha', thought: 'Still struggles when a protein has few relatives to learn from.' },
];

export default function HomeLibrary({ beckoning, onTried }) {
  const [draft, setDraft] = useState('');
  const [mine, setMine] = useState(null);

  const readers = mine ? [...READERS, { initial: 'Y', tint: 1, name: 'You', thought: mine, own: true }] : READERS;

  return (
    <div className="landing-jacket">
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
