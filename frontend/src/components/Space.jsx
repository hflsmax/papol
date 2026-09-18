import React, { useState, useEffect, useCallback } from 'react';
import { getUserSpace } from '../../../shared/api/people.js';
import PaperUpload from './PaperUpload';
import PaperList from './PaperList';
import Avatar from './Avatar';
import BackLink from '../../../shared/ui/BackLink.jsx';
import NookManager from './NookManager';
import BoardCreateForm from './BoardCreateForm';

export default function Space({ userUuid, currentUser, onSelectPaper, onSelectBoard, onBack, backHref, initialSection = null, onReportableError }) {
  const [space, setSpace] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);
  const [managingShelves, setManagingShelves] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [section, setSection] = useState(() => {
    if (initialSection) return initialSection;
    try { return sessionStorage.getItem(`papol_nook_section_${userUuid}`) || 'papers'; }
    catch { return 'papers'; }
  });

  const isOwn = currentUser != null && currentUser.uuid === userUuid;
  const selectSection = (next) => {
    setSection(next);
    try { sessionStorage.setItem(`papol_nook_section_${userUuid}`, next); }
    catch { /* session storage may be disabled */ }
  };

  useEffect(() => {
    const next = initialSection || (() => {
      try { return sessionStorage.getItem(`papol_nook_section_${userUuid}`); }
      catch { return null; }
    })() || 'papers';
    setSection(next);
    if (initialSection) {
      try { sessionStorage.setItem(`papol_nook_section_${userUuid}`, initialSection); }
      catch { /* session storage may be disabled */ }
    }
  }, [userUuid, initialSection]);

  const loadSpace = useCallback(() => {
    setError(null);
    getUserSpace(userUuid)
      .then(setSpace)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [userUuid]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setSpace(null);
    setError(null);
    getUserSpace(userUuid)
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
  }, [userUuid]);

  if (isLoading) return <div className="loading" role="status" aria-live="polite">Loading nook…</div>;
  if (error) return <div className="error" role="alert">{error}</div>;
  if (!space) return null;

  return (
    <div className={reviewingUpload ? 'space upload-review-mode' : 'space'}>
      {onBack && (
        <BackLink className="back-btn" href={backHref} onBack={onBack} />
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
                  onClick={() => setManagingShelves(true)}
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
            {/* Only present when the user chose to show it. */}
            {space.user.email && (
              <p className="space-email">
                <a href={`mailto:${space.user.email}`}>{space.user.email}</a>
              </p>
            )}
          </div>
          {isOwn && (
            <div className="space-header-actions">
              <button className="new-board-btn" type="button" onClick={() => setCreatingBoard(true)}>
                <span className="new-board-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>New board</span>
              </button>
              <PaperUpload
                onReportableError={onReportableError}
                compact
                onPaperCreated={(paper) => {
                  if (paper?.sha256 != null && onSelectPaper) onSelectPaper(paper.sha256);
                  else loadSpace();
                }}
                onReviewChange={setReviewingUpload}
              />
            </div>
          )}
        </div>
      </div>

      {isOwn && creatingBoard && (
        <BoardCreateForm
          className="nook-inline-board-create"
          shelves={space.shelves}
          onCreated={(board) => { setCreatingBoard(false); onSelectBoard(board.uuid); }}
          onCancel={() => setCreatingBoard(false)}
        />
      )}

      {isOwn && managingShelves && (
        <NookManager
          space={space}
          setSpace={setSpace}
          onChanged={loadSpace}
          onClose={() => setManagingShelves(false)}
          onTagDeleted={(tagUuid) => { if (selectedTag === tagUuid) setSelectedTag(null); }}
        />
      )}

      <PaperList
          papers={space.papers}
          boards={space.boards || []}
          isOwn={isOwn}
          tags={isOwn ? space.tags : []}
          shelves={space.shelves || []}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onSelectPaper={onSelectPaper}
          onSelectBoard={onSelectBoard}
          onChanged={loadSpace}
        />
    </div>
  );
}
