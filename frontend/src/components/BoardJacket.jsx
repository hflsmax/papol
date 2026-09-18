import React, { useEffect, useState } from 'react';
import { getBoard, updateBoard } from '../../../shared/api/boards.js';
import BackLink from '../../../shared/ui/BackLink.jsx';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import Avatar from './Avatar';
import { lastEdited } from '../../../shared/lastEdited.js';
import appLimits from '../../../shared/appLimits.js';
import { appPath } from '../base';

/**
 * A board's jacket: what is known about it, and the way in.
 *
 * A board used to have no jacket at all. Its whole presence in the Library
 * was a row in a nook showing its name, and opening that row left the
 * Library for the canvas — so a board had a description column that nothing
 * could display, and no place to come back to. The canvas's Back had
 * nowhere to lead, which is how it came to lead to the front door and read
 * as a home button, and why a reader who arrived back at Papol had to find
 * the nook and the row again by hand.
 *
 * So a board is now shaped like a paper: a jacket in the Library, and an
 * application that opens it. The row opens the jacket, the jacket opens the
 * canvas, and the canvas comes back to the jacket. On the desktop the
 * jacket sits in the Library window and the canvas is a document window of
 * its own, which is the same arrangement in both shells for the first time.
 *
 * Its two writable fields are kept the way an anchor's card keeps its own:
 * when the field is left, not when a button is pressed. A board is a quiet
 * thing and its jacket should not ask to be saved.
 */

export default function BoardJacket({ boardUuid, currentUser, onOpen, onBack, backHref, backLabel }) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    let gone = false;
    setBoard(null);
    setError(null);
    getBoard(boardUuid)
      .then((found) => {
        if (gone) return;
        setBoard(found);
        setName(found.name);
        setDescription(found.description || '');
      })
      .catch((err) => !gone && setError(err.message));
    return () => { gone = true; };
  }, [boardUuid]);

  // What has already been sent, so leaving a field that nothing changed
  // says nothing to the server.
  const keep = async (field, value) => {
    if (!board?.can_edit || value === (board[field] || '')) return;
    if (field === 'name' && !value.trim()) { setName(board.name); return; }
    try {
      const saved = await updateBoard(board.uuid, { [field]: value });
      setBoard((current) => ({ ...current, ...saved }));
    } catch (err) {
      setError(err.message);
    }
  };

  if (error && !board) return <div className="panel board-jacket"><div className="error" role="alert">{error}</div></div>;
  if (!board) return <div className="loading" role="status" aria-live="polite">Loading board…</div>;

  const mine = board.can_edit;
  const cards = board.item_count;

  return (
    <div className="board-jacket">
      <BackLink className="back-btn" href={backHref} onBack={onBack}>&larr; {backLabel}</BackLink>
      <div className="panel">
        <div className="board-jacket-head">
          {mine ? (
            <input
              className="board-jacket-name"
              value={name}
              aria-label="Board name"
              maxLength={appLimits.text.board_name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => keep('name', name.trim())}
            />
          ) : <h1 className="board-jacket-name">{board.name}</h1>}
          <ExperimentalBadge />
        </div>

        <p className="board-jacket-facts">
          {!mine && board.owner && (
            <a className="avatar-chip mini" href={appPath(`/u/${board.owner.uuid}`)}>
              <Avatar user={board.owner} className="mini-avatar" />
              {board.owner.display_name}
            </a>
          )}
          <span>{cards} {cards === 1 ? 'card' : 'cards'}</span>
          <time dateTime={board.updated_at}>Edited {lastEdited(board.updated_at)}</time>
        </p>

        {mine ? (
          <textarea
            className="board-jacket-note"
            rows={3}
            value={description}
            placeholder="What is this board for?"
            aria-label="Description"
            maxLength={appLimits.text.board_description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => keep('description', description.trim())}
          />
        ) : board.description && <p className="board-jacket-note">{board.description}</p>}

        <div className="board-jacket-actions">
          <button type="button" className="primary" onClick={() => onOpen(board.uuid)}>Open board</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
