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
          I am a computer science researcher, and I built Papol by bringing together
          the best features of research tools on the market. From Google
          Scholar&rsquo;s browser extension, it borrows citation popups: click a
          reference and a window shows you what it is, without leaving the page.
          From Allume, formerly Muse, it borrows the infinite canvas, which gives
          your thinking room to spread out.
        </p>
        <p>
          In Papol, all these tools share one ecosystem, so ideas flow between them
          effortlessly.
        </p>
      </article>
    </div>
  );
}
