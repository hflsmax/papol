import React, { useRef, useState } from 'react';
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
  const placeRef = useRef(null);

  // The list and the viewer are not the same height, so the swap is made
  // with the top of the place in view: the page does not seem to jump.
  const show = (next) => {
    setReading(next);
    requestAnimationFrame(() => {
      const place = placeRef.current;
      if (!place) return;
      const top = place.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.5) place.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

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
      </header>

      <section id="viewer" ref={placeRef} className="landing-place-section" aria-label={reading ? 'Viewer' : 'Nook'}>
        <h2 className="landing-try">Try it below <span aria-hidden="true">↓</span></h2>
        {reading ? (
          <HomeSpecimen
            painted={painted}
            onTogglePaint={togglePaint}
            flash={flash}
            onGlow={glow}
            beckoning={beckoning}
            onTried={onTried}
            onHome={() => show(false)}
          />
        ) : (
          <HomeNook onOpen={() => show(true)} />
        )}
      </section>

      <section className="landing-close">
        <h2>Bring your own papers.</h2>
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
