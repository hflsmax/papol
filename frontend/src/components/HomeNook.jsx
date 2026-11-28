import React from 'react';

// The landing page's nook: a few papers on two shelves, listed the way a
// nook lists them, before the visitor has an account. Any of them opens
// the viewer, and the viewer has one paper to show: the first.
const SHELVES = { reading: 'var(--green)', read: 'var(--accent)' };
const PAPERS = [
  { title: 'RustBelt: Securing the Foundations of the Rust Programming Language', meta: 'Ralf Jung et al. (2018) - Proceedings of the ACM on Programming Languages', shelf: 'reading' },
  { title: 'Stacked Borrows: An Aliasing Model for Rust', meta: 'Ralf Jung et al. (2020) - Proceedings of the ACM on Programming Languages', shelf: 'reading' },
  { title: 'Iris from the ground up: A modular foundation for higher-order concurrent separation logic', meta: 'Ralf Jung et al. (2018) - Journal of Functional Programming', shelf: 'read' },
  { title: 'Separation Logic: A Logic for Shared Mutable Data Structures', meta: 'John C. Reynolds (2002) - Logic in Computer Science', shelf: 'read' },
];

export default function HomeNook({ onOpen }) {
  return (
    <div className="landing-nook">
      <p className="landing-nook-name">My nook</p>
      <div className="paper-list">
        <ul>
          {PAPERS.map((paper, index) => (
            <li key={paper.title} onClick={onOpen}>
              <span className="bar-anchor shelf-bar" aria-hidden="true">
                <span className="shelf-current" style={{ '--shelf-color': SHELVES[paper.shelf] }} />
              </span>
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
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
