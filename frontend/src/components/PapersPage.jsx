import React, { useState, useEffect } from 'react';
import { listLibraryBoards, listPapers, paperHref } from '../api';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import PaperUpload from './PaperUpload';
import { appPath } from '../base';

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

export default function PapersPage({ currentUser, onSelectPaper, onSelectBoard }) {
  const [papers, setPapers] = useState(null);
  const [boards, setBoards] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [selectedUser, setSelectedUser] = useState(null);
  const [error, setError] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);

  const load = () => {
    Promise.all([listPapers(), listLibraryBoards()])
      .then(([nextPapers, nextBoards]) => { setPapers(nextPapers); setBoards(nextBoards); })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="error">{error}</div>;
  if (papers === null || boards === null) return <div className="loading">Loading the library…</div>;

  const searchLower = search.toLowerCase();
  const matches = (p) =>
    (selectedUser == null || (p.readers || []).some((r) => r.user.id === selectedUser)) &&
    (p.title.toLowerCase().includes(searchLower) ||
      (p.authors && p.authors.toLowerCase().includes(searchLower)) ||
      (p.journal && p.journal.toLowerCase().includes(searchLower)) ||
      (p.readers || []).some((r) =>
        r.user.display_name.toLowerCase().includes(searchLower)
      ));

  const readers = Array.from(
    new Map(
      [
        ...papers.flatMap((paper) => paper.readers || []).map((entry) => entry.user),
        ...boards.map((board) => board.owner).filter(Boolean),
      ].map((reader) => [reader.id, reader])
    ).values()
  ).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const shown = [...papers.filter(matches)].sort(SORTS[sortBy].cmp);
  const shownBoards = boards.filter((board) =>
    (selectedUser == null || board.user_id === selectedUser) &&
    (board.name.toLowerCase().includes(searchLower) ||
      (board.owner?.display_name || '').toLowerCase().includes(searchLower))
  ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return (
    <div className={reviewingUpload ? 'library-page upload-review-mode' : 'library-page'}>
      {currentUser && (
        <PaperUpload
          onPaperCreated={load}
          onReviewChange={setReviewingUpload}
        />
      )}

      <div className="panel paper-list">
        <div className="search-bar library-search-tools">
          {readers.length > 0 && (
            <div className="library-reader-filters" aria-label="Filter papers by reader">
              <button className={selectedUser == null ? 'reader-filter selected' : 'reader-filter'} onClick={() => setSelectedUser(null)}>All readers</button>
              {readers.map((reader) => (
                <button key={reader.id} className={selectedUser === reader.id ? 'reader-filter selected' : 'reader-filter'} onClick={() => setSelectedUser(reader.id)}>
                  <Avatar user={reader} className="reader-filter-avatar" />
                  <span>{reader.display_name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="library-search-line">
            <input
              type="text"
              placeholder="Search the library…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="sort-control">
              Sort by
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {Object.entries(SORTS).map(([key, s]) => (
                  <option key={key} value={key}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {shown.length === 0 && shownBoards.length === 0 ? (
          <p className="no-papers">
            {papers.length === 0 && boards.length === 0 ? 'The library is empty.' : 'Nothing matches your search.'}
          </p>
        ) : (
          <ul className="grouped-papers">
            {shownBoards.map((board) => (
              <li key={`board-${board.guid}`} className="paper-group nook-board-row library-board-row">
                <a
                  className="paper-group-head library-board-link"
                  href={appPath(`/boards/${board.guid}`)}
                  data-document
                  onClick={(event) => { event.preventDefault(); onSelectBoard(board.guid); }}
                >
                  <div className="paper-title-row"><h4>{board.name}</h4></div>
                </a>
                {board.owner && <a className="avatar-chip has-pop" href={appPath(`/u/${board.owner.id}`)}><Avatar user={board.owner} className="nook-chip-avatar" /><span className="chip-pop"><span className="chip-pop-name">{board.owner.display_name}</span>{board.owner.affiliation && <span className="chip-pop-aff">{board.owner.affiliation}</span>}</span></a>}
              </li>
            ))}
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
                      href={appPath(`/u/${entry.user.id}`)}
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
