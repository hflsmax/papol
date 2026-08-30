import React, { useEffect, useState } from 'react';
import { createBoard, listBoards, updateBoard } from '../api';
import ExperimentalBadge from './ExperimentalBadge';

const formatLastEdit = (value) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

export default function BoardsSection({ onSelectBoard, initialBoards = null, shelves = [], isOwn = true, onChanged }) {
  const [boards, setBoards] = useState(initialBoards || []);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [shelfId, setShelfId] = useState(() => shelves.find((shelf) => shelf.is_default)?.id || shelves[0]?.id || '');

  useEffect(() => {
    if (initialBoards) { setBoards(initialBoards); return; }
    listBoards().then(setBoards).catch((err) => setError(err.message));
  }, [initialBoards]);
  useEffect(() => {
    if (!shelfId && shelves.length) setShelfId(shelves.find((shelf) => shelf.is_default)?.id || shelves[0].id);
  }, [shelves, shelfId]);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const board = await createBoard({ name: name.trim(), description: description.trim() || null, shelf_id: Number(shelfId) });
      onSelectBoard(board.guid);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="nook-boards" aria-labelledby="boards-title">
      <div className="boards-heading">
        <div>
          <h3 id="boards-title" className="experimental-title">Boards <ExperimentalBadge /></h3>
          <p className="panel-note">Private spaces for exploring ideas and research directions.</p>
        </div>
        {isOwn && !creating && <button className="primary" onClick={() => setCreating(true)}>New board</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {creating && (
        <form className="panel board-create" onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="board-name">Name</label>
            <input id="board-name" value={name} onChange={(e) => setName(e.target.value)} maxLength="120" autoFocus required />
          </div>
          <div className="form-group">
            <label htmlFor="board-shelf">Shelf</label>
            <select id="board-shelf" value={shelfId} onChange={(event) => setShelfId(event.target.value)} required>
              {shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="board-description">Description or guiding question <span className="optional">optional</span></label>
            <textarea id="board-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength="4000" rows="3" />
          </div>
          <div className="form-actions">
            <button className="primary" type="submit">Create board</button>
            <button type="button" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}
      {!creating && boards.length === 0 && <div className="panel"><p className="panel-note">No boards yet.</p></div>}
      <div className="board-list">
        {boards.map((board) => (
          <div className="board-list-card board-list-card-board" role="button" tabIndex="0" key={board.guid} style={{ '--shelf-color': shelves.find((shelf) => shelf.id === board.shelf_id)?.color || 'var(--line-strong)' }} onClick={() => onSelectBoard(board.guid)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectBoard(board.guid); }}>
            <span className="board-list-title">{board.name}</span>
            {board.description && <span className="board-list-description">{board.description}</span>}
            <span className="board-list-meta"><span>{board.item_count} {board.item_count === 1 ? 'item' : 'items'}</span><time dateTime={board.updated_at}>Last edited {formatLastEdit(board.updated_at)}</time></span>
            {isOwn && <select className="board-list-shelf" aria-label={`Shelf for ${board.name}`} value={board.shelf_id || ''} onClick={(event) => event.stopPropagation()} onChange={async (event) => { event.stopPropagation(); await updateBoard(board.guid, { shelf_id: Number(event.target.value) }); setBoards((current) => current.map((item) => item.guid === board.guid ? { ...item, shelf_id: Number(event.target.value) } : item)); onChanged?.(); }}>
              {shelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>)}
            </select>}
          </div>
        ))}
      </div>
    </section>
  );
}
