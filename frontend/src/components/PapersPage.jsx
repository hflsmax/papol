import React, { useState, useEffect } from 'react';
import { listPapers, paperHref } from '../api';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import PaperUpload from './PaperUpload';

function parseAuthors(authorsJson) {
  if (!authorsJson) return '';
  try {
    const authors = JSON.parse(authorsJson);
    if (authors.length <= 2) return authors.join(', ');
    return `${authors[0]} et al.`;
  } catch {
    return authorsJson;
  }
}

// Active calls first, then scheduled seminars, then the rest
const seminarRank = (p) =>
  p.room_status === 'open' || p.room_status === 'planning'
    ? 0
    : p.room_status === 'scheduled'
      ? 1
      : 2;

const avgMerit = (p) => {
  const rated = (p.readers || [])
    .map((r) => r.rating_liking)
    .filter((v) => v != null);
  return rated.length
    ? rated.reduce((s, v) => s + v, 0) / rated.length
    : null;
};

const newest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

const SORTS = {
  activity: {
    label: 'Seminar activity',
    cmp: (a, b) => seminarRank(a) - seminarRank(b) || newest(a, b),
  },
  newest: { label: 'Newest', cmp: newest },
  readers: {
    label: 'Most readers',
    cmp: (a, b) =>
      (b.readers?.length || 0) - (a.readers?.length || 0) || newest(a, b),
  },
  merit: {
    label: 'Highest merit',
    // Papers no reader has rated go last
    cmp: (a, b) =>
      (avgMerit(b) ?? -1) - (avgMerit(a) ?? -1) || newest(a, b),
  },
  year: {
    label: 'Publication year',
    cmp: (a, b) => (b.year || 0) - (a.year || 0) || newest(a, b),
  },
  title: {
    label: 'Title',
    cmp: (a, b) => a.title.localeCompare(b.title),
  },
};

export default function PapersPage({ currentUser, onSelectPaper }) {
  const [papers, setPapers] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [error, setError] = useState(null);

  const load = () => {
    listPapers()
      .then(setPapers)
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="error">{error}</div>;
  if (papers === null) return <div className="loading">Loading the library…</div>;

  const searchLower = search.toLowerCase();
  const matches = (p) =>
    p.title.toLowerCase().includes(searchLower) ||
    (p.authors && p.authors.toLowerCase().includes(searchLower)) ||
    (p.journal && p.journal.toLowerCase().includes(searchLower)) ||
    (p.readers || []).some((r) =>
      r.user.display_name.toLowerCase().includes(searchLower)
    );

  const shown = [...papers.filter(matches)].sort(SORTS[sortBy].cmp);

  return (
    <div>
      {currentUser && <PaperUpload onPaperCreated={load} />}

      <div className="panel paper-list">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search papers and readers in the library…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="sort-control">
            Sort by
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {shown.length === 0 ? (
          <p className="no-papers">
            {papers.length === 0 ? 'No papers yet.' : 'No papers match your search.'}
          </p>
        ) : (
          <ul className="grouped-papers">
            {shown.map((paper) => (
              <li key={paper.id} className="paper-group">
                <div className="paper-group-head">
                  {/* Same arrangement as the nook's rows: the pill beside
                      the title rather than inside the heading, so it sits
                      on the title's line instead of riding its baseline. */}
                  <div className="paper-title-row">
                    <h4>
                      <a className="paper-title-link" href={paperHref(paper)}>
                        {paper.title}
                      </a>
                    </h4>
                    {paper.room_status && paper.room_status !== 'finished' && (
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
                </div>
                <div className="entry-chips">
                  {(paper.readers || []).map((entry) => (
                    <a
                      key={entry.user.id}
                      className={
                        entry.is_author
                          ? 'avatar-chip has-pop author'
                          : 'avatar-chip has-pop'
                      }
                      href={`#/u/${entry.user.id}`}
                    >
                      <Avatar user={entry.user} className="nook-chip-avatar" />
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
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
