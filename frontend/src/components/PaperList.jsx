import React, { useEffect, useState } from 'react';
import { updateBoard } from '../../../shared/api/boards.js';
import { updatePaper, paperHref } from '../../../shared/api/papers.js';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';
import { appPath } from '../base';
import { formatAuthors, newestFirst, seminarRank } from '../paperFormat';
import { contextMenuHandler } from '../../../shared/contextMenu';

export default function PaperList({ papers, boards = [], isOwn, tags = [], shelves = [], selectedTag = null, onSelectTag, onSelectPaper, onSelectBoard, onChanged }) {
  const [search, setSearch] = useState('');
  const [selectedShelf, setSelectedShelf] = useState(null);
  const [browserOpen, setBrowserOpen] = useState(
    () => window.sessionStorage.getItem('papol.paperBrowserOpen') === 'true'
  );
  // { uuid, text }, where uuid names the row that refused: a paper by its
  // file, a board by `board:` and its UUID.
  const [toggleWarning, setToggleWarning] = useState(null);
  const [openShelfPicker, setOpenShelfPicker] = useState(null);
  useEffect(() => {
    window.sessionStorage.setItem('papol.paperBrowserOpen', String(browserOpen));
  }, [browserOpen]);

  const handleShelfMove = async (paper, shelfUuid) => {
    setToggleWarning(null);
    try {
      await updatePaper(paper.sha256, { shelf_uuid: shelfUuid });
      setOpenShelfPicker(null);
      onChanged();
    } catch (err) {
      setToggleWarning({ uuid: paper.sha256, text: err.message });
    }
  };
  const handleBoardShelfMove = async (board, shelfUuid) => {
    const pickerUuid = `board:${board.uuid}`;
    try {
      await updateBoard(board.uuid, { shelf_uuid: shelfUuid });
      setOpenShelfPicker(null);
      onChanged();
    } catch (err) {
      setToggleWarning({ uuid: pickerUuid, text: err.message });
    }
  };

  const filteredPapers = papers.filter((paper) => {
    const searchLower = search.toLowerCase();
    return (selectedShelf == null || paper.shelf_uuid === selectedShelf) &&
      (selectedTag == null || paper.tags.some((tag) => tag.uuid === selectedTag)) && (
      paper.title.toLowerCase().includes(searchLower) ||
      (paper.authors && paper.authors.toLowerCase().includes(searchLower)) ||
      (paper.journal && paper.journal.toLowerCase().includes(searchLower))
    );
  });
  const filteredBoards = boards.filter((board) => {
    const searchLower = search.toLowerCase();
    return selectedTag == null &&
      (selectedShelf == null || board.shelf_uuid === selectedShelf) &&
      (board.name.toLowerCase().includes(searchLower) || (board.description || '').toLowerCase().includes(searchLower));
  });

  // Your own nook reads as a journal: newest first, grouped by month.
  // Other nooks rank active seminars to the top.
  const entries = [
    ...filteredPapers.map((paper) => ({ kind: 'paper', value: paper, at: paper.created_at, rank: seminarRank(paper) })),
    ...filteredBoards.map((board) => ({ kind: 'board', value: board, at: board.updated_at, rank: 2 })),
  ].sort((a, b) => (isOwn ? 0 : a.rank - b.rank) || new Date(b.at) - new Date(a.at));

  const activeShelf = shelves.find((shelf) => shelf.uuid === selectedShelf);
  const activeTag = tags.find((tag) => tag.uuid === selectedTag);
  const filterSummary = [
    activeShelf?.name,
    activeTag ? `#${activeTag.name}` : null,
    search.trim() ? `“${search.trim()}”` : null,
  ].filter(Boolean).join(' · ');
  const hasActiveFilters = selectedShelf != null || selectedTag != null || Boolean(search.trim());
  const clearFilters = () => {
    setSelectedShelf(null);
    onSelectTag?.(null);
    setSearch('');
  };

  return (
    <div
      className={`panel paper-list${activeShelf ? ' shelf-view' : ''}`}
      style={activeShelf ? { '--active-shelf-color': activeShelf.color } : undefined}
    >
      <div className={`paper-browser${browserOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="paper-browser-toggle"
          onClick={() => setBrowserOpen((open) => !open)}
          aria-expanded={browserOpen}
        >
          <span className="paper-browser-title">
            {activeShelf && <span className="paper-browser-dot" style={{ background: activeShelf.color }} aria-hidden="true" />}
            Browse
          </span>
          <span className="paper-browser-summary">{filterSummary}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
        </button>
        {browserOpen && <div className="search-bar paper-search-tools">
        {shelves.length > 1 && (
          <div className="shelf-filter" role="group" aria-label="Filter nook items by shelf">
            <div className="shelf-filter-case">
              {shelves.map((shelf) => (
                <button
                  key={shelf.uuid}
                  className={selectedShelf === shelf.uuid ? 'shelf-filter-cubby selected' : 'shelf-filter-cubby'}
                  style={{ '--shelf-color': shelf.color }}
                  onClick={() => setSelectedShelf(selectedShelf === shelf.uuid ? null : shelf.uuid)}
                  aria-pressed={selectedShelf === shelf.uuid}
                  title={selectedShelf === shelf.uuid
                    ? `Clear ${shelf.name} shelf filter`
                    : `${shelf.name}: ${shelf.paper_count + (shelf.board_count || 0)} items`}
                >
                  <span className="shelf-filter-spine" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="shelf-filter-copy">
                    <span className="shelf-filter-name">{shelf.name}</span>
                    <span className="shelf-filter-meta">
                      {shelf.paper_count} {shelf.paper_count === 1 ? 'paper' : 'papers'}, {shelf.board_count} {shelf.board_count === 1 ? 'board' : 'boards'}
                      <span aria-hidden="true">·</span>
                      <span className="shelf-filter-visibility">
                        {shelf.is_public ? (
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <circle cx="8" cy="8" r="5.5" />
                            <path d="M2.8 8h10.4M8 2.5c1.4 1.5 2.1 3.3 2.1 5.5S9.4 12 8 13.5C6.6 12 5.9 10.2 5.9 8S6.6 4 8 2.5Z" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                            <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
                          </svg>
                        )}
                        {shelf.is_public ? 'Public' : 'Private'}
                      </span>
                    </span>
                  </span>
                  {selectedShelf === shelf.uuid && (
                    <span className="shelf-filter-x" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {isOwn && tags.length > 0 && (
          <div className="search-tag-filters" role="group" aria-label="Filter papers by tag">
            <button className={selectedTag == null ? 'tag-chip selected' : 'tag-chip'} aria-pressed={selectedTag == null} onClick={() => onSelectTag(null)}>All</button>
            {tags.map((tag) => (
              <button key={tag.uuid} className={selectedTag === tag.uuid ? 'tag-chip selected' : 'tag-chip'} aria-pressed={selectedTag === tag.uuid} onClick={() => onSelectTag(tag.uuid)}>
                <span aria-hidden="true">#</span> {tag.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          aria-label={isOwn ? 'Search my nook' : 'Search this nook'}
          placeholder={
            isOwn ? 'Search papers and boards in your nook…' : 'Search papers and boards in this nook…'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        </div>}
      </div>

      {entries.length === 0 ? (
        <div className="no-papers">
          <p>{papers.length === 0 && boards.length === 0
            ? isOwn
              ? 'No papers or boards yet.'
              : 'Nothing in this nook yet.'
            : selectedShelf != null || selectedTag != null
              ? 'Nothing tucked away here matches those filters.'
              : 'Nothing matches your search.'}</p>
          {hasActiveFilters && <button type="button" className="link-btn" onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <ul>
          {entries.map((entry) => {
            if (entry.kind === 'board') {
              const board = entry.value;
              const pickerUuid = `board:${board.uuid}`;
              return <li
                key={pickerUuid}
                className="nook-board-row"
                onContextMenu={contextMenuHandler(() => [
                { label: 'Open Board', onSelect: () => onSelectBoard(board.uuid) },
                isOwn && shelves.length > 0 && { separator: true },
                isOwn && shelves.length > 0 && {
                  label: 'Move to Shelf',
                  submenu: shelves.map((shelf) => ({
                    label: shelf.name,
                    checked: board.shelf_uuid === shelf.uuid,
                    onSelect: () => board.shelf_uuid !== shelf.uuid && handleBoardShelfMove(board, shelf.uuid),
                  })),
                },
              ])}>
                {isOwn && <span className="hint-anchor bar-anchor shelf-bar" onMouseEnter={() => setOpenShelfPicker(pickerUuid)} onMouseLeave={() => setOpenShelfPicker((current) => current === pickerUuid ? null : current)}>
                  <button className="shelf-current" style={{ '--shelf-color': shelves.find((shelf) => shelf.uuid === board.shelf_uuid)?.color || 'var(--line-strong)' }} onClick={(event) => { event.stopPropagation(); setOpenShelfPicker(openShelfPicker === pickerUuid ? null : pickerUuid); }} title="Move to another shelf" aria-label="Choose shelf" aria-expanded={openShelfPicker === pickerUuid} />
                  {openShelfPicker === pickerUuid && <span className="shelf-palette" onClick={(event) => event.stopPropagation()}>
                    {shelves.map((shelf) => <button key={shelf.uuid} className={board.shelf_uuid === shelf.uuid ? 'active' : ''} onClick={() => board.shelf_uuid === shelf.uuid ? setOpenShelfPicker(null) : handleBoardShelfMove(board, shelf.uuid)} title={`${shelf.name} — ${shelf.is_public ? 'Public' : 'Private'}`} aria-label={`Move to ${shelf.name}`} aria-pressed={board.shelf_uuid === shelf.uuid}><span style={{ background: shelf.color }} />{shelf.name}</button>)}
                  </span>}
                  {toggleWarning?.uuid === pickerUuid && <HintPop text={toggleWarning.text} onClose={() => setToggleWarning(null)} />}
                </span>}
                <div className="paper-item board-item-row"><div className="paper-title-row"><h4><a className="paper-title-link nook-board-title" href={appPath(`/board/${board.uuid}`)} onClick={(event) => { event.preventDefault(); onSelectBoard(board.uuid); }}>{board.name}</a></h4></div></div>
              </li>;
            }
            const paper = entry.value;
            return <li
              key={`paper-${paper.sha256}`}
              className={isOwn && !paper.is_public ? 'paper-private' : ''}
              onContextMenu={contextMenuHandler(() => [
                { label: 'Open Paper', onSelect: () => onSelectPaper(paper.sha256) },
                isOwn && shelves.length > 0 && { separator: true },
                isOwn && shelves.length > 0 && {
                  label: 'Move to Shelf',
                  submenu: shelves.map((shelf) => ({
                    label: shelf.name,
                    checked: paper.shelf_uuid === shelf.uuid,
                    onSelect: () => paper.shelf_uuid !== shelf.uuid && handleShelfMove(paper, shelf.uuid),
                  })),
                },
              ])}
            >
              {/* Keep the row quiet: its edge shows the current shelf, and
                  reveals the full shelf palette only on request. */}
              {isOwn && (
                <span
                  className="hint-anchor bar-anchor shelf-bar"
                  onMouseEnter={() => setOpenShelfPicker(paper.sha256)}
                  onMouseLeave={() => setOpenShelfPicker((current) => current === paper.sha256 ? null : current)}
                >
                  <button
                    className="shelf-current"
                    style={{ '--shelf-color': shelves.find((shelf) => shelf.uuid === paper.shelf_uuid)?.color || 'var(--line-strong)' }}
                    onClick={(event) => { event.stopPropagation(); setOpenShelfPicker(openShelfPicker === paper.sha256 ? null : paper.sha256); }}
                    title="Move to another shelf"
                    aria-label="Choose shelf"
                    aria-expanded={openShelfPicker === paper.sha256}
                  />
                  {openShelfPicker === paper.sha256 && (
                    <span className="shelf-palette" onClick={(event) => event.stopPropagation()}>
                      {shelves.map((shelf) => (
                        <button
                          key={shelf.uuid}
                          className={paper.shelf_uuid === shelf.uuid ? 'active' : ''}
                          onClick={() => paper.shelf_uuid === shelf.uuid ? setOpenShelfPicker(null) : handleShelfMove(paper, shelf.uuid)}
                          title={`${shelf.name} — ${shelf.is_public ? 'Public' : 'Private'}`}
                          aria-label={`Move to ${shelf.name}`}
                          aria-pressed={paper.shelf_uuid === shelf.uuid}
                        >
                          <span style={{ background: shelf.color }} />
                          {shelf.name}
                        </button>
                      ))}
                    </span>
                  )}
                  {toggleWarning?.uuid === paper.sha256 && (
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
                    user chips, and the two agree. */}
                {paper.room_status && (
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
                <RatingSummary paper={paper} compact />
              </div>
              {/* The users are the row's right-hand feature: who else
                  has this paper is the reason to look at a nook. Out of
                  the title row so they answer to the whole row rather
                  than to the title. */}
                {paper.users && paper.users.length > 0 && (
                  <div className="row-users">
                    {paper.users.map((entry) => (
                      <a
                        key={entry.user.uuid}
                        className={
                          entry.is_author
                            ? 'avatar-chip has-pop mini author'
                            : 'avatar-chip has-pop mini'
                        }
                        href={appPath(`/u/${entry.user.uuid}`)}
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
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
