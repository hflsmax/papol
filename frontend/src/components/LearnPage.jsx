import React from 'react';
import { appPath } from '../base';

const lessons = [
  {
    id: 'clipping-figures',
    title: 'Keep a figure beside the text',
    video: '/assets/learn/clipping-functionality.mp4',
    poster: '/assets/learn/clipping-functionality.jpg',
  },
  {
    id: 'add-animal',
    title: 'Add animals to your viewer',
    video: '/assets/learn/animal-functionality.mp4',
    poster: '/assets/learn/animal-functionality.jpg',
  },
  {
    id: 'group-board-cards',
    title: 'Group cards with booklets and collections',
    video: '/assets/learn/board-grouping.mp4',
    poster: '/assets/learn/board-grouping.jpg',
  },
];

export default function LearnPage() {
  return (
    <div className="learn-page">
      <div className="learn-grid">
        {lessons.map((lesson) => (
          <article className="learn-lesson" key={lesson.id}>
            <div className="learn-video-shell">
              <video
                controls
                preload="metadata"
                poster={appPath(lesson.poster)}
                aria-label={`${lesson.title} tutorial video`}
              >
                <source src={appPath(lesson.video)} type="video/mp4" />
                Your browser does not support embedded video.
              </video>
            </div>
            <h2>{lesson.title}</h2>
          </article>
        ))}
      </div>
    </div>
  );
}
