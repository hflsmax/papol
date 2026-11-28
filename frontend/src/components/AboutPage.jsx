import React from 'react';

// The author's page: what Papol is and who makes it. One
// typeface, the title and two paragraphs (styles under "About").
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
      </article>
    </div>
  );
}
