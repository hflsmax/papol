import React, { useState } from 'react';
import { updatePaper, paperHref } from '../api';
import { RatingSummary } from './Rating';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';
import { appPath } from '../base';

export default function PaperList({ papers, isOwn, tags = [], shelves = [], selectedTag = null, onSelectTag, onSelectPaper, onChanged }) {
  const [search, setSearch] = useState('');
  const [toggleWarning, setToggleWarning] = useState(null); // { id, text }
  const [openShelfPicker, setOpenShelfPicker] = useState(null);

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

  const filteredPapers = papers.filter((paper) => {
    const searchLower = search.toLowerCase();
    return (selectedTag == null || (paper.tags || []).some((tag) => tag.id === selectedTag)) && (
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
      <div className="search-bar paper-search-tools">
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
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
