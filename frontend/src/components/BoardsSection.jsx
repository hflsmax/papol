import React, { useEffect, useState } from 'react';
import { createBoard, listBoards, updateBoard } from '../../../shared/api/boards.js';
import ExperimentalBadge from '../../../shared/ui/ExperimentalBadge.jsx';
import { subscribeNativeData } from '../../../shared/nativeData.js';
import appLimits from '../../../shared/appLimits.js';

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
  const [shelfUuid, setShelfUuid] = useState(() => shelves.find((shelf) => shelf.is_default)?.uuid || shelves[0]?.uuid || '');

  useEffect(() => {
    if (initialBoards) { setBoards(initialBoards); return; }
    listBoards().then(setBoards).catch((err) => setError(err.message));
  }, [initialBoards]);
  useEffect(() => subscribeNativeData(() => {
    if (!initialBoards) listBoards().then(setBoards).catch((err) => setError(err.message));
  }), [initialBoards]);
  useEffect(() => {
    if (!shelfUuid && shelves.length) setShelfUuid(shelves.find((shelf) => shelf.is_default)?.uuid || shelves[0].uuid);
  }, [shelves, shelfUuid]);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const selectedShelf = shelves.find((shelf) => String(shelf.uuid) === String(shelfUuid));
      const board = await createBoard({ name: name.trim(), description: description.trim() || null, shelf_uuid: selectedShelf?.uuid ?? null });
      onSelectBoard(board.uuid);
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
      {error && <p className="error" role="alert">{error}</p>}
      {creating && (
        <form className="panel board-create" onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="board-name">Name</label>
            <input id="board-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={appLimits.text.board_name} autoFocus required />
          </div>
          <div className="form-group">
            <label htmlFor="board-shelf">Shelf</label>
            <select id="board-shelf" value={shelfUuid} onChange={(event) => setShelfUuid(event.target.value)} required>
              {shelves.map((shelf) => <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="board-description">Description or guiding question <span className="optional">optional</span></label>
            <textarea id="board-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={appLimits.text.board_description} rows="3" />
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
          <div className="board-list-card board-list-card-board" role="button" tabIndex="0" key={board.uuid} style={{ '--shelf-color': shelves.find((shelf) => shelf.uuid === board.shelf_uuid)?.color || 'var(--line-strong)' }} onClick={() => onSelectBoard(board.uuid)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectBoard(board.uuid); } }}>
            <span className="board-list-title">{board.name}</span>
            {board.description && <span className="board-list-description">{board.description}</span>}
            <span className="board-list-meta"><span>{board.item_count} {board.item_count === 1 ? 'item' : 'items'}</span><time dateTime={board.updated_at}>Last edited {formatLastEdit(board.updated_at)}</time></span>
            {isOwn && <select className="board-list-shelf" aria-label={`Shelf for ${board.name}`} value={board.shelf_uuid || ''} onClick={(event) => event.stopPropagation()} onChange={async (event) => { event.stopPropagation(); const selected = shelves.find((shelf) => String(shelf.uuid) === event.target.value); if (!selected) return; await updateBoard(board.uuid, { shelf_uuid: selected.uuid }); setBoards((current) => current.map((item) => item.uuid === board.uuid ? { ...item, shelf_uuid: selected.uuid } : item)); onChanged?.(); }}>
              {shelves.map((shelf) => <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>)}
            </select>}
          </div>
        ))}
      </div>
    </section>
  );
}
