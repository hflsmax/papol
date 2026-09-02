import React, { useEffect, useState } from 'react';
import { appPath } from '../base';

const lessons = [
  {
    id: 'upload-pdf',
    art: 'upload',
    section: 'Library',
    title: 'Upload and organize a PDF',
    video: '/assets/learn/uploading-a-pdf.mp4',
    poster: '/assets/learn/uploading-a-pdf.jpg',
  },
  {
    id: 'clipping-figures',
    art: 'clip',
    section: 'Viewer',
    title: 'Keep a figure next to the text',
    video: '/assets/learn/clipping-functionality.mp4',
  },
  {
    id: 'add-animal',
    art: 'animal',
    section: 'Viewer',
    title: 'Add animals to your viewer',
    video: '/assets/learn/animal-functionality.mp4',
  },
  {
    id: 'board-basics',
    art: 'board-basics',
    section: 'Board',
    title: 'Build a board with cards',
    video: '/assets/learn/board-basics.mp4',
  },
  {
    id: 'group-board-cards',
    art: 'group',
    section: 'Board',
    title: 'Group cards with booklets and collections',
    video: '/assets/learn/board-grouping.mp4',
  },
  {
    id: 'viewer-to-board',
    art: 'send',
    section: 'Board',
    title: 'Send excerpts and figures to a board',
    video: '/assets/learn/viewer-to-board.mp4',
  },
];

function LessonArt({ type }) {
  if (type === 'board-basics') return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <rect className="art-collection-frame" x="20" y="14" width="200" height="84" rx="10" />
      <rect className="art-card" x="36" y="29" width="52" height="39" rx="5" />
      <path className="art-image" d="m43 61 12-13 9 8 8-10 10 15Z" />
      <rect className="art-card" x="101" y="24" width="60" height="48" rx="5" />
      <path className="art-line" d="M111 37h39M111 47h32M111 57h36" />
      <rect className="art-card" x="130" y="79" width="66" height="13" rx="4" />
      <path className="art-arrow" d="M179 27h25m-8-8 8 8-8 8" />
    </svg>
  );
  if (type === 'upload') return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <rect className="art-paper" x="42" y="17" width="76" height="80" rx="5" />
      <path className="art-line" d="M55 39h49M55 51h38M55 63h45M55 75h31" />
      <path className="art-arrow" d="M151 72V39m-10 10 10-10 10 10" />
      <path className="art-collection-frame" d="M129 78h45a12 12 0 0 0 12-12V31" />
      <rect className="art-mini-card" x="135" y="82" width="62" height="14" rx="4" />
    </svg>
  );
  if (type === 'clip') return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <rect className="art-paper" x="34" y="15" width="104" height="82" rx="5" />
      <path className="art-line" d="M50 34h69M50 47h52M50 60h64M50 73h41" />
      <rect className="art-card" x="125" y="30" width="78" height="62" rx="7" />
      <path className="art-image" d="m137 77 17-18 12 10 10-14 15 22Z" />
      <circle className="art-image" cx="181" cy="45" r="6" />
    </svg>
  );
  if (type === 'animal') return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <path className="art-animal" d="M91 45c-6-12-1-22 8-20 7 2 10 11 10 19m22 1c5-13 0-22-9-20-7 2-10 11-10 19m-20 5c-13 8-18 29-5 39 14 11 53 10 66-1 12-11 6-31-7-38-15-9-39-9-54 0Z" />
      <circle className="art-dot" cx="108" cy="63" r="3.5" /><circle className="art-dot" cx="132" cy="63" r="3.5" />
      <path className="art-detail" d="m115 72 5 4 5-4M120 76v6m0 0c-5 0-8-2-9-5m9 5c5 0 8-2 9-5" />
      <path className="art-spark" d="M64 34v14m-7-7h14m105 19v14m-7-7h14" />
    </svg>
  );
  if (type === 'group') return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <path className="art-booklet-spine" d="M25 18v80m0-65h11m-11 25h11m-11 25h11" />
      <rect className="art-mini-card" x="36" y="24" width="68" height="18" rx="4" />
      <rect className="art-mini-card" x="36" y="49" width="68" height="18" rx="4" />
      <rect className="art-mini-card" x="36" y="74" width="68" height="18" rx="4" />
      <path className="art-mini-line" d="M45 33h35M45 58h46M45 83h28" />
      <rect className="art-collection-frame" x="128" y="18" width="94" height="80" rx="9" />
      <rect className="art-mini-card" x="140" y="29" width="30" height="25" rx="4" />
      <rect className="art-mini-card" x="179" y="29" width="31" height="37" rx="4" />
      <rect className="art-mini-card" x="140" y="62" width="30" height="25" rx="4" />
      <rect className="art-mini-card" x="179" y="74" width="31" height="13" rx="3" />
    </svg>
  );
  return (
    <svg viewBox="0 0 240 112" aria-hidden="true">
      <rect className="art-paper" x="34" y="20" width="74" height="74" rx="5" />
      <path className="art-line" d="M47 38h48M47 49h38M47 72h44" />
      <rect className="art-highlight" x="45" y="56" width="52" height="8" rx="2" />
      <rect className="art-card" x="158" y="20" width="48" height="74" rx="7" />
      <path className="art-arrow" d="M119 57h27m-8-8 8 8-8 8" />
      <circle className="art-dot" cx="182" cy="45" r="8" />
      <path className="art-line" d="M170 66h24M170 75h18" />
    </svg>
  );
}

export default function LearnPage() {
  const [playing, setPlaying] = useState(null);
  const sections = ['Library', 'Viewer', 'Board'];

  useEffect(() => {
    if (!playing) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setPlaying(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [playing]);

  return (
    <div className="learn-page">
      {sections.map((section) => (
        <section className="learn-section" key={section} aria-labelledby={`learn-${section.toLowerCase()}`}>
          <h1 id={`learn-${section.toLowerCase()}`}>{section}</h1>
          <div className="learn-grid">
            {lessons.filter((lesson) => lesson.section === section).map((lesson) => (
              <article className="learn-lesson" key={lesson.id}>
                <button type="button" className={`learn-lesson-open learn-art-${lesson.art}`} onClick={() => setPlaying(lesson)}>
                  <span className="learn-lesson-art"><LessonArt type={lesson.art} /></span>
                  <span className="learn-lesson-footer">
                    <h2>{lesson.title}</h2>
                    <svg className="learn-play" viewBox="0 0 40 40" aria-hidden="true">
                      <circle cx="20" cy="20" r="18" />
                      <path d="m17 13 11 7-11 7Z" />
                    </svg>
                  </span>
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
      {playing && (
        <div className="learn-player-backdrop" role="dialog" aria-modal="true" aria-label={playing.title} onMouseDown={() => setPlaying(null)}>
          <div className="learn-player" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="learn-player-close" aria-label="Close video" onClick={() => setPlaying(null)} autoFocus>×</button>
            <video controls autoPlay preload="auto" aria-label={`${playing.title} tutorial video`}>
              <source src={appPath(playing.video)} type="video/mp4" />
              Your browser does not support embedded video.
            </video>
          </div>
        </div>
      )}
    </div>
  );
}
