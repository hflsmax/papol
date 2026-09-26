import React, { useRef, useState } from 'react';
import { SENTENCES, SOURCE } from './HomeSpecimen';

// The landing page's board: a canvas the way a board looks, with a
// booklet, a collection and loose cards of several kinds, and the
// sentences the visitor painted on the specimen above, each able to lead
// back to its place on the page. Every card can be picked up and moved;
// one in a booklet or a collection springs back to its place there when
// let go, as a grouped card keeps its place in its group.

function Kind({ children }) {
  return <span className="board-mock-kind">{children}</span>;
}

// Where each card has been dragged to, from where the layout put it. A
// card that snaps back loses its offset when let go, and glides home.
function useDrag() {
  const [offsets, setOffsets] = useState({});
  const [lifted, setLifted] = useState(null);
  const [returning, setReturning] = useState(null);
  const grab = useRef(null);

  const letGo = (id, snapBack) => {
    if (grab.current?.id !== id) return;
    grab.current = null;
    if (!snapBack) return;
    setReturning(id);
    setOffsets(({ [id]: _, ...rest }) => rest);
  };

  const handlers = (id, snapBack) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const start = offsets[id] || { x: 0, y: 0 };
      grab.current = { id, x: e.clientX - start.x, y: e.clientY - start.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      setLifted(id);
      setReturning(null);
    },
    onPointerMove: (e) => {
      if (grab.current?.id !== id) return;
      // Read now: the update runs later, perhaps after the card is let go.
      const to = { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y };
      setOffsets((current) => ({ ...current, [id]: to }));
    },
    onPointerUp: () => letGo(id, snapBack),
    onPointerCancel: () => letGo(id, snapBack),
    onTransitionEnd: () => { if (returning === id) setReturning(null); },
    style: offsets[id] ? { transform: `translate(${offsets[id].x}px, ${offsets[id].y}px)` } : undefined,
    'data-lifted': lifted === id ? '' : undefined,
    'data-returning': returning === id ? '' : undefined,
  });
  return handlers;
}

// A sketch of a predicted distance map: residue against residue, darker
// where two are predicted close, so the diagonal and a few contacts away
// from it.
const CONTACTS = [[2, 9], [3, 10], [4, 11], [1, 13], [6, 14], [7, 13]];
function DistanceMap() {
  const n = 16;
  const cells = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const near = Math.max(0, 1 - Math.abs(i - j) / 3);
      const contact = CONTACTS.some(([a, b]) => (Math.abs(i - a) + Math.abs(j - b) <= 1) || (Math.abs(i - b) + Math.abs(j - a) <= 1)) ? 0.7 : 0;
      const shade = Math.max(near, contact);
      if (shade > 0) cells.push(<rect key={`${i}-${j}`} x={j * 4} y={i * 4} width="4" height="4" opacity={0.15 + 0.85 * shade} />);
    }
  }
  return (
    <svg className="board-mock-image distances" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      {cells}
    </svg>
  );
}

function Card({ id, drag, grouped = false, className = '', children }) {
  return <div className={`board-mock-card ${className}`} {...drag(id, grouped)}>{children}</div>;
}

export default function HomeBoard({ painted, onBack }) {
  const drag = useDrag();
  return (
    <div className="board-mock">
      <div className="board-mock-bar">
        <span className="board-mock-name">Protein folding</span>
        <span className="board-mock-count">{6 + painted.length} cards</span>
      </div>
      <div className="board-mock-canvas">
        <div className="board-mock-booklet">
          <p className="board-mock-group-title">Before AlphaFold 2</p>
          <Card id="file" drag={drag} grouped>
            <Kind>File</Kind>
            <p className="board-mock-file">AlphaFold 1 (Senior 2020).pdf</p>
          </Card>
          <Card id="image" drag={drag} grouped>
            <Kind>Image</Kind>
            <DistanceMap />
            <p>AlphaFold 1’s distance map</p>
          </Card>
        </div>

        <div className="board-mock-loose">
          {painted.map((id) => (
            <Card key={id} id={id} drag={drag} className="excerpt">
              <Kind>Excerpt</Kind>
              <p>{SENTENCES[id]}</p>
              <button type="button" className="specimen-backlink" onClick={() => onBack(id)}>
                ↖ {SOURCE}
              </button>
            </Card>
          ))}
          <Card id="thought" drag={drag} className="thought">
            <Kind>Thought</Kind>
            <p>0.96 Å error, less than a carbon atom’s width. Next best: 2.8 Å.</p>
          </Card>
          <Card id="video" drag={drag}>
            <Kind>YouTube video</Kind>
            <div className="board-mock-image video" aria-hidden="true"><span>▶</span></div>
            <p>The protein folding problem</p>
          </Card>
        </div>

        <div className="board-mock-collection">
          <p className="board-mock-group-title">Data</p>
          <Card id="leavitt" drag={drag} grouped>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page" aria-hidden="true" />
            <p>CASP14 results</p>
          </Card>
          <Card id="humason" drag={drag} grouped>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page alt" aria-hidden="true" />
            <p>How a protein structure is solved</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
