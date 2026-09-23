import React from 'react';
import { RatingSummary } from './Rating';

// What a reader's chip shows on hover: who they are, and whatever of their
// copy they let others see. A field they keep to themselves arrives empty,
// so it is simply not here.
export default function ReaderPop({ entry, isYou = false }) {
  const rated = entry.rating_expertise || entry.rating_reading || entry.rating_liking;
  return (
    <span className="chip-pop">
      <span className="chip-pop-name">
        {entry.user.display_name}
        {isYou ? ' (you)' : ''}
        {entry.is_author && <span className="author-tag">author</span>}
      </span>
      {entry.user.affiliation && (
        <span className="chip-pop-aff">{entry.user.affiliation}</span>
      )}
      {entry.thought && (
        <span className="chip-pop-thought">“{entry.thought}”</span>
      )}
      {rated && <RatingSummary paper={entry} />}
      {entry.summary && (
        <span className="chip-pop-summary">{entry.summary}</span>
      )}
      {entry.tags?.length > 0 && (
        <span className="chip-pop-tags">
          {entry.tags.map((tag) => (
            <span key={tag.uuid} className="chip-pop-tag">{tag.name}</span>
          ))}
        </span>
      )}
    </span>
  );
}
