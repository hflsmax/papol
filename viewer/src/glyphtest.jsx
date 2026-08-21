import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimalJointed } from './glyphs';
import { poseCow } from './cow';
import { ANIMALS } from './animals';

const K = 3.0, CW = 210, CH = 150;

const rest = (kind, o) => ({
  id: 'x', kind, x: 0, y: 0, facing: -1, grazing: false, until: 1e9, held: false,
  tvx: 0, tvy: 0, vx: 0, vy: 0, turn: 1, gait: 0, stride: 0,
  head: 0, ear: 0, earAt: 1e9, earTill: 0, tailAt: 1e9, tailTill: 0,
  born: -1e6, seed: 0.3, pace: 1, ...o,
});

const grab = (n) => ({
  root: n, frame: n.querySelector('[data-cow="frame"]'),
  bob: n.querySelectorAll('[data-cow="bob"]'), head: n.querySelector('[data-cow="head"]'),
  ear: n.querySelector('[data-cow="ear"]'), tail: n.querySelector('[data-cow="tail"]'),
  legs: n.querySelectorAll('[data-cow="leg"]'), shadow: n.querySelector('[data-cow="shadow"]'),
});

function Cell({ spec, cow, label }) {
  const ref = useRef(null);
  useLayoutEffect(() => { poseCow(cow, grab(ref.current), 0, K, CW / 2, CH / 2 + 8); });
  return (
    <svg width={CW} height={CH} style={{ background: '#fcfcfb' }}>
      <text x="6" y="14" fontSize="10" fill="#bbb" fontFamily="monospace">{label}</text>
      <line x1="0" y1={CH / 2 + 8 + (spec.ground - spec.box.h / 2) * K} x2={CW}
            y2={CH / 2 + 8 + (spec.ground - spec.box.h / 2) * K} stroke="#f0d0d0" strokeWidth="0.5" />
      <g ref={ref}><AnimalJointed spec={spec} /></g>
    </svg>
  );
}

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 14 }}>
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
      {ANIMALS.map((a) => (
        <span key={a.id} style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" style={{ color: '#2b4a6f' }}>
            <g fill="currentColor" dangerouslySetInnerHTML={{ __html: a.glyph }} />
          </svg>
          <svg width="46" height="32" viewBox={`0 0 ${a.box.w} ${a.box.h}`}>
            <g fill="#faf7ef" stroke="#33383f" strokeWidth="1.5" strokeLinejoin="round"
               dangerouslySetInnerHTML={{ __html: a.pale }} />
            <g fill="#33383f" dangerouslySetInnerHTML={{ __html: a.dark }} />
          </svg>
          <span style={{ font: '10px monospace', color: '#999' }}>{a.label}</span>
        </span>
      ))}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${CW}px)` }}>
      {ANIMALS.map((a) => [
        <Cell key={`${a.id}r`} spec={a} label={`${a.id} rest`} cow={rest(a.id, {})} />,
        <Cell key={`${a.id}g`} spec={a} label="graze" cow={rest(a.id, { head: 1 })} />,
        <Cell key={`${a.id}w`} spec={a} label="walk" cow={rest(a.id, { gait: 1, stride: 0.4 })} />,
        <Cell key={`${a.id}t`} spec={a} label="right" cow={rest(a.id, { turn: -1, facing: 1 })} />,
      ])}
    </div>
  </div>
);
