import React from 'react';

// One paragraph, in the author's own words.
export default function AboutPage() {
  return (
    <div className="about-page">
      <section className="panel" aria-labelledby="about-title">
        <h6 className="kicker" id="about-title">About Papol</h6>
        <p>
          Papol is developed as a hobby project by me,{' '}
          <a href="https://mc-pony.com" target="_blank" rel="noreferrer">Cong Ma</a>,
          a computer science researcher. It combines the best features I have used
          in research and paper reading: above all the citation popups of Google
          Scholar&rsquo;s browser plugin, and the infinite board for brainstorming of
          Allume (formerly Muse). The functionalities are all interconnected. Papol
          is an ecosystem where ideas flow.
        </p>
      </section>
    </div>
  );
}
