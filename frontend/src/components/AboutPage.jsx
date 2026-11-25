import React from 'react';

// The author's page: what Papol is, who makes it, and how to reach them. One
// typeface, the title and three paragraphs (styles under "About").
export default function AboutPage() {
  return (
    <div className="about-page">
      <article className="panel about-story" aria-labelledby="about-title">
        <h1 id="about-title">About Papol</h1>
        <p>
          Papol is a workspace for reading research papers and organizing your thinking
          about them. It is free to use and is available on the web and as a Mac app.
        </p>
        <p>
          Papol is developed and maintained by{' '}
          <a href="https://mc-pony.com" target="_blank" rel="noreferrer">Cong Ma</a>.
          The source code is publicly available on{' '}
          <a href="https://github.com/hflsmax/papol" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
        <p>
          Questions, bug reports and suggestions are welcome. Messages sent through the
          Feedback button go directly to the developer.
        </p>
      </article>
    </div>
  );
}
