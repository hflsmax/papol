import React, { useState } from 'react';
import { appPath } from '../base';
import HomeBoard from './HomeBoard';
import HomeLibrary from './HomeLibrary';
import HomeSpecimen from './HomeSpecimen';

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

// What a visitor sees: the way in for someone who already knows Papol, and
// for someone who does not, Papol itself to try — a paper to read, a board
// its painted sentences land on, and the paper's page in the Library.
// Nothing is explained; everything can be tried.
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
        <h1 className="landing-title">Papers, and everything you think about them.</h1>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/signin')}>Sign in</a>
        </div>
      </header>

      <section id="read" className="landing-place-section" aria-label="Read">
        <p className="landing-number">Read</p>
        <HomeSpecimen painted={painted} onTogglePaint={togglePaint} flash={flash} onGlow={glow} />
      </section>

      <section id="think" className="landing-place-section" aria-label="Think">
        <p className="landing-number">Think</p>
        <HomeBoard painted={painted} onBack={backTo} />
      </section>

      <section id="find" className="landing-place-section" aria-label="Find">
        <p className="landing-number">Find</p>
        <HomeLibrary />
      </section>

      <section className="landing-close">
        <h2>Now bring your own papers.</h2>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/library')}>Browse the Library</a>
        </div>
        <a className="landing-github" href="https://github.com/hflsmax/papol" target="_blank" rel="noreferrer" title="Papol on GitHub" aria-label="Papol on GitHub">
          <GitHubMark />
        </a>
      </section>
    </div>
  );
}
