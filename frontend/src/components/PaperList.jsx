import React, { useState } from 'react';
import { updatePaper, paperHref } from '../api';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';

export default function PaperList({ papers, isOwn, onSelectPaper, onChanged }) {
  const [search, setSearch] = useState('');
  const [toggleWarning, setToggleWarning] = useState(null); // { id, text }

  const handleMarketToggle = async (paper, checked) => {
    setToggleWarning(null);
    try {
      await updatePaper(paper.id, { marketed: checked });
      onChanged();
    } catch (err) {
      setToggleWarning({ id: paper.id, text: err.message });
    }
  };

  const filteredPapers = papers.filter((paper) => {
    const searchLower = search.toLowerCase();
    return (
      paper.title.toLowerCase().includes(searchLower) ||
      (paper.authors && paper.authors.toLowerCase().includes(searchLower)) ||
      (paper.journal && paper.journal.toLowerCase().includes(searchLower))
    );
  });

  // Your own nook reads as a journal: newest first, grouped by month.
  // Other nooks rank active seminars to the top.
  const rank = (p) =>
    p.room_status === 'open' || p.room_status === 'planning'
      ? 0
      : p.room_status === 'scheduled'
        ? 1
        : 2;
  filteredPapers.sort((a, b) =>
    isOwn
      ? new Date(b.created_at) - new Date(a.created_at)
      : rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at)
  );

  const monthOf = (d) =>
    new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const parseAuthors = (authorsJson) => {
    if (!authorsJson) return '';
    try {
      const authors = JSON.parse(authorsJson);
      if (authors.length <= 2) return authors.join(', ');
      return `${authors[0]} et al.`;
    } catch {
      return authorsJson;
    }
  };

  return (
    <div className="panel paper-list">
      <div className="search-bar">
        <input
          type="text"
          placeholder={
            isOwn ? 'Search papers in your nook…' : 'Search papers in this nook…'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredPapers.length === 0 ? (
        <p className="no-papers">
          {papers.length === 0
            ? isOwn
              ? 'No papers yet. Upload your first paper!'
              : 'No papers in this nook yet.'
            : 'No papers match your search.'}
        </p>
      ) : (
        <ul>
          {filteredPapers.map((paper, i) => (
            <React.Fragment key={paper.id}>
            {isOwn &&
              (i === 0 ||
                monthOf(paper.created_at) !==
                  monthOf(filteredPapers[i - 1].created_at)) && (
                <li className="month-header">{monthOf(paper.created_at)}</li>
              )}
            <li
              className={isOwn && paper.marketed === false ? 'unmarketed' : ''}
            >
              {/* The row's left edge already said whether a paper was on
                  display — it went dashed when hidden. So the edge is the
                  control: one thing that both shows the state and changes
                  it, instead of a badge in one corner repeating what the
                  border in the other was already saying. */}
              {isOwn && (
                <span className="hint-anchor bar-anchor">
                  <button
                    className={
                      paper.marketed !== false
                        ? 'display-bar on'
                        : 'display-bar off'
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarketToggle(paper, paper.marketed === false);
                    }}
                    title={
                      paper.marketed !== false
                        ? 'On display — other readers can see that you have this paper. Click to hide it.'
                        : 'Hidden — only you can see this paper. Click to put it on display.'
                    }
                    aria-label={
                      paper.marketed !== false
                        ? 'On display; click to hide from your nook'
                        : 'Hidden; click to put on display'
                    }
                    aria-pressed={paper.marketed !== false}
                  />
                  {toggleWarning?.id === paper.id && (
                    <HintPop
                      text={toggleWarning.text}
                      onClose={() => setToggleWarning(null)}
                    />
                  )}
                </span>
              )}
              <div className="paper-item">
                <div className="paper-title-row">
                <h4>
                  <a className="paper-title-link" href={paperHref(paper)}>
                    {paper.title}
                  </a>
                </h4>
                {/* Beside the title rather than inside it: inside, the pill
                    rides the text baseline and sits low against a serif
                    line. Out here it takes the same first-line box as the
                    reader chips, and the two agree. */}
                {paper.room_status && (
                  <span className="title-state">
                    <StatePill status={paper.room_status} />
                  </span>
                )}
                </div>
                <p className="paper-meta">
                  {parseAuthors(paper.authors)}
                  {paper.year && ` (${paper.year})`}
                  {paper.journal && ` - ${paper.journal}`}
                </p>
                <RatingSummary paper={paper} compact />
              </div>
              {/* The readers are the row's right-hand feature: who else
                  has this paper is the reason to look at a nook. Out of
                  the title row so they answer to the whole row rather
                  than to the title. */}
                {paper.readers && paper.readers.length > 0 && (
                  <div className="row-readers">
                    {paper.readers.map((entry) => (
                      <a
                        key={entry.user.id}
                        className={
                          entry.is_author
                            ? 'avatar-chip has-pop mini author'
                            : 'avatar-chip has-pop mini'
                        }
                        href={`/u/${entry.user.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Avatar user={entry.user} className="mini-avatar" />
                        <span className="chip-pop">
                          <span className="chip-pop-name">
                            {entry.user.display_name}
                            {entry.is_author && (
                              <span className="author-tag">author</span>
                            )}
                          </span>
                          {entry.user.affiliation && (
                            <span className="chip-pop-aff">
                              {entry.user.affiliation}
                            </span>
                          )}
                          {entry.thought && (
                            <span className="chip-pop-thought">“{entry.thought}”</span>
                          )}
                          <RatingSummary paper={entry} />
                        </span>
                      </a>
                    ))}
                  </div>
                )}
            </li>
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
