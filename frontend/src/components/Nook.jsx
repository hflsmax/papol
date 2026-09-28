import React, { useState, useEffect, useCallback } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { getNook } from '../../../shared/api/people.js';
import PaperUpload from './PaperUpload';
import FolderImport from './FolderImport';
import PaperList from './PaperList';
import Avatar from './Avatar';
import BackLink from '../../../shared/ui/BackLink.jsx';
import NookManager from './NookManager';
import NookDesk, { rememberNookShape } from './NookDesk';
import BoardCreateForm from './BoardCreateForm';
import { appPath } from '../base';
import { DESKTOP } from '../../../shared/desktopShell';
import { paperName } from '../../../shared/paperName.js';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import { formatAuthors, newestFirst } from '../paperFormat';

const sectionKey = (userUuid) => `papol_nook_section_${userUuid}`;
const storedSection = (userUuid) => {
  try { return sessionStorage.getItem(sectionKey(userUuid)) || 'papers'; }
  catch { return 'papers'; }
};

// The nooks seen so far in this tab, so coming back to one shows it at once
// while it is fetched again.
const seen = new Map();

export default function Nook({ userUuid, currentUser, onSelectPaper, onSelectBoard, onBack, backHref, initialSection = null, onReportableError, board = null, shelf = null, project = null, renderProject, paper = null, renderPaper, onOpenCanvas }) {
  const [nook, setNook] = useState(() => seen.get(userUuid) ?? null);
  const [error, setError] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);
  const [reviewingUpload, setReviewingUpload] = useState(false);
  // A folder, or several PDFs, being brought in (FolderImport) in place
  // of the upload box: `{}` when only opened, else what was handed over.
  const [folderRequest, setFolderRequest] = useState(null);
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
    setNook(seen.get(userUuid) ?? null);
    return loadNook();
  }, [loadNook]);

  useEffect(() => {
    if (nook?.user?.uuid !== userUuid) return;
    seen.set(userUuid, nook);
    if (isOwn && !DESKTOP) rememberNookShape(nook);
  }, [nook, userUuid, isOwn]);

  if (error) return <div className="error" role="alert">{error}</div>;
  const ownDesk = isOwn && !DESKTOP;
  if (!nook && ownDesk) {
    // The desk's frame while its papers come; a place already asked for
    // (a project, a paper, a board) opens in it straight away.
    return (
      <div className="nook is-desk">
        <NookDesk
          adding={<PaperUpload onReportableError={onReportableError} trigger onPaperCreated={(paper) => { if (paper?.sha256 != null && onSelectPaper) onSelectPaper(paper.sha256); }} />}
          onSelectBoard={onSelectBoard}
          board={board}
          shelf={shelf}
          project={project}
          renderProject={renderProject}
          paper={paper}
          renderPaper={renderPaper}
          onOpenCanvas={onOpenCanvas}
          onChanged={loadNook}
        />
      </div>
    );
  }
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
  if (ownDesk) {
    const addingOnDesk = folderRequest ? adding : React.cloneElement(adding, { trigger: true, compact: false });
    return (
      <div className={reviewingUpload ? 'nook is-desk upload-review-mode' : 'nook is-desk'}>
        <NookDesk
          nook={nook}
          adding={addingOnDesk}
          reviewing={reviewingUpload}
          onSelectBoard={onSelectBoard}
          board={board}
          shelf={shelf}
          project={project}
          renderProject={renderProject}
          paper={paper}
          renderPaper={renderPaper}
          onOpenCanvas={onOpenCanvas}
          onChanged={loadNook}
          onManage={() => setManagingShelves(true)}
        />
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

  // Someone else's nook on the web: who they are, then a plain list of
  // what they keep, newest first, each with their thought on it.
  if (!isOwn && !DESKTOP) {
    const owner = nook.user;
    return (
      <div className="nook their-nook">
        <header className="their-head">
          <Avatar user={owner} className="their-face" />
          <div>
            <h1 className="their-name">{owner.display_name}</h1>
            {owner.affiliation && <p className="their-line">{owner.affiliation}</p>}
            {/* Only there when they chose to show it. */}
            {owner.email && <p className="their-line"><a href={`mailto:${owner.email}`}>{owner.email}</a></p>}
          </div>
        </header>
        {nook.papers.length > 0 && (
          <ul className="their-list" aria-label="Papers">
            {[...nook.papers].sort(newestFirst).map((paper) => (
              <li key={paper.sha256}>
                <a className="their-title" href={appPath(`/paper/${paperName(paper.sha256)}`)}><PaperTitle title={paper.title} /></a>
                <span className="their-meta">
                  {[formatAuthors(paper.authors), paper.year].filter(Boolean).join(' · ')}
                  {paper.journal && <> · <i>{paper.journal}</i></>}
                </span>
                {paper.thought && <span className="their-thought">“{paper.thought}”</span>}
              </li>
            ))}
          </ul>
        )}
        {nook.boards.length > 0 && (
          <ul className="their-list their-boards" aria-label="Boards">
            {nook.boards.map((board) => (
              <li key={board.uuid}>
                <a
                  className="their-title"
                  href={appPath(`/boards/${board.uuid}`)}
                  onClick={(e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); onSelectBoard(board.uuid); } }}
                >{board.name}</a>
                <span className="their-meta">Board · {board.item_count}</span>
              </li>
            ))}
          </ul>
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
