import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CowJointed } from './glyphs';
import { poseCow } from './cow';

const K = 3.2, CW = 260, CH = 190;

const rest = (o) => ({
  id: 'x', x: 0, y: 0, facing: -1, grazing: false, until: 1e9, held: false,
  tvx: 0, tvy: 0, vx: 0, vy: 0, turn: 1, gait: 0, stride: 0,
  head: 0, ear: 0, earAt: 1e9, earTill: 0, tailAt: 1e9, tailTill: 0,
  born: -1e6, seed: 0, pace: 1, ...o,
});

// Each cell is one frozen pose, so a joint that is wrong is wrong in a
// picture rather than in a blur.
const CELLS = [
  ['rest', rest({})],
  ['head .5', rest({ head: 0.5 })],
  ['head 1 (graze)', rest({ head: 1 })],
  ['ear 1', rest({ ear: 1 })],
  ['stride .00', rest({ gait: 1, stride: 0 })],
  ['stride .15', rest({ gait: 1, stride: 0.15 })],
  ['stride .30', rest({ gait: 1, stride: 0.3 })],
  ['stride .45', rest({ gait: 1, stride: 0.45 })],
  ['stride .60', rest({ gait: 1, stride: 0.6 })],
  ['stride .80', rest({ gait: 1, stride: 0.8 })],
  ['turn .5', rest({ turn: 0.5 })],
  ['turn -1 (right)', rest({ turn: -1, facing: 1 })],
];

function Cell({ label, cow, i }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const node = ref.current;
    poseCow(cow, {
      root: node,
      frame: node.querySelector('[data-cow="frame"]'),
      bob: node.querySelectorAll('[data-cow="bob"]'),
      head: node.querySelector('[data-cow="head"]'),
      ear: node.querySelector('[data-cow="ear"]'),
      tail: node.querySelector('[data-cow="tail"]'),
      legs: node.querySelectorAll('[data-cow="leg"]'),
      shadow: node.querySelector('[data-cow="shadow"]'),
    }, 0, K, CW / 2, CH / 2 + 10);
  });
  return (
    <svg width={CW} height={CH} style={{ background: i % 2 ? '#fbfbfa' : '#fff' }}>
      <text x="8" y="16" fontSize="11" fill="#888" fontFamily="monospace">{label}</text>
      {/* Where the feet should be, so skating and floating are visible. */}
      <line x1="0" y1={CH / 2 + 10 + 17.5 * K} x2={CW} y2={CH / 2 + 10 + 17.5 * K} stroke="#d33" strokeWidth="0.5" />
      <g ref={ref}><CowJointed /></g>
    </svg>
  );
}

createRoot(document.getElementById('root')).render(
  <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${CW}px)` }}>
    {CELLS.map(([label, cow], i) => <Cell key={label} label={label} cow={cow} i={i} />)}
  </div>
);
