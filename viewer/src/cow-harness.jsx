import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { CowJointed, COW_PARTS, COW_MARKS, CowFigure, COW_GROUND, COW_BOX } from './glyphs';
import { stepCow, poseCow } from './cow';

const K = 3.4, CW = 250, CH = 175;

const born = (o) => ({
  id: 'x', x: 0.5, y: 0.5, facing: -1, grazing: false, until: 0, held: false,
  tvx: 0, tvy: 0, vx: 0, vy: 0, turn: 1, gait: 0, stride: 0,
  head: 0, ear: 0, earAt: 0, earTill: 0, tailAt: 0, tailTill: 0,
  born: 0, seed: 0.3, pace: 1, ...o,
});

const grab = (node) => ({
  root: node,
  frame: node.querySelector('[data-cow="frame"]'),
  bob: node.querySelectorAll('[data-cow="bob"]'),
  head: node.querySelector('[data-cow="head"]'),
  ear: node.querySelector('[data-cow="ear"]'),
  tail: node.querySelector('[data-cow="tail"]'),
  legs: node.querySelectorAll('[data-cow="leg"]'),
  shadow: node.querySelector('[data-cow="shadow"]'),
});

function Cell({ label, at, cow, i }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    poseCow(cow, grab(ref.current), at, K, CW / 2, CH / 2 + 8);
  });
  return (
    <svg width={CW} height={CH} style={{ background: i % 2 ? '#fbfbfa' : '#fff' }}>
      <text x="8" y="15" fontSize="11" fill="#999" fontFamily="monospace">{label}</text>
      <line x1="0" y1={CH / 2 + 8 + (COW_GROUND - COW_BOX.h / 2) * K} x2={CW}
            y2={CH / 2 + 8 + (COW_GROUND - COW_BOX.h / 2) * K} stroke="#e88" strokeWidth="0.5" />
      <g ref={ref}><CowJointed /></g>
    </svg>
  );
}

// Poses set by hand, to check each joint on its own.
const rest = (o) => born({ until: 1e9, born: -1e6, ...o });
const POSES = [
  ['rest', rest({})],
  ['graze', rest({ head: 1 })],
  ['ear back', rest({ ear: 1 })],
  ['walking', rest({ gait: 1, stride: 0.35 })],
  ['mid-turn', rest({ turn: 0.35 })],
  ['facing right', rest({ turn: -1, facing: 1 })],
];

// And the real simulation, stepped on a clock of its own, since headless
// Chrome will not run an animation frame.
const film = [];
{
  const c = born({});
  let t = 0;
  for (let f = 0; f < 1500; f += 1) {
    stepCow(c, 16, t);
    t += 16;
    if (f % 125 === 0) film.push([`${(t / 1000).toFixed(1)}s`, t, { ...c }]);
  }
}

createRoot(document.getElementById('root')).render(
  <>
    <div style={{ display: 'flex', gap: 26, alignItems: 'center', padding: '12px 18px' }}>
      <span style={{ font: '11px monospace', color: '#999' }}>bar 24 / page 46 / 92</span>
      <svg width="24" height="24" viewBox="0 0 24 24" style={{ color: '#2b4a6f' }}>
        <g fill="currentColor" transform="translate(0.63 5.25) scale(0.369)"><CowFigure /></g>
      </svg>
      {[46, 92].map((w) => (
        <svg key={w} width={w} height={(w * 44) / 64} viewBox="0 0 64 44"
          dangerouslySetInnerHTML={{ __html:
            '<g fill="#faf7ef" stroke="#33383f" stroke-width="1.5" stroke-linejoin="round">' +
            `${COW_PARTS}</g><g fill="#33383f">${COW_MARKS}</g>` }} />
      ))}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(6, ${CW}px)` }}>
      {POSES.map(([label, cow], i) => <Cell key={label} label={label} at={0} cow={cow} i={i} />)}
      {film.map(([label, at, cow], i) => (
        <Cell key={`f${label}`} label={label} at={at} cow={cow} i={i + 1} />
      ))}
    </div>
  </>
);
