import React from 'react';
import { appPath } from '../base';

const SOURCE_URL = 'https://github.com/hflsmax/papol';
// The latest release is what the sign-in page's download button points to
// as well; the page names no version, so it never falls behind one.
const RELEASES_URL = 'https://github.com/hflsmax/papol/releases';
const ISSUES_URL = 'https://github.com/hflsmax/papol/issues';

// What Papol is, in the order a reader meets it: the nook, reading a paper,
// handing a reading on, seminars, boards, the Mac app, and then how it is
// built and how to reach the author. Signed in or not, the same page.
export default function AboutPage() {
  return (
    <div className="about-page">
      <section className="panel" aria-labelledby="about-what">
        <h6 className="kicker" id="about-what">What Papol is</h6>
        <p>
          Papol is a place to keep the papers you read. Each paper sits in
          your nook, on a shelf, with the tags you give it. The Library is
          every paper anyone here keeps, so you see who else reads what you
          read, and they see you when your copy is on a public shelf.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-reading">
        <h6 className="kicker" id="about-reading">Reading</h6>
        <div className="home-organize-item">
          <strong>The viewer</strong>
          <p>
            A paper opens in Papol&rsquo;s viewer, which shows the PDF as it
            is. You leave notes anchored to a spot on the page, or about the
            paper as a whole; paint ink over a passage; clip a figure to keep
            beside the text. All of it is yours, and private until you share
            a reading.
          </p>
        </div>
        <div className="home-organize-item">
          <strong>References</strong>
          <p>
            The references panel makes the bibliography clickable. When you
            open a reference it is resolved to the work it names, with
            CrossRef and OpenAlex behind it, and a cited paper that is
            already in Papol opens here.
          </p>
        </div>
      </section>

      <section className="panel" aria-labelledby="about-sharing">
        <h6 className="kicker" id="about-sharing">Sharing a reading</h6>
        <p>
          A link hands one reading of one PDF to anyone. It carries the paper
          alone or the paper with your annotations, as you choose when you
          make it, and it works without an account. Whoever holds it can take
          the paper into their own nook, without your notes.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-seminars">
        <h6 className="kicker" id="about-seminars">Seminars</h6>
        <p>
          Any user of a paper can call a spontaneous seminar on it. Every
          user of that paper is invited; someone answers the call and leads;
          the cohort settles the time and the place. The{' '}
          <a href={appPath('/')}>home page</a> shows how one comes together,
          step by step.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-boards">
        <h6 className="kicker" id="about-boards">Boards</h6>
        <p>
          A board is a canvas of cards: excerpts and figures carried out of
          your papers, and thoughts written beside them. A board can be for a
          reading group, or for yourself.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-mac">
        <h6 className="kicker" id="about-mac">The Mac app</h6>
        <p>
          Papol for Mac is the same Papol with a local copy of your nook. It
          works offline and syncs when it is connected. The latest release is
          on{' '}
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-built">
        <h6 className="kicker" id="about-built">How it is built</h6>
        <p>
          Papol is{' '}
          <a href={SOURCE_URL} target="_blank" rel="noreferrer">open source</a>.
          It runs on Cloudflare: a Worker at the edge, D1 for the database,
          R2 for the PDFs, and a queue for the background jobs. The reference
          analyzer, GROBID, runs on the author&rsquo;s own server behind a
          tunnel.
        </p>
      </section>

      <section className="panel" aria-labelledby="about-touch">
        <h6 className="kicker" id="about-touch">Getting in touch</h6>
        <p>
          The Feedback button in the corner of every page reaches the author
          directly. Bugs go to the{' '}
          <a href={ISSUES_URL} target="_blank" rel="noreferrer">GitHub issues</a>.
        </p>
      </section>
    </div>
  );
}
