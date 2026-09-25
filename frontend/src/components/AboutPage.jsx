import React from 'react';

// The author's page: who makes Papol and what shaped it. One typeface,
// the title and two paragraphs (styles under "About").
export default function AboutPage() {
  return (
    <div className="about-page">
      <article className="panel about-story" aria-labelledby="about-title">
        <h1 id="about-title">About Papol</h1>
        <p>
          Papol is a hobby project of{' '}
          <a href="https://mc-pony.com" target="_blank" rel="noreferrer">mine</a>.
          I am a computer science researcher, and I built it around the two things
          I liked best when reading papers. The first is the citation popups of
          Google Scholar&rsquo;s browser button, which show you what a reference is
          without leaving the page. The second is the infinite canvas of Allume,
          formerly Muse, which gives your thinking room to spread out.
        </p>
        <p>
          In Papol, all the tools share one ecosystem, so ideas flow between them
          effortlessly.
        </p>
      </article>
    </div>
  );
}
