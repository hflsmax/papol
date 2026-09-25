import React, { useState } from 'react';
import { createTag } from '../../../shared/api/papers.js';

// The private-tag picker of an upload: the chosen tags as chips, a field
// that filters the user's tags as it is typed in, and a way to create
// the tag typed when there is none by that name. Used by the one-paper
// review and by a folder's.
export default function TagPicker({ id, available, onAvailableChange, selected, onSelectedChange, onError }) {
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedUuids = new Set(selected.map((tag) => tag.uuid));
  const query = draft.trim().toLowerCase();
  const suggestions = available.filter(
    (tag) => !selectedUuids.has(tag.uuid) && (!query || tag.name.toLowerCase().includes(query))
  );
  const exactTagExists = available.some((tag) => tag.name.toLowerCase() === query);
  const selectTag = (tag) => {
    onSelectedChange(selected.some((item) => item.uuid === tag.uuid) ? selected : [...selected, tag]);
    onAvailableChange(available.some((item) => item.uuid === tag.uuid) ? available : [...available, tag]);
    setDraft('');
    setMenuOpen(false);
  };

  return (
    <div className="tag-editor-card upload-tag-editor">
      <div className="tag-picker">
        <div className="tag-editor">
          {selected.map((tag) => (
            <button type="button" className="tag-chip selected" key={tag.uuid} onClick={() => onSelectedChange(selected.filter((item) => item.uuid !== tag.uuid))}>
              {tag.name} ×
            </button>
          ))}
          <input
            id={id}
            className="tag-input"
            value={draft}
            placeholder="Add a private tag…"
            onFocus={() => setMenuOpen(true)}
            onBlur={() => setMenuOpen(false)}
            onChange={(e) => { setDraft(e.target.value); setMenuOpen(true); }}
          />
        </div>
        {menuOpen && (
          <div className="tag-dropdown">
            {suggestions.length > 0 && <div className="tag-dropdown-label">Your tags</div>}
            {suggestions.map((tag) => (
              <button type="button" key={tag.uuid} onMouseDown={(e) => e.preventDefault()} onClick={() => selectTag(tag)}>
                <span className="tag-option-mark">#</span><span>{tag.name}</span><span className="tag-option-hint">Add</span>
              </button>
            ))}
            {query && !exactTagExists && (
              <button type="button" className="tag-create-option" onMouseDown={(e) => e.preventDefault()} onClick={async () => {
                try { selectTag(await createTag(draft.trim())); } catch (err) { onError(err); }
              }}>
                <span className="tag-create-mark">+</span><span>Create <strong>{draft.trim()}</strong></span>
              </button>
            )}
            {!query && suggestions.length === 0 && <span className="tag-empty">All of your tags are selected.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
