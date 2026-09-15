import React, { useState } from 'react';
import { createBoard } from '../../../shared/api/boards.js';
import appLimits from '../../../shared/appLimits.js';

// Naming a new board and choosing its shelf, which decides who can find it.
export default function BoardCreateForm({ shelves, className, onCreated, onCancel }) {
  const [boardName, setBoardName] = useState('');
  const [boardShelfUuid, setBoardShelfUuid] = useState(
    () => shelves.find((shelf) => shelf.is_default)?.uuid || shelves[0]?.uuid || ''
  );
  const [error, setError] = useState(null);
  const selectedBoardShelf = shelves.find((shelf) => String(shelf.uuid) === String(boardShelfUuid));

  const submit = async (event) => {
    event.preventDefault();
    if (!boardName.trim()) return;
    setError(null);
    try {
      const selectedShelf = shelves.find((shelf) => String(shelf.uuid) === String(boardShelfUuid));
      const board = await createBoard({ name: boardName.trim(), shelf_uuid: selectedShelf?.uuid ?? null });
      onCreated(board);
    } catch (err) {
      // Said where the reader pressed Create, not left as a button that
      // silently did nothing (the demo has no boards, for one).
      setError(err.message);
    }
  };

  return (
    <form className={`panel board-create${className ? ` ${className}` : ''}`} onSubmit={submit}>
      <div className="board-create-heading"><h3>New board</h3><p>Name it and choose who can find it through its shelf.</p></div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="board-create-fields">
        <div className="form-group"><label htmlFor="inline-board-name">Board name</label><input id="inline-board-name" value={boardName} onChange={(event) => setBoardName(event.target.value)} autoFocus required maxLength={appLimits.text.board_name} placeholder="Untitled board" /></div>
        <div className="form-group board-create-shelf-field"><label htmlFor="inline-board-shelf">Shelf</label><div className="board-create-shelf-select"><select id="inline-board-shelf" value={boardShelfUuid} onChange={(event) => setBoardShelfUuid(event.target.value)} required>{shelves.map((shelf) => <option key={shelf.uuid} value={shelf.uuid}>{shelf.name} · {shelf.is_public ? 'Public' : 'Private'}</option>)}</select><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></div><p className="board-create-shelf-hint">{selectedBoardShelf?.is_public ? 'Anyone can view this board.' : 'Only you can view this board.'}</p></div>
      </div>
      <div className="form-actions"><button className="primary" type="submit">Create board</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}
