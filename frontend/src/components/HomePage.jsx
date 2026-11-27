import React, { useState } from 'react';
import { appPath } from '../base';
import HomeBoard from './HomeBoard';
import HomeLounge from './HomeLounge';
import HomeSpecimen from './HomeSpecimen';
import { MAC_DOWNLOAD_URL } from '../../../shared/macDownload.js';

// What can be tried, in the order the page offers it. One thing beckons at
// a time: the first not yet tried.
const TRIES = ['cite', 'figure', 'rule', 'paint', 'drag', 'line'];

// What a visitor sees: what Papol is in a line, the way in for someone who
// already knows it, and for someone who does not, Papol itself to try — a
// paper in the viewer, a board its painted sentences land on, and the
// paper as it reaches you in the Lounge, from friends. No feature is explained; each can be tried.
export default function HomePage() {
  const [painted, setPainted] = useState([]);
  const [flash, setFlash] = useState(null);
  const [tried, setTried] = useState({});

  const onTried = (key) => setTried((current) => (current[key] ? current : { ...current, [key]: true }));
  const beckoning = TRIES.find((key) => !tried[key]);

  const glow = (id) => {
    setFlash(null);
    requestAnimationFrame(() => setFlash(id));
  };
  const togglePaint = (id) => {
    setPainted((current) => (current.includes(id) ? current.filter((each) => each !== id) : [...current, id]));
    onTried('paint');
  };
  // A card's backlink: back up to the page, to the sentence it came from.
  const backTo = (id) => {
    document.querySelector(`[data-sentence="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    glow(id);
  };

  return (
    <div className="landing">
      <header className="landing-hero">
        <h1 className="landing-title">Read more papers, more intelligently</h1>
        <p className="landing-fact">A paper reader for researchers. Free and open source, on the web and Mac.</p>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href="#viewer">Try it ↓</a>
        </div>
      </header>

      <section id="viewer" className="landing-place-section" aria-label="Viewer">
        <p className="landing-number">Viewer</p>
        <HomeSpecimen
          painted={painted}
          onTogglePaint={togglePaint}
          flash={flash}
          onGlow={glow}
          beckoning={beckoning}
          onTried={onTried}
        />
      </section>

      <section id="board" className="landing-place-section" aria-label="Board">
        <p className="landing-number">Board</p>
        <HomeBoard painted={painted} onBack={backTo} beckoning={beckoning} onTried={onTried} />
      </section>

      <section id="lounge" className="landing-place-section" aria-label="Lounge">
        <p className="landing-number">Lounge</p>
        <HomeLounge beckoning={beckoning} onTried={onTried} />
      </section>

      <section className="landing-close">
        <h2>Now bring your own papers.</h2>
        <div className="landing-doors">
          <a className="landing-button primary" href={appPath('/join')}>Create an account</a>
          <a className="landing-button" href={appPath('/signin')}>Sign in</a>
        </div>
      </section>

      <footer className="landing-footer">
        <a href={appPath('/about')}>About</a>
        <a href={appPath('/learn')}>Learn</a>
        <a href={MAC_DOWNLOAD_URL}>Mac app</a>
        <a href="https://github.com/hflsmax/papol" target="_blank" rel="noreferrer">Open source on GitHub</a>
      </footer>
    </div>
  );
}
