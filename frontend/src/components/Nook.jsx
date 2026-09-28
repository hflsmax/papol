import React, { useState, useEffect, useCallback } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { getNook } from '../../../shared/api/people.js';
import PaperUpload from './PaperUpload';
import FolderImport from './FolderImport';
import PaperList from './PaperList';
import Avatar from './Avatar';
import BackLink from '../../../shared/ui/BackLink.jsx';
import NookManager from './NookManager';
import BoardCreateForm from './BoardCreateForm';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';

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
  // A folder, or several PDFs, being brought in (FolderImport) in place
  // of the upload box: `{}` when only opened, else what was handed over.
  const [folderRequest, setFolderRequest] = useState(null);
  const [managingShelves, setManagingShelves] = useState(false);
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [section, setSection] = useState(() => initialSection || storedSection(userUuid));
  const [shelf, setShelf] = useState(null);

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
  if (!nook) return <div className="loading"><Working label="Loading nook…" /></div>;

  // Bringing papers in: the drop box, or a folder being brought in.
  const adding = folderRequest ? (
      <FolderImport
        currentUser={nook.user}
        incomingFolder={folderRequest.uuid ? folderRequest : null}
        onReportableError={onReportableError}
        onAdded={loadNook}
        onClose={() => { setFolderRequest(null); setReviewingUpload(false); loadNook(); }}
      />
    ) : (
      <PaperUpload
        onReportableError={onReportableError}
        compact
        onAddFolder={(incoming) => {
          setFolderRequest(incoming ? { uuid: globalThis.crypto.randomUUID(), ...incoming } : {});
          setReviewingUpload(true);
        }}
        onPaperCreated={(paper) => {
          if (paper?.sha256 != null && onSelectPaper) onSelectPaper(paper.sha256);
          else loadNook();
        }}
        onReviewChange={setReviewingUpload}
      />
  );

  const projectCards = nook.projects?.length > 0 && (
    // A member's own projects are where their shared work goes on:
    // each a card of its own, with what is new in it.
    <section className="nook-desk-projects" aria-label="My projects">
      <h3 className="nook-desk-projects-title">Projects</h3>
      <ul className="nook-desk-projects-grid">
        {nook.projects.map((project) => {
          const others = (project.members ?? []).filter((m) => m.user.uuid !== nook.user.uuid);
          return (
            <li key={project.uuid}>
              <a className={project.new_count > 0 ? 'nook-project-card has-new' : 'nook-project-card'} href={appPath(`/project/${project.uuid}`)}>
                <span className="nook-project-card-name">{project.name}</span>
                <span className="nook-project-card-foot">
                  <span className="nook-projects-faces">
                    {others.slice(0, 4).map((m) => (
                      <Avatar key={m.user.uuid} user={m.user} className="nook-projects-avatar" />
                    ))}
                    {others.length > 4 && <span className="nook-projects-more">+{others.length - 4}</span>}
                    {others.length === 0 && <span className="nook-projects-more">Just you</span>}
                  </span>
                  {project.new_count > 0 && <span className="nook-project-card-new">{project.new_count} new</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );

  // A member's own nook on the web: what they work in, not who they are.
  // Their projects lead; their papers take the width, with their boards and
  // shelves beside them. The shelf chosen there narrows the papers.
  if (isOwn && !DESKTOP) {
    const chosen = nook.shelves.find((s) => s.uuid === shelf);
    return (
      <div className={reviewingUpload ? 'nook is-home upload-review-mode' : 'nook is-home'}>
        {projectCards}
        <div className="nook-home">
          <section className="nook-home-papers" aria-labelledby="nook-papers-title">
            <div className="nook-home-head">
              <h3 id="nook-papers-title">
                {chosen ? chosen.name : 'Papers'}
                <span className="nook-home-count">{chosen ? chosen.paper_count : nook.papers.length}</span>
              </h3>
              {adding}
            </div>
            <PaperList
              papers={nook.papers}
              isOwn
              tags={nook.tags}
              shelves={nook.shelves}
              shelf={shelf}
              onSelectShelf={setShelf}
              shelfCase={false}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              onSelectPaper={onSelectPaper}
              onChanged={loadNook}
            />
          </section>
          <aside className="nook-home-side">
            <section className="nook-home-boards" aria-labelledby="nook-boards-title">
              <div className="nook-home-head">
                <h3 id="nook-boards-title">Boards</h3>
                {!creatingBoard && (
                  <button type="button" className="nook-home-add" onClick={() => setCreatingBoard(true)}>New board</button>
                )}
              </div>
              {creatingBoard && (
                <BoardCreateForm
                  className="nook-inline-board-create"
                  shelves={nook.shelves}
                  onCreated={(board) => { setCreatingBoard(false); onSelectBoard(board.uuid); }}
                  onCancel={() => setCreatingBoard(false)}
                />
              )}
              {nook.boards.length > 0 && (
                <ul className="nook-home-list">
                  {nook.boards.map((board) => (
                    <li key={board.uuid}>
                      <a
                        className="nook-home-board"
                        href={appPath(`/board/${board.uuid}`)}
                        onClick={(event) => { event.preventDefault(); onSelectBoard(board.uuid); }}
                      >
                        <span className="nook-home-dot" style={{ background: nook.shelves.find((s) => s.uuid === board.shelf_uuid)?.color }} aria-hidden="true" />
                        <span className="nook-home-name">{board.name}</span>
                        <span className="nook-home-count">{board.item_count}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="nook-home-shelves" aria-labelledby="nook-shelves-title">
              <div className="nook-home-head">
                <h3 id="nook-shelves-title">Shelves</h3>
                <button
                  type="button"
                  className="manage-nook-gear"
                  onClick={() => setManagingShelves(true)}
                  title="Manage shelves and tags"
                  aria-label="Manage shelves and tags"
                >
                  <span className="gear-symbol" aria-hidden="true">⚙</span>
                </button>
              </div>
              <ul className="nook-home-list">
                {nook.shelves.map((s) => (
                  <li key={s.uuid}>
                    <button
                      type="button"
                      className={shelf === s.uuid ? 'nook-home-shelf is-on' : 'nook-home-shelf'}
                      aria-pressed={shelf === s.uuid}
                      onClick={() => setShelf(shelf === s.uuid ? null : s.uuid)}
                    >
                      <span className="nook-home-dot" style={{ background: s.color }} aria-hidden="true" />
                      <span className="nook-home-name">{s.name}</span>
                      {!s.is_public && (
                        <svg className="nook-home-lock" viewBox="0 0 16 16" aria-label="Private">
                          <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                          <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />
                        </svg>
                      )}
                      <span className="nook-home-count">{s.paper_count + (s.board_count || 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
        {managingShelves && (
          <NookManager
            nook={nook}
            setNook={setNook}
            onChanged={loadNook}
            onClose={() => setManagingShelves(false)}
            onTagDeleted={(tagUuid) => { if (selectedTag === tagUuid) setSelectedTag(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={reviewingUpload ? 'nook upload-review-mode' : 'nook'}>
      {onBack && (
        <BackLink className="back-button" href={backHref} onBack={onBack} />
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
              <button className="new-board-button" type="button" onClick={() => setCreatingBoard(true)}>
                <span className="new-board-mark" aria-hidden="true"><i /><i /><i /><i /></span>
                <span>New board</span>
              </button>
              {adding}
            </div>
          )}
        </div>
        {isOwn && projectCards}
        {!isOwn && nook.projects?.length > 0 && (
          <nav className="nook-projects" aria-label="Projects">
            <span className="kicker nook-projects-label">Projects</span>
            <ul className="nook-projects-list">
              {nook.projects.map((project) => {
                const others = (project.members ?? []).filter((m) => m.user.uuid !== nook.user.uuid);
                return (
                  <li key={project.uuid}>
                    <a className="nook-projects-chip" href={appPath(`/project/${project.uuid}`)}>
                      <span className="nook-projects-name">{project.name}</span>
                      {others.length > 0 && (
                        <span className="nook-projects-faces" aria-label={`with ${others.length} more`}>
                          {others.slice(0, 3).map((m) => (
                            <Avatar key={m.user.uuid} user={m.user} className="nook-projects-avatar" />
                          ))}
                          {others.length > 3 && <span className="nook-projects-more">+{others.length - 3}</span>}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
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
