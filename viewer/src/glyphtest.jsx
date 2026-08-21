import React from 'react';
import { createRoot } from 'react-dom/client';
import { COW_PARTS, COW_MARKS, CowJointed } from './glyphs';
import { stepCow, poseCow } from './cow';
import { useLayoutEffect, useRef } from 'react';

const A =
  '<rect x="6" y="8.6" width="14" height="7.6" rx="3.8"/>' +
  '<rect x="1.4" y="6.4" width="7" height="6.6" rx="3.1"/>' +
  '<path d="M4.6 8.4 8.8 10.2v3.2L4.6 12.4z"/>' +
  '<path d="M3.6 6.6c-1-.9-1.1-2.4-.2-3.3.3.5-.1.9-.2 1.4-.1.7.4 1.2 1 1.5z"/>' +
  '<path d="M5.9 6.3c-.8-.7-.9-2-.2-2.8.3.4-.1.8-.1 1.2-.1.6.3 1 .8 1.2z"/>' +
  '<rect x="7.4" y="15.4" width="2" height="4.6" rx="1"/>' +
  '<rect x="10.4" y="15.4" width="2" height="4.6" rx="1"/>' +
  '<rect x="15.2" y="15.4" width="2" height="4.6" rx="1"/>' +
  '<rect x="18" y="15.4" width="2" height="4.6" rx="1"/>' +
  '<path d="M19.6 8.4c1.7.2 2.5 1.5 2.3 3.1l-.3 2.4-1.4-.2.3-2.4c.1-.8-.3-1.3-1.1-1.4z"/>';

const B =
  '<path d="M7.2 6.6C5.9 4.2 6.4 2.2 8.2 1.6c-.7 1.2-.7 2.7.4 4.2z"/>' +
  '<path d="M16.8 6.6C18.1 4.2 17.6 2.2 15.8 1.6c.7 1.2.7 2.7-.4 4.2z"/>' +
  '<ellipse cx="3.6" cy="11" rx="3.2" ry="2.1"/>' +
  '<ellipse cx="20.4" cy="11" rx="3.2" ry="2.1"/>' +
  '<rect x="5.4" y="5.4" width="13.2" height="13.2" rx="5"/>';

const C =
  '<path d="M8.6 7.2c-1.3-1.1-1.5-3.1-.3-4.2.4.6-.1 1.2-.2 1.8-.1.9.5 1.5 1.3 1.9z"/>' +
  '<path d="M12.4 6.6c-1.1-.9-1.3-2.6-.3-3.6.3.5-.1 1-.1 1.5-.1.7.4 1.3 1 1.6z"/>' +
  '<path d="M14.8 8.2c.7-2.6 3.4-4.2 4.8-3s-.2 3.6-2.6 4.8z"/>' +
  '<rect x="3" y="6.4" width="14" height="10" rx="4.6"/>' +
  '<ellipse cx="4.6" cy="14.6" rx="3.8" ry="3.2"/>';

const D =
  '<rect x="7" y="9" width="13.5" height="7" rx="3.5"/>' +
  '<path d="M3.2 6.5c-1-.9-1.1-2.4-.2-3.3.3.5-.1.9-.2 1.4-.1.7.4 1.2 1 1.5z"/>' +
  '<path d="M6.4 6.2c-.8-.7-.9-2-.2-2.8.3.4-.1.8-.1 1.2-.1.6.3 1 .8 1.2z"/>' +
  '<path d="M1 6.2h6.6c1.2 0 2 .8 2 2v4.4c0 1-.9 1.8-2 1.8H1z"/>' +
  '<rect x="8.2" y="15.2" width="2.2" height="4.8" rx="1.1"/>' +
  '<rect x="12" y="15.2" width="2.2" height="4.8" rx="1.1"/>' +
  '<rect x="16.6" y="15.2" width="2.2" height="4.8" rx="1.1"/>' +
  '<path d="M20 8.8c1.7.2 2.5 1.5 2.3 3.1l-.3 2.6-1.4-.2.3-2.6c.1-.8-.3-1.3-1.1-1.4z"/>';

const Row = ({ label, d }) => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 8 }}>
    <span style={{ width: 150, font: '12px monospace', color: '#666' }}>{label}</span>
    {[18, 24, 96].map((w) => (
      <div key={w} style={{ background: w === 96 ? '#f4f4f2' : 'none', padding: 2 }}>
        <svg width={w} height={w} viewBox="0 0 24 24" style={{ color: '#2b4a6f' }}>
          {d ? <g fill="currentColor" dangerouslySetInnerHTML={{ __html: d }} />
             : <g fill="currentColor" dangerouslySetInnerHTML={{ __html: COW_PARTS }} transform="translate(0.85 5.35) scale(0.3636)" />}
        </svg>
      </div>
    ))}
  </div>
);

// B narrows toward the muzzle: a face that is a rounded square is a bear's,
// a face that is wide at the brow and narrow at the nose is a cow's.
const HORNS =
  '<path d="M7.4 6.4C5.9 4 6.5 1.9 8.4 1.3c-.8 1.3-.7 2.9.5 4.4z"/>' +
  '<path d="M16.6 6.4C18.1 4 17.5 1.9 15.6 1.3c.8 1.3.7 2.9-.5 4.4z"/>';
const BIGHORNS =
  '<path d="M7 6.6C4.9 4 5.4 1.4 7.7.6c-.9 1.6-.7 3.5.8 5.4z"/>' +
  '<path d="M17 6.6C19.1 4 18.6 1.4 16.3.6c.9 1.6.7 3.5-.8 5.4z"/>';
const EARS =
  '<ellipse cx="3.4" cy="10.8" rx="3.3" ry="2.1"/>' +
  '<ellipse cx="20.6" cy="10.8" rx="3.3" ry="2.1"/>';
const FACE =
  '<path d="M12 5.2c3.8 0 5.6 1.5 5.6 3.7v3.4c0 3.4-2.5 6-5.6 6s-5.6-2.6-5.6-6V8.9c0-2.2 1.8-3.7 5.6-3.7z"/>';
const NARROW =
  '<path d="M12 5.2c3.8 0 5.8 1.5 5.8 3.7v2.4c0 1.6-.9 2.4-1.6 3.2-.9 1-1.6 3.1-4.2 3.1s-3.3-2.1-4.2-3.1c-.7-.8-1.6-1.6-1.6-3.2V8.9c0-2.2 2-3.7 5.8-3.7z"/>';

const K = 5.2, CW = 380, CH = 290;
const grab = (n) => ({
  root: n, frame: n.querySelector('[data-cow="frame"]'),
  bob: n.querySelectorAll('[data-cow="bob"]'), head: n.querySelector('[data-cow="head"]'),
  ear: n.querySelector('[data-cow="ear"]'), tail: n.querySelector('[data-cow="tail"]'),
  legs: n.querySelectorAll('[data-cow="leg"]'), shadow: n.querySelector('[data-cow="shadow"]'),
});
const swatCow = (frac) => ({
  id: 'x', x: 0, y: 0, facing: -1, grazing: true, until: 1e9, held: false,
  tvx: 0, tvy: 0, vx: 0, vy: 0, turn: 1, gait: 0, stride: 0,
  head: 1, ear: 0, earAt: 1e9, earTill: 0,
  tailAt: 1e9, tailTill: 640 - frac * 640, born: -1e6, seed: 0, pace: 1,
});
function Swat({ frac }) {
  const ref = useRef(null);
  const cow = swatCow(frac);
  useLayoutEffect(() => { poseCow(cow, grab(ref.current), 0, K, CW / 2, CH / 2 + 6); });
  return (
    <svg width={CW} height={CH} style={{ background: '#fbfbfa' }}>
      <text x="6" y="13" fontSize="10" fill="#aaa" fontFamily="monospace">{frac.toFixed(2)}</text>
      <g ref={ref}><CowJointed /></g>
    </svg>
  );
}

createRoot(document.getElementById('root')).render(
  <div style={{ padding: 18 }}>
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(3, ${CW}px)`, marginBottom: 20 }}>
      {[0.2, 0.32, 0.7, 0.78, 0.86, 0.94].map((f) => (
        <Swat key={f} frac={f} />
      ))}
    </div>
    <Row label="now (full cow)" d={null} />
    <Row label="A whole cow" d={A} />
    <Row label="B1 rounded square" d={B} />
    <Row label="B2 tapered face" d={HORNS + EARS + FACE} />
    <Row label="B3 + bigger horns" d={BIGHORNS + EARS + FACE} />
    <Row label="B4 narrowed muzzle" d={BIGHORNS + EARS + NARROW} />
  </div>
);
