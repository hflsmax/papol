import React, { useEffect, useState } from 'react';
import { updateBoard, updatePaper, paperHref } from '../api';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';
import { appPath } from '../base';

export default function PaperList({ papers, boards = [], isOwn, tags = [], shelves = [], selectedTag = null, onSelectTag, onSelectPaper, onSelectBoard, onChanged }) {
  const [search, setSearch] = useState('');
  const [selectedShelf, setSelectedShelf] = useState(null);
  const [browserOpen, setBrowserOpen] = useState(
    () => window.sessionStorage.getItem('papol.paperBrowserOpen') === 'true'
  );
  const [toggleWarning, setToggleWarning] = useState(null); // { id, text }
  const [openShelfPicker, setOpenShelfPicker] = useState(null);

  useEffect(() => {
    window.sessionStorage.setItem('papol.paperBrowserOpen', String(browserOpen));
  }, [browserOpen]);

  const handleShelfMove = async (paper, shelfId) => {
    setToggleWarning(null);
    try {
      await updatePaper(paper.id, { shelf_id: shelfId });
      setOpenShelfPicker(null);
      onChanged();
    } catch (err) {
      setToggleWarning({ id: paper.id, text: err.message });
    }
  };
  const handleBoardShelfMove = async (board, shelfId) => {
    const pickerId = `board:${board.guid}`;
    try {
      await updateBoard(board.guid, { shelf_id: shelfId });
      setOpenShelfPicker(null);
      onChanged();
    } catch (err) {
      setToggleWarning({ id: pickerId, text: err.message });
    }
  };

  const filteredPapers = papers.filter((paper) => {
    const searchLower = search.toLowerCase();
    return (selectedShelf == null || paper.shelf_id === selectedShelf) &&
      (selectedTag == null || (paper.tags || []).some((tag) => tag.id === selectedTag)) && (
      paper.title.toLowerCase().includes(searchLower) ||
      (paper.authors && paper.authors.toLowerCase().includes(searchLower)) ||
      (paper.journal && paper.journal.toLowerCase().includes(searchLower))
    );
  });
  const filteredBoards = boards.filter((board) => {
    const searchLower = search.toLowerCase();
    return selectedTag == null &&
      (selectedShelf == null || board.shelf_id === selectedShelf) &&
      (board.name.toLowerCase().includes(searchLower) || (board.description || '').toLowerCase().includes(searchLower));
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
  const entries = [
    ...filteredPapers.map((paper) => ({ kind: 'paper', value: paper, at: paper.created_at, rank: rank(paper) })),
    ...filteredBoards.map((board) => ({ kind: 'board', value: board, at: board.updated_at, rank: 2 })),
  ].sort((a, b) => (isOwn ? 0 : a.rank - b.rank) || new Date(b.at) - new Date(a.at));

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

  const activeShelf = shelves.find((shelf) => shelf.id === selectedShelf);
  const activeTag = tags.find((tag) => tag.id === selectedTag);
  const filterSummary = [
    activeShelf?.name,
    activeTag ? `#${activeTag.name}` : null,
    search.trim() ? `“${search.trim()}”` : null,
  ].filter(Boolean).join(' · ');

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
          <div className="shelf-filter" aria-label="Filter nook items by shelf">
            <div className="shelf-filter-case">
              {shelves.map((shelf) => (
                <button
                  key={shelf.id}
                  className={selectedShelf === shelf.id ? 'shelf-filter-cubby selected' : 'shelf-filter-cubby'}
                  style={{ '--shelf-color': shelf.color }}
                  onClick={() => setSelectedShelf(selectedShelf === shelf.id ? null : shelf.id)}
                  aria-pressed={selectedShelf === shelf.id}
                  title={selectedShelf === shelf.id
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
                      {shelf.paper_count} {shelf.paper_count === 1 ? 'paper' : 'papers'}, {shelf.board_count || 0} {(shelf.board_count || 0) === 1 ? 'board' : 'boards'}
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
                  {selectedShelf === shelf.id && (
                    <span className="shelf-filter-x" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        {isOwn && tags.length > 0 && (
          <div className="search-tag-filters" aria-label="Filter papers by tag">
            <button className={selectedTag == null ? 'tag-chip selected' : 'tag-chip'} onClick={() => onSelectTag(null)}>All</button>
            {tags.map((tag) => (
              <button key={tag.id} className={selectedTag === tag.id ? 'tag-chip selected' : 'tag-chip'} onClick={() => onSelectTag(tag.id)}>
                <span aria-hidden="true">#</span> {tag.name}
              </button>
            ))}
          </div>
        )}
        <input
          type="text"
          placeholder={
            isOwn ? 'Search papers and boards in your nook…' : 'Search papers and boards in this nook…'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        </div>}
      </div>

      {entries.length === 0 ? (
        <p className="no-papers">
          {papers.length === 0 && boards.length === 0
            ? isOwn
              ? 'No papers or boards yet.'
              : 'Nothing in this nook yet.'
            : selectedShelf != null || selectedTag != null
              ? 'Nothing tucked away here matches those filters.'
              : 'Nothing matches your search.'}
        </p>
      ) : (
        <ul>
          {entries.map((entry) => {
            if (entry.kind === 'board') {
              const board = entry.value;
              const pickerId = `board:${board.guid}`;
              return <li key={pickerId} className="nook-board-row">
                {isOwn && <span className="hint-anchor bar-anchor shelf-bar" onMouseEnter={() => setOpenShelfPicker(pickerId)} onMouseLeave={() => setOpenShelfPicker((current) => current === pickerId ? null : current)}>
                  <button className="shelf-current" style={{ '--shelf-color': shelves.find((shelf) => shelf.id === board.shelf_id)?.color || 'var(--line-strong)' }} onClick={(event) => { event.stopPropagation(); setOpenShelfPicker(openShelfPicker === pickerId ? null : pickerId); }} title="Move to another shelf" aria-label="Choose shelf" aria-expanded={openShelfPicker === pickerId} />
                  {openShelfPicker === pickerId && <span className="shelf-palette" onClick={(event) => event.stopPropagation()}>
                    {shelves.map((shelf) => <button key={shelf.id} className={board.shelf_id === shelf.id ? 'active' : ''} onClick={() => board.shelf_id === shelf.id ? setOpenShelfPicker(null) : handleBoardShelfMove(board, shelf.id)} title={`${shelf.name} — ${shelf.is_public ? 'Public' : 'Private'}`} aria-label={`Move to ${shelf.name}`} aria-pressed={board.shelf_id === shelf.id}><span style={{ background: shelf.color }} />{shelf.name}</button>)}
                  </span>}
                  {toggleWarning?.id === pickerId && <HintPop text={toggleWarning.text} onClose={() => setToggleWarning(null)} />}
                </span>}
                <div className="paper-item board-item-row"><div className="paper-title-row"><h4><a className="paper-title-link nook-board-title" href={appPath(`/boards/${board.guid}`)} data-document onClick={(event) => { event.preventDefault(); onSelectBoard(board.guid); }}>{board.name}</a></h4></div></div>
              </li>;
            }
            const paper = entry.value;
            return <React.Fragment key={`paper-${paper.id}`}>
            <li
              className={isOwn && paper.marketed === false ? 'unmarketed' : ''}
            >
              {/* Keep the row quiet: its edge shows the current shelf, and
                  reveals the full shelf palette only on request. */}
              {isOwn && (
                <span
                  className="hint-anchor bar-anchor shelf-bar"
                  onMouseEnter={() => setOpenShelfPicker(paper.id)}
                  onMouseLeave={() => setOpenShelfPicker((current) => current === paper.id ? null : current)}
                >
                  <button
                    className="shelf-current"
                    style={{ '--shelf-color': shelves.find((shelf) => shelf.id === paper.shelf_id)?.color || 'var(--line-strong)' }}
                    onClick={(event) => { event.stopPropagation(); setOpenShelfPicker(openShelfPicker === paper.id ? null : paper.id); }}
                    title="Move to another shelf"
                    aria-label="Choose shelf"
                    aria-expanded={openShelfPicker === paper.id}
                  />
                  {openShelfPicker === paper.id && (
                    <span className="shelf-palette" onClick={(event) => event.stopPropagation()}>
                      {shelves.map((shelf) => (
                        <button
                          key={shelf.id}
                          className={paper.shelf_id === shelf.id ? 'active' : ''}
                          onClick={() => paper.shelf_id === shelf.id ? setOpenShelfPicker(null) : handleShelfMove(paper, shelf.id)}
                          title={`${shelf.name} — ${shelf.is_public ? 'Public' : 'Private'}`}
                          aria-label={`Move to ${shelf.name}`}
                          aria-pressed={paper.shelf_id === shelf.id}
                        >
                          <span style={{ background: shelf.color }} />
                          {shelf.name}
                        </button>
                      ))}
                    </span>
                  )}
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
                        href={appPath(`/u/${entry.user.id}`)}
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
            </React.Fragment>;
          })}
        </ul>
      )}
    </div>
  );
}
