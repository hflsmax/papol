import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The landing page's specimen: the RustBelt paper, in excerpts, to be read
// the way Papol reads, before the visitor has an account. Nothing here
// talks to a server; it acts out in miniature what the viewer does with a
// real PDF. Nothing on it is explained either: what can be tried pulses,
// one thing at a time, until it has been. What is painted is the landing
// page's, which lays it on the board below.
//
// R. Jung, J.-H. Jourdan, R. Krebbers and D. Dreyer, "RustBelt: Securing
// the Foundations of the Rust Programming Language", Proc. ACM Program.
// Lang. 2, POPL, Article 66 (2018), under CC BY 4.0, which asks for credit,
// a link to the licence and a note of what was changed: the page shows all
// three. The sentences are the paper's own, whole; the rules are three of
// the eight in its Fig. 2, set again in type.

const SOURCE_URL = 'https://doi.org/10.1145/3158154';
const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/';

// The reference list's entries for the works these sentences cite, as
// printed, the label the text cites each by, and the parts a card shows.
const REFERENCES = {
  appendix: {
    label: 'Jung et al. 2017a',
    printed: 'Ralf Jung, Jacques-Henri Jourdan, Robbert Krebbers, and Derek Dreyer. 2017a. RustBelt: Securing the foundations of the Rust programming language – Technical appendix and Coq development. https://plv.mpi-sws.org/rustbelt/popl18/.',
    title: 'RustBelt: Securing the foundations of the Rust programming language – Technical appendix and Coq development',
    authors: 'Ralf Jung, Jacques-Henri Jourdan, Robbert Krebbers, and Derek Dreyer',
    venue: 'plv.mpi-sws.org/rustbelt/popl18 (2017)',
  },
  language: {
    label: 'Matsakis and Klock II 2014',
    printed: 'Nicholas D. Matsakis and Felix S. Klock II. 2014. The Rust language. In SIGAda Ada Letters, Vol. 34. https://doi.org/10.1145/2663171.2663188',
    title: 'The Rust language',
    authors: 'Nicholas D. Matsakis and Felix S. Klock II',
    venue: 'SIGAda Ada Letters, Vol. 34 (2014)',
  },
  team: {
    label: 'Rust team 2017',
    printed: 'The Rust team. 2017. The Rust programming language. http://rust-lang.org/.',
    title: 'The Rust programming language',
    authors: 'The Rust team',
    venue: 'rust-lang.org (2017)',
  },
};

// The page, sentence by sentence. A sentence is a list of pieces: text, a
// citation ({ cites }: one bracketed marker, which may name several works),
// the words that lead to the figure ({ figure }) or the name of a typing
// rule ({ rule }). An elision marks where the paper's own sentences were
// left out.
const COLUMNS = [
  [
    { id: 's1', parts: ['Systems programming languages like C and C++ give programmers low-level control over resource management at the expense of safety, whereas most other modern languages give programmers safe, high-level abstractions at the expense of control.'] },
    { id: 's2', parts: ['It has long been a “holy grail” of programming languages research to overcome this seemingly fundamental tradeoff and design a language that offers programmers both high-level safety and low-level control.'] },
    { id: 's3', parts: ['Rust ', { cites: ['language', 'team'] }, ', developed at Mozilla Research, comes closer to achieving this holy grail than any other industrially supported programming language to date.'] },
    { elision: true },
    { id: 's4', parts: ['All results in this paper have been fully formalized in the Coq proof assistant ', { cites: ['appendix'] }, '.'] },
    { elision: true },
  ],
  [
    { id: 's5', parts: ['The details of the core language are fully spelled out in our technical appendix ', { cites: ['appendix'] }, '.'] },
    { elision: true },
    { id: 's6', parts: ['Selected typing rules are shown in Figure 1 and ', { figure: 'Figure 2' }, '.'] },
    { elision: true },
    { id: 's7', parts: ['Lifetimes begin and end at the newlft and endlft ghost instructions, following ', { rule: 'F-newlft' }, ' and ', { rule: 'F-endlft' }, '.'] },
    { elision: true },
    { id: 's8', parts: ['We mostly use ', { rule: 'F-let' }, ' to type-check the function one instruction at a time.'] },
  ],
];
const FIGURE_SENTENCE = 's6';

const BLOCKS = COLUMNS.flat().filter((block) => block.id);
const citeLabel = (part) => part.cites.map((ref) => REFERENCES[ref].label).join('; ');
const plain = (part) => {
  if (typeof part === 'string') return part;
  if (part.cites) return `[${citeLabel(part)}]`;
  return part.figure || part.rule;
};
export const SENTENCES = Object.fromEntries(BLOCKS.map((block) => [block.id, block.parts.map(plain).join('')]));
export const SOURCE = 'Jung et al., 2018';

// Every citation, by where it stands, and every place each work is cited,
// in reading order; and the first place a rule is named.
const CITATIONS = {};
const OCCURRENCES = {};
let FIRST_RULE = null;
BLOCKS.forEach((block) => block.parts.forEach((part, i) => {
  const at = `${block.id}-${i}`;
  if (part.rule) FIRST_RULE ||= at;
  if (!part.cites) return;
  CITATIONS[at] = part.cites;
  part.cites.forEach((ref) => (OCCURRENCES[ref] ||= []).push(at));
}));
const FIRST_CITATION = Object.keys(CITATIONS)[0];

// The typing rules the text names, as Fig. 2 prints them: premises over a
// bar, the conclusion under it, the name over its left end. Contexts are
// bold, keywords bold sans, a list of lifetimes overlined.
const E = <b>E</b>;
const L = <b>L</b>;
const K = <b>K</b>;
const T = <b>T</b>;
const word = (w) => <b className="rule-word">{w}</b>;
const many = (x) => <span className="rule-many">{x}</span>;
const RULES = {
  'F-let': {
    premises: [
      [<>Γ | {E}; {L} | {T}<sub>1</sub> ⊢ <i>I</i> ⊣ <i>x</i>. {T}<sub>2</sub></>],
      [<>Γ, <i>x</i> : {word('val')} | {E}; {L} | {K}; {T}<sub>2</sub>, {T} ⊢ <i>F</i></>],
    ],
    conclusion: <>Γ | {E}; {L} | {K}; {T}<sub>1</sub>, {T} ⊢ {word('let')} <i>x</i> = <i>I</i> {word('in')} <i>F</i></>,
  },
  'F-newlft': {
    premises: [[<>Γ, <i>α</i> : {word('lft')} | {E}; {L}, <i>α</i> ⊑<sub>l</sub> {many(<i>κ</i>)} | {K}; {T} ⊢ <i>F</i></>]],
    conclusion: <>Γ | {E}; {L} | {K}; {T} ⊢ {word('newlft')}; <i>F</i></>,
  },
  'F-endlft': {
    premises: [[<>Γ | {E}; {L} | {K}; <b>T′</b> ⊢ <i>F</i></>, <>{T} ⇒<sup>†<i>κ</i></sup> <b>T′</b></>]],
    conclusion: <>Γ | {E}; {L}, <i>κ</i> ⊑<sub>l</sub> {many(<i>κ</i>)} | {K}; {T} ⊢ {word('endlft')}; <i>F</i></>,
  },
};

function Rule({ name, flash }) {
  const rule = RULES[name];
  return (
    <span className={`rule${flash ? ' flash' : ''}`} data-rule={name}>
      <span className="rule-name">{name}</span>
      {rule.premises.map((row, i) => (
        <span key={i} className="rule-row">
          {row.map((premise, j) => <span key={j}>{premise}</span>)}
        </span>
      ))}
      <span className="rule-bar" />
      <span className="rule-row"><span>{rule.conclusion}</span></span>
    </span>
  );
}

// Fig. 2, with the three of its rules the excerpts name.
function TypingRules({ flash }) {
  return (
    <>
      <p className="rule-judgment">
        <b>Rules for typing of function bodies:</b>
        <span>(Γ | {E}; {L} | {K}; {T} ⊢ <i>F</i>)</span>
      </p>
      <div className="specimen-rules">
        {Object.keys(RULES).map((name) => <Rule key={name} name={name} flash={flash === name} />)}
      </div>
    </>
  );
}
const CAPTION = <>A selection of the typing rules of λ<sub>Rust</sub> (function bodies).</>;

const ICONS = {
  home: <path d="M2.5 8 8 3l5.5 5M4 7v6h3v-3.5h2V13h3V7" />,
  read: <path d="M3.5 2.5 12 8.2l-3.9.6 2.2 4.4-1.6.8-2.2-4.4-3 2.6Z" />,
  paint: <path d="M13.6 2.4c-.6-.6-1.5-.5-2.1.1L6.3 8l1.7 1.7 5.5-5.2c.6-.6.7-1.5.1-2.1ZM5.4 9c-1.4 0-2.4 1-2.4 2.3 0 .9-.5 1.6-1 2.1 2.7.5 5.1-.4 5.1-2.7Z" />,
};

// A tool, as the viewer's toolbar draws it: its icon, and the key that
// picks it.
function Tool({ name, label, keyLetter, active, beckon, onClick }) {
  return (
    <button
      type="button"
      className={`specimen-tool${active ? ' active' : ''}${beckon ? ' beckon' : ''}`}
      data-hint={beckon ? 'Click' : undefined}
      aria-pressed={active}
      aria-label={label}
      title={`${label} (${keyLetter})`}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">{ICONS[name]}</svg>
      <span className="specimen-key" aria-hidden="true">{keyLetter}</span>
    </button>
  );
}

export default function HomeSpecimen({ painted, onTogglePaint, flash, onGlow, beckoning, onTried }) {
  const [tool, setTool] = useState('read');
  const [card, setCard] = useState(null); // { at: where the citation stands, ref: the work shown }
  const [figureOpen, setFigureOpen] = useState(false);
  const [cardBox, setCardBox] = useState(null);
  const [scope, setScope] = useState(null); // the telescope: { at: where the rule is named, name }
  const [scopeBox, setScopeBox] = useState(null);
  const [ruleFlash, setRuleFlash] = useState(null);
  const pageRef = useRef(null);
  const scopeRef = useRef(null);
  const wasScoped = useRef(false);
  const cardRef = useRef(null);
  const returnRef = useRef(null);
  const opener = useRef(null);

  const openCitation = (at, trigger) => {
    opener.current = trigger;
    setCard({ at, ref: CITATIONS[at][0] });
    onTried('cite');
  };
  const closeCitation = () => {
    setCard(null);
    opener.current?.focus();
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

  // A rule's name brings the rule under its line while the pointer rests on
  // it (or it has the focus, or a finger tapped it); a press then leads to
  // the rule where the paper prints it.
  const openScope = (at, name) => {
    setCard(null);
    setScope({ at, name });
    onTried('rule');
  };
  const leadToRule = (name) => {
    setScope(null);
    pageRef.current?.querySelector(`.specimen-rules [data-rule="${name}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setRuleFlash(null);
    requestAnimationFrame(() => setRuleFlash(name));
  };

  const openFigure = (trigger) => {
    opener.current = trigger;
    setCard(null);
    setScope(null);
    setFigureOpen(true);
    onTried('figure');
  };
  const closeFigure = () => {
    setFigureOpen(false);
    onGlow(FIGURE_SENTENCE);
    opener.current?.focus();
  };

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

  // The telescope hangs under the line that names its rule, kept on the page.
  const scopeAt = scope?.at;
  useLayoutEffect(() => {
    if (!scopeAt || !pageRef.current || !scopeRef.current) { setScopeBox(null); return; }
    const marker = pageRef.current.querySelector(`[data-rule-at="${scopeAt}"]`);
    if (!marker) return;
    const page = pageRef.current.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    const width = scopeRef.current.offsetWidth;
    const left = Math.max(8, Math.min(box.left - page.left - 12, page.width - width - 8));
    setScopeBox({ top: box.bottom - page.top + 6, left });
  }, [scopeAt]);

  // What opens takes the focus, so the keyboard is where the eye is.
  const cardOpen = Boolean(card && cardBox);
  useEffect(() => { if (cardOpen) cardRef.current?.focus(); }, [cardOpen]);
  useEffect(() => { if (figureOpen) returnRef.current?.focus(); }, [figureOpen]);

  const onEscape = (close) => (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };

  // Links in the running text are spans, not buttons: a button is set as a
  // block of its own, which lets a line break between "system" and its ¹⁰.
  const inline = (onActivate) => ({
    role: 'button',
    tabIndex: 0,
    onClick: (e) => { e.stopPropagation(); onActivate(e.currentTarget); },
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      onActivate(e.currentTarget);
    },
  });

  const renderPart = (block, part, i) => {
    if (typeof part === 'string') return part;
    const at = `${block.id}-${i}`;
    if (part.figure) {
      return (
        <span
          key={i}
          className={`specimen-link${beckoning === 'figure' ? ' beckon' : ''}`}
          data-hint={beckoning === 'figure' ? 'Click' : undefined}
          {...inline(openFigure)}
        >
          {part.figure}
        </span>
      );
    }
    if (part.rule) {
      const beckon = beckoning === 'rule' && at === FIRST_RULE && scopeAt !== at;
      return (
        <span
          key={i}
          role="button"
          tabIndex={0}
          data-rule-at={at}
          aria-label={`Rule ${part.rule}`}
          className={`specimen-link specimen-rule${at === scopeAt ? ' active' : ''}${beckon ? ' beckon' : ''}`}
          data-hint={beckon ? 'Hover' : undefined}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') openScope(at, part.rule); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setScope(null); }}
          onPointerDown={() => { wasScoped.current = scopeAt === at; }}
          onFocus={() => openScope(at, part.rule)}
          onBlur={() => setScope((current) => (current?.at === at ? null : current))}
          onClick={(e) => {
            e.stopPropagation();
            if (wasScoped.current) leadToRule(part.rule); else openScope(at, part.rule);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && scopeAt === at) { e.stopPropagation(); setScope(null); }
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            leadToRule(part.rule);
          }}
        >
          {part.rule}
        </span>
      );
    }
    const label = citeLabel(part);
    return (
      <span
        key={i}
        data-occurrence={at}
        aria-label={`Citation ${label}`}
        className={`specimen-cite${at === activeAt ? ' active' : ''}${beckoning === 'cite' && at === FIRST_CITATION ? ' beckon' : ''}`}
        data-hint={beckoning === 'cite' && at === FIRST_CITATION ? 'Click' : undefined}
        {...inline((trigger) => openCitation(at, trigger))}
      >
        [{label}]
      </span>
    );
  };

  const renderBlock = (block, index) => {
    if (block.elision) return <span key={`elision-${index}`} className="specimen-elision">[…] </span>;
    const isPainted = painted.includes(block.id);
    const paintable = tool === 'paint';
    return (
      <span
        key={block.id}
        data-sentence={block.id}
        className={`specimen-sentence${isPainted ? ' painted' : ''}${flash === block.id ? ' flash' : ''}${paintable ? ' paintable' : ''}`}
        onClick={paintable ? () => onTogglePaint(block.id) : undefined}
        onKeyDown={paintable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTogglePaint(block.id); } } : undefined}
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
          <svg className="specimen-home" viewBox="0 0 16 16" aria-hidden="true">{ICONS.home}</svg>
          <span className="specimen-doc-title">RustBelt: Securing the Foundations of the Rust Programming Language</span>
          <span className="specimen-tools" role="group" aria-label="Tool">
            <Tool name="read" label="Select" keyLetter="Z" active={tool === 'read'} onClick={() => setTool('read')} />
            <Tool
              name="paint"
              label="Paint"
              keyLetter="V"
              active={tool === 'paint'}
              beckon={beckoning === 'paint' && tool !== 'paint'}
              onClick={() => { setTool('paint'); setCard(null); setScope(null); }}
            />
          </span>
        </div>

        <div className={`specimen-page${tool === 'paint' ? ' painting' : ''}`} ref={pageRef} onClick={() => { setCard(null); setScope(null); }}>
          <p className="specimen-running-head"><span>Proc. ACM Program. Lang., Vol. 2, No. POPL</span><span>Article 66</span></p>
          <header className="specimen-masthead">
            <p className="specimen-title">RustBelt: Securing the Foundations of the Rust Programming Language</p>
            <p className="specimen-authors">Ralf Jung, Jacques-Henri Jourdan, Robbert Krebbers, and Derek Dreyer</p>
          </header>
          <div className="specimen-columns">
            {COLUMNS.flat().map(renderBlock)}
          </div>
          <figure className="specimen-figure rules">
            <TypingRules flash={ruleFlash} />
            <figcaption><b>Fig. 2.</b> {CAPTION}</figcaption>
          </figure>
          <ol className="specimen-references">
            {Object.entries(REFERENCES).map(([key, ref]) => <li key={key}>{ref.printed}</li>)}
          </ol>
          <p className="specimen-licence">
            Excerpted from <a href={SOURCE_URL} target="_blank" rel="noreferrer">Jung et al., POPL 2018</a>,
            {' '}<a href={LICENCE_URL} target="_blank" rel="noreferrer">CC BY 4.0</a>. Sentences left out are marked […];
            {' '}Fig. 2 is set again in type, with three of its eight rules.
          </p>
          <p className="specimen-folio" aria-hidden="true">66:1</p>

          {scope && (
            <div
              ref={scopeRef}
              className="specimen-telescope"
              style={scopeBox ? { top: scopeBox.top, left: scopeBox.left } : { visibility: 'hidden' }}
              aria-hidden="true"
            >
              <Rule name={scope.name} />
            </div>
          )}

          {reference && cardBox && (
            <div
              ref={cardRef}
              tabIndex={-1}
              className="specimen-card"
              style={{ top: cardBox.top, left: cardBox.left, width: cardBox.width }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={onEscape(closeCitation)}
              role="dialog"
              aria-label={`Reference ${reference.label}`}
            >
              {works.length > 1 && (
                <div className="specimen-card-works">
                  <button type="button" aria-label="Previous work" onClick={() => stepWork(-1)}>‹</button>
                  <span>{reference.label} · work {works.indexOf(card.ref) + 1} of {works.length}</span>
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
            <div className="specimen-figure-stage" onClick={(e) => e.stopPropagation()} onKeyDown={onEscape(closeFigure)}>
              <figure className="specimen-figure rules large">
                <TypingRules />
                <figcaption>
                  <b>Fig. 2.</b> {CAPTION}
                  <span className="specimen-redrawn">Set again in type, with three of the figure’s eight rules.</span>
                </figcaption>
              </figure>
              <button ref={returnRef} type="button" className="specimen-return" onClick={closeFigure}>
                ← Back to where you were
              </button>
            </div>
          )}
        </div>
      </div>
      {painted.length > 0 && (
        <a className="specimen-landed" href="#board">
          {painted.length === 1 ? '1 sentence' : `${painted.length} sentences`} on Rust, proved safe ↓
        </a>
      )}
    </div>
  );
}
