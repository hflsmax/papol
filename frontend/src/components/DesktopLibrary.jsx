import React, { useCallback, useEffect, useRef, useState } from 'react';
import { deleteBoard, deletePaper, getUserSpace, listPapers, paperHref, updateBoard, updatePaper } from '../api';
import { appPath } from '../base';
import {
  PAPER_DRAG_TYPE, matchesSearch, papersInSource, rememberSource, shelfOf, sourcePath, tagOf,
} from '../desktopSources';
import { formatAuthors } from '../paperFormat';
import PaperDetail from './PaperDetail';
import PaperUpload from './PaperUpload';
import BoardCreateForm from './BoardCreateForm';
import StatePill from './StatePill';
import Glyph from './DesktopGlyph';
import { confirmAction } from '../../../shared/confirmAction';
import { contextMenuHandler } from '../../../shared/contextMenu';
import { openDesktopDocumentWindow } from '../../../shared/desktopShell';
import { subscribeNativeData } from '../nativeData';

// Papol Desktop's three-pane browser (DESIGN.md, "Desktop shell"): the
// sidebar picks a source, the list pane shows what is in it, and the chosen
// paper opens beside the list instead of replacing it. What a source means
// and lists is decided in desktopSources.js.

// The reader's nook, kept loaded for the sidebar and the list. Reloaded on
// every navigation and whenever the window comes back to the front, since
// the paper pane edits it underneath.
export function useNookSpace(userUuid, refreshKey) {
  const [space, setSpace] = useState(null);
  const currentUserUuid = useRef(userUuid);
  currentUserUuid.current = userUuid;

  const reload = useCallback(() => {
    if (!userUuid) return;
    getUserSpace(userUuid)
      .then((data) => { if (currentUserUuid.current === userUuid) setSpace(data); })
      .catch(() => {});
  }, [userUuid]);

  useEffect(() => { setSpace(null); }, [userUuid]);
  useEffect(() => { reload(); }, [reload, refreshKey]);
  useEffect(() => {
    window.addEventListener('focus', reload);
    const unsubscribeNative = subscribeNativeData(reload);
    return () => {
      unsubscribeNative();
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  return { space, setSpace, reload };
}

export function DesktopBrowser({
  source, route, currentUser, nook, onNavigate, onOpenBoard, onSyncRefresh, banner,
  incomingPaperFile, onIncomingPaperFileHandled,
}) {
  const { space, reload } = nook;
  const [library, setLibrary] = useState(null);
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(null); // null | 'paper' | 'board'
  const [draggingUuid, setDraggingUuid] = useState(null);
  const [actionError, setActionError] = useState(null);
  const listRef = useRef(null);
  const paperUuid = route.page === 'paper' ? route.uuid : null;
  const selectedKey = paperUuid;
  const isSelected = (paper) => selectedKey != null && paper.uuid === selectedKey;

  useEffect(() => {
    if (route.page !== 'paper') rememberSource(source);
  }, [route.page, source]);

  useEffect(() => { setSearch(''); }, [source]);
  useEffect(() => { setComposer(null); }, [paperUuid, source]);
  useEffect(() => {
    if (incomingPaperFile) setComposer('paper');
  }, [incomingPaperFile]);

  const openReader = (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820');

  useEffect(() => {
    if (source !== 'library') return undefined;
    let active = true;
    listPapers()
      .then((papers) => { if (active) setLibrary(papers); })
      .catch(() => { if (active) setLibrary([]); });
    return () => { active = false; };
  }, [source, route, onSyncRefresh]);

  // Keep the selection in view, and keep keyboard focus on it while the
  // reader is moving through the list with the arrow keys.
  useEffect(() => {
    const row = listRef.current?.querySelector('.desktop-row.selected');
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (listRef.current.contains(document.activeElement)) row.focus({ preventScroll: true });
  }, [selectedKey]);

  const shelves = space?.shelves || [];
  const shelf = shelfOf(source, space);
  const tag = tagOf(source, space);
  const boardsView = source === 'boards';
  const libraryView = source === 'library';
  const loading = libraryView ? library == null : space == null;

  const shownPapers = papersInSource(source, { space, library })
    .filter((paper) => matchesSearch(search, [paper.title, paper.authors, paper.journal]));
  const shownBoards = boardsView
    ? (space?.boards || [])
      .filter((board) => matchesSearch(search, [board.name, board.description]))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    : [];

  const title = libraryView ? 'Library' : boardsView ? 'Boards' : shelf ? shelf.name : tag ? `#${tag.name}` : 'All papers';
  const total = boardsView ? shownBoards.length : shownPapers.length;
  const noun = boardsView ? (total === 1 ? 'board' : 'boards') : (total === 1 ? 'paper' : 'papers');
  const subtitle = loading ? 'Loading…' : [
    `${total} ${noun}`,
    shelf ? (shelf.is_public ? 'Public' : 'Private') : null,
  ].filter(Boolean).join(' · ');

  const canCompose = Boolean(space) && !libraryView;
  const sourceHome = () => onNavigate(sourcePath(source));
  const movePaper = async (paper, shelfUuid) => {
    setActionError(null);
    try {
      await updatePaper(paper.uuid, { shelf_uuid: shelfUuid });
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const moveBoard = async (board, shelfUuid) => {
    setActionError(null);
    try {
      await updateBoard(board.uuid, { shelf_uuid: shelfUuid });
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const removePaper = async (paper) => {
    if (!(await confirmAction('Remove this paper from your nook? Your ratings and notes will be deleted. This cannot be undone.', { confirmLabel: 'Remove', destructive: true }))) return;
    setActionError(null);
    try {
      await deletePaper(paper.uuid);
      if (isSelected(paper)) sourceHome();
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const removeBoard = async (board) => {
    if (!(await confirmAction(`Delete “${board.name}”? This cannot be undone.`, { confirmLabel: 'Delete board', destructive: true }))) return;
    setActionError(null);
    try {
      await deleteBoard(board.uuid);
      reload();
    } catch (error) { setActionError(error.message); }
  };

  const moveSelection = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (event.target.closest?.('input, textarea') || shownPapers.length === 0) return;
    event.preventDefault();
    const index = shownPapers.findIndex((paper) => isSelected(paper));
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? 0 : Math.min(shownPapers.length - 1, Math.max(0, index + step));
    if (next === index) return;
    onNavigate(`/paper/${shownPapers[next].uuid}`, { replace: route.page === 'paper' });
  };

  let emptyList = null;
  if (loading) emptyList = 'Loading…';
  else if (total === 0 && search.trim()) emptyList = 'Nothing matches your search.';
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
            onPaperCreated={(paper) => {
              setComposer(null);
              reload();
              if (paper?.uuid != null) onNavigate(`/paper/${paper.uuid}`);
            }}
            incomingFile={incomingPaperFile}
            onIncomingFileHandled={onIncomingPaperFileHandled}
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
            onCreated={(board) => onOpenBoard(board.uuid)}
            onCancel={() => setComposer(null)}
          />
        </div>
      </div>
    );
  } else if (paperUuid != null) {
    detail = (
      <div className="desktop-scroll">
        <div className="desktop-content">
          <PaperDetail
            // Moving the paper to another shelf from the sidebar reloads it,
            // so its own shelf control never shows the old shelf.
            key={`${paperUuid}:${(space?.papers || []).find((paper) => isSelected(paper))?.shelf_uuid ?? ''}`}
            paperUuid={paperUuid}
            currentUser={currentUser}
            hideBack
            onBack={sourceHome}
            onChanged={reload}
            onRead={openReader}
            onSelectPaper={(uuid) => onNavigate(`/paper/${uuid}`)}
          />
        </div>
      </div>
    );
  } else {
    detail = (
      <div className="desktop-empty">
        <Glyph name={boardsView ? 'boards' : 'document'} />
        <strong>{boardsView ? 'No board open' : 'No paper selected'}</strong>
        <span>
          {boardsView
            ? 'Choose a board from the list to open it.'
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
          {canCompose && (
            <button
              type="button"
              className="desktop-toolbar-btn"
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
                className="desktop-row"
                href={appPath(`/boards/${board.uuid}`)}
                data-document
                draggable="false"
                onClick={(event) => { event.preventDefault(); onOpenBoard(board.uuid); }}
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
              const readers = paper.readers?.length || 0;
              return (
                <a
                  key={paper.uuid}
                  className={`desktop-row${selected ? ' selected' : ''}${draggingUuid === paper.uuid ? ' dragging' : ''}`}
                  href={paperHref(paper)}
                  aria-current={selected ? 'true' : undefined}
                  // A paper in the reader's own nook can be dropped on one of
                  // the sidebar's shelves to move it there.
                  draggable={libraryView ? 'false' : 'true'}
                  onDragStart={libraryView ? undefined : (event) => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(PAPER_DRAG_TYPE, JSON.stringify({ uuid: paper.uuid, shelfUuid: paper.shelf_uuid }));
                    event.dataTransfer.setData('text/plain', paper.title);
                    setDraggingUuid(paper.uuid);
                  }}
                  onDragEnd={() => setDraggingUuid(null)}
                  onContextMenu={contextMenuHandler(() => [
                    { label: 'Open Paper', onSelect: () => onNavigate(`/paper/${paper.uuid}`) },
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
                    <span className="desktop-row-sub">
                      {[paper.journal, libraryView && readers ? `${readers} ${readers === 1 ? 'reader' : 'readers'}` : null]
                        .filter(Boolean).join(' · ')}
                    </span>
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
        {banner}
        {detail}
      </section>
    </div>
  );
}
