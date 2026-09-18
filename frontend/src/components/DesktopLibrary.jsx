import React, { useCallback, useEffect, useRef, useState } from 'react';
import { boardFileBlob, deleteBoard, getBoard, updateBoard } from '../../../shared/api/boards.js';
import { getUserSpace } from '../../../shared/api/people.js';
import { paperName } from '../../../shared/paperName.js';
import { deletePaper, listPapers, paperHref, updatePaper } from '../../../shared/api/papers.js';
import { appPath } from '../base';
import {
  PAPER_DRAG_TYPE, matchesSearch, paperCreatedNavigation, papersInSource,
  rememberSource, shelfOf, sourcePath, tagOf,
} from '../desktopSources';
import { formatAuthors } from '../paperFormat';
import PaperJacket from './PaperJacket';
import PaperUpload from './PaperUpload';
import appLimits from '../../../shared/appLimits.js';
import BoardCreateForm from './BoardCreateForm';
import { lastEdited as formatBoardDate } from '../../../shared/lastEdited.js';
import StatePill from './StatePill';
import Glyph from './DesktopGlyph';
import { confirmAction } from '../../../shared/confirmAction';
import { contextMenuHandler } from '../../../shared/contextMenu';
import { openDesktopDocumentWindow } from '../../../shared/desktopShell';
import {
  dismissPdfViewerPrompt, makePdfViewerDefault, nativeSyncInProgress, pdfViewerStatus, subscribeNativeData,
} from '../../../shared/nativeData.js';
import { inDemo } from '../base';

// Asked on every launch while another app is the PDF viewer. The viewer asks
// the same question over an opened file; answering in either place quiets
// both until the app is relaunched.
function DefaultViewerPrompt() {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (inDemo()) return undefined;
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
    <div className="demo-banner pdf-viewer-prompt" role="status">
      <span>{error || 'Use Papol as your default PDF viewer?'}</span>
      <span className="demo-banner-actions">
        <button type="button" className="demo-banner-btn" onClick={makeDefault}>Use Papol</button>
        <button type="button" className="demo-banner-link" onClick={dismiss}>Not now</button>
      </span>
    </div>
  );
}


const previewCardHeight = (item) => {
  if (['image', 'youtube', 'webpage'].includes(item.kind)) return 180;
  if (item.kind === 'excerpt') return 145;
  if (item.kind === 'file') return 82;
  return 112;
};

const previewCardLabel = (item) => item.content || item.excerpt_text || item.original_filename || item.source_label || {
  comment: 'Thought', excerpt: 'Excerpt', image: 'Image', file: 'File', youtube: 'YouTube video', webpage: 'Webpage',
}[item.kind] || 'Card';

const hasVisualPreview = (item) => ['image', 'youtube', 'webpage'].includes(item.kind)
  && Boolean(item.kind === 'image' || item.sha256 || item.file_path);

function BoardCanvasPreview({ board, onOpen }) {
  const items = board?.items || [];
  const [previewUrls, setPreviewUrls] = useState({});
  const previewUrlsRef = useRef({});
  const previewSourcesRef = useRef({});
  const previewItems = items.filter(hasVisualPreview);
  const previewKey = previewItems
    .map((item) => `${item.uuid}:${item.sha256 || item.file_path || ''}`)
    .join(',');

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    let active = true;
    const wanted = new Map(previewItems.map((item) => [
      item.uuid, `${item.sha256 || item.file_path || ''}`,
    ]));

    Object.entries(previewUrlsRef.current).forEach(([uuid, url]) => {
      if (wanted.get(uuid) === previewSourcesRef.current[uuid]) return;
      URL.revokeObjectURL(url);
      delete previewUrlsRef.current[uuid];
      delete previewSourcesRef.current[uuid];
    });
    setPreviewUrls((current) => Object.fromEntries(
      Object.entries(current).filter(([uuid]) => wanted.get(uuid) === previewSourcesRef.current[uuid]),
    ));

    previewItems.forEach(async (item) => {
      if (previewUrlsRef.current[item.uuid]) return;
      const source = wanted.get(item.uuid);
      try {
        const url = await boardFileBlob(item);
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrls((current) => {
          const next = { ...current, [item.uuid]: url };
          previewSourcesRef.current[item.uuid] = source;
          previewUrlsRef.current = next;
          return next;
        });
      } catch (error) {
        console.warn('Could not load board preview image', item.uuid, error);
      }
    });

    return () => { active = false; };
  }, [previewKey]);

  useEffect(() => () => {
    Object.values(previewUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    previewSourcesRef.current = {};
  }, []);

  if (!items.length) {
    return (
      <div className="desktop-board-preview empty">
        <Glyph name="boards" />
        <strong>This board is empty</strong>
        <span>Open it to add a thought, drop a file, or paste a link.</span>
        <button type="button" onClick={onOpen}>Open board</button>
      </div>
    );
  }

  const cards = items.map((item) => ({
    ...item,
    width: item.width || 300,
    previewHeight: previewCardHeight(item),
  }));
  const padding = 44;
  const minX = Math.min(...cards.map((item) => item.x)) - padding;
  const minY = Math.min(...cards.map((item) => item.y)) - padding;
  const maxX = Math.max(...cards.map((item) => item.x + item.width)) + padding;
  const maxY = Math.max(...cards.map((item) => item.y + item.previewHeight)) + padding;

  return (
    <div className="desktop-board-preview" onDoubleClick={onOpen} title="Double-click to open board">
      <svg
        viewBox={`${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Preview of ${board.name}, containing ${items.length} ${items.length === 1 ? 'card' : 'cards'}`}
      >
        {cards.sort((a, b) => (a.position || 0) - (b.position || 0)).map((item) => {
          const label = previewCardLabel(item).replace(/\s+/g, ' ').trim();
          const clipped = label.length > 38 ? `${label.slice(0, 37)}…` : label;
          return (
            <g key={item.uuid} className={`desktop-board-preview-card ${item.kind}`}>
              <title>{label}</title>
              <rect x={item.x} y={item.y} width={item.width} height={item.previewHeight} rx="8" />
              <line x1={item.x} y1={item.y + 32} x2={item.x + item.width} y2={item.y + 32} />
              <text className="kind" x={item.x + 13} y={item.y + 21}>{item.kind}</text>
              {previewUrls[item.uuid] ? (
                <>
                  <clipPath id={`desktop-board-preview-clip-${item.uuid}`}>
                    <rect x={item.x + 1} y={item.y + 33} width={item.width - 2} height={item.previewHeight - 34} rx="7" />
                  </clipPath>
                  <image
                    className="content-preview"
                    href={previewUrls[item.uuid]}
                    x={item.x + 1}
                    y={item.y + 33}
                    width={item.width - 2}
                    height={item.previewHeight - 34}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#desktop-board-preview-clip-${item.uuid})`}
                  />
                </>
              ) : <text x={item.x + 13} y={item.y + 58}>{clipped}</text>}
            </g>
          );
        })}
      </svg>
      <span className="desktop-board-preview-hint">Double-click to open</span>
    </div>
  );
}

function BoardOverview({ summary, board, loading, error, shelves, onOpen, onUpdate, onMove, onDelete }) {
  const [editingField, setEditingField] = useState(null);
  const [draftValue, setDraftValue] = useState('');
  const [savingField, setSavingField] = useState(null);
  const [editError, setEditError] = useState(null);
  const beginEditing = (field) => {
    setEditError(null);
    setEditingField(field);
    setDraftValue(field === 'name' ? summary.name : (summary.description || ''));
  };
  const beginEditingWithKeyboard = (field, event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      beginEditing(field);
    }
  };
  useEffect(() => {
    setEditingField(null);
    setDraftValue('');
    setEditError(null);
  }, [summary.uuid, summary.name, summary.description]);

  const saveInline = async () => {
    if (!editingField || savingField) return;
    const value = draftValue.trim();
    if (editingField === 'name' && !value) return;
    const field = editingField;
    const previous = field === 'name' ? summary.name : (summary.description || '');
    if (value === previous) {
      setEditingField(null);
      return;
    }
    setSavingField(field);
    setEditError(null);
    try {
      await onUpdate(field === 'name' ? { name: value } : { description: value || null });
      setEditingField(null);
    } catch (failure) {
      setEditError(failure.message);
    } finally { setSavingField(null); }
  };
  const cancelInline = () => { setEditingField(null); setDraftValue(''); setEditError(null); };

  const staged = board?.staged_items || [];
  const cardCount = board?.item_count ?? summary.item_count;
  return (
    <div className="desktop-scroll">
      <article className="desktop-board-overview">
        <header className="desktop-board-overview-head">
          <div>
            <>
              <div className="desktop-board-title-row">
                {editingField === 'name' ? (
                  <input
                    className="desktop-board-inline-input"
                    value={draftValue}
                    onChange={(event) => setDraftValue(event.target.value)}
                    onBlur={saveInline}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveInline(); } if (event.key === 'Escape') cancelInline(); }}
                    maxLength={appLimits.text.board_name}
                    autoFocus
                    aria-label="Board name"
                  />
                ) : (
                  <h1 className="desktop-board-editable" role="button" tabIndex="0" onClick={() => beginEditing('name')} onKeyDown={(event) => beginEditingWithKeyboard('name', event)} title="Click to edit board name" aria-label="Edit board name">{summary.name}</h1>
                )}
                  <div className="detail-toggle">
                    {shelves.length > 0 && (
                      <span className="hint-anchor paper-shelf-picker desktop-board-shelf-picker">
                        <label htmlFor="selected-board-shelf">Shelf:</label>
                        <select id="selected-board-shelf" value={summary.shelf_uuid || ''} onChange={(event) => onMove(event.target.value)}>
                          {shelves.map((item) => <option key={item.uuid} value={item.uuid}>{item.name} · {item.is_public ? 'Public' : 'Private'}</option>)}
                        </select>
                      </span>
                    )}
                    <button type="button" className="icon-btn danger-icon" onClick={onDelete} title="Delete this board" aria-label="Delete this board">
                      <svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2.6 4h10.8" />
                        <path d="M6.2 4V2.7h3.6V4" />
                        <path d="M4.1 4l.5 9.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L11.9 4" />
                        <path d="M6.7 6.6v5.2M9.3 6.6v5.2" />
                      </svg>
                    </button>
                  </div>
              </div>
              {editingField === 'description' ? (
                <textarea
                  className="desktop-board-inline-description"
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  onBlur={saveInline}
                  onKeyDown={(event) => { if (event.key === 'Escape') cancelInline(); if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); saveInline(); } }}
                  maxLength={appLimits.text.board_description}
                  rows="3"
                  autoFocus
                  placeholder="What are you exploring on this board?"
                  aria-label="Board description"
                />
              ) : (
                <p
                  className={`desktop-board-description desktop-board-editable${summary.description ? '' : ' empty'}`}
                  role="button"
                  tabIndex="0"
                  onClick={() => beginEditing('description')}
                  onKeyDown={(event) => beginEditingWithKeyboard('description', event)}
                  title="Click to edit board description"
                  aria-label="Edit board description"
                >
                  {summary.description || 'Add a description…'}
                </p>
              )}
              {editError && <p className="desktop-board-edit-error" role="alert">{editError}</p>}
            </>
            <button type="button" className="primary desktop-board-open" onClick={onOpen}>Open Board</button>
          </div>
        </header>

        {loading && <div className="desktop-board-loading" role="status">Loading board preview…</div>}
        {error && <div className="desktop-board-loading error" role="alert">{error}</div>}
        {board && (
          <>
            {staged.length > 0 && (
              <section className="desktop-board-staging" aria-labelledby="desktop-board-staging-title">
                <div className="desktop-board-section-head">
                  <div><h2 id="desktop-board-staging-title">Waiting to place</h2><p>{staged.length} {staged.length === 1 ? 'item is' : 'items are'} ready on this board.</p></div>
                  <button type="button" onClick={onOpen}>Place on board</button>
                </div>
                <div className="desktop-board-staging-list">
                  {staged.slice(0, 4).map((item) => (
                    <div key={item.uuid} className="desktop-board-staged-item">
                      <span>{item.kind === 'image' ? 'Clip' : 'Excerpt'}</span>
                      <p>{item.content || item.excerpt_text || 'Clipped paper content'}</p>
                      {item.source_label && <small>{item.source_label}</small>}
                    </div>
                  ))}
                  {staged.length > 4 && <div className="desktop-board-staged-more">+{staged.length - 4} more</div>}
                </div>
              </section>
            )}
          </>
        )}
        <section className="desktop-board-canvas-section" aria-labelledby="desktop-board-canvas-title">
          <div className="desktop-board-section-head"><div><h2 id="desktop-board-canvas-title">Board preview</h2><p className="desktop-board-title-meta" aria-label="Board information"><span>{cardCount} {cardCount === 1 ? 'card' : 'cards'}</span><time dateTime={summary.updated_at}>Edited {formatBoardDate(summary.updated_at)}</time></p></div></div>
          {!loading && board && <BoardCanvasPreview board={board} onOpen={onOpen} />}
        </section>
      </article>
    </div>
  );
}

// Papol macOS's three-pane browser (DESIGN.md, "Desktop shell"): the
// sidebar picks a source, the list pane shows what is in it, and the chosen
// paper opens beside the list instead of replacing it. What a source means
// and lists is decided in desktopSources.js.

// The user's nook, kept loaded for the sidebar and the list. Reloaded on
// every navigation and whenever the window comes back to the front, since
// the paper pane edits it underneath.
export function useNookSpace(userUuid, refreshKey) {
  const [space, setSpace] = useState(null);
  const [nativeSyncing, setNativeSyncing] = useState(nativeSyncInProgress);
  const currentUserUuid = useRef(userUuid);
  currentUserUuid.current = userUuid;

  const reload = useCallback(() => {
    if (!userUuid) return;
    getUserSpace(userUuid)
      .then((data) => { if (currentUserUuid.current === userUuid) setSpace(data); })
      .catch(() => {});
  }, [userUuid]);

  useEffect(() => {
    setSpace(null);
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
    space, setSpace, reload,
    syncing: Boolean(userUuid) && (nativeSyncing || nativeSyncInProgress()),
  };
}

export function DesktopBrowser({
  source, route, currentUser, nook, onNavigate, onOpenBoard, onSyncRefresh, banner,
  incomingPaperFile, onIncomingPaperFileHandled, onReportableError,
}) {
  const { space, setSpace, reload, syncing } = nook;
  const [library, setLibrary] = useState(null);
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(null); // null | 'paper' | 'board'
  const [draggingSha256, setDraggingSha256] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [selectedBoardUuid, setSelectedBoardUuid] = useState(null);
  const [boardDetail, setBoardDetail] = useState(null);
  const [boardDetailLoading, setBoardDetailLoading] = useState(false);
  const [boardDetailError, setBoardDetailError] = useState(null);
  const listRef = useRef(null);
  const paperSha256 = route.page === 'paper' ? route.uuid : null;
  const selectedKey = source === 'boards' ? selectedBoardUuid : paperSha256;
  const isSelected = (paper) => paperSha256 != null && paper.sha256 === paperSha256;

  useEffect(() => {
    if (route.page !== 'paper') rememberSource(source);
  }, [route.page, source]);

  useEffect(() => {
    setSearch('');
    if (source !== 'boards') {
      setSelectedBoardUuid(null);
      setBoardDetail(null);
      setBoardDetailError(null);
    }
  }, [source]);
  useEffect(() => { setComposer(null); }, [paperSha256, source]);
  useEffect(() => {
    if (incomingPaperFile) setComposer('paper');
  }, [incomingPaperFile]);

  const openUser = (href) => openDesktopDocumentWindow(href, 'popup,width=1100,height=820');

  useEffect(() => {
    if (source !== 'library') return undefined;
    let active = true;
    listPapers()
      .then((papers) => { if (active) setLibrary(papers); })
      .catch(() => { if (active) setLibrary([]); });
    return () => { active = false; };
  }, [source, route, onSyncRefresh]);

  // Keep the selection in view, and keep keyboard focus on it while the
  // user is moving through the list with the arrow keys.
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
  const selectedBoard = boardsView
    ? (space?.boards || []).find((board) => board.uuid === selectedBoardUuid) || null
    : null;

  useEffect(() => {
    if (!boardsView || !selectedBoardUuid) return undefined;
    let active = true;
    setBoardDetailLoading(true);
    setBoardDetailError(null);
    getBoard(selectedBoardUuid)
      .then((detail) => { if (active) setBoardDetail(detail); })
      .catch((failure) => {
        if (!active) return;
        setBoardDetail(null);
        setBoardDetailError(failure.message);
      })
      .finally(() => { if (active) setBoardDetailLoading(false); });
    return () => { active = false; };
  }, [boardsView, selectedBoardUuid, selectedBoard?.updated_at, onSyncRefresh]);

  useEffect(() => {
    if (selectedBoardUuid && space && !selectedBoard) {
      setSelectedBoardUuid(null);
      setBoardDetail(null);
    }
  }, [space, selectedBoard, selectedBoardUuid]);

  const title = libraryView ? 'Library' : boardsView ? 'Boards' : shelf ? shelf.name : tag ? `#${tag.name}` : 'All papers';
  const total = boardsView ? shownBoards.length : shownPapers.length;
  const noun = boardsView ? (total === 1 ? 'board' : 'boards') : (total === 1 ? 'paper' : 'papers');
  const subtitle = loading ? 'Loading…' : [
    `${total} ${noun}`,
    syncing ? 'Syncing…' : null,
    shelf ? (shelf.is_public ? 'Public' : 'Private') : null,
  ].filter(Boolean).join(' · ');

  const canCompose = Boolean(space) && !libraryView;
  const sourceHome = () => onNavigate(sourcePath(source));
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
      if (isSelected(paper)) sourceHome();
      reload();
    } catch (error) { setActionError(error.message); }
  };
  const removeBoard = async (board) => {
    if (!(await confirmAction(`Delete “${board.name}”? This cannot be undone.`, { confirmLabel: 'Delete board', destructive: true }))) return;
    setActionError(null);
    try {
      await deleteBoard(board.uuid);
      if (selectedBoardUuid === board.uuid) {
        setSelectedBoardUuid(null);
        setBoardDetail(null);
      }
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
  if (loading) emptyList = 'Loading…';
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
                const destination = paperCreatedNavigation(source, paper.sha256);
                rememberSource(destination.source);
                onNavigate(destination.path);
              }
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
            onCreated={(board) => {
              // Creation belongs to the Library workflow: put the new board
              // into the list immediately and focus its overview. Opening the
              // separate canvas is the user's next, explicit action.
              setComposer(null);
              setSearch('');
              setBoardDetail(board);
              setBoardDetailError(null);
              setBoardDetailLoading(false);
              setSpace((current) => current ? {
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
            key={`${paperSha256}:${(space?.papers || []).find((paper) => isSelected(paper))?.shelf_uuid ?? ''}`}
            paperSha256={paperSha256}
            currentUser={currentUser}
            hideBack
            onBack={sourceHome}
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
      <BoardOverview
        summary={selectedBoard}
        board={boardDetail?.uuid === selectedBoard.uuid ? boardDetail : null}
        loading={boardDetailLoading}
        error={boardDetailError}
        shelves={shelves}
        onOpen={() => onOpenBoard(selectedBoard.uuid)}
        onUpdate={async (values) => {
          setActionError(null);
          try {
            const updated = await updateBoard(selectedBoard.uuid, values);
            setBoardDetail((current) => current?.uuid === selectedBoard.uuid ? { ...current, ...updated } : current);
            reload();
          } catch (failure) {
            setActionError(failure.message);
            throw failure;
          }
        }}
        onMove={async (shelfUuid) => {
          if (await moveBoard(selectedBoard, shelfUuid)) {
            setBoardDetail((current) => current?.uuid === selectedBoard.uuid ? { ...current, shelf_uuid: shelfUuid } : current);
          }
        }}
        onDelete={() => removeBoard(selectedBoard)}
      />
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
                    {selectedBoardUuid === board.uuid && boardDetail?.uuid === board.uuid && boardDetail.staged_items?.length > 0
                      ? ` · ${boardDetail.staged_items.length} waiting`
                      : ''}
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
        {banner}
        <DefaultViewerPrompt />
        {detail}
      </section>
    </div>
  );
}
