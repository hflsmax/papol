import React, { useLayoutEffect, useRef, useState } from 'react';

// The landing page's specimen: Hubble's 1929 paper, in excerpts, to be read
// the way Papol reads, before the visitor has an account. Nothing here
// talks to a server; it acts out in miniature what the viewer does with a
// real PDF. Nothing on it is explained either: what can be tried pulses
// until it has been. What is painted is the landing page's, which lays it
// on the board below.
//
// E. Hubble, "A Relation Between Distance and Radial Velocity Among
// Extra-Galactic Nebulae", PNAS 15 (1929) 168–173. Public domain in the
// US; the sentences are the paper's own, whole, from the archive.org scan
// (B-001-001-868).

// The footnotes as printed, and what a lookup makes of those it can place.
const REFERENCES = {
  1: {
    printed: 'Mt. Wilson Contr., No. 324; Astroph. J., Chicago, Ill., 64, 1926 (321).',
    title: 'Extra-galactic nebulae',
    authors: 'E. Hubble',
    venue: 'The Astrophysical Journal 64, 1926',
  },
  2: { printed: 'Harvard Coll. Obs. Circ., 294, 1926.' },
  3: { printed: 'Mon. Not. R. Astr. Soc., 85, 1925 (865–894).' },
  4: {
    printed: 'These Proceedings, 15, 1929 (167).',
    title: 'The Large Radial Velocity of N. G. C. 7619',
    authors: 'M. L. Humason',
    venue: 'Proceedings of the National Academy of Sciences 15, 1929',
  },
};

// The page, sentence by sentence, each with the printed page it is on. A
// sentence is a list of pieces: text, a footnote ({ cite }) or the words
// that lead to the figure ({ figure }).
const COLUMNS = [
  [
    { id: 's1', page: 168, parts: ['The present paper is a re-examination of the question, based on only those nebular distances which are believed to be fairly reliable.'] },
    { id: 's2', page: 168, parts: ['A study of these nebulae, together with those in which any stars at all can be recognized, indicates the probability of an approximately uniform upper limit to the absolute luminosity of stars, in the late-type spirals and irregular nebulae at least, of the order of M (photographic) = −6.3.', { cite: 1 }] },
    { id: 's3', page: 169, parts: ['Finally, the nebulae themselves appear to be of a definite order of absolute luminosity, exhibiting a range of four or five magnitudes about an average value M (visual) = −15.2.', { cite: 1 }] },
    { id: 's4', page: 170, parts: ['The data in the table indicate a linear correlation between distances and velocities, whether the latter are used directly or corrected for solar motion, according to the older solutions.'] },
    { id: 's5', page: 171, parts: ['Solutions of this sort have been published by Lundmark,', { cite: 3 }, ' who replaced the old K by k + lr + mr².'] },
  ],
  [
    { id: 's6', page: 171, parts: ['In order to exhibit the results in a graphical form, the solar motion has been eliminated from the observed velocities and the remainders, the distance terms plus the residuals, have been ', { figure: 'plotted against the distances' }, '.'] },
    { figureBlock: true },
    { id: 's7', page: 173, parts: ['The results establish a roughly linear relation between velocities and distances among nebulae for which velocities have been previously published, and the relation appears to dominate the distribution of velocities.'] },
    { id: 's8', page: 173, parts: ['The first definite result,', { cite: 4 }, ' v = +3779 km./sec. for N. G. C. 7619, is thoroughly consistent with the present conclusions.'] },
  ],
];

const BLOCKS = COLUMNS.flat().filter((block) => block.id);
const SUPERSCRIPT = { 1: '¹', 2: '²', 3: '³', 4: '⁴' };

export const SENTENCES = Object.fromEntries(BLOCKS.map((block) => [
  block.id,
  block.parts.map((part) => (typeof part === 'string' ? part : part.cite ? SUPERSCRIPT[part.cite] : part.figure)).join(''),
]));
export const PAGES = Object.fromEntries(BLOCKS.map((block) => [block.id, block.page]));

// Every place each work is cited, in reading order.
const OCCURRENCES = {};
BLOCKS.forEach((block) => block.parts.forEach((part, i) => {
  if (part.cite) (OCCURRENCES[part.cite] ||= []).push(`${block.id}-${i}`);
}));
const FIRST_CITATION = OCCURRENCES[1][0];

// Table 1 of the paper: distance (10⁶ parsecs) and measured velocity
// (km/sec) of the 24 nebulae whose distances were estimated.
const TABLE_1 = [
  [0.032, 170], [0.034, 290], [0.214, -130], [0.263, -70], [0.275, -185], [0.275, -220],
  [0.45, 200], [0.5, 290], [0.5, 270], [0.63, 200], [0.8, 300], [0.9, -30],
  [0.9, 650], [0.9, 150], [0.9, 500], [1.0, 920], [1.1, 450], [1.1, 500],
  [1.4, 500], [1.7, 960], [2.0, 500], [2.0, 850], [2.0, 800], [2.0, 1090],
];
const px = (r) => 48 + r * 78;
const py = (v) => 150 - (v + 400) * 0.0875;

// The figure, redrawn from table 1: the two solutions for K the paper
// gives (465 and 513 km/sec per million parsecs), and the cross at the
// mean of the 22 nebulae without distances (1.4 × 10⁶ parsecs, 745 km/sec).
function VelocityDistance() {
  return (
    <svg viewBox="0 0 228 172" aria-hidden="true" focusable="false" className="hubble-plot">
      <path className="plot-axis" d="M48 8V150H222" />
      <path className="plot-zero" d={`M48 ${py(0)}H222`} />
      <text x="44" y={py(1000) + 3} className="plot-label end">+1000 KM</text>
      <text x="44" y={py(500) + 3} className="plot-label end">500 KM</text>
      <text x="44" y={py(0) + 3} className="plot-label end">0</text>
      <text x={px(1)} y="162" className="plot-label middle">10⁶ PARSECS</text>
      <text x={px(2)} y="162" className="plot-label middle">2 × 10⁶</text>
      <path className="plot-tick" d={`M${px(1)} 150v3M${px(2)} 150v3`} />
      <path className="plot-fit" d={`M${px(0)} ${py(0)}L${px(2.2)} ${py(465 * 2.2)}`} />
      <path className="plot-fit dashed" d={`M${px(0)} ${py(0)}L${px(2.2)} ${py(513 * 2.2)}`} />
      {TABLE_1.map(([r, v], i) => <circle key={i} cx={px(r)} cy={py(v)} r="2.6" className="plot-dot" />)}
      <path className="plot-cross" d={`M${px(1.4) - 4} ${py(745)}h8M${px(1.4)} ${py(745) - 4}v8`} />
    </svg>
  );
}

export default function HomeSpecimen({ painted, onTogglePaint, flash, onGlow }) {
  const [tool, setTool] = useState('read');
  const [card, setCard] = useState(null); // { ref, at }
  const [figureOpen, setFigureOpen] = useState(false);
  const [tried, setTried] = useState({});
  const [cardBox, setCardBox] = useState(null);
  const pageRef = useRef(null);

  const markTried = (key) => setTried((current) => (current[key] ? current : { ...current, [key]: true }));

  const openCitation = (ref, occurrence) => {
    setCard({ ref: Number(ref), at: OCCURRENCES[ref].indexOf(occurrence) });
    markTried('cite');
  };

  const step = (by) => setCard((current) => {
    const count = OCCURRENCES[current.ref].length;
    return { ...current, at: (current.at + by + count) % count };
  });

  // The card hangs under the footnote it is showing, and follows it as the
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
          className={`specimen-link${tried.figure ? '' : ' beckon'}`}
          onClick={(e) => { e.stopPropagation(); setCard(null); setFigureOpen(true); markTried('figure'); }}
        >
          {part.figure}
        </button>
      );
    }
    const occurrence = `${block.id}-${i}`;
    const beckon = !tried.cite && occurrence === FIRST_CITATION;
    return (
      <button
        key={i}
        type="button"
        data-occurrence={occurrence}
        aria-label={`Footnote ${part.cite}`}
        className={`specimen-cite${occurrence === activeOccurrence ? ' active' : ''}${beckon ? ' beckon' : ''}`}
        onClick={(e) => { e.stopPropagation(); openCitation(part.cite, occurrence); }}
      >
        {part.cite}
      </button>
    );
  };

  const renderBlock = (block) => {
    if (block.figureBlock) {
      return (
        <figure key="figure" className="specimen-figure">
          <VelocityDistance />
          <figcaption>Velocity-Distance Relation among Extra-Galactic Nebulae.</figcaption>
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
      <div className="specimen-window">
        <div className="specimen-toolbar">
          <span className="specimen-doc-title">A Relation Between Distance and Radial Velocity Among Extra-Galactic Nebulae</span>
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
              className={`${tool === 'paint' ? 'active' : ''}${tried.paint || tool === 'paint' ? '' : ' beckon'}`}
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
            <p className="specimen-title">A Relation Between Distance and Radial Velocity Among Extra-Galactic Nebulae</p>
            <p className="specimen-authors">By Edwin Hubble · Mount Wilson Observatory</p>
            <p className="specimen-source">Proc. N. A. S. 15, 1929, pp. 168–173 · excerpts</p>
          </header>
          <div className="specimen-columns">
            {COLUMNS.map((column, c) => <div key={c} className="specimen-column">{column.map(renderBlock)}</div>)}
          </div>
          <ol className="specimen-references">
            {Object.entries(REFERENCES).map(([n, ref]) => (
              <li key={n}><span>{n}</span> {ref.printed}</li>
            ))}
          </ol>

          {reference && cardBox && (
            <div
              className="specimen-card"
              style={{ top: cardBox.top, left: cardBox.left, width: cardBox.width }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`Footnote ${card.ref}`}
            >
              <p className="specimen-card-title">{reference.title || reference.printed}</p>
              {reference.title && <p className="specimen-card-meta">{reference.authors} · {reference.venue}</p>}
              <div className="specimen-card-steps">
                <span>
                  {count === 1 ? 'Cited once in this paper' : `Cited ${count === 2 ? 'twice' : `${count} times`} in this paper`}
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
                <VelocityDistance />
                <figcaption>
                  Velocity-Distance Relation among Extra-Galactic Nebulae.
                  <span className="specimen-redrawn">Redrawn from the paper’s table 1.</span>
                </figcaption>
              </figure>
              <button
                type="button"
                className="specimen-return"
                onClick={() => { setFigureOpen(false); onGlow('s6'); }}
              >
                ← Back to where you were
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
