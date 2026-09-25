import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { deleteBoard, updateBoard } from '../../../shared/api/boards.js';
import { getNook } from '../../../shared/api/people.js';
import { paperName } from '../../../shared/paperName.js';
import { deletePaper, listPapers, paperHref, updatePaper } from '../../../shared/api/papers.js';
import { appPath } from '../base';
import {
  PAPER_DRAG_TYPE, matchesSearch, paperCreatedNavigation, papersInListing,
  rememberListing, shelfOf, listingPath, tagOf,
} from '../desktopListings';
import { formatAuthors } from '../paperFormat';
import PaperJacket from './PaperJacket';
import BoardJacket from './BoardJacket';
import ErrorBoundary from '../../../shared/ui/ErrorBoundary.jsx';
import PaperUpload from './PaperUpload';
import FolderImport from './FolderImport';
import BoardCreateForm from './BoardCreateForm';
import StatePill from './StatePill';
import Glyph from './DesktopGlyph';
import { confirmAction } from '../../../shared/confirmAction';
import { contextMenuHandler } from '../../../shared/contextMenu';
import { openDesktopDocumentWindow } from '../../../shared/desktopShell';
import {
  dismissPdfViewerPrompt, makePdfViewerDefault, nativeSyncInProgress, pdfViewerStatus, subscribeNativeData,
} from '../../../shared/nativeData.js';

// Asked on every launch while another app is the PDF viewer. The viewer asks
// the same question over an opened file; answering in either place quiets
// both until the app is relaunched.
function DefaultViewerPrompt() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    pdfViewerStatus()
      .then((status) => {
        if (active) setVisible(status.supported && !status.is_default && !status.prompt_dismissed);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  if (!visible) return null;
  const dismiss = () => {
    dismissPdfViewerPrompt().catch(() => {});
    setVisible(false);
  };
  const makeDefault = async () => {
    try {
      await makePdfViewerDefault();
      dismiss();
    } catch (failure) {
      setError(String(failure?.message ?? failure));
    }
  };

  return (
    <div className="notice-banner pdf-viewer-prompt" role="status">
      <span>{error || 'Use Papol as your default PDF viewer?'}</span>
      <span className="notice-banner-actions">
        <button type="button" className="notice-banner-button" onClick={makeDefault}>Use Papol</button>
        <button type="button" className="notice-banner-link" onClick={dismiss}>Not now</button>
      </span>
    </div>
  );
}

// Papol macOS's three-pane browser (DESIGN.md, "Desktop shell"): the
// sidebar picks a source, the list pane shows what is in it, and the chosen
// paper opens beside the list instead of replacing it. What a source means
// and lists is decided in desktopListings.js.

// The user's nook, kept loaded for the sidebar and the list. Reloaded on
// every navigation and whenever the window comes back to the front, since
// the paper pane edits it underneath.
export function useNook(userUuid, refreshKey) {
  const [nook, setNook] = useState(null);
  const [nativeSyncing, setNativeSyncing] = useState(nativeSyncInProgress);
  const currentUserUuid = useRef(userUuid);
  currentUserUuid.current = userUuid;

  const reload = useCallback(() => {
    if (!userUuid) return;
    getNook(userUuid)
      .then((data) => { if (currentUserUuid.current === userUuid) setNook(data); })
      .catch(() => {});
  }, [userUuid]);

  useEffect(() => {
    setNook(null);
    setNativeSyncing(nativeSyncInProgress());
  }, [userUuid]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  useEffect(() => {
    const refresh = () => {
      setNativeSyncing(nativeSyncInProgress());
      reload();
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('papol-offline-status', refresh);
    const unsubscribeNative = subscribeNativeData((status) => {
      if (typeof status?.syncing === 'boolean') setNativeSyncing(status.syncing);
      reload();
    });
    return () => {
      unsubscribeNative();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('papol-offline-status', refresh);
    };
  }, [reload]);

  return {
    nook, setNook, reload,
    syncing: Boolean(userUuid) && nativeSyncing,
  };
}

export function DesktopBrowser({
  listing, route, currentUser, nookState, onNavigate, onOpenBoard, onSyncRefresh,
  incomingPaperFile, onIncomingPaperFileHandled, onReportableError,
  incomingPaperFolder = null, onIncomingPaperFolderHandled = () => {},
}) {
  const { nook, setNook, reload, syncing } = nookState;
  const [library, setLibrary] = useState(null);
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(null); // null | 'paper' | 'folder' | 'board'
  // What the paper composer's upload box handed to the folder's: a folder
  // or several PDFs dropped or chosen there.
  const [folderRequest, setFolderRequest] = useState(null);
  const [draggingSha256, setDraggingSha256] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [selectedBoardUuid, setSelectedBoardUuid] = useState(null);
  const listRef = useRef(null);
  const paperSha256 = route.page === 'paper' ? route.uuid : null;
  const selectedKey = listing === 'boards' ? selectedBoardUuid : paperSha256;
  const isSelected = (paper) => paperSha256 != null && paper.sha256 === paperSha256;

  useEffect(() => {
    if (route.page !== 'paper') rememberListing(listing);
  }, [route.page, listing]);

  useEffect(() => {
    setSearch('');
    if (listing !== 'boards') setSelectedBoardUuid(null);
  }, [listing]);
  useEffect(() => { setComposer(null); }, [paperSha256, listing]);
  useEffect(() => {
    if (incomingPaperFile) setComposer('paper');
  }, [incomingPaperFile]);
  useEffect(() => {
    if (incomingPaperFolder) setComposer('folder');
  }, [incomingPaperFolder]);

  const openUser = (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820');

  useEffect(() => {
    if (listing !== 'library') return undefined;
    let active = true;
    listPapers()
      .then((papers) => { if (active) setLibrary(papers); })
      .catch(() => { if (active) setLibrary([]); });
    return () => { active = false; };
  }, [listing, route, onSyncRefresh]);

  // Keep the selection in view, and keep keyboard focus on it while the
  // user is moving through the list with the arrow keys.
  useEffect(() => {
    const row = listRef.current?.querySelector('.desktop-row.selected');
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (listRef.current.contains(document.activeElement)) row.focus({ preventScroll: true });
  }, [selectedKey]);

  const shelves = nook?.shelves ?? [];
  const shelf = shelfOf(listing, nook);
  const tag = tagOf(listing, nook);
  const boardsView = listing === 'boards';
  const libraryView = listing === 'library';
  const loading = libraryView ? library == null : nook == null;

  const shownPapers = papersInListing(listing, { nook, library })
    .filter((paper) => matchesSearch(search, [paper.title, paper.authors, paper.journal]));
  const shownBoards = boardsView
    ? (nook?.boards ?? [])
      .filter((board) => matchesSearch(search, [board.name, board.description]))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    : [];
  const selectedBoard = boardsView
    ? (nook?.boards ?? []).find((board) => board.uuid === selectedBoardUuid) || null
    : null;

  useEffect(() => {
    if (selectedBoardUuid && nook && !selectedBoard) setSelectedBoardUuid(null);
  }, [nook, selectedBoard, selectedBoardUuid]);

  const title = libraryView ? 'Library' : boardsView ? 'Boards' : shelf ? shelf.name : tag ? `#${tag.name}` : 'All papers';
  const total = boardsView ? shownBoards.length : shownPapers.length;
  const noun = boardsView ? (total === 1 ? 'board' : 'boards') : (total === 1 ? 'paper' : 'papers');
  // The list below shows the wait itself; the subtitle only counts.
  const subtitle = loading ? '' : [
    `${total} ${noun}`,
    syncing ? 'Syncing…' : null,
    shelf ? (shelf.is_public ? 'Public' : 'Private') : null,
  ].filter(Boolean).join(' · ');

  const canCompose = Boolean(nook) && !libraryView;
  const listingHome = () => onNavigate(listingPath(listing));
  const movePaper = async (paper, shelfUuid) => {
    setActionError(null);
    try {
      await updatePaper(paper.sha256, { shelf_uuid: shelfUuid });
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const moveBoard = async (board, shelfUuid) => {
    setActionError(null);
    try {
      await updateBoard(board.uuid, { shelf_uuid: shelfUuid });
      reload();
      return true;
    } catch (error) {
      setActionError(error.message);
      return false;
    }
  };
  const removePaper = async (paper) => {
    if (!(await confirmAction('Remove this paper from your nook? Your ratings and notes will be deleted. This cannot be undone.', { confirmLabel: 'Remove', destructive: true }))) return;
    setActionError(null);
    try {
      await deletePaper(paper.sha256);
      if (isSelected(paper)) listingHome();
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const removeBoard = async (board) => {
    if (!(await confirmAction(`Delete “${board.name}”? This cannot be undone.`, { confirmLabel: 'Delete board', destructive: true }))) return;
    setActionError(null);
    try {
      await deleteBoard(board.uuid);
      if (selectedBoardUuid === board.uuid) setSelectedBoardUuid(null);
      reload();
    } catch (error) { setActionError(error.message); }
  };

  const moveSelection = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const entries = boardsView ? shownBoards : shownPapers;
    if (event.target.closest?.('input, textarea') || entries.length === 0) return;
    event.preventDefault();
    // A board is named by its UUID and a paper by its file, so the list
    // being shown decides which name to look for.
    const keyOf = (entry) => (boardsView ? entry.uuid : entry.sha256);
    const index = entries.findIndex((entry) => keyOf(entry) === selectedKey);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? 0 : Math.min(entries.length - 1, Math.max(0, index + step));
    if (next === index) return;
    if (boardsView) {
      setComposer(null);
      setSelectedBoardUuid(entries[next].uuid);
    } else {
      onNavigate(`/paper/${paperName(entries[next].sha256)}`, { replace: route.page === 'paper' });
    }
  };

  let emptyList = null;
  if (loading) emptyList = <Working label="Loading…" />;
  else if (total === 0 && search.trim()) emptyList = 'Nothing matches your search.';
  else if (total === 0 && syncing && !libraryView) {
    emptyList = boardsView
      ? 'Syncing your nook… Boards will appear here as they arrive.'
      : 'Syncing your nook… Papers will appear here as they arrive.';
  }
  else if (total === 0) {
    emptyList = libraryView ? 'No one has shared a paper yet.'
      : boardsView ? 'You have no boards yet.'
        : shelf ? 'Nothing is on this shelf yet.'
          : tag ? 'None of your papers carry this tag.'
            : 'Your nook has no papers yet.';
  }

  let detail;
  if (composer === 'paper') {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <div className="desktop-composer-head">
            <h2>Add a paper</h2>
            <button type="button" onClick={() => setComposer(null)}>Cancel</button>
          </div>
          <PaperUpload
            onReportableError={onReportableError}
            onPaperCreated={(paper) => {
              setComposer(null);
              reload();
              if (paper?.sha256 != null) {
                const destination = paperCreatedNavigation(listing, paper.sha256);
                rememberListing(destination.listing);
                onNavigate(destination.path);
              }
            }}
            incomingFile={incomingPaperFile}
            onIncomingFileHandled={onIncomingPaperFileHandled}
            onAddFolder={(incoming) => {
              setFolderRequest(incoming && { uuid: globalThis.crypto.randomUUID(), ...incoming });
              setComposer('folder');
            }}
          />
        </div>
      </div>
    );
  } else if (composer === 'folder') {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <FolderImport
            currentUser={currentUser}
            incomingFolder={incomingPaperFolder ?? folderRequest}
            onIncomingFolderHandled={onIncomingPaperFolderHandled}
            onReportableError={onReportableError}
            onAdded={reload}
            onClose={() => {
              setComposer(null);
              setFolderRequest(null);
              reload();
            }}
          />
        </div>
      </div>
    );
  } else if (composer === 'board') {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <BoardCreateForm
            shelves={shelves}
            onCreated={(board) => {
              // Creation belongs to the Desk workflow: put the new board
              // into the list immediately and focus its overview. Opening the
              // separate canvas is the user's next, explicit action.
              setComposer(null);
              setSearch('');
              setNook((current) => current ? {
                ...current,
                boards: [board, ...(current.boards || []).filter((item) => item.uuid !== board.uuid)],
              } : current);
              setSelectedBoardUuid(board.uuid);
              reload();
            }}
            onCancel={() => setComposer(null)}
          />
        </div>
      </div>
    );
  } else if (paperSha256 != null) {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <PaperJacket
            // Moving the paper to another shelf from the sidebar reloads it,
            // so its own shelf control never shows the old shelf.
            key={`${paperSha256}:${(nook?.papers ?? []).find((paper) => isSelected(paper))?.shelf_uuid ?? ''}`}
            paperSha256={paperSha256}
            currentUser={currentUser}
            hideBack
            onBack={listingHome}
            onChanged={reload}
            onRead={openUser}
            onSelectPaper={(sha256) => onNavigate(`/paper/${paperName(sha256)}`)}
            onReportableError={onReportableError}
          />
        </div>
      </div>
    );
  } else if (boardsView && selectedBoard) {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <BoardJacket
            boardUuid={selectedBoard.uuid}
            hideBack
            // A sync, or a change made from the list (its shelf, from the
            // context menu), is read again in place.
            refreshKey={`${selectedBoard.updated_at}:${selectedBoard.shelf_uuid}:${onSyncRefresh}`}
            onOpen={onOpenBoard}
            onChanged={reload}
            onDeleted={() => {
              setSelectedBoardUuid(null);
              reload();
            }}
          />
        </div>
      </div>
    );
  } else {
    detail = (
      <div className="desktop-empty">
        <Glyph name={boardsView ? 'boards' : 'document'} />
        <strong>{boardsView ? 'No board selected' : 'No paper selected'}</strong>
        <span>
          {boardsView
            ? 'Choose a board to preview it and continue where you left off.'
            : 'Choose a paper from the list to read its notes and discussion.'}
        </span>
      </div>
    );
  }

  return (
    <div className="desktop-browser">
      <section className="desktop-list-pane" aria-label={title}>
        <header className="desktop-toolbar desktop-list-header" data-tauri-drag-region="deep">
          <div className="desktop-list-heading">
            <h1>{title}</h1>
            <span>{subtitle}</span>
          </div>
          {canCompose && !boardsView && (
            <button
              type="button"
              className="desktop-toolbar-button"
              onClick={() => setComposer('folder')}
              title="Add a folder"
              aria-label="Add a folder"
            >
              <Glyph name="folder" />
            </button>
          )}
          {canCompose && (
            <button
              type="button"
              className="desktop-toolbar-button"
              onClick={() => setComposer(boardsView ? 'board' : 'paper')}
              title={boardsView ? 'New board' : 'Add a paper'}
              aria-label={boardsView ? 'New board' : 'Add a paper'}
            >
              <Glyph name="plus" />
            </button>
          )}
        </header>
        <label className="desktop-search">
          <Glyph name="search" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${title}`}
            aria-label={`Search ${title}`}
          />
        </label>
        <div className="desktop-list" ref={listRef} onKeyDown={moveSelection}>
          {actionError && <p className="desktop-list-empty" role="alert">{actionError}</p>}
          {emptyList ? (
            <p className="desktop-list-empty">{emptyList}</p>
          ) : boardsView ? (
            shownBoards.map((board) => (
              <a
                key={board.uuid}
                className={`desktop-row${selectedBoardUuid === board.uuid ? ' selected' : ''}`}
                href={appPath(`/boards/${board.uuid}`)}
                data-document
                draggable="false"
                aria-current={selectedBoardUuid === board.uuid ? 'true' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setComposer(null);
                  setSelectedBoardUuid(board.uuid);
                }}
                onDoubleClick={(event) => { event.preventDefault(); onOpenBoard(board.uuid); }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  onOpenBoard(board.uuid);
                }}
                onContextMenu={contextMenuHandler(() => [
                  { label: 'Open Board', onSelect: () => onOpenBoard(board.uuid) },
                  shelves.length > 0 && { separator: true },
                  shelves.length > 0 && {
                    label: 'Move to Shelf',
                    submenu: shelves.map((item) => ({
                      label: item.name,
                      checked: item.uuid === board.shelf_uuid,
                      onSelect: () => item.uuid !== board.shelf_uuid && moveBoard(board, item.uuid),
                    })),
                  },
                  { separator: true },
                  { label: 'Delete Board…', onSelect: () => removeBoard(board) },
                ])}
              >
                <span
                  className="desktop-row-swatch"
                  style={{ background: shelves.find((item) => item.uuid === board.shelf_uuid)?.color || 'var(--line-strong)' }}
                  aria-hidden="true"
                />
                <span className="desktop-row-body">
                  <span className="desktop-row-title">{board.name}</span>
                  {board.description && <span className="desktop-row-meta">{board.description}</span>}
                  <span className="desktop-row-sub">
                    {board.item_count} {board.item_count === 1 ? 'card' : 'cards'}
                  </span>
                </span>
              </a>
            ))
          ) : (
            shownPapers.map((paper) => {
              const selected = isSelected(paper);
              const shelfColor = libraryView ? null : shelves.find((item) => item.uuid === paper.shelf_uuid)?.color;
              const users = paper.users?.length || 0;
              return (
                <a
                  key={paper.sha256}
                  className={`desktop-row${selected ? ' selected' : ''}${draggingSha256 === paper.sha256 ? ' dragging' : ''}`}
                  href={paperHref(paper)}
                  aria-current={selected ? 'true' : undefined}
                  // A paper in the user's own nook can be dropped on one of
                  // the sidebar's shelves to move it there.
                  draggable={libraryView ? 'false' : 'true'}
                  onDragStart={libraryView ? undefined : (event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(PAPER_DRAG_TYPE, JSON.stringify({ sha256: paper.sha256, shelfUuid: paper.shelf_uuid }));
                    event.dataTransfer.setData('text/plain', paper.title);
                    setDraggingSha256(paper.sha256);
                  }}
                  onDragEnd={() => setDraggingSha256(null)}
                  onContextMenu={contextMenuHandler(() => [
                    { label: 'Open Paper', onSelect: () => onNavigate(`/paper/${paperName(paper.sha256)}`) },
                    !libraryView && shelves.length > 0 && { separator: true },
                    !libraryView && shelves.length > 0 && {
                      label: 'Move to Shelf',
                      submenu: shelves.map((item) => ({
                        label: item.name,
                        checked: item.uuid === paper.shelf_uuid,
                        onSelect: () => item.uuid !== paper.shelf_uuid && movePaper(paper, item.uuid),
                      })),
                    },
                    !libraryView && { separator: true },
                    !libraryView && { label: 'Remove from My Nook…', onSelect: () => removePaper(paper) },
                  ])}
                >
                  {shelfColor && (
                    <span className="desktop-row-swatch" style={{ background: shelfColor }} aria-hidden="true" />
                  )}
                  <span className="desktop-row-body">
                    <span className="desktop-row-title">{paper.title}</span>
                    <span className="desktop-row-meta">
                      {[formatAuthors(paper.authors), paper.year].filter(Boolean).join(' · ')}
                    </span>
                    {paper.journal && (
                      <span className="desktop-row-sub">{paper.journal}</span>
                    )}
                    {libraryView && users > 0 && (
                      <span className="desktop-row-sub">
                        {users} {users === 1 ? 'user' : 'users'}
                      </span>
                    )}
                  </span>
                  {/* A label here, not the explainer button: a button inside
                      the row's link would be a control inside a control. */}
                  {paper.room_status && <StatePill status={paper.room_status} link={false} />}
                </a>
              );
            })
          )}
        </div>
      </section>
      <section className="desktop-detail-pane">
        {/* The rest of the unified toolbar: nothing to press, but it moves
            the window like the title bar it stands in for. */}
        <div className="desktop-toolbar" data-tauri-drag-region="deep" />
        <DefaultViewerPrompt />
        {/* Keyed by what the pane shows, so a crash stays in this pane and
            choosing anything else starts it clean. */}
        <ErrorBoundary
          key={paperSha256 ?? selectedBoardUuid ?? listing}
          area="the desk's detail pane"
        >
          {detail}
        </ErrorBoundary>
      </section>
    </div>
  );
}
