import React, { useState, useEffect, useCallback } from 'react';
import { getUserSpace } from '../../../shared/api/people.js';
import PaperUpload from './PaperUpload';
import PaperList from './PaperList';
import Avatar from './Avatar';
import BackLink from '../../../shared/ui/BackLink.jsx';
import NookManager from './NookManager';
import BoardCreateForm from './BoardCreateForm';

const sectionKey = (userUuid) => `papol_nook_section_${userUuid}`;
const storedSection = (userUuid) => {
  try { return sessionStorage.getItem(sectionKey(userUuid)) || 'papers'; }
  catch { return 'papers'; }
};

export default function Space({ userUuid, currentUser, onSelectPaper, onSelectBoard, onBack, backHref, initialSection = null }) {
  const [space, setSpace] = useState(null);
  const [error, setError] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);
  const [managingShelves, setManagingShelves] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [section, setSection] = useState(() => initialSection || storedSection(userUuid));

  const isOwn = currentUser != null && currentUser.uuid === userUuid;
  const selectSection = (next) => {
    setSection(next);
    try { sessionStorage.setItem(sectionKey(userUuid), next); }
    catch { /* session storage may be disabled */ }
  };

  useEffect(() => {
    if (initialSection) selectSection(initialSection);
    else setSection(storedSection(userUuid));
  }, [userUuid, initialSection]);

  const loadSpace = useCallback(() => {
    let active = true;
    setError(null);
    getUserSpace(userUuid)
      .then((data) => { if (active) setSpace(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [userUuid]);

  useEffect(() => {
    setSpace(null);
    return loadSpace();
  }, [loadSpace]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!space) return <div className="loading" role="status" aria-live="polite">Loading nook…</div>;

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
          boards={space.boards}
          isOwn={isOwn}
          tags={isOwn ? space.tags : []}
          shelves={space.shelves}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onSelectPaper={onSelectPaper}
          onSelectBoard={onSelectBoard}
          onChanged={loadSpace}
        />
    </div>
  );
}
