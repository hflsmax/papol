import React, { useState, useEffect, useCallback } from 'react';
import { getUserSpace, createShelf, updateShelf, deleteShelf, createTag, deleteTag } from '../api';
import PaperUpload from './PaperUpload';
import PaperList from './PaperList';
import Avatar from './Avatar';
import BoardsSection from './BoardsSection';
import ExperimentalBadge from './ExperimentalBadge';

export default function Space({ userId, currentUser, onSelectPaper, onSelectBoard, onBack, initialSection = null }) {
  const [space, setSpace] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);
  const [managingShelves, setManagingShelves] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [nookManagerError, setNookManagerError] = useState(null);
  const [section, setSection] = useState(() => {
    if (initialSection) return initialSection;
    try { return sessionStorage.getItem(`papol_nook_section_${userId}`) || 'papers'; }
    catch { return 'papers'; }
  });

  const isOwn = currentUser != null && currentUser.id === userId;
  const selectSection = (next) => {
    setSection(next);
    try { sessionStorage.setItem(`papol_nook_section_${userId}`, next); }
    catch { /* session storage may be disabled */ }
  };

  useEffect(() => {
    const next = initialSection || (() => {
      try { return sessionStorage.getItem(`papol_nook_section_${userId}`); }
      catch { return null; }
    })() || 'papers';
    setSection(next);
    if (initialSection) {
      try { sessionStorage.setItem(`papol_nook_section_${userId}`, initialSection); }
      catch { /* session storage may be disabled */ }
    }
  }, [userId, initialSection]);

  const loadSpace = useCallback(() => {
    setError(null);
    getUserSpace(userId)
      .then(setSpace)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [userId]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setSpace(null);
    setError(null);
    getUserSpace(userId)
      .then((data) => {
        if (active) setSpace(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!managingShelves) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setManagingShelves(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [managingShelves]);

  if (isLoading) return <div className="loading">Loading nook…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!space) return null;

  return (
    <div className={reviewingUpload ? 'space upload-review-mode' : 'space'}>
      {onBack && (
        <button className="back-btn" onClick={onBack}>
          &larr; Back
        </button>
      )}
      <div className="space-header">
        <div className="space-header-row">
          <Avatar user={space.user} className="space-avatar" />
          <div className="space-profile-copy">
            {isOwn ? (
              <h2 className="nook-title-row">
                <span>My nook</span>
                <button
                  className="manage-nook-gear"
                  onClick={() => { setNookManagerError(null); setManagingShelves(true); }}
                  title="Manage nook"
                  aria-label="Manage nook"
                >
                  <span className="gear-symbol" aria-hidden="true">⚙</span>
                </button>
              </h2>
            ) : (
              <h2>{space.user.display_name}'s nook</h2>
            )}
            {space.user.affiliation && (
              <p className="space-subtitle">{space.user.affiliation}</p>
            )}
            {/* Only present when the reader chose to show it. */}
            {space.user.email && (
              <p className="space-email">
                <a href={`mailto:${space.user.email}`}>{space.user.email}</a>
              </p>
            )}
          </div>
          {isOwn && (
            <div className="space-header-actions">
              <PaperUpload
                compact
                onPaperCreated={loadSpace}
                onReviewChange={setReviewingUpload}
              />
            </div>
          )}
        </div>
      </div>

      {isOwn && managingShelves && (
        <div className="modal-overlay shelf-manager-overlay" onMouseDown={() => setManagingShelves(false)}>
          <div className="modal-box shelf-manager" role="dialog" aria-modal="true" aria-labelledby="shelf-manager-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="shelf-manager-head">
              <div>
                <h3 id="shelf-manager-title">Manage nook</h3>
                <p>You can create up to five shelves.</p>
              </div>
              <button className="icon-btn shelf-manager-close" onClick={() => setManagingShelves(false)} title="Close" aria-label="Close nook manager">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {nookManagerError && <p className="nook-manager-error" role="alert">{nookManagerError}</p>}
            <div className="shelf-manager-list">
              {space.shelves.map((shelf) => (
                <div className="shelf-manager-row" key={shelf.id}>
                  <label className="shelf-color-control" title="Shelf color">
                    <input
                      className="shelf-color-input"
                      type="color"
                      value={shelf.color}
                      aria-label={`Color for ${shelf.name}`}
                      onChange={async (e) => { await updateShelf(shelf.id, { color: e.target.value }); loadSpace(); }}
                    />
                  </label>
                  <div className="shelf-name-block">
                    <input
                      className="shelf-name-input"
                      value={shelf.name}
                      aria-label="Shelf name"
                      onChange={(e) => setSpace((current) => ({ ...current, shelves: current.shelves.map((item) => item.id === shelf.id ? { ...item, name: e.target.value } : item) }))}
                      onBlur={async (e) => { if (e.target.value.trim()) { await updateShelf(shelf.id, { name: e.target.value.trim() }); loadSpace(); } }}
                    />
                    <span className="shelf-paper-count">{shelf.paper_count} {shelf.paper_count === 1 ? 'paper' : 'papers'}</span>
                  </div>
                  <button
                    className={`market-toggle shelf-visibility-toggle ${shelf.is_public ? 'on' : 'off'}`}
                    role="switch"
                    aria-checked={shelf.is_public}
                    aria-label={`${shelf.name} is ${shelf.is_public ? 'public' : 'private'}`}
                    onClick={async () => { await updateShelf(shelf.id, { is_public: !shelf.is_public }); loadSpace(); }}
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
                      onChange={async () => { if (!shelf.is_default) { await updateShelf(shelf.id, { is_default: true }); loadSpace(); } }}
                    />
                    <span>Default</span>
                  </label>
                  <button
                    className="icon-btn shelf-delete-btn"
                    title={`Delete ${shelf.name}`}
                    aria-label={`Delete shelf ${shelf.name}`}
                    onClick={async () => {
                      setNookManagerError(null);
                      if (space.shelves.length === 1) {
                        setNookManagerError('A nook must have at least one shelf.');
                        return;
                      }
                      const papers = shelf.paper_count === 1 ? '1 paper' : `${shelf.paper_count} papers`;
                      if (!window.confirm(`Delete ${shelf.name}? Its ${papers} will move to another shelf.`)) return;
                      try {
                        await deleteShelf(shelf.id);
                        loadSpace();
                      } catch (err) {
                        setNookManagerError(err.message);
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
                  </button>
                </div>
              ))}
            </div>
            {space.shelves.length < 5 && (
              <button className="link-btn shelf-add" onClick={async () => {
                const colors = ['#b3923d', '#6b3f5e', '#35606b'];
                await createShelf({ name: `Shelf ${space.shelves.length + 1}`, color: colors[(space.shelves.length - 2) % colors.length], is_public: false });
                loadSpace();
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
                    <div className="manage-tag-row" key={tag.id}>
                      <span className="tag-chip"><span aria-hidden="true">#</span> {tag.name}</span>
                      <button
                        className="icon-btn tag-delete-btn"
                        title={`Delete ${tag.name}`}
                        aria-label={`Delete tag ${tag.name}`}
                        onClick={async () => {
                          if (!window.confirm(`Delete #${tag.name} from every paper?`)) return;
                          await deleteTag(tag.id);
                          if (selectedTag === tag.id) setSelectedTag(null);
                          loadSpace();
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
                loadSpace();
              }}>
                <input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="New private tag" aria-label="New private tag" maxLength="60" />
                <button type="submit">Add tag</button>
              </form>
            </section>
          </div>
        </div>
      )}

      {isOwn && (
        <div className="nook-tabs" role="tablist" aria-label="Nook sections">
          <button className={section === 'papers' ? 'active' : ''} role="tab" aria-selected={section === 'papers'} onClick={() => selectSection('papers')}>Papers</button>
          <button className={section === 'boards' ? 'active' : ''} role="tab" aria-selected={section === 'boards'} onClick={() => selectSection('boards')}>Boards <ExperimentalBadge compact /></button>
        </div>
      )}
      {section === 'papers' || !isOwn ? (
        <PaperList
          papers={space.papers}
          isOwn={isOwn}
          tags={isOwn ? space.tags : []}
          shelves={space.shelves || []}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onSelectPaper={onSelectPaper}
          onChanged={loadSpace}
        />
      ) : (
        <BoardsSection onSelectBoard={onSelectBoard} />
      )}
    </div>
  );
}
