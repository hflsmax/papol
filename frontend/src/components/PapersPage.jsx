import React, { useState, useEffect } from 'react';
import { listLibraryBoards } from '../../../shared/api/boards.js';
import { listPapers, paperHref } from '../../../shared/api/papers.js';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import PaperUpload from './PaperUpload';
import { appPath } from '../base';
import { formatAuthors, newestFirst as newest, seminarRank } from '../paperFormat';

const avgMerit = (p) => {
  const rated = p.users
    .map((r) => r.rating_liking)
    .filter((v) => v != null);
  return rated.length
    ? rated.reduce((s, v) => s + v, 0) / rated.length
    : null;
};


const SORTS = {
  activity: {
    label: 'Seminar activity',
    cmp: (a, b) => seminarRank(a) - seminarRank(b) || newest(a, b),
  },
  newest: { label: 'Newest', cmp: newest },
  users: {
    label: 'Most users',
    cmp: (a, b) =>
      (b.users?.length || 0) - (a.users?.length || 0) || newest(a, b),
  },
  merit: {
    label: 'Highest merit',
    // Papers no user has rated go last
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

export default function PapersPage({
  currentUser, onSelectPaper, onSelectBoard,
  incomingPaperFile, onIncomingPaperFileHandled, onReportableError,
}) {
  const [papers, setPapers] = useState(null);
  const [boards, setBoards] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [selectedUser, setSelectedUser] = useState(null);
  const [error, setError] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);

  const load = () => {
    // Boards are secondary here: if that list fails, the papers still show.
    Promise.all([listPapers(), listLibraryBoards().catch(() => [])])
      .then(([nextPapers, nextBoards]) => { setPapers(nextPapers); setBoards(nextBoards); })
      .catch((err) => setError(err.message));
  };

  useEffect(load, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (papers === null || boards === null) return <div className="loading" role="status" aria-live="polite">Loading the library…</div>;

  const searchLower = search.toLowerCase();
  const matches = (p) =>
    (selectedUser == null || p.users.some((r) => r.user.uuid === selectedUser)) &&
    (p.title.toLowerCase().includes(searchLower) ||
      (p.authors && p.authors.toLowerCase().includes(searchLower)) ||
      (p.journal && p.journal.toLowerCase().includes(searchLower)) ||
      p.users.some((r) =>
        r.user.display_name.toLowerCase().includes(searchLower)
      ));

  const users = Array.from(
    new Map(
      [
        ...papers.flatMap((paper) => paper.users || []).map((entry) => entry.user),
        ...boards.map((board) => board.owner).filter(Boolean),
      ].map((user) => [user.uuid, user])
    ).values()
  ).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const shown = [...papers.filter(matches)].sort(SORTS[sortBy].cmp);
  const shownBoards = boards.filter((board) =>
    (selectedUser == null || board.user_uuid === selectedUser) &&
    (board.name.toLowerCase().includes(searchLower) ||
      (board.owner?.display_name || '').toLowerCase().includes(searchLower))
  ).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const hasActiveFilters = selectedUser != null || Boolean(search.trim());

  return (
    <div className={reviewingUpload ? 'library-page upload-review-mode' : 'library-page'}>
      {currentUser && (
        <PaperUpload
          onReportableError={onReportableError}
          onPaperCreated={(paper) => {
            if (paper?.sha256 != null) onSelectPaper(paper.sha256);
            else load();
          }}
          onReviewChange={setReviewingUpload}
          incomingFile={incomingPaperFile}
          onIncomingFileHandled={onIncomingPaperFileHandled}
        />
      )}

      <div className="panel paper-list">
        <div className="search-bar library-search-tools">
          {users.length > 0 && (
            <div className="library-user-filters" role="group" aria-label="Filter papers by user">
              <button className={selectedUser == null ? 'user-filter selected' : 'user-filter'} aria-pressed={selectedUser == null} onClick={() => setSelectedUser(null)}>All users</button>
              {users.map((user) => (
                <button key={user.uuid} className={selectedUser === user.uuid ? 'user-filter selected' : 'user-filter'} aria-pressed={selectedUser === user.uuid} onClick={() => setSelectedUser(user.uuid)}>
                  <Avatar user={user} className="user-filter-avatar" />
                  <span>{user.display_name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="library-search-line">
            <input
              type="text"
              aria-label="Search the library"
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
          <div className="no-papers">
            <p>{papers.length === 0 && boards.length === 0 ? 'The library is empty.' : 'Nothing matches your filters.'}</p>
            {hasActiveFilters && <button type="button" className="link-btn" onClick={() => { setSelectedUser(null); setSearch(''); }}>Clear filters</button>}
          </div>
        ) : (
          <ul className="grouped-papers">
            {shownBoards.map((board) => (
              <li key={`board-${board.uuid}`} className="paper-group nook-board-row library-board-row">
                <a
                  className="paper-group-head library-board-link"
                  href={appPath(`/boards/${board.uuid}`)}
                  data-document
                  onClick={(event) => { event.preventDefault(); onSelectBoard(board.uuid); }}
                >
                  <div className="paper-title-row"><h4>{board.name}</h4></div>
                </a>
                {board.owner && <a className="avatar-chip has-pop" href={appPath(`/u/${board.owner.uuid}`)}><Avatar user={board.owner} className="nook-chip-avatar" /><span className="chip-pop"><span className="chip-pop-name">{board.owner.display_name}</span>{board.owner.affiliation && <span className="chip-pop-aff">{board.owner.affiliation}</span>}</span></a>}
              </li>
            ))}
            {shown.map((paper) => (
              <li key={paper.sha256} className="paper-group">
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
                    {formatAuthors(paper.authors)}
                    {paper.year && ` (${paper.year})`}
                    {paper.journal && ` - ${paper.journal}`}
                  </p>
                </div>
                <div className="entry-chips">
                  {paper.users.map((entry) => (
                    <a
                      key={entry.user.uuid}
                      className={
                        entry.is_author
                          ? 'avatar-chip has-pop author'
                          : 'avatar-chip has-pop'
                      }
                      href={appPath(`/u/${entry.user.uuid}`)}
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
