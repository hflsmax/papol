import React, { useState } from 'react';
import { appPath } from '../base';
import HomeNook from './HomeNook';
import HomeSpecimen from './HomeSpecimen';

// What can be tried, in the order the page offers it. One thing beckons at
// a time: the first not yet tried.
const TRIES = ['cite', 'figure', 'rule', 'paint'];

// What a visitor sees: what Papol is in a line, and Papol itself to try: a
// nook with a few papers in it, and behind any of them a paper in the
// viewer. No feature is explained; each can be tried.
export default function HomePage() {
  const [painted, setPainted] = useState([]);
  const [flash, setFlash] = useState(null);
  const [tried, setTried] = useState({});
  const [reading, setReading] = useState(false);

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
  return (
    <div className="landing">
      <header className="landing-hero">
        <h1 className="landing-title">Read more papers, more intelligently</h1>
        <p className="landing-fact">A paper reader for researchers, free and open source.</p>
        <p className="landing-try"><span className="landing-try-mark">Demo</span>Try it below <span aria-hidden="true">↓</span></p>
      </header>

      <section id="viewer" className="landing-place-section" aria-label={reading ? 'Viewer' : 'Nook'}>
        {reading ? (
          <HomeSpecimen
            painted={painted}
            onTogglePaint={togglePaint}
            flash={flash}
            onGlow={glow}
            beckoning={beckoning}
            onTried={onTried}
            onHome={() => setReading(false)}
          />
        ) : (
          <HomeNook onOpen={() => setReading(true)} />
        )}
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
        <a href="https://github.com/hflsmax/papol" target="_blank" rel="noreferrer">Open source on GitHub</a>
      </footer>
    </div>
  );
}
