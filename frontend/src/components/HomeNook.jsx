import React, { useLayoutEffect, useRef, useState } from 'react';
import { effortLevel, formatDurationShort } from '../activityView';

// The landing page's nook: a few papers, listed the way a nook lists them,
// before the visitor has an account: each with the time its reader has
// spent on it. Any of them opens the viewer, and the viewer has one paper
// to show: the first.
const HOUR = 3600;
const PAPERS = [
  {
    title: 'RustBelt: Securing the Foundations of the Rust Programming Language',
    meta: 'Ralf Jung et al. (2018) - Proceedings of the ACM on Programming Languages',
    seconds: 6 * HOUR + 20 * 60,
  },
  {
    title: 'The Next 700 Programming Languages',
    meta: 'P. J. Landin (1966) - Communications of the ACM',
    seconds: 1 * HOUR + 40 * 60,
  },
  {
    title: 'An Axiomatic Basis for Computer Programming',
    meta: 'C. A. R. Hoare (1969) - Communications of the ACM',
    seconds: 2 * HOUR + 45 * 60,
  },
  {
    title: 'A Theory of Type Polymorphism in Programming',
    meta: 'Robin Milner (1978) - Journal of Computer and System Sciences',
    seconds: 11 * HOUR + 5 * 60,
  },
  {
    title: 'Separation Logic: A Logic for Shared Mutable Data Structures',
    meta: 'John C. Reynolds (2002) - Logic in Computer Science',
    seconds: 25 * 60,
  },
];

// How many papers show before the list is scrolled: the last one cut in
// half, which says there are more under it.
const SHOWN = 3.5;

export default function HomeNook({ onOpen }) {
  const listRef = useRef(null);
  const [height, setHeight] = useState(null);

  // Rows are as tall as their titles wrap, so the height that shows three
  // and a half of them is measured, and measured again when the width
  // changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const measure = () => {
      const cut = list.querySelectorAll('li')[Math.floor(SHOWN)];
      if (!cut) { setHeight(null); return; }
      const top = cut.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      setHeight(Math.round(top + cut.offsetHeight * (SHOWN % 1)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(list.querySelector('ul'));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-nook">
      <p className="landing-nook-head">
        <span className="landing-nook-name">My nook</span>
        <span className="landing-nook-column">Effort</span>
      </p>
      <div
        ref={listRef}
        className="paper-list landing-nook-list"
        style={height ? { maxHeight: height } : undefined}
        tabIndex={0}
        role="group"
        aria-label="Papers in the nook"
      >
        <ul>
          {PAPERS.map((paper, index) => (
            <li key={paper.title} onClick={onOpen}>
              <div className="paper-item">
                <div className="paper-title-row">
                  <h4>
                    <a
                      className={`paper-title-link${index === 0 ? ' beckon' : ''}`}
                      data-hint={index === 0 ? 'Click' : undefined}
                      href="#viewer"
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen(); }}
                    >
                      {paper.title}
                    </a>
                  </h4>
                </div>
                <p className="paper-meta paper-meta-row"><span>{paper.meta}</span></p>
              </div>
              <span className={`nook-effort is-compact effort-level-${effortLevel(paper.seconds)} landing-nook-effort`}>
                {formatDurationShort(paper.seconds)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
