// Mounts the real PdfPage with a real PDF, so the cow's frame loop, its
// ref registry and its drag handlers are the ones that actually ship.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.js';
import PdfPage from './PdfPage';

// Headless Chrome answers yes to prefers-reduced-motion, and a cow under
// that setting is supposed to stand perfectly still — which is correct,
// and useless for looking at the walk. Answered for it here, and only for
// that one query.
const realMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (q) =>
  q.includes('reduced-motion')
    ? { matches: false, addEventListener() {}, removeEventListener() {} }
    : realMatchMedia(q);

// A stand-in for a pdf.js document. pdf.js runs its parse on a worker, and
// a worker does not get on with a headless browser being fast-forwarded —
// but none of the cow's code cares what is printed on the page. This gives
// PdfPage the page size it lays everything out from, and draws ruled lines
// on the canvas so it is obvious the animal is standing on a page.
const PAGE = { width: 612, height: 792 };
const stubPage = {
  getViewport: ({ scale }) => ({ width: PAGE.width * scale, height: PAGE.height * scale }),
  render: ({ canvasContext, viewport }) => {
    const g = canvasContext;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, viewport.width, viewport.height);
    g.fillStyle = '#e6e6e6';
    for (let y = 70; y < viewport.height - 60; y += 17) {
      g.fillRect(64, y, viewport.width - 128 - ((y * 37) % 90), 7);
    }
    return { promise: Promise.resolve(), cancel: () => {} };
  },
  streamTextContent: () => ({ getReader: () => ({ read: () => Promise.resolve({ done: true }) }) }),
  getAnnotations: () => Promise.resolve([]),
};
const stubDoc = { getPage: () => Promise.resolve(stubPage), numPages: 1 };

const NONE = [];

function Live() {
  const doc = stubDoc;
  const [cows, setCows] = useState([]);
  const next = useRef(0);

  // The same record App.jsx builds.
  const dropCow = (page, at) => {
    const facing = Math.random() < 0.5 ? 1 : -1;
    setCows((h) => [...h, {
      id: `cow-${(next.current += 1)}`, page, x: at.x, y: at.y, facing,
      grazing: false, until: 0, held: false,
      tvx: 0, tvy: 0, vx: 0, vy: 0,
      turn: facing === 1 ? -1 : 1, gait: 0, stride: Math.random(),
      head: 0, ear: 0, earAt: 0, earTill: 0, tailAt: 0, tailTill: 0,
      born: performance.now(), seed: Math.random(), pace: 0.85 + Math.random() * 0.3,
    }]);
  };
  const moveCow = (id, at) => {
    const c = cows.find((x) => x.id === id);
    if (c) Object.assign(c, at);
  };

  // Put a few down as soon as the page has a size, spread across it.
  const seeded = useRef(false);
  const onPageSize = () => {
    if (seeded.current) return;
    seeded.current = true;
    [0.2, 0.45, 0.7].forEach((x, i) => dropCow(1, { x, y: 0.3 + i * 0.2 }));
  };

  return (
    <div className="pdf-scroll" style={{ padding: 20 }}>
      <PdfPage
        doc={doc}
        pageNumber={1}
        scale={1}
        renderScale={1}
        notes={NONE}
        activeNoteId={null}
        analysis={null}
        openReferenceId={null}
        onOpenReference={() => {}}
        onFollowLink={() => {}}
        onSelectNote={() => {}}
        onMoveNote={() => {}}
        tool="arrow"
        ink={NONE}
        inkColor="#d0342c"
        inkWidth={0.003}
        inkOpacity={1}
        onDrawStroke={() => {}}
        onEraseStroke={() => {}}
        onEraseNote={() => {}}
        onHover={() => {}}
        onDropAnchor={() => {}}
        onMoveStroke={() => {}}
        onDragNote={() => {}}
        onPageSize={onPageSize}
        cows={cows}
        onDropCow={dropCow}
        onMoveCow={moveCow}
        onEraseCow={(id) => setCows((h) => h.filter((c) => c.id !== id))}
      />
    </div>
  );
}

// Is requestAnimationFrame running at all under headless virtual time?
let frames = 0;
const tick = () => { frames += 1; document.title = `frames ${frames}`; requestAnimationFrame(tick); };
requestAnimationFrame(tick);

createRoot(document.getElementById('root')).render(<Live />);
