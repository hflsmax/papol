import React, { useRef, useState } from 'react';
import { SENTENCES, SOURCE } from './HomeSpecimen';

// The landing page's board: a canvas the way a board looks, with a
// booklet, a collection and loose cards of several kinds, and the
// sentences the visitor painted on the specimen above, each able to lead
// back to its place on the page. Every card can be picked up and moved.

function Kind({ children }) {
  return <span className="board-mock-kind">{children}</span>;
}

// Where each card has been dragged to, from where the layout put it.
function useDrag() {
  const [offsets, setOffsets] = useState({});
  const [lifted, setLifted] = useState(null);
  const grab = useRef(null);

  const handlers = (id) => ({
    onPointerDown: (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      const start = offsets[id] || { x: 0, y: 0 };
      grab.current = { id, x: e.clientX - start.x, y: e.clientY - start.y };
      e.currentTarget.setPointerCapture(e.pointerId);
      setLifted(id);
    },
    onPointerMove: (e) => {
      if (grab.current?.id !== id) return;
      // Read now: the update runs later, perhaps after the card is let go.
      const to = { x: e.clientX - grab.current.x, y: e.clientY - grab.current.y };
      setOffsets((current) => ({ ...current, [id]: to }));
    },
    onPointerUp: () => { grab.current = null; },
    onPointerCancel: () => { grab.current = null; },
    style: offsets[id] ? { transform: `translate(${offsets[id].x}px, ${offsets[id].y}px)` } : undefined,
    'data-lifted': lifted === id ? '' : undefined,
  });
  return handlers;
}

function Card({ id, drag, className = '', children }) {
  return <div className={`board-mock-card ${className}`} {...drag(id)}>{children}</div>;
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
          <Card id="file" drag={drag}>
            <Kind>File</Kind>
            <p className="board-mock-file">Senior 2020.pdf</p>
          </Card>
          <Card id="image" drag={drag}>
            <Kind>Image</Kind>
            <svg className="board-mock-image ribbon" viewBox="0 0 120 50" preserveAspectRatio="none" aria-hidden="true">
              <path d="M6 38 C 14 8, 22 8, 26 26 S 36 44, 42 24 S 52 6, 58 24 S 68 44, 74 26 C 80 10, 90 12, 96 30 S 110 40, 116 14" />
            </svg>
            <p>A ribbon sketch of a helix</p>
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
            <p>0.96 Å. Narrower than one carbon atom.</p>
          </Card>
          <Card id="video" drag={drag}>
            <Kind>YouTube video</Kind>
            <div className="board-mock-image video" aria-hidden="true"><span>▶</span></div>
            <p>The protein folding problem</p>
          </Card>
        </div>

        <div className="board-mock-collection">
          <p className="board-mock-group-title">Sources</p>
          <Card id="leavitt" drag={drag}>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page" aria-hidden="true" />
            <p>CASP14 results</p>
          </Card>
          <Card id="humason" drag={drag}>
            <Kind>Webpage</Kind>
            <div className="board-mock-image page alt" aria-hidden="true" />
            <p>Protein Data Bank</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
