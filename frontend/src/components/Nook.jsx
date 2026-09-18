import React, { useState, useEffect, useCallback } from 'react';
import { getNook } from '../../../shared/api/people.js';
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

export default function Nook({ userUuid, currentUser, onSelectPaper, onSelectBoard, onBack, backHref, initialSection = null, onReportableError }) {
  const [nook, setNook] = useState(null);
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

  const loadNook = useCallback(() => {
    let active = true;
    setError(null);
    getNook(userUuid)
      .then((data) => { if (active) setNook(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [userUuid]);

  useEffect(() => {
    setNook(null);
    return loadNook();
  }, [loadNook]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!nook) return <div className="loading" role="status" aria-live="polite">Loading nook…</div>;

  return (
    <div className={reviewingUpload ? 'nook upload-review-mode' : 'nook'}>
      {onBack && (
        <BackLink className="back-btn" href={backHref} onBack={onBack} />
      )}
      <div className="nook-header">
        <div className="nook-header-row">
          <Avatar user={nook.user} className="nook-avatar" />
          <div className="nook-profile-copy">
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
              <h2>{nook.user.display_name}'s nook</h2>
            )}
            {nook.user.affiliation && (
              <p className="nook-subtitle">{nook.user.affiliation}</p>
            )}
            {/* Only present when the user chose to show it. */}
            {nook.user.email && (
              <p className="nook-email">
                <a href={`mailto:${nook.user.email}`}>{nook.user.email}</a>
              </p>
            )}
          </div>
          {isOwn && (
            <div className="nook-header-actions">
              <button className="new-board-btn" type="button" onClick={() => setCreatingBoard(true)}>
                <span className="new-board-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>New board</span>
              </button>
              <PaperUpload
                onReportableError={onReportableError}
                compact
                onPaperCreated={(paper) => {
                  if (paper?.sha256 != null && onSelectPaper) onSelectPaper(paper.sha256);
                  else loadNook();
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
          shelves={nook.shelves}
          onCreated={(board) => { setCreatingBoard(false); onSelectBoard(board.uuid); }}
          onCancel={() => setCreatingBoard(false)}
        />
      )}

      {isOwn && managingShelves && (
        <NookManager
          nook={nook}
          setNook={setNook}
          onChanged={loadNook}
          onClose={() => setManagingShelves(false)}
          onTagDeleted={(tagUuid) => { if (selectedTag === tagUuid) setSelectedTag(null); }}
        />
      )}

      <PaperList
          papers={nook.papers}
          boards={nook.boards}
          isOwn={isOwn}
          tags={isOwn ? nook.tags : []}
          shelves={nook.shelves}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onSelectPaper={onSelectPaper}
          onSelectBoard={onSelectBoard}
          onChanged={loadNook}
        />
    </div>
  );
}
