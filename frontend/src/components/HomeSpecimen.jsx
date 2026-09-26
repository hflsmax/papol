import React, { useLayoutEffect, useRef, useState } from 'react';

// The landing page's specimen: a page of a paper a visitor can read the way
// Papol reads, before they have an account. Nothing here talks to a server;
// it acts out, in miniature, what the viewer does with a real PDF — a
// citation's card that steps through every place it is cited, a figure
// that comes to the reader, and a brush. What is painted is the landing
// page's, which lays it on the board further down.

const REFERENCES = {
  4: {
    authors: 'D. A. Huffman',
    title: 'Curvature and creases: a primer on paper',
    venue: 'IEEE Transactions on Computers, 1976',
  },
  7: {
    authors: 'S. Felton, M. Tolley, E. Demaine, D. Rus, R. Wood',
    title: 'A method for building self-folding machines',
    venue: 'Science, 2014',
  },
  12: {
    authors: 'E. D. Demaine, J. O’Rourke',
    title: 'Geometric Folding Algorithms',
    venue: 'Cambridge University Press, 2007',
  },
};

// The page, sentence by sentence. A sentence is a list of pieces: text, a
// citation ({ cite }) or the link to the figure ({ figure }).
const COLUMNS = [
  [
    { heading: '1  Introduction' },
    { id: 's1', parts: ['A sheet of paper, folded along the right creases, can hold a bit, count, and even compute ', { cite: 12 }, '. '] },
    { id: 's2', parts: ['Early work treated folding as a geometric curiosity ', { cite: 4 }, '; the modern view treats every crease as a small machine. '] },
    { id: 's3', parts: ['The pattern in ', { figure: true }, ' flips between two stable states when pressed at its centre.'] },
    { heading: '2  Rules of the crease' },
    { id: 's4', parts: ['Every flat-foldable pattern obeys a handful of rules at each vertex ', { cite: 12 }, '. '] },
    { id: 's5', parts: ['Those rules decide, before a single fold is made, whether a design will fold at all.'] },
  ],
  [
    { id: 's6', parts: ['What they leave open is how quickly a folded machine can switch, and how many times it can before the paper tires. '] },
    { figureBlock: true },
    { id: 's7', parts: ['Robots now fold themselves out of a flat sheet in minutes ', { cite: 7 }, ', guided by the same rules ', { cite: 12 }, '.'] },
  ],
];

export const SENTENCES = Object.fromEntries(
  COLUMNS.flat().filter((block) => block.id).map((block) => [
    block.id,
    block.parts.map((part) => (typeof part === 'string' ? part : part.cite ? `[${part.cite}]` : 'Figure 2')).join('').trim(),
  ]),
);

// Every place each work is cited, in reading order.
const OCCURRENCES = {};
COLUMNS.flat().forEach((block) => block.parts?.forEach((part, i) => {
  if (part.cite) (OCCURRENCES[part.cite] ||= []).push(`${block.id}-${i}`);
}));

function CreasePattern() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect x="6" y="6" width="108" height="108" className="crease-sheet" />
      <path className="crease-mountain" d="M6 6 114 114M114 6 6 114" />
      <path className="crease-valley" d="M60 6v108M6 60h108" />
      <circle cx="60" cy="60" r="3.5" className="crease-centre" />
    </svg>
  );
}

const TRIES = [
  { key: 'cite', label: 'Click a citation, like [12]' },
  { key: 'figure', label: 'Open Figure 2' },
  { key: 'paint', label: 'Paint a sentence with the brush' },
];

export default function HomeSpecimen({ painted, onTogglePaint, flash, onGlow }) {
  const [tool, setTool] = useState('read');
  const [card, setCard] = useState(null); // { ref, at }
  const [figureOpen, setFigureOpen] = useState(false);
  const [tried, setTried] = useState({});
  const [cardBox, setCardBox] = useState(null);
  const pageRef = useRef(null);

  const markTried = (key) => setTried((current) => (current[key] ? current : { ...current, [key]: true }));

  const openCitation = (ref, occurrence) => {
    setCard({ ref, at: OCCURRENCES[ref].indexOf(occurrence) });
    markTried('cite');
  };

  const step = (by) => setCard((current) => {
    const count = OCCURRENCES[current.ref].length;
    return { ...current, at: (current.at + by + count) % count };
  });

  // The card hangs under the citation it is showing, and follows it as the
  // arrows step from one place to the next.
  const activeOccurrence = card && OCCURRENCES[card.ref][card.at];
  useLayoutEffect(() => {
    if (!activeOccurrence || !pageRef.current) { setCardBox(null); return; }
    const marker = pageRef.current.querySelector(`[data-occurrence="${activeOccurrence}"]`);
    if (!marker) return;
    const page = pageRef.current.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    const width = Math.min(300, page.width - 24);
    const left = Math.max(12, Math.min(box.left - page.left - 20, page.width - width - 12));
    setCardBox({ top: box.bottom - page.top + 8, left, width });
  }, [activeOccurrence]);

  const togglePaint = (id) => {
    onTogglePaint(id);
    markTried('paint');
  };

  const renderPart = (block, part, i) => {
    if (typeof part === 'string') return part;
    if (part.figure) {
      return (
        <button
          key={i}
          type="button"
          className="specimen-link"
          onClick={(e) => { e.stopPropagation(); setCard(null); setFigureOpen(true); markTried('figure'); }}
        >
          Figure 2
        </button>
      );
    }
    const occurrence = `${block.id}-${i}`;
    return (
      <button
        key={i}
        type="button"
        data-occurrence={occurrence}
        className={`specimen-cite${occurrence === activeOccurrence ? ' active' : ''}`}
        onClick={(e) => { e.stopPropagation(); openCitation(part.cite, occurrence); }}
      >
        [{part.cite}]
      </button>
    );
  };

  const renderBlock = (block) => {
    if (block.heading) return <h4 key={block.heading} className="specimen-heading">{block.heading}</h4>;
    if (block.figureBlock) {
      return (
        <figure key="figure" className="specimen-figure">
          <CreasePattern />
          <figcaption><b>Figure 2.</b> A bistable crease pattern.</figcaption>
        </figure>
      );
    }
    const isPainted = painted.includes(block.id);
    const paintable = tool === 'paint';
    return (
      <span
        key={block.id}
        data-sentence={block.id}
        className={`specimen-sentence${isPainted ? ' painted' : ''}${flash === block.id ? ' flash' : ''}${paintable ? ' paintable' : ''}`}
        onClick={paintable ? () => togglePaint(block.id) : undefined}
        onKeyDown={paintable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePaint(block.id); } } : undefined}
        role={paintable ? 'button' : undefined}
        aria-pressed={paintable ? isPainted : undefined}
        tabIndex={paintable ? 0 : undefined}
      >
        {block.parts.map((part, i) => renderPart(block, part, i))}{' '}
      </span>
    );
  };

  const reference = card && REFERENCES[card.ref];
  const count = card ? OCCURRENCES[card.ref].length : 0;

  return (
    <div className="specimen">
      <ol className="specimen-tries" aria-label="Things to try on this page">
        {TRIES.map((each) => (
          <li key={each.key} className={tried[each.key] ? 'done' : ''}>
            <span className="specimen-tick" aria-hidden="true">{tried[each.key] ? '✓' : ''}</span>
            {each.label}
          </li>
        ))}
      </ol>

      <div className="specimen-window">
        <div className="specimen-toolbar">
          <span className="specimen-doc-title">Folding as Computation</span>
          <span className="specimen-tools" role="group" aria-label="Tool">
            <button
              type="button"
              className={tool === 'read' ? 'active' : ''}
              aria-pressed={tool === 'read'}
              onClick={() => setTool('read')}
              title="Read"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5 12 8.2l-3.9.6 2.2 4.4-1.6.8-2.2-4.4-3 2.6Z" /></svg>
              Read
            </button>
            <button
              type="button"
              className={tool === 'paint' ? 'active' : ''}
              aria-pressed={tool === 'paint'}
              onClick={() => { setTool('paint'); setCard(null); }}
              title="Paint"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.6 2.4c-.6-.6-1.5-.5-2.1.1L6.3 8l1.7 1.7 5.5-5.2c.6-.6.7-1.5.1-2.1ZM5.4 9c-1.4 0-2.4 1-2.4 2.3 0 .9-.5 1.6-1 2.1 2.7.5 5.1-.4 5.1-2.7Z" /></svg>
              Paint
            </button>
          </span>
        </div>

        <div className={`specimen-page${tool === 'paint' ? ' painting' : ''}`} ref={pageRef} onClick={() => setCard(null)}>
          <header className="specimen-masthead">
            <p className="specimen-title">Folding as Computation</p>
            <p className="specimen-authors">A specimen page · try it</p>
          </header>
          <div className="specimen-columns">
            {COLUMNS.map((column, c) => <div key={c} className="specimen-column">{column.map(renderBlock)}</div>)}
          </div>
          <ol className="specimen-references">
            {Object.entries(REFERENCES).map(([n, ref]) => (
              <li key={n}><span>[{n}]</span> {ref.authors}. {ref.title}. <i>{ref.venue}</i>.</li>
            ))}
          </ol>

          {reference && cardBox && (
            <div
              className="specimen-card"
              style={{ top: cardBox.top, left: cardBox.left, width: cardBox.width }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`Reference ${card.ref}`}
            >
              <p className="specimen-card-title">{reference.title}</p>
              <p className="specimen-card-meta">{reference.authors} · {reference.venue}</p>
              <div className="specimen-card-steps">
                <span>
                  {count === 1 ? 'Cited once in this paper' : `Cited ${count} times in this paper`}
                  {count > 1 && <b> · {card.at + 1} of {count}</b>}
                </span>
                {count > 1 && (
                  <span className="specimen-card-arrows">
                    <button type="button" aria-label="Previous place" onClick={() => step(-1)}>↑</button>
                    <button type="button" aria-label="Next place" onClick={() => step(1)}>↓</button>
                  </span>
                )}
              </div>
            </div>
          )}

          {figureOpen && (
            <div className="specimen-figure-stage" onClick={(e) => e.stopPropagation()}>
              <figure className="specimen-figure large">
                <CreasePattern />
                <figcaption>
                  <b>Figure 2.</b> A bistable crease pattern. Mountain folds solid, valley folds dashed.
                </figcaption>
              </figure>
              <button
                type="button"
                className="specimen-return"
                onClick={() => { setFigureOpen(false); onGlow('s3'); }}
              >
                ← Back to where you were
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="specimen-progress" aria-live="polite">
        {painted.length > 0 && (
          <a href="#think">
            {painted.length === 1 ? 'One sentence is' : `${painted.length} sentences are`} on your board below ↓
          </a>
        )}
      </p>
    </div>
  );
}
