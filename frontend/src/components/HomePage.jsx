import React from 'react';
import { appPath } from '../base';
import HomeSpecimen from './HomeSpecimen';
import StatePill from './StatePill';

const MACOS_DOWNLOAD_URL = 'https://github.com/hflsmax/papol/releases';

// Footage from the letter of 2026-09-25, of the real application.
const READING_LOG_GIF = 'https://files.papol.io/admin/5081b411893efa8a4b1c32f2ddc95dc9e96ce91583a066a4a5853abef9cb1865.gif';

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

// What a visitor sees: what Papol is, in a line, with the way in for
// someone who already knows; then a page to try it on for someone who does
// not; then the rest of a reading day, most useful first.
export default function HomePage() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <p className="landing-eyebrow">Papol · your paper reading companion</p>
        <h1 className="landing-title">A PDF reader that knows it’s reading a paper.</h1>
        <p className="landing-lede">
          Click a citation and see what it is, and every place it is used. Click
          “Figure 2” and the figure comes to you. Lift what matters onto a board,
          beside videos, web pages and your own thoughts.
        </p>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/signin')}>Sign in</a>
          <a className="landing-scroll" href="#try">or try it right here ↓</a>
        </div>
      </header>

      <section id="try" className="landing-try" aria-labelledby="try-title">
        <div className="landing-section-head">
          <h2 id="try-title">Try it on this page</h2>
          <p>No account needed. This page behaves the way your papers will.</p>
        </div>
        <HomeSpecimen />
      </section>

      <section className="landing-moment" aria-labelledby="folder-title">
        <div className="landing-moment-text">
          <p className="landing-number">01</p>
          <h2 id="folder-title">Your agent’s reading list, in one drop</h2>
          <p>
            Ask your AI agent for a literature review. Drop the folder it fills
            onto Papol, and every paper arrives with the agent’s reason for
            picking it. Anything you already have, or that sits behind a paywall,
            is pointed out before you add a thing.
          </p>
        </div>
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
            <span>Shelf <b>Reading</b> · Tag <b>transformers</b></span>
            <span className="landing-folder-add">Add 2 papers</span>
          </div>
        </div>
      </section>

      <section className="landing-moment flip" aria-labelledby="together-title">
        <div className="landing-moment-text">
          <p className="landing-number">02</p>
          <h2 id="together-title">Read alongside others</h2>
          <p>
            Each paper has one page in the Library. See who else read it and
            what each of them made of it, in a line. When a few of you want to
            talk it through, call a seminar and everyone who has the paper hears
            about it.
          </p>
          <p className="landing-aside">Your shelves are public or private. You decide which.</p>
        </div>
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
      </section>

      <section className="landing-moment" aria-labelledby="week-title">
        <div className="landing-moment-text">
          <p className="landing-number">03</p>
          <h2 id="week-title">See where your week went</h2>
          <p>
            Papol notices the time you spend reading, paper by paper, and shows
            it by day, week or month. Only you can see it.
          </p>
        </div>
        <figure className="landing-shot">
          <img
            src={READING_LOG_GIF}
            loading="lazy"
            alt="My activity by week, by month, paper by paper, and for one day"
          />
        </figure>
      </section>

      <section className="landing-facts" aria-label="Also">
        <div className="landing-fact">
          <h3>Links that fit anywhere</h3>
          <p className="landing-link-bubble">papol.io/s/MTFplaGHa6</p>
          <p>Whoever opens it reads the paper with your notes on it.</p>
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
