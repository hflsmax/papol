import React, { useLayoutEffect, useRef, useState } from 'react';

// The landing page's specimen: the opening of the AlphaFold 2 paper, in
// excerpts, to be read the way Papol reads, before the visitor has an
// account. Nothing here talks to a server; it acts out in miniature what
// the viewer does with a real PDF. Nothing on it is explained either: what
// can be tried pulses until it has been. What is painted is the landing
// page's, which lays it on the board below.
//
// J. Jumper et al., "Highly accurate protein structure prediction with
// AlphaFold", Nature 596, 583–589 (2021), under CC BY 4.0, which asks for
// credit, a link to the licence and a note of what was changed: the page
// shows all three. The sentences are the paper's own, whole, from
// nature.com; the figure is redrawn from the numbers its text gives.

const SOURCE_URL = 'https://doi.org/10.1038/s41586-021-03819-2';
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';

// The reference list's entries for the works these sentences cite, as
// printed, and the parts a card shows.
const REFERENCES = {
  10: {
    printed: 'Senior, A. W. et al. Improved protein structure prediction using potentials from deep learning. Nature 577, 706–710 (2020).',
    title: 'Improved protein structure prediction using potentials from deep learning',
    authors: 'Senior, A. W. et al.',
    venue: 'Nature 577, 706–710 (2020)',
  },
  11: {
    printed: 'Wang, S., Sun, S., Li, Z., Zhang, R. & Xu, J. Accurate de novo prediction of protein contact map by ultra-deep learning model. PLOS Comput. Biol. 13, e1005324 (2017).',
    title: 'Accurate de novo prediction of protein contact map by ultra-deep learning model',
    authors: 'Wang, S., Sun, S., Li, Z., Zhang, R. & Xu, J.',
    venue: 'PLOS Comput. Biol. 13, e1005324 (2017)',
  },
  12: {
    printed: 'Zheng, W. et al. Deep-learning contact-map guided protein structure prediction in CASP13. Proteins 87, 1149–1164 (2019).',
    title: 'Deep-learning contact-map guided protein structure prediction in CASP13',
    authors: 'Zheng, W. et al.',
    venue: 'Proteins 87, 1149–1164 (2019)',
  },
  13: {
    printed: 'Abriata, L. A., Tamò, G. E. & Dal Peraro, M. A further leap of improvement in tertiary structure prediction in CASP13 prompts new routes for future assessments. Proteins 87, 1100–1112 (2019).',
    title: 'A further leap of improvement in tertiary structure prediction in CASP13 prompts new routes for future assessments',
    authors: 'Abriata, L. A., Tamò, G. E. & Dal Peraro, M.',
    venue: 'Proteins 87, 1100–1112 (2019)',
  },
  14: {
    printed: 'Pearce, R. & Zhang, Y. Deep learning techniques have significantly impacted protein structure prediction and protein design. Curr. Opin. Struct. Biol. 68, 194–207 (2021).',
    title: 'Deep learning techniques have significantly impacted protein structure prediction and protein design',
    authors: 'Pearce, R. & Zhang, Y.',
    venue: 'Curr. Opin. Struct. Biol. 68, 194–207 (2021)',
  },
};

// The page, sentence by sentence. A sentence is a list of pieces: text, a
// citation ({ cites, label }: one marker, which may name several works) or
// the words that lead to the figure ({ figure }). An elision marks where
// the paper's own sentences were left out.
const COLUMNS = [
  [
    { id: 's1', parts: ['Proteins are essential to life, and understanding their structure can facilitate a mechanistic understanding of their function.'] },
    { elision: true },
    { id: 's2', parts: ['Structural coverage is bottlenecked by the months to years of painstaking effort required to determine a single protein structure.'] },
    { elision: true },
    { id: 's3', parts: ['Despite recent progress', { cites: [10, 11, 12, 13, 14], label: '10–14' }, ', existing methods fall far short of atomic accuracy, especially when no homologous structure is available.'] },
    { id: 's4', parts: ['Here we provide the first computational method that can regularly predict protein structures with atomic accuracy even in cases in which no similar structure is known.'] },
  ],
  [
    { id: 's5', parts: ['The neural network AlphaFold that we developed was entered into the CASP14 assessment (May–July 2020; entered under the team name ‘AlphaFold2’ and a completely different model from our CASP13 AlphaFold system', { cites: [10], label: '10' }, ').'] },
    { id: 's6', parts: ['In CASP14, AlphaFold structures were vastly more accurate than competing methods.'] },
    { id: 's7', parts: ['AlphaFold structures had a median backbone accuracy of 0.96 Å r.m.s.d.', { sub: '95' }, ' (Cα root-mean-square deviation at 95% residue coverage) (95% confidence interval = 0.85–1.16 Å) whereas the next best performing method had a median backbone accuracy of 2.8 Å r.m.s.d.', { sub: '95' }, ' (95% confidence interval = 2.7–4.0 Å) (measured on CASP domains; see ', { figure: 'Fig. 1a' }, ' for backbone accuracy and Supplementary Fig. 14 for all-atom accuracy).'] },
    { figureBlock: true },
    { id: 's8', parts: ['As a comparison point for this accuracy, the width of a carbon atom is approximately 1.4 Å.'] },
  ],
];

const BLOCKS = COLUMNS.flat().filter((block) => block.id);
const plain = (part) => {
  if (typeof part === 'string') return part;
  if (part.cites) return part.label.replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]).replace('–', '⁻');
  if (part.sub) return part.sub.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]);
  return part.figure;
};
export const SENTENCES = Object.fromEntries(BLOCKS.map((block) => [block.id, block.parts.map(plain).join('')]));
export const SOURCE = 'Jumper et al., 2021';

// Every citation, by where it stands, and every place each work is cited,
// in reading order.
const CITATIONS = {};
const OCCURRENCES = {};
BLOCKS.forEach((block) => block.parts.forEach((part, i) => {
  if (!part.cites) return;
  const at = `${block.id}-${i}`;
  CITATIONS[at] = part.cites;
  part.cites.forEach((ref) => (OCCURRENCES[ref] ||= []).push(at));
}));
const FIRST_CITATION = Object.keys(CITATIONS)[0];

// Fig. 1a, from the two of its bars the text gives: median Cα r.m.s.d.95
// on the CASP14 domains, with its 95% confidence interval, and the width
// of a carbon atom for comparison. The paper's figure has all top-15
// entries.
const BARS = [
  { name: 'AlphaFold', median: 0.96, low: 0.85, high: 1.16, own: true },
  { name: 'Next best', median: 2.8, low: 2.7, high: 4.0 },
];
const bx = (a) => 60 + a * 38; // 0–4.2 Å across 160 units
function BackboneAccuracy() {
  return (
    <svg viewBox="0 0 232 112" aria-hidden="true" focusable="false" className="fold-plot">
      {[0, 1, 2, 3, 4].map((a) => (
        <g key={a}>
          <path className="plot-grid" d={`M${bx(a)} 12V84`} />
          <text x={bx(a)} y="96" className="plot-label middle">{a}</text>
        </g>
      ))}
      <text x={bx(2.1)} y="108" className="plot-label middle">Median Cα r.m.s.d.₉₅ (Å)</text>
      {BARS.map((bar, i) => {
        const y = 22 + i * 30;
        return (
          <g key={bar.name}>
            <text x="54" y={y + 12} className="plot-label end">{bar.name}</text>
            <rect x={bx(0)} y={y} width={bx(bar.median) - bx(0)} height="18" className={`plot-bar${bar.own ? ' own' : ''}`} />
            <path className="plot-ci" d={`M${bx(bar.low)} ${y + 9}H${bx(bar.high)}M${bx(bar.low)} ${y + 5}v8M${bx(bar.high)} ${y + 5}v8`} />
          </g>
        );
      })}
      <path className="plot-atom" d={`M${bx(1.4)} 8V84`} />
      <text x={bx(1.4) + 3} y="11" className="plot-label">carbon atom, 1.4 Å</text>
    </svg>
  );
}

export default function HomeSpecimen({ painted, onTogglePaint, flash, onGlow }) {
  const [tool, setTool] = useState('read');
  const [card, setCard] = useState(null); // { at: where the citation stands, ref: the work shown }
  const [figureOpen, setFigureOpen] = useState(false);
  const [tried, setTried] = useState({});
  const [cardBox, setCardBox] = useState(null);
  const pageRef = useRef(null);

  const markTried = (key) => setTried((current) => (current[key] ? current : { ...current, [key]: true }));

  const openCitation = (at) => {
    setCard({ at, ref: CITATIONS[at][0] });
    markTried('cite');
  };
  // Between the works one citation names.
  const stepWork = (by) => setCard(({ at, ref }) => {
    const works = CITATIONS[at];
    return { at, ref: works[(works.indexOf(ref) + by + works.length) % works.length] };
  });
  // Between the places one work is cited.
  const stepPlace = (by) => setCard(({ at, ref }) => {
    const places = OCCURRENCES[ref];
    return { at: places[(places.indexOf(at) + by + places.length) % places.length], ref };
  });

  // The card hangs under the citation it is showing, and follows it as the
  // arrows step from one place to the next.
  const activeAt = card?.at;
  useLayoutEffect(() => {
    if (!activeAt || !pageRef.current) { setCardBox(null); return; }
    const marker = pageRef.current.querySelector(`[data-occurrence="${activeAt}"]`);
    if (!marker) return;
    const page = pageRef.current.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    const width = Math.min(320, page.width - 24);
    const left = Math.max(12, Math.min(box.left - page.left - 20, page.width - width - 12));
    setCardBox({ top: box.bottom - page.top + 8, left, width });
  }, [activeAt]);

  const togglePaint = (id) => {
    onTogglePaint(id);
    markTried('paint');
  };

  const renderPart = (block, part, i) => {
    if (typeof part === 'string') return part;
    if (part.sub) return <sub key={i}>{part.sub}</sub>;
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
    const at = `${block.id}-${i}`;
    return (
      <button
        key={i}
        type="button"
        data-occurrence={at}
        aria-label={`References ${part.label}`}
        className={`specimen-cite${at === activeAt ? ' active' : ''}${!tried.cite && at === FIRST_CITATION ? ' beckon' : ''}`}
        onClick={(e) => { e.stopPropagation(); openCitation(at); }}
      >
        {part.label}
      </button>
    );
  };

  const renderBlock = (block, index) => {
    if (block.elision) return <span key={`elision-${index}`} className="specimen-elision">[…] </span>;
    if (block.figureBlock) {
      return (
        <figure key="figure" className="specimen-figure">
          <BackboneAccuracy />
          <figcaption><b>Fig. 1:</b> AlphaFold produces highly accurate structures.</figcaption>
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
  const works = card ? CITATIONS[card.at] : [];
  const places = card ? OCCURRENCES[card.ref] : [];

  return (
    <div className="specimen">
      <div className="specimen-window">
        <div className="specimen-toolbar">
          <span className="specimen-doc-title">Highly accurate protein structure prediction with AlphaFold</span>
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
            <p className="specimen-kicker">Article</p>
            <p className="specimen-title">Highly accurate protein structure prediction with AlphaFold</p>
            <p className="specimen-authors">John Jumper, Richard Evans, Alexander Pritzel et al.</p>
            <p className="specimen-source">Nature 596, 583–589 (2021) · excerpts</p>
          </header>
          <div className="specimen-columns">
            {COLUMNS.map((column, c) => <div key={c} className="specimen-column">{column.map(renderBlock)}</div>)}
          </div>
          <ol className="specimen-references">
            {Object.entries(REFERENCES).map(([n, ref]) => (
              <li key={n}><span>{n}.</span> {ref.printed}</li>
            ))}
          </ol>
          <p className="specimen-licence">
            Excerpted from <a href={SOURCE_URL} target="_blank" rel="noreferrer">Jumper et al., Nature 2021</a>,
            {' '}<a href={LICENCE_URL} target="_blank" rel="noreferrer">CC BY 4.0</a>. Sentences left out are marked […];
            {' '}Fig. 1a is redrawn from the values in the text.
          </p>

          {reference && cardBox && (
            <div
              className="specimen-card"
              style={{ top: cardBox.top, left: cardBox.left, width: cardBox.width }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={`Reference ${card.ref}`}
            >
              {works.length > 1 && (
                <div className="specimen-card-works">
                  <button type="button" aria-label="Previous work" onClick={() => stepWork(-1)}>‹</button>
                  <span>{card.ref} · work {works.indexOf(card.ref) + 1} of {works.length}</span>
                  <button type="button" aria-label="Next work" onClick={() => stepWork(1)}>›</button>
                </div>
              )}
              <p className="specimen-card-title">{reference.title}</p>
              <p className="specimen-card-meta">{reference.authors} · {reference.venue}</p>
              <div className="specimen-card-steps">
                <span>
                  {places.length === 1 ? 'Cited once in this paper' : `Cited ${places.length === 2 ? 'twice' : `${places.length} times`} in this paper`}
                  {places.length > 1 && <b> · {places.indexOf(card.at) + 1} of {places.length}</b>}
                </span>
                {places.length > 1 && (
                  <span className="specimen-card-arrows">
                    <button type="button" aria-label="Previous place" onClick={() => stepPlace(-1)}>↑</button>
                    <button type="button" aria-label="Next place" onClick={() => stepPlace(1)}>↓</button>
                  </span>
                )}
              </div>
            </div>
          )}

          {figureOpen && (
            <div className="specimen-figure-stage" onClick={(e) => e.stopPropagation()}>
              <figure className="specimen-figure large">
                <BackboneAccuracy />
                <figcaption>
                  <b>Fig. 1a</b> The performance of AlphaFold on the CASP14 dataset (n = 87 protein domains).
                  <span className="specimen-redrawn">Redrawn with the two entries the text gives; the paper’s figure shows the top 15.</span>
                </figcaption>
              </figure>
              <button
                type="button"
                className="specimen-return"
                onClick={() => { setFigureOpen(false); onGlow('s7'); }}
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
