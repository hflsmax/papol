import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { deleteBoard, getBoard, updateBoard } from '../../../shared/api/boards.js';
import { listShelves, paperHref } from '../../../shared/api/papers.js';
import { boardSourcePapers } from '../../../shared/boardPapers.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import { confirmAction } from '../../../shared/confirmAction';
import appLimits from '../../../shared/appLimits.js';
import Avatar from './Avatar';
import AutoTextarea from './AutoTextarea';
import BoardPreview from './BoardPreview';
import HintPop from './HintPop';
import { boardFacts } from '../boardFacts';
import { authorList } from '../paperFormat';
import { appPath } from '../base';

/**
 * A board's jacket: what is known about it, and the way in.
 *
 * One jacket in both shells, as a paper has. The web shows it as the page at
 * /board/<uuid>; Papol macOS shows it beside the Boards list, where the
 * canvas opens in a document window of its own. It is set like a paper's —
 * the same panel, title, shelf picker and trash — because the two are the
 * same kind of thing.
 *
 * The name and the description are kept the way an anchor's card keeps its
 * own: when the field is left, not when a button is pressed. A board is a
 * quiet thing and its jacket should not ask to be saved.
 */

const SHOWN_PAPERS = 5;
const SHOWN_STAGED = 4;

function TrashGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 4h10.8" />
      <path d="M6.2 4V2.7h3.6V4" />
      <path d="M4.1 4l.5 9.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L11.9 4" />
      <path d="M6.7 6.6v5.2M9.3 6.6v5.2" />
    </svg>
  );
}

// "Vaswani et al. · 2017": who and when, for telling one paper from another.
const paperByline = (paper) => {
  const authors = authorList(paper.authors);
  const first = authors.length ? `${authors[0]}${authors.length > 1 ? ' et al.' : ''}` : null;
  return [first, paper.year].filter(Boolean).join(' · ');
};

export default function BoardJacket({
  boardUuid, onOpen, onBack, backHref, backLabel = 'Back',
  hideBack = false, onChanged, onDeleted, refreshKey,
}) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [shelves, setShelves] = useState([]);
  const [shelfWarning, setShelfWarning] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'name' | 'description'
  const [draft, setDraft] = useState('');
  const abandoned = useRef(false);

  const load = (quiet) => {
    let gone = false;
    if (!quiet) { setBoard(null); setError(null); }
    getBoard(boardUuid)
      .then((found) => {
        if (gone) return;
        setBoard(found);
        if (found.can_edit) listShelves().then((list) => !gone && setShelves(list)).catch(() => {});
      })
      .catch((err) => !gone && setError(err?.message || String(err)));
    return () => { gone = true; };
  };

  useEffect(() => {
    setEditing(null);
    return load(false);
  }, [boardUuid]);

  // The shell says when the board may have changed underneath — a sync, an
  // edit in its canvas — and it is read again in place, without a wait.
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return undefined; }
    if (editing) return undefined;
    return load(true);
  }, [refreshKey]);

  const save = async (values) => {
    setError(null);
    try {
      const saved = await updateBoard(board.uuid, values);
      setBoard((current) => ({ ...current, ...saved, items: current.items, staged_items: current.staged_items, groups: current.groups, papers: current.papers }));
      onChanged?.();
      return true;
    } catch (err) {
      setError(err?.message || String(err));
      return false;
    }
  };

  const beginEditing = (field) => {
    if (!board?.can_edit) return;
    abandoned.current = false;
    setDraft(field === 'name' ? board.name : (board.description || ''));
    setEditing(field);
  };

  const beginWithKeyboard = (field) => (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    beginEditing(field);
  };

  const cancelEditing = () => {
    abandoned.current = true;
    setEditing(null);
  };

  const finishEditing = async () => {
    if (!editing || abandoned.current) return;
    abandoned.current = true;
    const field = editing;
    const value = draft.trim();
    setEditing(null);
    const previous = field === 'name' ? board.name : (board.description || '');
    // A board always has a name: emptying it keeps the one it had.
    if (value === previous || (field === 'name' && !value)) return;
    await save(field === 'name' ? { name: value } : { description: value || null });
  };

  const moveToShelf = async (shelfUuid) => {
    setShelfWarning(null);
    try {
      const saved = await updateBoard(board.uuid, { shelf_uuid: shelfUuid });
      setBoard((current) => ({ ...current, shelf_uuid: saved?.shelf_uuid ?? shelfUuid }));
      onChanged?.();
    } catch (err) {
      setShelfWarning(err?.message || String(err));
    }
  };

  const remove = async () => {
    if (!(await confirmAction(`Delete “${board.name}”? Its cards go with it. This cannot be undone.`, { confirmLabel: 'Delete board', destructive: true }))) return;
    setError(null);
    try {
      await deleteBoard(board.uuid);
      onDeleted?.();
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const back = !hideBack && (
    <BackLink className="back-button" href={backHref} onBack={onBack}>&larr; {backLabel}</BackLink>
  );

  if (error && !board) {
    return (
      <div className="board-jacket">
        {back}
        <div className="panel"><div className="error" role="alert">{error}</div></div>
      </div>
    );
  }
  if (!board) return <div className="loading"><Working label="Loading board…" /></div>;

  const mine = Boolean(board.can_edit);
  const open = () => onOpen(board.uuid);
  const facts = boardFacts(board);
  const papers = boardSourcePapers(board);
  const staged = mine ? (board.staged_items || []) : [];

  return (
    <div className="board-jacket">
      {back}
      {error && <div className="error" role="alert">{error}</div>}

      <div className="panel">
        <div className="detail-title-row board-jacket-title-row">
          <div className="board-jacket-heading">
            {editing === 'name' ? (
              <input
                className="board-jacket-name-input"
                value={draft}
                maxLength={appLimits.text.board_name}
                aria-label="Board name"
                autoFocus
                onFocus={(event) => event.target.select()}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={finishEditing}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); finishEditing(); }
                  if (event.key === 'Escape') cancelEditing();
                }}
              />
            ) : (
              <h2
                className={mine ? 'board-jacket-editable' : undefined}
                {...(mine ? {
                  tabIndex: 0,
                  title: 'Rename this board',
                  onClick: () => beginEditing('name'),
                  onKeyDown: beginWithKeyboard('name'),
                } : {})}
              >
                {board.name}
              </h2>
            )}
            <ExperimentalBadge />
          </div>
          {mine && (
            <div className="detail-toggle">
              {shelves.length > 0 && (
                <span className="hint-anchor paper-shelf-picker">
                  <label htmlFor="board-shelf">Shelf:</label>
                  <select id="board-shelf" value={board.shelf_uuid || ''} onChange={(event) => moveToShelf(event.target.value)}>
                    {shelves.map((shelf) => (
                      <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>
                    ))}
                  </select>
                  {shelfWarning && <HintPop text={shelfWarning} onClose={() => setShelfWarning(null)} />}
                </span>
              )}
              <button
                type="button"
                className="icon-button danger-icon"
                onClick={remove}
                title="Delete this board — its cards go with it"
                aria-label="Delete this board"
              >
                <TrashGlyph />
              </button>
            </div>
          )}
        </div>

        <p className="board-jacket-facts" aria-label="About this board">
          {facts.map((fact) => (
            fact.key === 'owner' ? (
              <a key="owner" className="board-jacket-owner" href={appPath(`/u/${fact.owner.uuid}`)}>
                <Avatar user={fact.owner} className="mini-avatar" />
                {fact.owner.display_name}
              </a>
            ) : fact.dateTime ? (
              <time key={fact.key} dateTime={fact.dateTime}>{fact.text}</time>
            ) : <span key={fact.key}>{fact.text}</span>
          ))}
        </p>

        {editing === 'description' ? (
          <AutoTextarea
            className="inline-edit-box board-jacket-description-input"
            value={draft}
            rows={3}
            maxLength={appLimits.text.board_description}
            autoFocus
            placeholder="What are you exploring on this board?"
            aria-label="Board description"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finishEditing}
            onKeyDown={(event) => {
              if (event.key === 'Escape') cancelEditing();
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finishEditing(); }
            }}
          />
        ) : mine ? (
          <p
            className={`board-jacket-description board-jacket-editable${board.description ? '' : ' empty'}`}
            tabIndex={0}
            title="Edit the description"
            onClick={() => beginEditing('description')}
            onKeyDown={beginWithKeyboard('description')}
          >
            {board.description || 'What are you exploring on this board?'}
          </p>
        ) : board.description && <p className="board-jacket-description">{board.description}</p>}

        <div className="paper-actions">
          <button type="button" className="primary" onClick={open}>Open board</button>
        </div>

        <BoardPreview board={board} onOpen={open} />

        {papers.length > 0 && (
          <section className="board-jacket-section" aria-labelledby="board-jacket-papers">
            <h4 className="kicker" id="board-jacket-papers">Papers on this board</h4>
            <ul className="board-jacket-papers">
              {papers.slice(0, SHOWN_PAPERS).map((paper) => (
                <li key={paper.sha256}>
                  <a href={paperHref(paper)}>{paper.title}</a>
                  {paperByline(paper) && <span>{paperByline(paper)}</span>}
                </li>
              ))}
            </ul>
            {papers.length > SHOWN_PAPERS && (
              <p className="board-jacket-more">+{papers.length - SHOWN_PAPERS} more</p>
            )}
          </section>
        )}

        {staged.length > 0 && (
          <section className="board-jacket-section" aria-labelledby="board-jacket-staged">
            <div className="board-jacket-section-head">
              <div>
                <h4 className="kicker" id="board-jacket-staged">Waiting to place</h4>
                <p>{staged.length} {staged.length === 1 ? 'item is' : 'items are'} ready to go on this board.</p>
              </div>
              <button type="button" onClick={open}>Place on board</button>
            </div>
            <div className="board-jacket-staged">
              {staged.slice(0, SHOWN_STAGED).map((item) => (
                <div key={item.uuid} className="board-jacket-staged-item">
                  <span>{item.kind === 'image' ? 'Clip' : 'Excerpt'}</span>
                  <p>{item.content || item.excerpt_text || 'Clipped paper content'}</p>
                  {item.source_label && <small>{item.source_label}</small>}
                </div>
              ))}
              {staged.length > SHOWN_STAGED && (
                <div className="board-jacket-staged-more">+{staged.length - SHOWN_STAGED} more</div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
