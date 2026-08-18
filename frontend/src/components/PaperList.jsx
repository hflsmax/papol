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

  // Papers with a seminar rank to the top (active calls before scheduled);
  // in your own nook, displayed papers come before hidden ones.
  const rank = (p) =>
    p.room_status === 'open' || p.room_status === 'planning'
      ? 0
      : p.room_status === 'scheduled'
        ? 1
        : 2;
  filteredPapers.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (isOwn ? (b.marketed === true) - (a.marketed === true) : 0) ||
      new Date(b.created_at) - new Date(a.created_at)
  );

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
          placeholder="Search papers…"
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
          {filteredPapers.map((paper) => (
            <li
              key={paper.id}
              className={isOwn && paper.marketed === false ? 'unmarketed' : ''}
            >
              <div className="paper-item">
                <div className="paper-title-row">
                <h4>
                  <a className="paper-title-link" href={paperHref(paper)}>
                    {paper.title}
                  </a>
                  {paper.room_status && <StatePill status={paper.room_status} />}
                </h4>
                {paper.readers && paper.readers.length > 0 && (
                  <div className="title-chips">
                    {paper.readers.map((entry) => (
                      <a
                        key={entry.user.id}
                        className="avatar-chip has-pop mini"
                        href={`#/u/${entry.user.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Avatar user={entry.user} className="mini-avatar" />
                        <span className="chip-pop">
                          <span className="chip-pop-name">
                            {entry.user.display_name}
                          </span>
                          {entry.user.affiliation && (
                            <span className="chip-pop-aff">
                              {entry.user.affiliation}
                            </span>
                          )}
                          <RatingSummary paper={entry} />
                        </span>
                      </a>
                    ))}
                  </div>
                )}
                </div>
                <p className="paper-meta">
                  {parseAuthors(paper.authors)}
                  {paper.year && ` (${paper.year})`}
                  {paper.journal && ` - ${paper.journal}`}
                </p>
                <RatingSummary paper={paper} compact />
              </div>
              {isOwn && (
                <div className="paper-side" onClick={(e) => e.stopPropagation()}>
                  <span className="hint-anchor">
                  <button
                    className={
                      paper.marketed !== false
                        ? 'market-toggle on'
                        : 'market-toggle off'
                    }
                    onClick={() =>
                      handleMarketToggle(paper, paper.marketed === false)
                    }
                    title={
                      paper.marketed !== false
                        ? 'On display — other readers can see this paper. Click to hide it.'
                        : 'Hidden — only you can see this paper. Click to put it on display.'
                    }
                    aria-label={
                      paper.marketed !== false
                        ? 'On display; click to hide'
                        : 'Hidden; click to put on display'
                    }
                  >
                    <span className="switch bare" aria-hidden="true">
                      <span className="switch-knob" />
                    </span>
                  </button>
                  {toggleWarning?.id === paper.id && (
                    <HintPop
                      text={toggleWarning.text}
                      onClose={() => setToggleWarning(null)}
                    />
                  )}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
