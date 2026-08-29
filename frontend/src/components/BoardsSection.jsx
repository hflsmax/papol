import React, { useEffect, useState } from 'react';
import { createBoard, listBoards } from '../api';
import ExperimentalBadge from './ExperimentalBadge';

export default function BoardsSection({ onSelectBoard }) {
  const [boards, setBoards] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listBoards().then(setBoards).catch((err) => setError(err.message));
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const board = await createBoard({ name: name.trim(), description: description.trim() || null });
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
        {!creating && <button className="primary" onClick={() => setCreating(true)}>New board</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {creating && (
        <form className="panel board-create" onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="board-name">Name</label>
            <input id="board-name" value={name} onChange={(e) => setName(e.target.value)} maxLength="120" autoFocus required />
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
          <button className="board-list-card" key={board.guid} onClick={() => onSelectBoard(board.guid)}>
            <span className="board-list-title">{board.name}</span>
            {board.description && <span className="board-list-description">{board.description}</span>}
            <span className="board-list-meta">{board.item_count} {board.item_count === 1 ? 'item' : 'items'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
