import React from 'react';

// The author's page: who makes Papol, and how to reach them. One typeface,
// the title and two paragraphs (styles under "About").
export default function AboutPage() {
  return (
    <div className="about-page">
      <article className="panel about-story" aria-labelledby="about-title">
        <h1 id="about-title">About Papol</h1>
        <p>
          I’m{' '}
          <a href="https://mc-pony.com" target="_blank" rel="noreferrer">Cong Ma</a>,
          a computer science researcher, and Papol is my hobby project: a place to read
          papers and think about them. It’s free, it runs on the web and on the Mac, and
          its source is public on GitHub.
        </p>
        <p>
          If something isn’t right, the Feedback button in the corner comes straight to me.
        </p>
      </article>
    </div>
  );
}
