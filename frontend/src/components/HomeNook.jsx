import React, { useLayoutEffect, useRef, useState } from 'react';
import { effortLevel, formatDurationShort } from '../activityView';

// The landing page's nook: a few papers, listed the way a nook lists them,
// before the visitor has an account: each with its field as a tag and the
// time its reader has spent on it. The viewer has one paper to show, the first, so its title
// is the one link in the list; the others are only listed.
const HOUR = 3600;
const MINUTE = 60;
const PAPERS = [
  {
    title: 'RustBelt: Securing the Foundations of the Rust Programming Language',
    meta: 'Ralf Jung et al. (2018) - Proceedings of the ACM on Programming Languages',
    tag: 'programming-languages', seconds: 6 * HOUR + 20 * MINUTE,
  },
  {
    title: 'Attention Is All You Need',
    meta: 'Ashish Vaswani et al. (2017) - Neural Information Processing Systems',
    tag: 'machine-learning', seconds: 3 * HOUR + 15 * MINUTE,
  },
  {
    title: 'Time, Clocks, and the Ordering of Events in a Distributed System',
    meta: 'Leslie Lamport (1978) - Communications of the ACM',
    tag: 'distributed-systems', seconds: 2 * HOUR + 45 * MINUTE,
  },
  {
    title: 'An Axiomatic Basis for Computer Programming',
    meta: 'C. A. R. Hoare (1969) - Communications of the ACM',
    tag: 'programming-languages', seconds: 1 * HOUR + 40 * MINUTE,
  },
  {
    title: 'A Mathematical Theory of Communication',
    meta: 'C. E. Shannon (1948) - Bell System Technical Journal',
    tag: 'information-theory', seconds: 11 * HOUR + 5 * MINUTE,
  },
  {
    title: 'Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid',
    meta: 'J. D. Watson, F. H. C. Crick (1953) - Nature',
    tag: 'biology', seconds: 25 * MINUTE,
  },
  {
    title: 'Deep Residual Learning for Image Recognition',
    meta: 'Kaiming He et al. (2016) - Computer Vision and Pattern Recognition',
    tag: 'machine-learning', seconds: 1 * HOUR + 10 * MINUTE,
  },
  {
    title: 'New Directions in Cryptography',
    meta: 'Whitfield Diffie, Martin E. Hellman (1976) - IEEE Transactions on Information Theory',
    tag: 'cryptography', seconds: 2 * HOUR + 5 * MINUTE,
  },
  {
    title: 'A Theory of Type Polymorphism in Programming',
    meta: 'Robin Milner (1978) - Journal of Computer and System Sciences',
    tag: 'programming-languages', seconds: 5 * HOUR + 30 * MINUTE,
  },
  {
    title: 'The Google File System',
    meta: 'Sanjay Ghemawat et al. (2003) - Symposium on Operating Systems Principles',
    tag: 'distributed-systems', seconds: 50 * MINUTE,
  },
  {
    title: 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?',
    meta: 'A. Einstein et al. (1935) - Physical Review',
    tag: 'physics', seconds: 40 * MINUTE,
  },
];

// How many papers show before the list is scrolled: the last one cut in
// half, which says there are more under it.
const SHOWN = 6.5;

export default function HomeNook({ onOpen }) {
  const listRef = useRef(null);
  const [height, setHeight] = useState(null);

  // Rows are as tall as their titles wrap, so the height that shows that
  // many of them is measured, and measured again when the width changes.
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
        <span className="landing-nook-column">Title</span>
        <span className="landing-nook-column is-effort">Effort</span>
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
            <li key={paper.title}>
              <div className="paper-item">
                <div className="paper-title-row">
                  <h4>
                    {index === 0 ? (
                      <a
                        className="paper-title-link beckon"
                        data-hint="Click"
                        href="#viewer"
                        onClick={(event) => { event.preventDefault(); onOpen(); }}
                      >
                        {paper.title}
                      </a>
                    ) : paper.title}
                  </h4>
                </div>
                <p className="paper-meta paper-meta-row"><span>{paper.meta}</span></p>
                <p className="landing-nook-tag"><span aria-hidden="true">#</span>{paper.tag}</p>
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
