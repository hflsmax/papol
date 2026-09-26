import React, { useState } from 'react';
import { appPath } from '../base';
import HomeBoard from './HomeBoard';
import HomeSpecimen from './HomeSpecimen';
import StatePill from './StatePill';

const MACOS_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// A folder's review, as Folder Drop shows it.
const FOLDER = [
  { title: 'Attention Is All You Need', note: 'Where the architecture begins. Read this first.', state: 'new', label: 'New' },
  { title: 'Scaling Laws for Neural Language Models', note: 'Why bigger keeps getting better, and by how much.', state: 'new', label: 'New' },
  { title: 'Language Models are Few-Shot Learners', note: 'The agent could not get the PDF.', state: 'paywall', label: 'Behind a paywall' },
  { title: 'BERT: Pre-training of Deep Bidirectional Transformers', note: 'You read this in March.', state: 'have', label: 'Already in your nook' },
];

const READERS = [
  { initial: 'M', tint: 0, name: 'Mei', thought: 'Section 3 is the whole paper. Read it twice.' },
  { initial: 'T', tint: 2, name: 'Tomás', thought: 'The proof of Lemma 2 skips a case.' },
  { initial: 'A', tint: 4, name: 'Aisha', thought: 'Pairs well with Huffman ’76.' },
];

// Papol's places, as the hero lists them. Talk is on its way; it takes its
// place here, and a section of its own, when it comes.
const PLACES = [
  {
    id: 'read', name: 'Read', line: 'A PDF reader that knows it’s reading a paper',
    icon: <path d="M3 4.5c2.5-1 4.5-1 7 .5 2.5-1.5 4.5-1.5 7-.5v11c-2.5-1-4.5-1-7 .5-2.5-1.5-4.5-1.5-7-.5ZM10 5v11" />,
  },
  {
    id: 'think', name: 'Think', line: 'A board for everything a paper sets off',
    icon: <path d="M3 3.5h6v6H3ZM11 3.5h6v4h-6ZM11 9.5h6v7h-6ZM3 11.5h6v5H3Z" />,
  },
  {
    id: 'find', name: 'Find', line: 'A library of every paper, and who reads it',
    icon: <path d="M3 16.5h14M4.5 16.5v-12h3v12M8.5 16.5v-10h3v10M12.6 16.3l-1-9.6 2.9-.4 1.1 9.6" />,
  },
  {
    id: 'talk', name: 'Talk', line: 'Chat, beside your papers', soon: true,
    icon: <path d="M3.5 4.5h13v8.5h-7l-4 3v-3h-2Z" />,
  },
];

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
           -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
           .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
           -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
           .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
           .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
           0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42
           -3.58-8-8-8Z"
      />
    </svg>
  );
}

// What a visitor sees: what Papol is, and the way in for someone who
// already knows; then each of its places, the reader first, as a page to
// try, whose painted sentences land on the board below it.
export default function HomePage() {
  const [painted, setPainted] = useState([]);
  const [flash, setFlash] = useState(null);

  const glow = (id) => {
    setFlash(null);
    requestAnimationFrame(() => setFlash(id));
  };
  const togglePaint = (id) => setPainted((current) => (
    current.includes(id) ? current.filter((each) => each !== id) : [...current, id]
  ));
  // A card's backlink: back up to the page, to the sentence it came from.
  const backTo = (id) => {
    document.querySelector(`[data-sentence="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    glow(id);
  };

  return (
    <div className="landing">
      <header className="landing-hero">
        <p className="landing-eyebrow">Papol · your paper reading companion</p>
        <h1 className="landing-title">Papers, and everything you think about them.</h1>
        <p className="landing-lede">
          Papol is where you read a paper, gather everything it sets off, and
          find the other people reading it.
        </p>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/signin')}>Sign in</a>
        </div>
        <nav className="landing-places" aria-label="Papol’s places">
          {PLACES.map((place) => {
            const inner = (
              <>
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">{place.icon}</svg>
                <span className="landing-place-name">
                  {place.name}
                  {place.soon && <span className="landing-soon">Soon</span>}
                </span>
                <span className="landing-place-line">{place.line}</span>
              </>
            );
            return place.soon
              ? <div key={place.id} className="landing-place soon">{inner}</div>
              : <a key={place.id} className="landing-place" href={`#${place.id}`}>{inner}</a>;
          })}
        </nav>
      </header>

      <section id="read" className="landing-place-section" aria-labelledby="read-title">
        <div className="landing-section-head">
          <p className="landing-number">Read</p>
          <h2 id="read-title">A PDF reader that knows it’s reading a paper</h2>
          <p>Try it on this page. No account needed; it behaves the way your papers will.</p>
        </div>
        <HomeSpecimen painted={painted} onTogglePaint={togglePaint} flash={flash} onGlow={glow} />
      </section>

      <section id="think" className="landing-place-section" aria-labelledby="think-title">
        <div className="landing-section-head">
          <p className="landing-number">Think</p>
          <h2 id="think-title">A board for everything a paper sets off</h2>
          <p>
            Passages from your papers sit beside videos, web pages, files and
            your own thoughts, on a canvas with room to spread out. Gather them
            into booklets and collections. Every excerpt still knows the page it
            came from.
          </p>
        </div>
        <HomeBoard painted={painted} onBack={backTo} />
      </section>

      <section id="find" className="landing-place-section" aria-labelledby="find-title">
        <div className="landing-section-head">
          <p className="landing-number">Find</p>
          <h2 id="find-title">A library of every paper, and who reads it</h2>
          <p>
            Every paper in Papol has one page. See who else has read it and
            what each of them made of it, in a line. Your shelves are public or
            private; you decide which.
          </p>
        </div>
        <div className="landing-pair">
          <figure className="landing-pair-item">
            <div className="landing-jacket" aria-hidden="true">
              <p className="landing-jacket-kicker">Library</p>
              <p className="landing-jacket-title">Folding as Computation</p>
              <p className="landing-jacket-meta">Specimen, 2026 · 3 readers</p>
              <ul className="landing-readers">
                {READERS.map((reader) => (
                  <li key={reader.name}>
                    <span className={`landing-avatar tint-${reader.tint}`}>{reader.initial}</span>
                    <span>
                      <b>{reader.name}</b>
                      <q>{reader.thought}</q>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="landing-jacket-seminar">
                Seminar <StatePill status="open" link={false} /> 4 waiting for a leader
              </p>
            </div>
            <figcaption>
              When a few of you want to talk a paper through, call a seminar.
              Everyone who has the paper hears about it.
            </figcaption>
          </figure>
          <figure className="landing-pair-item">
            <div className="landing-folder" aria-hidden="true">
              <p className="landing-jacket-kicker">Folder · Transformers review</p>
              <ul className="landing-folder-rows">
                {FOLDER.map((row) => (
                  <li key={row.title} className={row.state}>
                    <span className="landing-folder-title">{row.title}</span>
                    <span className={`landing-folder-state ${row.state}`}>{row.label}</span>
                    <span className="landing-folder-note">{row.note}</span>
                  </li>
                ))}
              </ul>
              <div className="landing-folder-foot">
                <span>Shelf <b>Reading</b></span>
                <span className="landing-folder-add">Add 2 papers</span>
              </div>
            </div>
            <figcaption>
              Bring in a whole reading list at once: drop the folder your AI
              agent gathered, each paper with the agent’s reason for it.
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="talk" className="landing-next" aria-labelledby="talk-title">
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3.5 4.5h13v8.5h-7l-4 3v-3h-2Z" /></svg>
        <div>
          <p className="landing-number">Talk · coming</p>
          <h2 id="talk-title">Chat is on its way</h2>
          <p>Conversations, right beside the papers they are about.</p>
        </div>
      </section>

      <section className="landing-facts" aria-label="Also">
        <div className="landing-fact">
          <h3>Links that fit anywhere</h3>
          <p className="landing-link-bubble">papol.io/s/MTFplaGHa6</p>
          <p>Whoever opens it reads the paper with your notes on it.</p>
        </div>
        <div className="landing-fact">
          <h3>Your reading, logged</h3>
          <p>How much of your week went to reading, and to which paper. Only you can see it.</p>
        </div>
        <div className="landing-fact">
          <h3>On your Mac, offline</h3>
          <p>
            The same Papol as a Mac app, with your papers there when the Wi-Fi
            is not. <a href={MACOS_DOWNLOAD_URL} target="_blank" rel="noreferrer">Download</a>
          </p>
        </div>
        <div className="landing-fact">
          <h3>Open source</h3>
          <p>
            Wondering where your notes live? Read the code.{' '}
            <a href="https://github.com/hflsmax/papol" target="_blank" rel="noreferrer" className="landing-github">
              <GitHubMark /> hflsmax/papol
            </a>
          </p>
        </div>
      </section>

      <section className="landing-close">
        <h2>Start with one paper.</h2>
        <p>Drop in a PDF you are reading this week and read it here.</p>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/library')}>Browse the Library</a>
        </div>
      </section>
    </div>
  );
}
