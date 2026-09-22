import React from 'react';

// The author's page: who made Papol, what it grew from, and what it is for.
export default function AboutPage() {
  return (
    <div className="about-page">
      <section className="panel about-story" aria-labelledby="about-title">
        <h6 className="kicker" id="about-title">About Papol</h6>
        <p className="about-lede">
          Papol is a hobby project of{' '}
          <a href="https://mc-pony.com" target="_blank" rel="noreferrer">me</a>,
          a computer science researcher, built from the best of what I have
          used for reading papers.
        </p>
        <p>
          Two things shaped it most. The citation popups of Google Scholar&rsquo;s
          browser button, which show you what a reference is without leaving the
          page you are reading. And the infinite board of Allume, formerly Muse,
          which gives thinking the room to spread out.
        </p>
        <p>
          In Papol these are not separate tools. Reading, references, notes,
          boards and seminars are one connected place, so that an idea found in
          one paper can travel to the next. Papol is an ecosystem where ideas
          flow.
        </p>
      </section>
    </div>
  );
}
