import React, { useEffect, useState } from 'react';
import { createShelf, updateShelf, deleteShelf, createTag, deleteTag } from '../api';
import { confirmAction } from '../../../shared/confirmAction';

// The focused editor for a reader's shelves and private tags ("Shelf" in
// DESIGN.md). My nook opens it from its gear on the website, and Papol
// Desktop from its sidebar.
export default function NookManager({ space, setSpace, onChanged, onClose, onTagDeleted }) {
  const [error, setError] = useState(null);
  const [newTagName, setNewTagName] = useState('');

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  // Publishing and default changes need the server, so any of these can fail.
  const attempt = async (action) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-overlay shelf-manager-overlay" onMouseDown={() => onClose()}>
      <div className="modal-box shelf-manager" role="dialog" aria-modal="true" aria-labelledby="shelf-manager-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="shelf-manager-head">
          <div>
            <h3 id="shelf-manager-title">Manage nook</h3>
            <p>You can create up to five shelves.</p>
          </div>
          <button className="icon-btn shelf-manager-close" onClick={() => onClose()} title="Close" aria-label="Close nook manager">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {error && <p className="nook-manager-error" role="alert">{error}</p>}
        <div className="shelf-manager-list">
          {space.shelves.map((shelf) => (
            <div className="shelf-manager-row" key={shelf.uuid}>
              <label className="shelf-color-control" title="Shelf color">
                <input
                  className="shelf-color-input"
                  type="color"
                  value={shelf.color}
                  aria-label={`Color for ${shelf.name}`}
                  onChange={(e) => attempt(() => updateShelf(shelf.uuid, { color: e.target.value }))}
                />
              </label>
              <div className="shelf-name-block">
                <input
                  className="shelf-name-input"
                  value={shelf.name}
                  aria-label="Shelf name"
                  onChange={(e) => setSpace((current) => ({ ...current, shelves: current.shelves.map((item) => item.uuid === shelf.uuid ? { ...item, name: e.target.value } : item) }))}
                  onBlur={(e) => { if (e.target.value.trim()) attempt(() => updateShelf(shelf.uuid, { name: e.target.value.trim() })); }}
                />
                <span className="shelf-paper-count">{shelf.paper_count} {shelf.paper_count === 1 ? 'paper' : 'papers'} · {shelf.board_count || 0} {(shelf.board_count || 0) === 1 ? 'board' : 'boards'}</span>
              </div>
              <button
                className={`market-toggle shelf-visibility-toggle ${shelf.is_public ? 'on' : 'off'}`}
                role="switch"
                aria-checked={shelf.is_public}
                aria-label={`${shelf.name} is ${shelf.is_public ? 'public' : 'private'}`}
                onClick={() => attempt(() => updateShelf(shelf.uuid, { is_public: !shelf.is_public }))}
              >
                <span className="switch">
                  <span className="switch-knob" />
                  <span className="switch-text">{shelf.is_public ? 'Public' : 'Private'}</span>
                </span>
              </button>
              <label className="shelf-default">
                <input
                  type="radio"
                  name="default-shelf"
                  checked={shelf.is_default}
                  onChange={() => { if (!shelf.is_default) attempt(() => updateShelf(shelf.uuid, { is_default: true })); }}
                />
                <span>Default</span>
              </label>
              <button
                className="icon-btn shelf-delete-btn"
                title={`Delete ${shelf.name}`}
                aria-label={`Delete shelf ${shelf.name}`}
                onClick={async () => {
                  setError(null);
                  if (space.shelves.length === 1) {
                    setError('Keep at least one shelf.');
                    return;
                  }
                  const papers = shelf.paper_count === 1 ? '1 paper' : `${shelf.paper_count} papers`;
                  if (!(await confirmAction(`Delete ${shelf.name}? Its ${papers} will move to another shelf.`, { confirmLabel: 'Delete', destructive: true }))) return;
                  try {
                    await deleteShelf(shelf.uuid);
                    onChanged();
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
              </button>
            </div>
          ))}
        </div>
        {space.shelves.length < 5 && (
          <button className="link-btn shelf-add" onClick={() => {
            const colors = ['#b3923d', '#6b3f5e', '#35606b'];
            attempt(() => createShelf({ name: `Shelf ${space.shelves.length + 1}`, color: colors[(space.shelves.length - 2) % colors.length], is_public: false }));
          }}>Add another shelf</button>
        )}
        <section className="nook-manager-section" aria-labelledby="manage-tags-title">
          <div className="nook-manager-section-head">
            <div>
              <h4 id="manage-tags-title">Tags</h4>
              <p>Private labels you can add to any paper.</p>
            </div>
          </div>
          {space.tags.length > 0 && (
            <div className="manage-tag-list">
              {space.tags.map((tag) => (
                <div className="manage-tag-row" key={tag.uuid}>
                  <span className="tag-chip"><span aria-hidden="true">#</span> {tag.name}</span>
                  <button
                    className="icon-btn tag-delete-btn"
                    title={`Delete ${tag.name}`}
                    aria-label={`Delete tag ${tag.name}`}
                    onClick={async () => {
                      if (!(await confirmAction(`Delete #${tag.name} from every paper?`, { confirmLabel: 'Delete', destructive: true }))) return;
                      await deleteTag(tag.uuid);
                      onTagDeleted?.(tag.uuid);
                      onChanged();
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          <form className="manage-tag-add" onSubmit={async (event) => {
            event.preventDefault();
            if (!newTagName.trim()) return;
            await createTag(newTagName.trim());
            setNewTagName('');
            onChanged();
          }}>
            <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="New private tag" aria-label="New private tag" maxLength="60" />
            <button type="submit">Add tag</button>
          </form>
        </section>
      </div>
    </div>
  );
}
