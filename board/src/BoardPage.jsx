import React, { useEffect, useRef, useState } from 'react';
import { addBoardComment, addBoardFile, addBoardWebpage, addBoardYouTube, boardFileBlob, createBoardGroup, downloadBoardFile, deleteBoard, deleteBoardItem, getBoard, layoutBoardGroup, moveBoardGroup, moveBoardItem, placeStagedBoardItem, restoreBoardItem, ungroupBoardGroup, updateBoard, updateBoardGroup, updateBoardItem } from '../../frontend/src/api.js';
import ExperimentalBadge from '../../frontend/src/components/ExperimentalBadge.jsx';
import BackLink from '../../frontend/src/components/BackLink.jsx';
import { boardPointFromClient, cardCenter, collectionMasonryLayout, collectionReorderLayout, DEFAULT_CARD_WIDTH, exceedsDragThreshold, membershipHistorySnapshots, previewBookletHeight, stackWithInsertion, stackWithout, tidyCollectionPositions } from './bookletDrag.js';
import { mergeSelection, selectionMode } from './selection.js';
import { confirmAction } from '../../shared/confirmAction.js';
import { DESKTOP, DOCUMENT_WINDOW, focusDesktopLibraryWindow } from '../../shared/desktopShell.js';
import DesktopNav from '../../frontend/src/components/DesktopNav.jsx';
import DesktopSyncingStatus from '../../frontend/src/components/DesktopSyncingStatus.jsx';
import { openContextMenu } from '../../shared/contextMenu.js';
import { subscribeNativeData } from '../../frontend/src/nativeData.js';
import { carriesFiles } from '../../frontend/src/fileDrop.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const compareUuid = (a, b) => String(a).localeCompare(String(b));
const COLLECTION_INSET_X = 28;
const COLLECTION_CARD_OFFSET_Y = 96;
const COLLECTION_INSET_BOTTOM = 20;
const preventModifiedTextSelection = (event) => {
  if (event.shiftKey || event.metaKey || event.ctrlKey) event.preventDefault();
};
const prepareCardTextPointerDown = (event) => {
  event.stopPropagation();
  if (event.currentTarget.closest('.board-canvas-card.comment')) event.preventDefault();
  else preventModifiedTextSelection(event);
};
const defaultBoardView = () => ({ x: window.innerWidth / 2 - 150, y: 150, zoom: 1 });
const savedBoardView = (boardUuid) => {
  try {
    const value = JSON.parse(localStorage.getItem(`papol_board_view_${boardUuid}`));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.zoom)) {
      return { x: value.x, y: value.y, zoom: clamp(value.zoom, 0.25, 3) };
    }
  } catch { /* a damaged local preference should not stop the board opening */ }
  return null;
};
const initialBoardView = (boardUuid) => window.innerWidth > 700
  ? savedBoardView(boardUuid) || defaultBoardView()
  : defaultBoardView();

function AlignGlyph({ align }) {
  const starts = align === 'left' ? [2, 2, 2] : align === 'center' ? [2, 5, 3] : [2, 8, 4];
  const widths = [16, 10, 14];
  return <svg className="board-align-glyph" viewBox="0 0 20 16" aria-hidden="true">{starts.map((x, index) => <line key={index} x1={x} x2={x + widths[index]} y1={3 + index * 5} y2={3 + index * 5} />)}</svg>;
}

function TidyGlyph() {
  return <svg className="board-tidy-glyph" viewBox="0 0 18 16" aria-hidden="true"><rect x="2" y="2" width="14" height="4" rx="1" /><rect x="2" y="10" width="14" height="4" rx="1" /></svg>;
}

const itemTypeLabels = {
  comment: 'Thought', excerpt: 'Excerpt', image: 'Image', file: 'File', youtube: 'YouTube video', webpage: 'Webpage',
};
const itemTypeIcons = {
  comment: '✦',
  excerpt: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8c0-2.8 1.4-4.8 4-6v2.2C4.9 4.9 4.3 5.8 4.1 7H6v6H2V8Zm8 0c0-2.8 1.4-4.8 4-6v2.2c-1.1.7-1.7 1.6-1.9 2.8H14v6h-4V8Z" /></svg>,
  image: '▧', file: '↧', youtube: '▶', webpage: '↗',
};

function hasCardPreview(item) {
  return item.kind === 'image' || Boolean(item.sha256 || item.file_path);
}
const browserDate = (value) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
const formatLastEdit = (value) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: browserDate(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(browserDate(value));
const stagedSourceLabel = (item) => {
  if (item.source_label && item.source_label !== 'Open source') return item.source_label;
  try {
    const page = new URL(item.source_url).searchParams.get('page');
    return page ? `Page ${page}` : 'Open source';
  } catch {
    return 'Open source';
  }
};

export default function BoardPage({ boardUuid, onBack, backHref }) {
  const [board, setBoard] = useState(null);
  const [view, setView] = useState(() => initialBoardView(boardUuid));
  const [viewRevision, setViewRevision] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState({});
  const [imageErrors, setImageErrors] = useState({});
  const imageUrlsRef = useRef({});
  const [imageRevision, setImageRevision] = useState(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedBooklet, setSelectedBooklet] = useState(null);
  const [menuItem, setMenuItem] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [urlLoading, setUrlLoading] = useState([]);
  const [showNewBoardHint, setShowNewBoardHint] = useState(false);
  const urlLoadingRef = useRef([]);
  const [bookletLayouts, setBookletLayouts] = useState([]);
  const [bookletRedraws, setBookletRedraws] = useState({});
  const [dropBooklet, setDropBooklet] = useState(null);
  const [visibleGrip, setVisibleGrip] = useState(null);
  const [foregroundGrip, setForegroundGrip] = useState(null);
  const [draggingGrip, setDraggingGrip] = useState(null);
  const [editingBooklet, setEditingBooklet] = useState(null);
  const [bookletTitleDraft, setBookletTitleDraft] = useState('');
  const [editingBookletHeader, setEditingBookletHeader] = useState(null);
  const [bookletHeaderDraft, setBookletHeaderDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(null);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingText, setEditingText] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const gesture = useRef(null);
  const touches = useRef(new Map());
  const viewportRef = useRef(null);
  const stageRef = useRef(null);
  const boardActionsRef = useRef(null);
  const viewRef = useRef(view);
  const viewFrame = useRef(null);
  const pendingView = useRef(view);
  const viewSaveTimer = useRef(null);
  const activeBoardUuid = useRef(boardUuid);
  const centerInitialView = useRef(window.innerWidth <= 700 || savedBoardView(boardUuid) == null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const newNoteToSelect = useRef(null);
  const suppressBookletClick = useRef(null);

  useEffect(() => {
    if (board?.name) document.title = `${board.name} — Papol`;
  }, [board?.name]);
  const showGrip = (itemUuid) => {
    setVisibleGrip(itemUuid);
  };
  const redrawBooklets = (groupUuids) => {
    const ids = [...new Set(groupUuids.filter((uuid) => uuid != null))];
    if (!ids.length) return;
    setBookletRedraws((current) => {
      const next = { ...current };
      ids.forEach((uuid) => { next[uuid] = (next[uuid] || 0) + 1; });
      return next;
    });
  };
  const updateGripProximity = (event) => {
    if (event.pointerType === 'touch') return;
    if (event.target.closest?.('.board-card-drag-handle')) {
      const itemUuid = event.target.closest('[data-item-uuid]')?.dataset.itemUuid;
      if (itemUuid) {
        showGrip(itemUuid);
        setForegroundGrip(itemUuid);
      }
      return;
    }
    if (gesture.current) return;

    // This runs on the board, rather than on each card, so approaching a card
    // from outside its bounds can reveal the handle. Distances are measured in
    // screen pixels and therefore remain comfortable at every board zoom.
    const candidates = [...(stageRef.current?.querySelectorAll('[data-item-uuid]') || [])]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const outsideX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const outsideY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        // The whole card and a 24px halo around it form one uninterrupted
        // activation region. This also bridges the gap to the protruding grip.
        const distance = Math.hypot(outsideX, outsideY);
        return { itemUuid: element.dataset.itemUuid, distance, z: Number(element.style.zIndex) || 0 };
      })
      .filter((candidate) => candidate.itemUuid && candidate.distance <= 24)
      .sort((a, b) => a.distance - b.distance || b.z - a.z);

    if (candidates.length) {
      const itemUuid = candidates[0].itemUuid;
      showGrip(itemUuid);
      const handle = stageRef.current?.querySelector(`[data-item-uuid="${itemUuid}"] > .board-card-drag-handle`);
      const rect = handle?.getBoundingClientRect();
      const nearHandle = rect && Math.hypot(
        Math.max(rect.left - event.clientX, 0, event.clientX - rect.right),
        Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom),
      ) <= 14;
      setForegroundGrip(nearHandle ? itemUuid : null);
    } else {
      if (visibleGrip != null) setVisibleGrip(null);
      if (foregroundGrip != null) setForegroundGrip(null);
    }
  };
  const load = () => getBoard(boardUuid).then(setBoard).catch((err) => setError(err.message));
  useEffect(() => subscribeNativeData((change) => {
    setImageRevision((current) => current + 1);
    if (!change?.scope || change.scope === 'boards') load();
  }), [boardUuid]);
  const raiseCards = (itemUuids) => {
    const ids = new Set(itemUuids);
    const ordered = board.items.filter((item) => ids.has(item.uuid)).sort((a, b) => a.position - b.position || compareUuid(a.uuid, b.uuid));
    if (!ordered.length) return;
    const start = Math.max(0, ...board.items.map((item) => item.position || 0)) + 1;
    const positions = new Map(ordered.map((item, index) => [item.uuid, start + index]));
    setBoard((current) => ({ ...current, items: current.items.map((item) => positions.has(item.uuid) ? { ...item, position: positions.get(item.uuid) } : item) }));
    Promise.all(ordered.map((item) => updateBoardItem(item.uuid, { position: positions.get(item.uuid) }))).catch((err) => { setError(err.message); load(); });
  };

  useEffect(() => {
    if (menuItem == null) return undefined;
    const closeMenu = (event) => {
      // The card's own button toggles the menu, so leave that click to it.
      if (!event.target.closest('.board-item-menu, .board-card-more')) setMenuItem(null);
    };
    document.addEventListener('pointerdown', closeMenu, true);
    return () => document.removeEventListener('pointerdown', closeMenu, true);
  }, [menuItem]);

  useEffect(() => {
    const closeBoardActions = (event) => {
      const menu = boardActionsRef.current;
      if (menu?.open && !menu.contains(event.target)) menu.removeAttribute('open');
    };
    document.addEventListener('pointerdown', closeBoardActions, true);
    return () => document.removeEventListener('pointerdown', closeBoardActions, true);
  }, []);

  useEffect(() => {
    let isNewBoard = false;
    try {
      isNewBoard = sessionStorage.getItem('papol.newBoardHint') === boardUuid;
      if (isNewBoard) sessionStorage.removeItem('papol.newBoardHint');
    } catch { /* best effort */ }
    setShowNewBoardHint(isNewBoard);
    if (!isNewBoard) return undefined;
    const timer = window.setTimeout(() => setShowNewBoardHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [boardUuid]);

  useEffect(() => {
    if (viewSaveTimer.current != null) {
      clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = null;
      try {
        localStorage.setItem(`papol_board_view_${activeBoardUuid.current}`, JSON.stringify(viewRef.current));
      } catch { /* best effort while switching boards */ }
    }
    activeBoardUuid.current = boardUuid;
    const saved = window.innerWidth > 700 ? savedBoardView(boardUuid) : null;
    centerInitialView.current = saved == null;
    const restored = saved || defaultBoardView();
    viewRef.current = restored;
    pendingView.current = restored;
    paintView(restored);
    setView(restored);
    load();
  }, [boardUuid]);
  useEffect(() => { document.body.classList.add('board-workspace-open'); return () => document.body.classList.remove('board-workspace-open'); }, []);
  useEffect(() => {
    if (!board?.items.length || !centerInitialView.current) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!centerInitialView.current || !viewportRef.current || !stageRef.current) return;
      const weighted = board.items.map((item) => {
        const element = stageRef.current.querySelector(`[data-item-uuid="${item.uuid}"]`);
        const width = element?.offsetWidth || item.width || 300;
        const height = element?.offsetHeight || 1;
        return { x: item.x + width / 2, y: item.y + height / 2, width, height };
      });
      if (!weighted.length) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const minX = Math.min(...weighted.map((item) => item.x - item.width / 2));
      const maxX = Math.max(...weighted.map((item) => item.x + item.width / 2));
      const minY = Math.min(...weighted.map((item) => item.y - item.height / 2));
      const maxY = Math.max(...weighted.map((item) => item.y + item.height / 2));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      const zoom = clamp(Math.min(
        viewRef.current.zoom,
        contentWidth ? (bounds.width - 32) / contentWidth : 1,
        contentHeight ? (bounds.height - 32) / contentHeight : 1,
      ), 0.05, 3);
      centerInitialView.current = false;
      queueView({ x: bounds.width / 2 - centerX * zoom, y: bounds.height / 2 - centerY * zoom, zoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [board?.uuid]);
  const imageItems = board ? [...board.items, ...(board.staged_items || [])]
    .filter((item) => ['image', 'youtube', 'webpage'].includes(item.kind) && hasCardPreview(item)) : [];
  const imageUuids = imageItems.map((item) => item.uuid).join(',');
  useEffect(() => {
    imageUrlsRef.current = imageUrls;
  }, [imageUrls]);
  // Toggling a paint-affecting property invalidates each card's composited
  // layer without remounting it or discarding editors and loaded images.
  const cardPaintState = viewRevision % 2 ? 'hidden' : 'visible';
  useEffect(() => {
    if (!board) return undefined;
    let active = true;
    const wanted = new Set(imageItems.map((item) => item.uuid));
    const staleUrls = Object.entries(imageUrlsRef.current)
      .filter(([uuid]) => !wanted.has(uuid))
      .map(([, url]) => url);
    if (staleUrls.length) {
      staleUrls.forEach((url) => URL.revokeObjectURL(url));
      setImageUrls((current) => Object.fromEntries(
        Object.entries(current).filter(([uuid]) => wanted.has(uuid)),
      ));
      setImageErrors((current) => Object.fromEntries(
        Object.entries(current).filter(([uuid]) => wanted.has(uuid)),
      ));
    }
    imageItems.forEach(async (item) => {
      if (imageUrlsRef.current[item.uuid]) return;
      setImageErrors((current) => {
        if (!current[item.uuid]) return current;
        const next = { ...current };
        delete next[item.uuid];
        return next;
      });
      try {
        const url = await boardFileBlob(item);
        if (!active) { URL.revokeObjectURL(url); return; }
        setImageUrls((current) => {
          const next = { ...current, [item.uuid]: url };
          imageUrlsRef.current = next;
          return next;
        });
      } catch (error) {
        console.warn('Could not load board image', item.uuid, error);
        setImageErrors((current) => ({ ...current, [item.uuid]: true }));
      }
    });
    return () => { active = false; };
  }, [imageUuids, imageRevision]);
  useEffect(() => () => {
    Object.values(imageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const bookletKey = board?.groups?.map((group) => `${group.uuid}:${group.kind}:${group.title}:${group.header}:${group.auto_arrange}:${group.item_uuids.join(',')}`).join('|') || '';
  useEffect(() => {
    if (!board?.groups?.length || !stageRef.current) { setBookletLayouts([]); return undefined; }
    let reflowTimer = null;
    const compact = () => {
      if (!board.can_edit) return;
      if (['item', 'resize'].includes(gesture.current?.type)) return;
      const layouts = board.groups.filter((group) => group.kind === 'booklet').map((group) => {
        const members = group.item_uuids.map((uuid) => board.items.find((item) => item.uuid === uuid)).filter(Boolean).sort((a, b) => a.y - b.y);
        if (members.length < 2) return null;
        const x = Math.min(...members.map((item) => item.x));
        let y = members[0].y;
        const items = members.map((item) => {
          const position = { uuid: item.uuid, group_uuid: group.uuid, x, y };
          const element = stageRef.current?.querySelector(`[data-item-uuid="${item.uuid}"]`);
          y += (element?.offsetHeight || 0) + 18;
          return position;
        });
        const changed = items.some((position) => {
          const item = board.items.find((candidate) => candidate.uuid === position.uuid);
          return Math.abs(item.x - position.x) > .5 || Math.abs(item.y - position.y) > .5;
        });
        return changed ? { group, items } : null;
      }).filter(Boolean);
      if (!layouts.length) return;
      const positions = new Map(layouts.flatMap((layout) => layout.items).map((position) => [position.uuid, position]));
      setBoard((current) => ({ ...current, items: current.items.map((item) => positions.has(item.uuid) ? { ...item, ...positions.get(item.uuid) } : item) }));
      Promise.all(layouts.map((layout) => layoutBoardGroup(layout.group.uuid, layout.items))).catch((err) => { setError(err.message); load(); });
    };
    const scheduleCompact = () => {
      if (reflowTimer != null) clearTimeout(reflowTimer);
      reflowTimer = setTimeout(compact, 60);
    };
    const measure = () => {
      setBookletLayouts(board.groups.map((group) => {
        const members = group.item_uuids.map((uuid) => {
          const item = board.items.find((candidate) => candidate.uuid === uuid);
          const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
          return item && element ? { ...item, height: element.offsetHeight } : null;
        }).filter(Boolean);
        if (!members.length) return null;
        const minX = Math.min(...members.map((item) => item.x));
        const minY = Math.min(...members.map((item) => item.y));
        const maxRight = Math.max(...members.map((item) => item.x + item.width));
        const maxBottom = Math.max(...members.map((item) => item.y + item.height));
        const isCollection = group.kind === 'collection';
        const x = minX - (isCollection ? COLLECTION_INSET_X : 34); const y = minY - (isCollection ? COLLECTION_CARD_OFFSET_Y : 86);
        return {
          ...group, x, y, width: maxRight - minX + (isCollection ? COLLECTION_INSET_X * 2 : 34),
          height: maxBottom - minY + (isCollection ? COLLECTION_CARD_OFFSET_Y + COLLECTION_INSET_BOTTOM : 86),
          branches: isCollection ? [] : members.map((item) => ({ uuid: item.uuid, top: item.y - y + 18, width: item.x - x - 10 })),
        };
      }).filter(Boolean));
      scheduleCompact();
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    stageRef.current.querySelectorAll('.board-canvas-card').forEach((element) => observer.observe(element));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); if (reflowTimer != null) clearTimeout(reflowTimer); };
  }, [bookletKey, imageUuids, board?.items, bookletRedraws]);

  const paintView = (next) => {
    if (stageRef.current) {
      stageRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
      stageRef.current.style.setProperty('--board-ui-scale', 1 / next.zoom);
    }
    if (viewportRef.current) {
      viewportRef.current.style.setProperty('--board-grid-size', `${24 * next.zoom}px`);
      viewportRef.current.style.setProperty('--board-grid-dot', `${Math.max(.55, .75 * next.zoom)}px`);
      viewportRef.current.style.setProperty('--board-grid-x', `${next.x}px`);
      viewportRef.current.style.setProperty('--board-grid-y', `${next.y}px`);
    }
  };
  const queueView = (next) => {
    viewRef.current = next;
    pendingView.current = next;
    if (viewFrame.current != null) return;
    viewFrame.current = requestAnimationFrame(() => {
      viewFrame.current = null;
      const nextView = pendingView.current;
      paintView(nextView);
      // View changes also invalidate the React tree so every card can
      // redraw viewport-dependent content. Raw input remains coalesced to
      // one update per animation frame.
      setView(nextView);
      setViewRevision((current) => current + 1);
    });
    if (viewSaveTimer.current != null) clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = setTimeout(() => {
      viewSaveTimer.current = null;
      try {
        localStorage.setItem(`papol_board_view_${activeBoardUuid.current}`, JSON.stringify(viewRef.current));
      } catch { /* storage may be disabled; the board still works */ }
    }, 250);
  };
  const zoomAt = (factor, clientX, clientY) => {
    const old = viewRef.current;
    const zoom = clamp(old.zoom * factor, 0.25, 3);
    const wx = (clientX - old.x) / old.zoom; const wy = (clientY - old.y) / old.zoom;
    queueView({ zoom, x: clientX - wx * zoom, y: clientY - wy * zoom });
  };
  useEffect(() => () => {
    if (viewFrame.current != null) cancelAnimationFrame(viewFrame.current);
    if (viewSaveTimer.current != null) {
      clearTimeout(viewSaveTimer.current);
      try {
        localStorage.setItem(`papol_board_view_${activeBoardUuid.current}`, JSON.stringify(viewRef.current));
      } catch { /* best effort on departure */ }
    }
  }, []);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      // Trackpads report two-finger movement as an ordinary wheel and a
      // pinch as a ctrl-modified wheel. Keep those two gestures distinct:
      // movement travels over the board; pinching changes its scale.
      if (!event.ctrlKey) {
        const old = viewRef.current;
        queueView({
          ...old,
          x: old.x - (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX),
          y: old.y - (event.shiftKey ? 0 : event.deltaY),
        });
        return;
      }
      const bounds = viewport.getBoundingClientRect();
      zoomAt(
        Math.exp(-event.deltaY / 90),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [Boolean(board), boardUuid]);
  useEffect(() => {
    if (!board?.can_edit) return undefined;
    const handlePaste = async (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      const images = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (images.length) {
        event.preventDefault();
        const bounds = viewportRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const origin = boardPointFromClient(
          bounds.left + bounds.width / 2, bounds.top + bounds.height / 2,
          bounds, viewRef.current, { x: 150, y: 100 },
        );
        setBusy(true); setError(null);
        try {
          const items = await Promise.all(images.map((image, index) => addBoardFile(board.uuid, image, '', {
            x: origin.x + index * 28, y: origin.y + index * 28,
          })));
          items.forEach((item) => undoStack.current.push({ type: 'add', uuid: item.uuid }));
          redoStack.current = [];
          await load();
          setSelectedItems(items.map((item) => item.uuid));
        } catch (err) { setError(err.message); } finally { setBusy(false); }
        return;
      }
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      let parsed;
      try { parsed = new URL(text); } catch { return; }
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const isYouTube = host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com';
      event.preventDefault();
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const { x, y } = boardPointFromClient(
        bounds.left + bounds.width / 2, bounds.top + bounds.height / 2,
        bounds, viewRef.current, { x: 150, y: 100 },
      );
      const loadingUuid = `${Date.now()}-${Math.random()}`;
      const loadingItem = { uuid: loadingUuid, x, y, label: isYouTube ? 'Loading video frame…' : 'Capturing webpage…' };
      urlLoadingRef.current = [...urlLoadingRef.current, loadingItem];
      setUrlLoading(urlLoadingRef.current);
      setBusy(true); setError(null);
      try {
        const item = isYouTube
          ? await addBoardYouTube(board.uuid, text, x, y)
          : await addBoardWebpage(board.uuid, text, x, y);
        const finalPosition = urlLoadingRef.current.find((candidate) => candidate.uuid === loadingUuid);
        if (finalPosition && (finalPosition.x !== x || finalPosition.y !== y)) {
          try {
            await moveBoardItem(item.uuid, finalPosition.x, finalPosition.y);
          } catch (moveError) {
            setError(moveError.message);
          }
        }
        undoStack.current.push({ type: 'add', uuid: item.uuid });
        redoStack.current = [];
        await load();
        setSelectedItems([item.uuid]);
      } catch (err) { setError(err.message); } finally {
        urlLoadingRef.current = urlLoadingRef.current.filter((item) => item.uuid !== loadingUuid);
        setUrlLoading(urlLoadingRef.current);
        setBusy(false);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [board?.uuid]);
  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('.board-canvas-card, .board-youtube-loading')) return;
    setSelectedBooklet(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...touches.current.values()];
      if (points.length === 2) {
        const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 - 55 };
        gesture.current = {
          type: 'pinch', origin: viewRef.current, center,
          distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        };
        return;
      }
    }
    if (event.pointerType === 'mouse') {
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const mode = selectionMode(event);
      const baseSelected = [...selectedItems];
      setMenuItem(null);
      if (mode === 'replace') setSelectedItems([]);
      gesture.current = { type: 'select', sx: event.clientX, sy: event.clientY, point, mode, baseSelected };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    gesture.current = { type: 'pan', sx: event.clientX, sy: event.clientY, origin: viewRef.current };
  };
  const startDrag = (event, item) => {
    if (event.button !== 0 || event.target.closest('button,a')) return;
    setSelectedBooklet(null);
    setMenuItem(null);
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    if (!board.can_edit) {
      setSelectedItems([item.uuid]);
      return;
    }
    if (selectedItems.length > 1 && selectedItems.includes(item.uuid)) {
      const memberUuids = new Set(selectedItems);
      selectedItems.forEach((uuid) => {
        const selected = board.items.find((candidate) => candidate.uuid === uuid);
        const group = board.groups.find((candidate) => candidate.uuid === selected?.group_uuid);
        group?.item_uuids.forEach((memberUuid) => memberUuids.add(memberUuid));
      });
      const members = [...memberUuids].map((uuid) => {
        const member = board.items.find((candidate) => candidate.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
        return member && element ? { uuid, x: member.x, y: member.y, element } : null;
      }).filter(Boolean);
      const groupUuids = new Set(members.map((member) => board.items.find((candidate) => candidate.uuid === member.uuid)?.group_uuid).filter((uuid) => uuid != null));
      const groups = [...groupUuids].map((uuid) => {
        const layout = bookletLayouts.find((candidate) => candidate.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-group-uuid="${uuid}"]`);
        return layout && element ? { uuid, x: layout.x, y: layout.y, element } : null;
      }).filter(Boolean);
      raiseCards(members.map((member) => member.uuid));
      gesture.current = {
        type: 'multi-item', primaryUuid: item.uuid, members, groups,
        sx: event.clientX, sy: event.clientY,
        mode: selectionMode(event), baseSelected: [...selectedItems],
      };
      return;
    }
    if (item.group_uuid != null) {
      const group = board.groups?.find((candidate) => candidate.uuid === item.group_uuid);
      if (group?.kind === 'collection') {
        raiseCards([item.uuid]);
        event.currentTarget.classList.add('booklet-reordering');
        gesture.current = {
          type: 'free-item', uuid: item.uuid, originGroupUuid: group.uuid,
          sx: event.clientX, sy: event.clientY, x: item.x, y: item.y,
          element: event.currentTarget, mode: selectionMode(event), baseSelected: [...selectedItems],
        };
        return;
      }
      const members = group?.item_uuids.map((uuid) => {
        const member = board.items.find((candidate) => candidate.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
        return member && element ? { uuid, x: member.x, y: member.y, element } : null;
      }).filter(Boolean);
      const booklet = bookletLayouts.find((candidate) => candidate.uuid === group?.uuid);
      const bookletElement = stageRef.current?.querySelector(`[data-group-uuid="${group?.uuid}"]`);
      if (group && members?.length && booklet) {
        raiseCards(members.map((member) => member.uuid));
        gesture.current = {
          type: 'booklet-move', groupUuid: group.uuid, members, booklet, bookletElement,
          clickedUuid: item.uuid, sx: event.clientX, sy: event.clientY,
          mode: selectionMode(event), baseSelected: [...selectedItems],
        };
      }
      return;
    }
    gesture.current = {
      type: 'free-item', uuid: item.uuid,
      booklet: null, bookletElement: null, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y,
      element: event.currentTarget, mode: selectionMode(event), baseSelected: [...selectedItems],
    };
    raiseCards([item.uuid]);
  };
  const startMembershipDrag = (event, item) => {
    if (event.button !== 0 || !board.can_edit) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedBooklet(null); setMenuItem(null);
    const element = stageRef.current?.querySelector(`[data-item-uuid="${item.uuid}"]`);
    if (!element) return;
    element.classList.add('booklet-reordering');
    raiseCards([item.uuid]);
    gesture.current = {
      type: 'membership-item', uuid: item.uuid, originGroupUuid: item.group_uuid || null,
      sx: event.clientX, sy: event.clientY, x: item.x, y: item.y, element,
      collectionBounds: new Map(bookletLayouts.filter((group) => group.kind === 'collection').map((group) => {
        const collection = stageRef.current?.querySelector(`[data-group-uuid="${group.uuid}"]`);
        return [group.uuid, collection?.getBoundingClientRect() || null];
      })),
    };
  };
  const startLoadingDrag = (event, item) => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { type: 'loading-item', uuid: item.uuid, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y, element: event.currentTarget };
  };
  const startResize = (event, item) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const resizeUuids = selectedItems.length > 1 && selectedItems.includes(item.uuid) ? selectedItems : [item.uuid];
    if (resizeUuids.length > 1) {
      const entries = resizeUuids.map((uuid) => {
        const candidate = board.items.find((boardItem) => boardItem.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
        return candidate && element ? { uuid, width: candidate.width || 300, element } : null;
      }).filter(Boolean);
      const groupUuids = [...new Set(entries.map((entry) => {
        const candidate = board.items.find((boardItem) => boardItem.uuid === entry.uuid);
        const group = board.groups.find((boardGroup) => boardGroup.uuid === candidate?.group_uuid);
        return group?.kind === 'booklet' ? group.uuid : null;
      }).filter((uuid) => uuid != null))];
      const beforeLayouts = new Map(groupUuids.map((groupUuid) => {
        const group = board.groups.find((candidate) => candidate.uuid === groupUuid);
        return [groupUuid, group.item_uuids.map((uuid) => {
          const member = board.items.find((candidate) => candidate.uuid === uuid);
          return { uuid, group_uuid: groupUuid, x: member.x, y: member.y };
        })];
      }));
      gesture.current = { type: 'resize-many', sx: event.clientX, entries, groupUuids, beforeLayouts };
      return;
    }
    const group = item.group_uuid ? board.groups?.find((candidate) => candidate.uuid === item.group_uuid) : null;
    const booklet = group?.kind === 'booklet' ? group : null;
    const beforePositions = booklet?.item_uuids.map((uuid) => {
      const member = board.items.find((candidate) => candidate.uuid === uuid);
      return { uuid, group_uuid: booklet.uuid, x: member.x, y: member.y };
    });
    gesture.current = {
      type: 'resize', uuid: item.uuid, sx: event.clientX,
      width: item.width || 300, element: event.currentTarget.closest('.board-canvas-card'),
      groupUuid: booklet?.uuid, beforePositions,
    };
  };
  const compactBookletPositions = (groupUuid) => {
    const group = board.groups.find((candidate) => candidate.uuid === groupUuid);
    if (!group) return null;
    const members = group.item_uuids
      .map((uuid) => board.items.find((item) => item.uuid === uuid))
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    if (!members.length) return [];
    const x = Math.min(...members.map((item) => item.x));
    let y = members[0].y;
    return members.map((item) => {
      const position = { uuid: item.uuid, group_uuid: groupUuid, x, y };
      const element = stageRef.current?.querySelector(`[data-item-uuid="${item.uuid}"]`);
      y += (element?.offsetHeight || 0) + 18;
      return position;
    });
  };
  const collectionLayout = (group, draggedUuid = null, draggedPoint = null, excludedUuid = null) => {
    const cards = group.item_uuids
      .filter((uuid) => uuid !== excludedUuid)
      .map((uuid) => {
        const item = board.items.find((candidate) => candidate.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
        if (!item || !element) return null;
        return { uuid, x: item.x, y: item.y, width: element.offsetWidth || item.width || DEFAULT_CARD_WIDTH, height: element.offsetHeight || 1 };
      }).filter(Boolean);
    if (draggedUuid != null && !cards.some((card) => card.uuid === draggedUuid)) {
      const item = board.items.find((candidate) => candidate.uuid === draggedUuid);
      const element = stageRef.current?.querySelector(`[data-item-uuid="${draggedUuid}"]`);
      if (item && element) cards.push({
        uuid: draggedUuid,
        x: cards.length ? Math.min(...cards.map((card) => card.x)) : draggedPoint.x,
        y: cards.length ? Math.min(...cards.map((card) => card.y)) : draggedPoint.y,
        width: element.offsetWidth || item.width || DEFAULT_CARD_WIDTH,
        height: element.offsetHeight || 1,
      });
    }
    const columnWidth = Math.max(DEFAULT_CARD_WIDTH, ...cards.map((card) => card.width));
    const layout = draggedUuid != null && draggedPoint
      ? collectionReorderLayout(cards, draggedUuid, draggedPoint, columnWidth)
      : collectionMasonryLayout(cards, columnWidth);
    return layout.positions.map((position) => ({ ...position, group_uuid: group.uuid }));
  };
  const settleDraggedCard = (element, position) => {
    if (!element || !position) return;
    element.classList.remove('booklet-reordering');
    element.classList.add('booklet-reorder-peer');
    element.style.transform = `translate(${position.x}px, ${position.y}px)`;
    setTimeout(() => element.classList.remove('booklet-reorder-peer'), 190);
  };
  const startBookletMove = (event, booklet) => {
    if (event.button !== 0 || !board.can_edit) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const members = booklet.item_uuids.map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
      return item && element ? { uuid, x: item.x, y: item.y, element } : null;
    }).filter(Boolean);
    if (!members.length) return;
    setSelectedBooklet(null);
    setMenuItem(null);
    gesture.current = {
      type: 'booklet-move', groupUuid: booklet.uuid, members, booklet,
      bookletElement: stageRef.current?.querySelector(`[data-group-uuid="${booklet.uuid}"]`),
      sx: event.clientX, sy: event.clientY,
    };
  };
  const clearCollectionPreview = (drag) => {
    const preview = drag?.collectionPreview;
    if (!preview) return;
    preview.members?.forEach((member) => {
      member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
      member.element.classList.remove('booklet-reorder-peer');
    });
    preview.element.style.transform = `translate(${preview.original.x}px, ${preview.original.y}px)`;
    preview.element.style.width = `${preview.original.width}px`;
    preview.element.style.height = `${preview.original.height}px`;
    preview.element.classList.remove('moving-active');
    drag.collectionPreview = null;
  };
  const showCollectionPreview = (drag, group, point) => {
    if (drag.collectionPreview?.uuid !== group.uuid) clearCollectionPreview(drag);
    const layout = bookletLayouts.find((candidate) => candidate.uuid === group.uuid);
    const element = stageRef.current?.querySelector(`[data-group-uuid="${group.uuid}"]`);
    if (!layout || !element) return;
    const members = [...new Set([...group.item_uuids, drag.uuid])].map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      const card = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
      if (!item || !card) return null;
      return { uuid, x: item.x, y: item.y, width: card.offsetWidth || item.width || 300, height: card.offsetHeight || 1 };
    }).filter(Boolean);
    if (!group.item_uuids.includes(drag.uuid) && members.length > 1) {
      const dragged = members.find((member) => member.uuid === drag.uuid);
      const peers = members.filter((member) => member.uuid !== drag.uuid);
      dragged.x = Math.min(...peers.map((member) => member.x));
      dragged.y = Math.min(...peers.map((member) => member.y));
    }
    let displayMembers = members;
    if (group.auto_arrange) {
      const columnWidth = Math.max(DEFAULT_CARD_WIDTH, ...members.map((member) => member.width));
      const positions = new Map(collectionReorderLayout(members, drag.uuid, point, columnWidth).positions.map((position) => [position.uuid, position]));
      displayMembers = members.map((member) => ({ ...member, ...positions.get(member.uuid) }));
      const peers = members.filter((member) => member.uuid !== drag.uuid).map((member) => ({
        ...member, element: stageRef.current?.querySelector(`[data-item-uuid="${member.uuid}"]`),
      })).filter((member) => member.element);
      if (!drag.collectionPreview) drag.collectionPreview = { uuid: group.uuid, element, original: layout, members: peers };
      const previewPeers = new Map(drag.collectionPreview.members.map((member) => [member.uuid, member]));
      peers.forEach((member) => {
        const peer = previewPeers.get(member.uuid);
        if (!peer) drag.collectionPreview.members.push(member);
        const position = positions.get(member.uuid);
        member.element.classList.add('booklet-reorder-peer');
        member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
      });
    }
    const minX = Math.min(...displayMembers.map((member) => member.x));
    const minY = Math.min(...displayMembers.map((member) => member.y));
    const maxRight = Math.max(...displayMembers.map((member) => member.x + member.width));
    const maxBottom = Math.max(...displayMembers.map((member) => member.y + member.height));
    const next = {
      x: minX - COLLECTION_INSET_X,
      y: minY - COLLECTION_CARD_OFFSET_Y,
      width: maxRight - minX + COLLECTION_INSET_X * 2,
      height: maxBottom - minY + COLLECTION_CARD_OFFSET_Y + COLLECTION_INSET_BOTTOM,
    };
    if (!drag.collectionPreview) drag.collectionPreview = { uuid: group.uuid, element, original: layout, members: [] };
    element.style.transform = `translate(${next.x}px, ${next.y}px)`;
    element.style.width = `${next.width}px`;
    element.style.height = `${next.height}px`;
    element.classList.add('moving-active');
  };
  const clearOriginCollectionPreview = (drag) => {
    const preview = drag?.originCollectionPreview;
    if (!preview) return;
    preview.members?.forEach((member) => {
      member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
      member.element.classList.remove('booklet-reorder-peer');
    });
    preview.element.style.transform = `translate(${preview.original.x}px, ${preview.original.y}px)`;
    preview.element.style.width = `${preview.original.width}px`;
    preview.element.style.height = `${preview.original.height}px`;
    preview.element.style.opacity = '';
    preview.element.classList.remove('moving-active');
    drag.originCollectionPreview = null;
  };
  const showOriginCollectionPreview = (drag, group) => {
    if (drag.originCollectionPreview) return;
    const layout = bookletLayouts.find((candidate) => candidate.uuid === group.uuid);
    const element = stageRef.current?.querySelector(`[data-group-uuid="${group.uuid}"]`);
    if (!layout || !element) return;
    const members = group.item_uuids.filter((uuid) => uuid !== drag.uuid).map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      const card = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
      return item && card ? { ...item, width: card.offsetWidth || item.width || 300, height: card.offsetHeight || 1 } : null;
    }).filter(Boolean);
    const previewMembers = members.map((member) => ({
      ...member, element: stageRef.current?.querySelector(`[data-item-uuid="${member.uuid}"]`),
    })).filter((member) => member.element);
    drag.originCollectionPreview = { element, original: layout, members: previewMembers };
    element.classList.add('moving-active');
    if (!members.length) { element.style.opacity = '.35'; return; }
    let displayMembers = members;
    if (group.auto_arrange) {
      const columnWidth = Math.max(DEFAULT_CARD_WIDTH, ...members.map((member) => member.width));
      const positions = new Map(collectionMasonryLayout(members, columnWidth).positions.map((position) => [position.uuid, position]));
      displayMembers = members.map((member) => ({ ...member, ...positions.get(member.uuid) }));
      previewMembers.forEach((member) => {
        const position = positions.get(member.uuid);
        member.element.classList.add('booklet-reorder-peer');
        member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
      });
    }
    const minX = Math.min(...displayMembers.map((member) => member.x));
    const minY = Math.min(...displayMembers.map((member) => member.y));
    const maxRight = Math.max(...displayMembers.map((member) => member.x + member.width));
    const maxBottom = Math.max(...displayMembers.map((member) => member.y + member.height));
    element.style.transform = `translate(${minX - COLLECTION_INSET_X}px, ${minY - COLLECTION_CARD_OFFSET_Y}px)`;
    element.style.width = `${maxRight - minX + COLLECTION_INSET_X * 2}px`;
    element.style.height = `${maxBottom - minY + COLLECTION_CARD_OFFSET_Y + COLLECTION_INSET_BOTTOM}px`;
  };
  const clearMembershipBookletPreview = (drag) => {
    const preview = drag?.membershipBookletPreview;
    if (!preview) return;
    preview.members.forEach((member) => {
      member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
      member.element.classList.remove('booklet-reorder-peer');
    });
    if (preview.bookletElement) preview.bookletElement.style.height = `${preview.originalHeight}px`;
    drag.membershipBookletPreview = null;
  };
  const showMembershipBookletPreview = (drag, group, point, insertionY) => {
    const layout = bookletLayouts.find((candidate) => candidate.uuid === group.uuid);
    if (!layout) return;
    const members = group.item_uuids.filter((uuid) => uuid !== drag.uuid).map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
      return item && element ? { uuid, x: item.x, y: item.y, height: element.offsetHeight, element } : null;
    }).filter(Boolean);
    const height = drag.element.offsetHeight || 1;
    const anchor = group.uuid === drag.originGroupUuid
      ? group.item_uuids.map((uuid) => board.items.find((item) => item.uuid === uuid)).filter(Boolean).reduce((result, item) => ({
        x: Math.min(result.x, item.x), y: Math.min(result.y, item.y),
      }), { x: Infinity, y: Infinity })
      : null;
    const after = stackWithInsertion(members, {
      uuid: drag.uuid, x: point.x, y: point.y, height, centerY: insertionY,
    }, group.uuid, anchor).positions;
    const signature = `${group.uuid}:${after.map((position) => position.uuid).join(',')}`;
    if (drag.membershipBookletPreview?.signature === signature) return;
    clearMembershipBookletPreview(drag);
    const positions = new Map(after.map((position) => [position.uuid, position]));
    members.forEach((member) => {
      const position = positions.get(member.uuid);
      member.element.classList.add('booklet-reorder-peer');
      member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
    });
    const bookletElement = stageRef.current?.querySelector(`[data-group-uuid="${group.uuid}"]`);
    const heights = new Map([...members.map((member) => [member.uuid, member.height]), [drag.uuid, height]]);
    if (bookletElement) bookletElement.style.height = `${previewBookletHeight(layout.y, after, heights)}px`;
    drag.membershipBookletPreview = { groupUuid: group.uuid, members, after, bookletElement, originalHeight: layout.height, signature };
  };
  const clearOriginBookletPreview = (drag) => {
    const preview = drag?.originBookletPreview;
    if (!preview) return;
    preview.members.forEach((member) => {
      member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
      member.element.classList.remove('booklet-reorder-peer');
    });
    if (preview.bookletElement) preview.bookletElement.style.height = `${preview.originalHeight}px`;
    drag.originBookletPreview = null;
  };
  const showOriginBookletPreview = (drag, group) => {
    if (drag.originBookletPreview) return;
    const layout = bookletLayouts.find((candidate) => candidate.uuid === group.uuid);
    if (!layout) return;
    const allMembers = group.item_uuids.map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
      return item && element ? { uuid, x: item.x, y: item.y, height: element.offsetHeight, element } : null;
    }).filter(Boolean);
    const members = allMembers.filter((member) => member.uuid !== drag.uuid);
    const after = stackWithout(allMembers, drag.uuid, group.uuid);
    const positions = new Map(after.map((position) => [position.uuid, position]));
    members.forEach((member) => {
      const position = positions.get(member.uuid);
      member.element.classList.add('booklet-reorder-peer');
      member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
    });
    const bookletElement = stageRef.current?.querySelector(`[data-group-uuid="${group.uuid}"]`);
    const heights = new Map(members.map((member) => [member.uuid, member.height]));
    if (bookletElement) bookletElement.style.height = `${previewBookletHeight(layout.y, after, heights)}px`;
    drag.originBookletPreview = { members, after, bookletElement, originalHeight: layout.height };
  };
  const move = (event) => {
    const g = gesture.current; if (!g) return;
    const registerDragMovement = () => {
      const moved = exceedsDragThreshold(g.sx, g.sy, event.clientX, event.clientY);
      if (moved && !g.moved) {
        const draggedUuid = g.uuid ?? g.clickedUuid ?? g.primaryUuid;
        if (draggedUuid != null) setDraggingGrip(draggedUuid);
        setSelectedBooklet(null);
        setMenuItem(null);
      }
      g.moved = g.moved || moved;
    };
    if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (g.type === 'pinch') {
      const points = [...touches.current.values()]; if (points.length < 2) return;
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 - 55 };
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const pinchRatio = distance / Math.max(g.distance, 1);
      const zoom = clamp(g.origin.zoom * Math.pow(pinchRatio, 1.6), 0.25, 3);
      const wx = (g.center.x - g.origin.x) / g.origin.zoom;
      const wy = (g.center.y - g.origin.y) / g.origin.zoom;
      queueView({ zoom, x: center.x - wx * zoom, y: center.y - wy * zoom });
    } else if (g.type === 'select') {
      const dx = event.clientX - g.sx; const dy = event.clientY - g.sy;
      g.current = { clientX: event.clientX, clientY: event.clientY };
      setMarquee({ x: g.point.x + Math.min(0, dx), y: g.point.y + Math.min(0, dy), width: Math.abs(dx), height: Math.abs(dy) });
      const x1 = Math.min(g.sx, event.clientX); const y1 = Math.min(g.sy, event.clientY);
      const x2 = Math.max(g.sx, event.clientX); const y2 = Math.max(g.sy, event.clientY);
      const hitUuids = [...viewportRef.current.querySelectorAll('.board-canvas-card')]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left <= x2 && rect.right >= x1 && rect.top <= y2 && rect.bottom >= y1;
        })
        .map((card) => card.dataset.itemUuid);
      setSelectedItems(mergeSelection(g.baseSelected, hitUuids, g.mode));
    } else if (g.type === 'pan') queueView({ ...g.origin, x: g.origin.x + event.clientX - g.sx, y: g.origin.y + event.clientY - g.sy });
    else if (g.type === 'booklet-move') {
      const dx = (event.clientX - g.sx) / viewRef.current.zoom;
      const dy = (event.clientY - g.sy) / viewRef.current.zoom;
      g.current = { dx, dy };
      registerDragMovement();
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x + dx}px, ${member.y + dy}px)`; });
      if (g.bookletElement) g.bookletElement.style.transform = `translate(${g.booklet.x + dx}px, ${g.booklet.y + dy}px)`;
    }
    else if (g.type === 'multi-item') {
      const dx = (event.clientX - g.sx) / viewRef.current.zoom;
      const dy = (event.clientY - g.sy) / viewRef.current.zoom;
      g.current = { dx, dy };
      registerDragMovement();
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x + dx}px, ${member.y + dy}px)`; });
      g.groups.forEach((group) => { group.element.style.transform = `translate(${group.x + dx}px, ${group.y + dy}px)`; });
    }
    else if (g.type === 'free-item' || g.type === 'loading-item' || g.type === 'membership-item') {
      const zoom = viewRef.current.zoom;
      g.current = { x: g.x + (event.clientX - g.sx) / zoom, y: g.y + (event.clientY - g.sy) / zoom };
      registerDragMovement();
      g.element.style.transform = `translate(${g.current.x}px, ${g.current.y}px)`;
      if (g.type === 'membership-item') {
        const cardWidth = g.element.offsetWidth || 300;
        const cardHeight = g.element.offsetHeight || 1;
        const center = cardCenter(g.current, cardWidth, cardHeight);
        const viewportRect = viewportRef.current.getBoundingClientRect();
        const pointer = boardPointFromClient(event.clientX, event.clientY, viewportRect, viewRef.current);
        const pointerX = pointer.x;
        g.insertionY = pointer.y;
        const collectionTarget = bookletLayouts.find((group) => {
          if (group.kind !== 'collection') return false;
          const rect = g.collectionBounds.get(group.uuid);
          if (!rect) return false;
          const outlineTop = rect.top + 76 * zoom;
          return event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= outlineTop && event.clientY <= rect.bottom;
        });
        const originBooklet = bookletLayouts.find((group) => group.kind === 'booklet' && group.uuid === g.originGroupUuid);
        const staysInOriginBooklet = originBooklet && pointerX >= originBooklet.x && pointerX <= originBooklet.x + originBooklet.width;
        const bookletTarget = staysInOriginBooklet ? originBooklet : bookletLayouts.find((group) => group.kind === 'booklet' && group.uuid !== g.originGroupUuid
          && center.x >= group.x && center.x <= group.x + group.width
          && center.y >= group.y && center.y <= group.y + group.height);
        g.dropGroupUuid = collectionTarget?.uuid || bookletTarget?.uuid || null;
        setDropBooklet(g.dropGroupUuid);
        const target = board.groups.find((group) => group.uuid === g.dropGroupUuid);
        const origin = board.groups.find((group) => group.uuid === g.originGroupUuid);
        if (origin?.kind === 'booklet' && target?.uuid !== origin.uuid) showOriginBookletPreview(g, origin);
        else clearOriginBookletPreview(g);
        if (origin?.kind === 'collection' && target?.uuid !== origin.uuid) showOriginCollectionPreview(g, origin);
        else clearOriginCollectionPreview(g);
        if (target?.kind === 'collection') {
          clearMembershipBookletPreview(g);
          showCollectionPreview(g, target, g.current);
        } else if (target?.kind === 'booklet') {
          clearCollectionPreview(g);
          showMembershipBookletPreview(g, target, g.current, g.insertionY);
        } else {
          clearCollectionPreview(g);
          clearMembershipBookletPreview(g);
        }
      } else if (g.type === 'free-item' && g.originGroupUuid) {
        const group = board.groups.find((candidate) => candidate.uuid === g.originGroupUuid);
        if (group?.kind === 'collection') showCollectionPreview(g, group, g.current);
      }
      if (g.type === 'loading-item') {
        urlLoadingRef.current = urlLoadingRef.current.map((item) => item.uuid === g.uuid ? { ...item, ...g.current } : item);
      }
    } else if (g.type === 'resize') {
      g.current = clamp(g.width + (event.clientX - g.sx) / viewRef.current.zoom, 120, 1200);
      g.element.style.width = `${g.current}px`;
    } else if (g.type === 'resize-many') {
      const delta = (event.clientX - g.sx) / viewRef.current.zoom;
      g.current = g.entries.map((entry) => ({ ...entry, nextWidth: clamp(entry.width + delta, 120, 1200) }));
      g.current.forEach((entry) => { entry.element.style.width = `${entry.nextWidth}px`; });
    }
  };
  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    setDraggingGrip(null);
    setDropBooklet(null);
    setMarquee(null);
    touches.current.clear();
    if (!g) return;
    if (g.type === 'free-item' || g.type === 'loading-item' || g.type === 'membership-item') {
      clearCollectionPreview(g);
      clearOriginCollectionPreview(g);
      clearMembershipBookletPreview(g);
      clearOriginBookletPreview(g);
      g.element.style.transform = `translate(${g.x}px, ${g.y}px)`;
      g.element.classList.remove('booklet-reordering');
    } else if (g.type === 'booklet-move') {
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
      if (g.bookletElement) g.bookletElement.style.transform = `translate(${g.booklet.x}px, ${g.booklet.y}px)`;
    } else if (g.type === 'multi-item') {
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
      g.groups.forEach((group) => { group.element.style.transform = `translate(${group.x}px, ${group.y}px)`; });
    } else if (g.type === 'resize') {
      g.element.style.width = `${g.width}px`;
    } else if (g.type === 'resize-many') {
      g.entries.forEach((entry) => { entry.element.style.width = `${entry.width}px`; });
    }
  };
  const endGesture = (event) => {
    const g = gesture.current; gesture.current = null;
    setDraggingGrip(null);
    setDropBooklet(null);
    if (g?.type === 'membership-item') {
      const membershipPeers = [...(g.membershipBookletPreview?.members || []), ...(g.collectionPreview?.members || [])];
      const originPeers = [...(g.originBookletPreview?.members || []), ...(g.originCollectionPreview?.members || [])];
      setTimeout(() => [...membershipPeers, ...originPeers].forEach((member) => member.element.classList.remove('booklet-reorder-peer')), 190);
      g.element.classList.remove('booklet-reordering');
      const item = board.items.find((candidate) => candidate.uuid === g.uuid);
      const point = g.current || { x: g.x, y: g.y };
      const target = board.groups.find((group) => group.uuid === g.dropGroupUuid) || null;
      const origin = board.groups.find((group) => group.uuid === g.originGroupUuid) || null;
      const saveMembership = async () => {
        let targetLayout = null;
        if (target?.kind === 'booklet') {
          const members = target.item_uuids.filter((uuid) => uuid !== item.uuid).map((uuid) => {
            const member = board.items.find((candidate) => candidate.uuid === uuid);
            const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
            return member && element ? { uuid, x: member.x, y: member.y, height: element.offsetHeight } : null;
          }).filter(Boolean);
          const anchor = target.uuid === origin?.uuid
            ? origin.item_uuids.map((uuid) => board.items.find((candidate) => candidate.uuid === uuid)).filter(Boolean).reduce((result, member) => ({
              x: Math.min(result.x, member.x), y: Math.min(result.y, member.y),
            }), { x: Infinity, y: Infinity })
            : null;
          targetLayout = g.membershipBookletPreview?.groupUuid === target.uuid
            ? g.membershipBookletPreview.after
            : stackWithInsertion(members, {
              uuid: item.uuid, x: point.x, y: point.y, height: g.element.offsetHeight || 1,
              centerY: g.insertionY ?? point.y + (g.element.offsetHeight || 1) / 2,
            }, target.uuid, anchor).positions;
        }
        if (target?.kind === 'collection' && target.auto_arrange) {
          targetLayout = collectionLayout(target, item.uuid, point);
        }
        let originLayout = null;
        if (origin?.kind === 'booklet' && origin.uuid !== target?.uuid) {
          const members = origin.item_uuids.map((uuid) => {
            const member = board.items.find((candidate) => candidate.uuid === uuid);
            const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
            return member && element ? { uuid, x: member.x, y: member.y, height: element.offsetHeight } : null;
          }).filter(Boolean);
          originLayout = stackWithout(members, item.uuid, origin.uuid);
        }
        if (origin?.kind === 'collection' && origin.auto_arrange && origin.uuid !== target?.uuid) {
          originLayout = collectionLayout(origin, null, null, item.uuid);
        }
        const destination = targetLayout?.find((position) => position.uuid === item.uuid) || point;
        if (target?.auto_arrange) settleDraggedCard(g.element, destination);
        const history = membershipHistorySnapshots(
          board.items, item.uuid, target?.uuid, destination, originLayout || [], targetLayout || [],
        );
        await updateBoardItem(item.uuid, { group_uuid: target?.uuid || null, x: destination.x, y: destination.y });
        if (originLayout?.length) await layoutBoardGroup(origin.uuid, originLayout);
        if (targetLayout) await layoutBoardGroup(target.uuid, targetLayout);
        undoStack.current.push({ type: 'membership', ...history });
        redoStack.current = [];
        await load();
        redrawBooklets([
          origin?.kind === 'booklet' ? origin.uuid : null,
          target?.kind === 'booklet' ? target.uuid : null,
        ]);
      };
      if (item && g.moved) {
        g.collectionPreview?.element.classList.remove('moving-active');
        g.originCollectionPreview?.element.classList.remove('moving-active');
        setBusy(true);
        saveMembership()
          .catch((err) => { setError(err.message); load(); })
          .finally(() => setBusy(false));
      } else {
        clearCollectionPreview(g);
        clearOriginCollectionPreview(g);
        clearMembershipBookletPreview(g);
        clearOriginBookletPreview(g);
        g.element.style.transform = `translate(${g.x}px, ${g.y}px)`;
      }
    }
    if (g?.type === 'free-item') {
      g.element.classList.remove('booklet-reordering');
      g.collectionPreview?.element.classList.remove('moving-active');
      const point = g.current || { x: g.x, y: g.y };
      if (g.moved) {
        const group = board.groups.find((candidate) => candidate.uuid === g.originGroupUuid);
        if (group?.kind === 'collection' && group.auto_arrange) {
          const layout = collectionLayout(group, g.uuid, point);
          const positions = new Map(layout.map((position) => [position.uuid, position]));
          const destination = layout.find((position) => position.uuid === g.uuid);
          settleDraggedCard(g.element, destination);
          const history = membershipHistorySnapshots(board.items, g.uuid, group.uuid, destination, [], layout);
          undoStack.current.push({ type: 'membership', ...history });
          redoStack.current = [];
          setBoard((current) => ({ ...current, items: current.items.map((item) => positions.has(item.uuid) ? { ...item, ...positions.get(item.uuid) } : item) }));
          setTimeout(() => g.collectionPreview?.members?.forEach((member) => member.element.classList.remove('booklet-reorder-peer')), 190);
          setBusy(true);
          layoutBoardGroup(group.uuid, layout).then(load).catch((err) => { setError(err.message); load(); }).finally(() => setBusy(false));
        } else {
          undoStack.current.push({ type: 'move', uuid: g.uuid, from: { x: g.x, y: g.y }, to: point });
          redoStack.current = [];
          setBoard((current) => ({ ...current, items: current.items.map((item) => item.uuid === g.uuid ? { ...item, ...point } : item) }));
          moveBoardItem(g.uuid, point.x, point.y).catch((err) => { setError(err.message); load(); });
        }
      } else {
        g.element.style.transform = `translate(${g.x}px, ${g.y}px)`;
        setSelectedItems(mergeSelection(g.baseSelected, [g.uuid], g.mode));
      }
    }
    if (g?.type === 'booklet-move') {
      const { dx = 0, dy = 0 } = g.current || {};
      if (g.moved) {
        suppressBookletClick.current = g.groupUuid;
        setSelectedBooklet(null);
        setMenuItem(null);
        undoStack.current.push({ type: 'group-move', uuid: g.groupUuid, dx, dy });
        redoStack.current = [];
        const ids = new Set(g.members.map((member) => member.uuid));
        setBoard((current) => ({ ...current, items: current.items.map((item) => ids.has(item.uuid) ? { ...item, x: item.x + dx, y: item.y + dy } : item) }));
        moveBoardGroup(g.groupUuid, dx, dy).catch((err) => { setError(err.message); load(); });
      } else {
        g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
        if (g.bookletElement) g.bookletElement.style.transform = `translate(${g.booklet.x}px, ${g.booklet.y}px)`;
        if (g.clickedUuid != null) {
          setSelectedItems(mergeSelection(g.baseSelected, [g.clickedUuid], g.mode));
          setSelectedBooklet(null);
          setMenuItem(null);
        }
      }
    }
    if (g?.type === 'multi-item') {
      const { dx = 0, dy = 0 } = g.current || {};
      if (g.moved) {
        const moves = g.members.map((member) => ({ uuid: member.uuid, from: { x: member.x, y: member.y }, to: { x: member.x + dx, y: member.y + dy } }));
        undoStack.current.push({ type: 'move-many', moves });
        redoStack.current = [];
        const positions = new Map(moves.map((move) => [move.uuid, move.to]));
        setBoard((current) => ({ ...current, items: current.items.map((item) => positions.has(item.uuid) ? { ...item, ...positions.get(item.uuid) } : item) }));
        Promise.all(moves.map((move) => moveBoardItem(move.uuid, move.to.x, move.to.y))).catch((err) => { setError(err.message); load(); });
      } else {
        g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
        g.groups.forEach((group) => { group.element.style.transform = `translate(${group.x}px, ${group.y}px)`; });
        if (g.mode === 'toggle') setSelectedItems(mergeSelection(g.baseSelected, [g.primaryUuid], g.mode));
      }
    }
    if (event?.pointerType === 'touch') {
      touches.current.delete(event.pointerId);
      const remaining = [...touches.current.values()][0];
      if (remaining) gesture.current = { type: 'pan', sx: remaining.x, sy: remaining.y, origin: viewRef.current };
    }
    if (g?.type === 'loading-item') {
      const point = g.current || { x: g.x, y: g.y };
      urlLoadingRef.current = urlLoadingRef.current.map((item) => item.uuid === g.uuid ? { ...item, ...point } : item);
      setUrlLoading(urlLoadingRef.current);
    }
    if (g?.type === 'resize') {
      const width = g.current ?? g.width;
      if (Math.abs(width - g.width) > 1) {
        const afterPositions = g.groupUuid ? compactBookletPositions(g.groupUuid) : null;
        undoStack.current.push({ type: 'resize', uuid: g.uuid, from: g.width, to: width, groupUuid: g.groupUuid, beforePositions: g.beforePositions, afterPositions });
        redoStack.current = [];
        const positions = new Map(afterPositions?.map((position) => [position.uuid, position]));
        setBoard((current) => ({ ...current, items: current.items.map((item) => ({
          ...item,
          ...(item.uuid === g.uuid ? { width } : {}),
          ...(positions?.get(item.uuid) || {}),
        })) }));
        Promise.all([
          updateBoardItem(g.uuid, { width }),
          ...(g.groupUuid ? [layoutBoardGroup(g.groupUuid, afterPositions)] : []),
        ]).catch((err) => { setError(err.message); load(); });
      }
    }
    if (g?.type === 'resize-many') {
      const resized = g.current || g.entries.map((entry) => ({ ...entry, nextWidth: entry.width }));
      const changes = resized
        .filter((entry) => Math.abs(entry.nextWidth - entry.width) > 1)
        .map((entry) => ({ uuid: entry.uuid, from: entry.width, to: entry.nextWidth }));
      if (changes.length) {
        const layouts = g.groupUuids.map((groupUuid) => ({
          uuid: groupUuid,
          before: g.beforeLayouts.get(groupUuid),
          after: compactBookletPositions(groupUuid),
        }));
        const positions = new Map(layouts.flatMap((layout) => layout.after).map((position) => [position.uuid, position]));
        undoStack.current.push({ type: 'resize-selection', changes, layouts });
        redoStack.current = [];
        const widths = new Map(changes.map((change) => [change.uuid, change.to]));
        setBoard((current) => ({ ...current, items: current.items.map((candidate) => ({
          ...candidate,
          ...(widths.has(candidate.uuid) ? { width: widths.get(candidate.uuid) } : {}),
          ...(positions.get(candidate.uuid) || {}),
        })) }));
        Promise.all([
          ...changes.map((change) => updateBoardItem(change.uuid, { width: change.to })),
          ...layouts.map((layout) => layoutBoardGroup(layout.uuid, layout.after)),
        ]).catch((err) => { setError(err.message); load(); });
      }
    }
    if (g?.type === 'select') {
      const x1 = Math.min(g.sx, g.current?.clientX ?? g.sx);
      const y1 = Math.min(g.sy, g.current?.clientY ?? g.sy);
      const x2 = Math.max(g.sx, g.current?.clientX ?? g.sx);
      const y2 = Math.max(g.sy, g.current?.clientY ?? g.sy);
      if (x2 - x1 > 3 || y2 - y1 > 3) {
        const cards = [...viewportRef.current.querySelectorAll('.board-canvas-card')];
        const hits = cards.filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left <= x2 && rect.right >= x1 && rect.top <= y2 && rect.bottom >= y1;
        });
        setSelectedItems(mergeSelection(g.baseSelected, hits.map((card) => card.dataset.itemUuid), g.mode));
      } else if (g.mode === 'replace') {
        setSelectedItems([]);
      }
      setMarquee(null);
    }
  };
  const removeItem = async (item, ask = true) => {
    if (ask && !(await confirmAction('Remove this card?', { confirmLabel: 'Remove', destructive: true }))) return;
    setBusy(true); setError(null);
    try {
      await deleteBoardItem(item.uuid);
      undoStack.current.push({ type: 'delete', uuid: item.uuid });
      redoStack.current = [];
      setSelectedItems([]);
      setMenuItem(null);
      setBoard((current) => ({
        ...current,
        item_count: Math.max(0, current.item_count - 1),
        items: current.items.filter((candidate) => candidate.uuid !== item.uuid),
      }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveDescription = async (item) => {
    setBusy(true); setError(null);
    try {
      const updated = await updateBoardItem(item.uuid, { content: descriptionDraft });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.uuid === item.uuid ? updated : candidate) }));
      setEditingDescription(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const removeItems = async (itemUuids) => {
    if (!itemUuids.length) return;
    const ids = [...itemUuids];
    setBusy(true); setError(null);
    try {
      await Promise.all(ids.map(deleteBoardItem));
      undoStack.current.push({ type: 'delete-many', ids });
      redoStack.current = [];
      setSelectedItems([]);
      setBoard((current) => ({
        ...current,
        item_count: Math.max(0, current.item_count - ids.length),
        items: current.items.filter((item) => !ids.includes(item.uuid)),
      }));
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const removeSelectedItems = () => removeItems(selectedItems);
  const saveText = async (item) => {
    setBusy(true); setError(null);
    try {
      const updated = await updateBoardItem(item.uuid, { content: textDraft });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.uuid === item.uuid ? updated : candidate) }));
      setEditingText(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const alignText = async (item, textAlign) => {
    try {
      const updated = await updateBoardItem(item.uuid, { text_align: textAlign });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.uuid === item.uuid ? updated : candidate) }));
    } catch (err) { setError(err.message); }
  };
  const groupAsBooklet = async (itemUuids = selectedItems) => {
    if (itemUuids.some((uuid) => board.items.find((item) => item.uuid === uuid)?.group_uuid != null)) return;
    setBusy(true); setError(null);
    try {
      const previous = itemUuids.map((uuid) => {
        const item = board.items.find((candidate) => candidate.uuid === uuid);
        return { uuid, group_uuid: item.group_uuid || null, x: item.x, y: item.y };
      });
      const group = await createBoardGroup(board.uuid, { kind: 'booklet', title: '', item_uuids: itemUuids });
      undoStack.current.push({ type: 'group', kind: 'booklet', uuid: group.uuid, boardUuid: board.uuid, title: '', header: '', itemUuids: [...itemUuids], previous });
      redoStack.current = [];
      setSelectedItems([]);
      await load();
      setBookletTitleDraft('');
      setEditingBooklet(group.uuid);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const groupAsCollection = async (itemUuids = selectedItems) => {
    if (itemUuids.some((uuid) => board.items.find((item) => item.uuid === uuid)?.group_uuid != null)) return;
    setBusy(true); setError(null);
    try {
      const previous = itemUuids.map((uuid) => {
        const item = board.items.find((candidate) => candidate.uuid === uuid);
        return { uuid, group_uuid: null, x: item.x, y: item.y };
      });
      const group = await createBoardGroup(board.uuid, { kind: 'collection', title: '', item_uuids: itemUuids });
      undoStack.current.push({ type: 'group', kind: 'collection', uuid: group.uuid, boardUuid: board.uuid, title: '', header: '', itemUuids: [...itemUuids], previous });
      redoStack.current = [];
      setSelectedItems([]);
      await load();
      setBookletTitleDraft('');
      setEditingBooklet(group.uuid);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const ungroupBooklet = async (booklet) => {
    const items = booklet.item_uuids.map((uuid) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      return { uuid, group_uuid: null, x: item.x, y: item.y };
    });
    setBusy(true); setError(null);
    try {
      await ungroupBoardGroup(booklet.uuid, items);
      undoStack.current.push({
        type: 'ungroup', kind: booklet.kind, uuid: booklet.uuid, boardUuid: board.uuid,
        title: booklet.title, header: booklet.header, autoArrange: booklet.auto_arrange,
        itemUuids: [...booklet.item_uuids], items,
      });
      redoStack.current = [];
      setSelectedBooklet(null);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const tidyItems = async (itemUuids) => {
    const ids = new Set(itemUuids);
    const items = board.items.filter((item) => ids.has(item.uuid));
    if (!items.length) return;
    const width = DEFAULT_CARD_WIDTH;
    const changes = items.map((item) => ({ uuid: item.uuid, from: item.width || DEFAULT_CARD_WIDTH, to: width, fromX: item.x, fromY: item.y }));
    const positions = new Map();
    board.groups.filter((group) => group.kind === 'collection' && group.item_uuids.every((uuid) => ids.has(uuid))).forEach((group) => {
      const cards = group.item_uuids.map((uuid) => {
        const item = board.items.find((candidate) => candidate.uuid === uuid);
        const element = stageRef.current?.querySelector(`[data-item-uuid="${uuid}"]`);
        return item && element ? { uuid, x: item.x, y: item.y, width, height: element.offsetHeight } : null;
      }).filter(Boolean);
      tidyCollectionPositions(cards).forEach((position) => positions.set(position.uuid, position));
    });
    changes.forEach((change) => {
      const position = positions.get(change.uuid);
      change.toX = position?.x ?? change.fromX;
      change.toY = position?.y ?? change.fromY;
    });
    if (changes.every((change) => change.from === change.to) && [...positions].every(([uuid, position]) => {
      const item = board.items.find((candidate) => candidate.uuid === uuid);
      return item.x === position.x && item.y === position.y;
    })) return;
    setBusy(true); setError(null);
    try {
      await Promise.all(changes.map((change) => updateBoardItem(change.uuid, { width: change.to, ...(positions.get(change.uuid) || {}) })));
      undoStack.current.push({ type: 'resize-many', changes });
      redoStack.current = [];
      setBoard((current) => ({ ...current, items: current.items.map((item) => ids.has(item.uuid) ? { ...item, width, ...(positions.get(item.uuid) || {}) } : item) }));
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const tidySelectedItems = () => tidyItems(selectedItems);
  const tidyBoard = () => tidyItems(board.items.map((item) => item.uuid));
  const tidyCollection = async (collection) => {
    const members = collection.item_uuids.map((uuid) => board.items.find((item) => item.uuid === uuid)).filter(Boolean);
    if (!members.length) return;
    const changes = members.map((item) => ({
      uuid: item.uuid, from: item.width || DEFAULT_CARD_WIDTH, to: DEFAULT_CARD_WIDTH,
      fromX: item.x, fromY: item.y,
    }));
    members.forEach((item) => {
      const element = stageRef.current?.querySelector(`[data-item-uuid="${item.uuid}"]`);
      if (element) element.style.width = `${DEFAULT_CARD_WIDTH}px`;
    });
    const cards = members.map((item) => {
      const element = stageRef.current?.querySelector(`[data-item-uuid="${item.uuid}"]`);
      return { uuid: item.uuid, x: item.x, y: item.y, height: element?.offsetHeight || 1 };
    });
    const { positions } = collectionMasonryLayout(cards);
    const positionsByUuid = new Map(positions.map((position) => [position.uuid, position]));
    changes.forEach((change) => {
      const position = positionsByUuid.get(change.uuid);
      change.toX = position.x; change.toY = position.y;
    });
    setBusy(true); setError(null);
    try {
      await Promise.all(changes.map((change) => updateBoardItem(change.uuid, {
        width: change.to, x: change.toX, y: change.toY,
      })));
      undoStack.current.push({ type: 'resize-many', changes });
      redoStack.current = [];
      setBoard((current) => ({ ...current, items: current.items.map((item) => {
        const position = positionsByUuid.get(item.uuid);
        return position ? { ...item, width: DEFAULT_CARD_WIDTH, ...position } : item;
      }) }));
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const toggleCollectionAutoArrange = async (collection) => {
    const enabled = !collection.auto_arrange;
    setBusy(true); setError(null);
    try {
      const updated = await updateBoardGroup(collection.uuid, { auto_arrange: enabled });
      if (enabled) {
        const layout = collectionLayout(collection);
        if (layout.length) await layoutBoardGroup(collection.uuid, layout);
      }
      setBoard((current) => ({ ...current, groups: current.groups.map((group) => group.uuid === collection.uuid ? updated : group) }));
      await load();
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const saveBookletTitle = async (booklet) => {
    setEditingBooklet(null);
    try {
      const updated = await updateBoardGroup(booklet.uuid, { title: bookletTitleDraft });
      for (let index = undoStack.current.length - 1; index >= 0; index -= 1) {
        const action = undoStack.current[index];
        if (action.type === 'group' && action.uuid === booklet.uuid) { action.title = updated.title; break; }
      }
      setBoard((current) => ({ ...current, groups: current.groups.map((group) => group.uuid === booklet.uuid ? updated : group) }));
    } catch (err) { setError(err.message); }
  };
  const saveBookletHeader = async (booklet) => {
    setEditingBookletHeader(null);
    try {
      const updated = await updateBoardGroup(booklet.uuid, { header: bookletHeaderDraft });
      for (let index = undoStack.current.length - 1; index >= 0; index -= 1) {
        const action = undoStack.current[index];
        if (action.type === 'group' && action.uuid === booklet.uuid) { action.header = updated.header; break; }
      }
      setBoard((current) => ({ ...current, groups: current.groups.map((group) => group.uuid === booklet.uuid ? updated : group) }));
    } catch (err) { setError(err.message); }
  };
  const applyHistory = async (direction) => {
    const source = direction === 'undo' ? undoStack.current : redoStack.current;
    const destination = direction === 'undo' ? redoStack.current : undoStack.current;
    const action = source.pop();
    if (!action) return;
    setBusy(true); setError(null);
    try {
      if (action.type === 'move') {
        const point = direction === 'undo' ? action.from : action.to;
        await moveBoardItem(action.uuid, point.x, point.y);
      } else if (action.type === 'move-many') {
        await Promise.all(action.moves.map((move) => {
          const point = direction === 'undo' ? move.from : move.to;
          return moveBoardItem(move.uuid, point.x, point.y);
        }));
      } else if (action.type === 'membership') {
        const snapshot = direction === 'undo' ? action.before : action.after;
        await Promise.all(snapshot.map((item) => updateBoardItem(item.uuid, {
          group_uuid: item.group_uuid,
          x: item.x,
          y: item.y,
        })));
      } else if (action.type === 'booklet-join') {
        const joined = action.after.find((position) => position.uuid === action.uuid);
        if (direction === 'undo') {
          await updateBoardItem(action.uuid, { group_uuid: null, ...action.from });
          if (action.before.length) await layoutBoardGroup(action.groupUuid, action.before);
        } else {
          await updateBoardItem(action.uuid, { group_uuid: action.groupUuid, x: joined.x, y: joined.y });
          await layoutBoardGroup(action.groupUuid, action.after);
        }
      } else if (action.type === 'booklet-leave') {
        const original = action.before.find((position) => position.uuid === action.uuid);
        if (direction === 'undo') {
          await updateBoardItem(action.uuid, { group_uuid: action.groupUuid, x: original.x, y: original.y });
          await layoutBoardGroup(action.groupUuid, action.before);
        } else {
          await updateBoardItem(action.uuid, { group_uuid: null, ...action.to });
          if (action.after.length) await layoutBoardGroup(action.groupUuid, action.after);
        }
      } else if (action.type === 'group-move') {
        const factor = direction === 'undo' ? -1 : 1;
        await moveBoardGroup(action.uuid, action.dx * factor, action.dy * factor);
      } else if (action.type === 'group') {
        if (direction === 'undo') {
          await ungroupBoardGroup(action.uuid, action.previous);
        } else {
          const previousUuid = action.uuid;
          const group = await createBoardGroup(action.boardUuid, {
            kind: action.kind || 'booklet', title: action.title, header: action.header,
            auto_arrange: action.autoArrange || false, item_uuids: action.itemUuids,
          });
          action.uuid = group.uuid;
          source.forEach((pending) => {
            if (pending.type === 'group-move' && pending.uuid === previousUuid) pending.uuid = group.uuid;
          });
        }
      } else if (action.type === 'ungroup') {
        if (direction === 'undo') {
          const group = await createBoardGroup(action.boardUuid, {
            kind: action.kind || 'booklet', title: action.title, header: action.header,
            auto_arrange: action.autoArrange || false, item_uuids: action.itemUuids,
          });
          action.uuid = group.uuid;
        } else {
          await ungroupBoardGroup(action.uuid, action.items);
        }
      } else if (action.type === 'resize') {
        await updateBoardItem(action.uuid, { width: direction === 'undo' ? action.from : action.to });
        if (action.groupUuid) await layoutBoardGroup(
          action.groupUuid,
          direction === 'undo' ? action.beforePositions : action.afterPositions,
        );
      } else if (action.type === 'resize-many') {
        await Promise.all(action.changes.map((change) => updateBoardItem(
          change.uuid, direction === 'undo'
            ? { width: change.from, ...(change.fromX == null ? {} : { x: change.fromX, y: change.fromY }) }
            : { width: change.to, ...(change.toX == null ? {} : { x: change.toX, y: change.toY }) },
        )));
      } else if (action.type === 'resize-selection') {
        await Promise.all([
          ...action.changes.map((change) => updateBoardItem(change.uuid, {
            width: direction === 'undo' ? change.from : change.to,
          })),
          ...action.layouts.map((layout) => layoutBoardGroup(
            layout.uuid, direction === 'undo' ? layout.before : layout.after,
          )),
        ]);
      } else if (action.type === 'layout') {
        await layoutBoardGroup(action.uuid, direction === 'undo' ? action.before : action.after);
      } else if (action.type === 'delete') {
        if (direction === 'undo') await restoreBoardItem(action.uuid);
        else await deleteBoardItem(action.uuid);
      } else if (action.type === 'delete-many') {
        await Promise.all(action.ids.map((uuid) => direction === 'undo' ? restoreBoardItem(uuid) : deleteBoardItem(uuid)));
      } else {
        if (direction === 'undo') await deleteBoardItem(action.uuid);
        else await restoreBoardItem(action.uuid);
      }
      destination.push(action);
      setSelectedItems([]);
      await load();
    } catch (err) {
      source.push(action);
      setError(err.message);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!DOCUMENT_WINDOW && event.metaKey && !event.ctrlKey && !event.altKey && event.key === '[') {
        event.preventDefault();
        window.history.back();
        return;
      }
      if (event.key === 'Escape') {
        boardActionsRef.current?.removeAttribute('open');
        setSelectedItems([]);
        setSelectedBooklet(null);
        setMenuItem(null);
        cancelGesture();
        setEditingDescription(null);
        setEditingText(null);
        setEditingBooklet(null);
        setEditingBookletHeader(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
        event.preventDefault();
        if (board.can_edit && !busy) applyHistory(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
        event.preventDefault();
        setMenuItem(null);
        setSelectedItems(board.items.map((item) => item.uuid));
        return;
      }
      if (!board.can_edit || !['Delete', 'Backspace'].includes(event.key) || !selectedItems.length || busy) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      event.preventDefault();
      removeSelectedItems();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, busy, board]);
  const dropFiles = async (event) => {
    event.preventDefault(); setDraggingFiles(false);
    if (!board.can_edit) return;
    const stagedUuid = event.dataTransfer.getData('application/x-papol-staged-item');
    if (stagedUuid) {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const { x, y } = boardPointFromClient(
        event.clientX, event.clientY, bounds, viewRef.current, { x: 150, y: 50 },
      );
      setBusy(true); setError(null);
      try {
        const item = await placeStagedBoardItem(stagedUuid, x, y);
        undoStack.current.push({ type: 'add', uuid: item.uuid });
        redoStack.current = [];
        await load();
        setSelectedItems([item.uuid]);
      } catch (err) { setError(err.message); } finally { setBusy(false); }
      return;
    }
    const files = [...event.dataTransfer.files]; if (!files.length) return;
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const origin = boardPointFromClient(
      clamp(event.clientX, bounds.left, bounds.right),
      clamp(event.clientY, bounds.top, bounds.bottom),
      bounds,
      viewRef.current,
    );
    setBusy(true); setError(null);
    try {
      await Promise.all(files.map((file, index) => addBoardFile(board.uuid, file, '', {
        x: origin.x + index * 28, y: origin.y + index * 28,
      })));
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const createNoteAt = async (event) => {
    if (!board.can_edit || busy || event.target.closest?.('.board-canvas-card, .board-booklet, .board-staging')) return;
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const { x, y } = boardPointFromClient(
      event.clientX, event.clientY, bounds, viewRef.current,
      { x: DEFAULT_CARD_WIDTH / 2, y: 40 },
    );
    setBusy(true); setError(null);
    try {
      const item = await addBoardComment(board.uuid, 'New note', x, y);
      undoStack.current.push({ type: 'add', uuid: item.uuid });
      redoStack.current = [];
      setBoard((currentBoard) => ({
        ...currentBoard,
        item_count: currentBoard.item_count + 1,
        items: [...currentBoard.items, item],
      }));
      setSelectedItems([]);
      setSelectedBooklet(null);
      setTextDraft(item.content);
      newNoteToSelect.current = item.uuid;
      setEditingText(item.uuid);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const removeBoard = async () => {
    if (!(await confirmAction(`Delete “${board.name}”? This cannot be undone.`, { confirmLabel: 'Delete board', destructive: true }))) return;
    setBusy(true); setError(null);
    try {
      await deleteBoard(board.uuid);
      try { localStorage.removeItem(`papol_board_view_${board.uuid}`); } catch { /* best effort */ }
      onBack();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="loading">Loading board…</div>;
  const canGroupSelection = selectedItems.every((uuid) =>
    board.items.find((item) => item.uuid === uuid)?.group_uuid == null
  );
  const activeBooklet = board.groups?.find((booklet) => booklet.uuid === selectedBooklet);
  const historyEntries = () => [
    { label: 'Undo', shortcut: '⌘Z', disabled: busy || undoStack.current.length === 0, onSelect: () => applyHistory('undo') },
    { label: 'Redo', shortcut: '⇧⌘Z', disabled: busy || redoStack.current.length === 0, onSelect: () => applyHistory('redo') },
  ];
  const beginEditingItem = (item) => {
    setSelectedItems([]);
    setSelectedBooklet(null);
    setMenuItem(null);
    if (item.source_url || item.kind === 'image') {
      setDescriptionDraft(item.content || '');
      setEditingDescription(item.uuid);
    } else {
      setTextDraft(item.content || '');
      setEditingText(item.uuid);
    }
  };
  const downloadItem = async (item) => {
    setMenuItem(null);
    setError(null);
    try {
      await downloadBoardFile(item);
    } catch (failure) {
      setError(failure?.message || 'This file is not available right now.');
    }
  };
  const handleCardContextMenu = (event, item) => {
    const itemUuids = selectedItems.length > 1 && selectedItems.includes(item.uuid)
      ? [...selectedItems]
      : [item.uuid];
    const isSelection = itemUuids.length > 1;
    const selectionCanGroup = itemUuids.every((uuid) => (
      board.items.find((candidate) => candidate.uuid === uuid)?.group_uuid == null
    ));
    const opened = openContextMenu(event, [
      !isSelection && item.source_url && {
        label: item.kind === 'youtube' ? 'Open Video' : 'Open Page',
        onSelect: () => window.open(item.source_url, '_blank', 'noopener,noreferrer'),
      },
      !isSelection && item.kind !== 'comment' && {
        label: 'Download', onSelect: () => downloadItem(item),
      },
      !isSelection && board.can_edit && { label: item.kind === 'comment' ? 'Edit Thought…' : 'Edit Description…', onSelect: () => beginEditingItem(item) },
      !isSelection && board.can_edit && {
        label: 'Text Alignment',
        submenu: ['left', 'center', 'right'].map((alignment) => ({
          label: alignment[0].toUpperCase() + alignment.slice(1),
          checked: (item.text_align || 'left') === alignment,
          onSelect: () => alignText(item, alignment),
        })),
      },
      isSelection && board.can_edit && { label: `Tidy ${itemUuids.length} Cards`, onSelect: () => tidyItems(itemUuids) },
      isSelection && board.can_edit && selectionCanGroup && { label: 'Make Collection', onSelect: () => groupAsCollection(itemUuids) },
      isSelection && board.can_edit && selectionCanGroup && { label: 'Make Booklet', onSelect: () => groupAsBooklet(itemUuids) },
      board.can_edit && { separator: true },
      board.can_edit && { label: isSelection ? `Remove ${itemUuids.length} Cards` : 'Remove Card…', disabled: busy, onSelect: () => isSelection ? removeItems(itemUuids) : removeItem(item) },
      board.can_edit && { separator: true },
      board.can_edit && historyEntries()[0],
      board.can_edit && historyEntries()[1],
    ]);
    if (opened) {
      setSelectedItems(itemUuids);
      setSelectedBooklet(null);
      setMenuItem(null);
    }
  };
  const handleGroupContextMenu = (event, booklet) => {
    const opened = openContextMenu(event, [
      board.can_edit && { label: `Rename ${booklet.kind === 'collection' ? 'Collection' : 'Booklet'}…`, onSelect: () => {
        setBookletTitleDraft(booklet.title || '');
        setEditingBooklet(booklet.uuid);
      } },
      board.can_edit && { label: booklet.header ? 'Edit Header…' : 'Add Header…', onSelect: () => {
        setBookletHeaderDraft(booklet.header || '');
        setEditingBookletHeader(booklet.uuid);
      } },
      board.can_edit && booklet.kind === 'collection' && {
        label: 'Auto-arrange', checked: booklet.auto_arrange, onSelect: () => toggleCollectionAutoArrange(booklet),
      },
      board.can_edit && booklet.kind === 'collection' && { label: 'Tidy Up', onSelect: () => tidyCollection(booklet) },
      board.can_edit && { separator: true },
      board.can_edit && { label: 'Ungroup', disabled: busy, onSelect: () => ungroupBooklet(booklet) },
      board.can_edit && { separator: true },
      board.can_edit && historyEntries()[0],
      board.can_edit && historyEntries()[1],
    ]);
    if (opened) {
      setSelectedItems([]);
      setSelectedBooklet(booklet.uuid);
      setMenuItem(null);
    }
  };
  const handleBoardPointerDownCapture = (event) => {
    const editing = editingText != null || editingDescription != null || editingBooklet != null || editingBookletHeader != null;
    if (editing && !event.target.closest?.('.board-inline-text-editor, input.board-booklet-title, textarea.board-booklet-header-text')) {
      const editor = document.querySelector('.board-inline-text-editor textarea, input.board-booklet-title, textarea.board-booklet-header-text');
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.blur();
      else {
        setEditingText(null);
        setEditingDescription(null);
        setEditingBooklet(null);
        setEditingBookletHeader(null);
      }
    }
    if (!selectedItems.length || event.shiftKey || event.metaKey || event.ctrlKey) return;
    if (event.target.closest?.('.board-selection-menu')) return;
    const card = event.target.closest?.('[data-item-uuid]');
    if (card && selectedItems.includes(card.dataset.itemUuid)) return;
    setSelectedItems([]);
  };
  return <div
    className="infinite-board"
    onPointerDownCapture={handleBoardPointerDownCapture}
    onDragEnter={(event) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (board.can_edit) setDraggingFiles(true);
    }}
    onDragOver={(event) => {
      if (!carriesFiles(event.dataTransfer) && !event.dataTransfer.types.includes('application/x-papol-staged-item')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = board.can_edit ? 'copy' : 'none';
    }}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setDraggingFiles(false);
    }}
    onDrop={dropFiles}
  >
    <header
      className="board-toolbar"
      data-tauri-drag-region="deep"
      onPointerDown={() => { setSelectedItems([]); setSelectedBooklet(null); setMenuItem(null); }}
    >
      {/* In Papol Desktop the toolbar leads with the native Back chevron. */}
      {DESKTOP
        ? <DesktopNav library={{ onClick: focusDesktopLibraryWindow, label: 'Open Library' }} />
        : !DESKTOP
          ? <BackLink className="board-back" href={backHref} onBack={onBack}>← <span>Back</span></BackLink>
          : null}
      <input className="board-toolbar-title" value={board.name} size={Math.max(1, Math.min(48, board.name.length + 1))} aria-label="Board name" maxLength="120" readOnly={!board.can_edit} onChange={(e) => setBoard({ ...board, name: e.target.value })} onBlur={(e) => board.can_edit && e.target.value.trim() && updateBoard(board.uuid, { name: e.target.value.trim() })} />
      <time className="board-toolbar-edited" dateTime={board.updated_at}>Last edited {formatLastEdit(board.updated_at)}</time>
      {!board.can_edit && <span className="board-readonly-badge">Read only</span>}
      <span className="board-toolbar-spacer" />
      <DesktopSyncingStatus />
      {board.can_edit && <button type="button" className="board-tidy-button" disabled={busy || !board.items.length} onClick={tidyBoard} title="Reset card sizes and bring collection cards closer"><TidyGlyph /><span>Tidy</span></button>}
      <div className="board-card-count" aria-label={`${board.item_count} cards`}><strong>{board.item_count}</strong> {board.item_count === 1 ? 'card' : 'cards'}</div>
      <ExperimentalBadge />
      {board.can_edit && <details ref={boardActionsRef} className="board-actions-menu"><summary aria-label="Board actions" title="Board actions"><i /><i /><i /></summary><div className="board-actions-popover"><button type="button" className="remove" disabled={busy} onClick={removeBoard}>Delete board</button></div></details>}
    </header>
    {showNewBoardHint && <div className="board-new-hint" role="status"><span>Drop files anywhere, or paste an image or link to get started.</span><button type="button" aria-label="Dismiss" onClick={() => setShowNewBoardHint(false)}>×</button></div>}
    {error && <div className="board-canvas-error">{error}</div>}
    {board.can_edit && selectedItems.length > 1 && <div className="board-selection-menu"><span>{selectedItems.length} selected</span><button type="button" disabled={busy} onClick={tidySelectedItems}>Tidy up</button>{canGroupSelection && <><button type="button" disabled={busy} onClick={() => groupAsCollection()}>Make collection</button><button type="button" disabled={busy} onClick={() => groupAsBooklet()}>Make booklet</button></>}</div>}
    {board.can_edit && activeBooklet && <div className="board-selection-menu"><span>{activeBooklet.kind === 'collection' ? 'Collection' : 'Booklet'} selected</span>{activeBooklet.kind === 'collection' && <><button type="button" disabled={busy} aria-pressed={activeBooklet.auto_arrange} onClick={() => toggleCollectionAutoArrange(activeBooklet)}>{activeBooklet.auto_arrange ? 'Freeform' : 'Auto-arrange'}</button><button type="button" disabled={busy} onClick={() => tidyCollection(activeBooklet)}>Tidy up</button></>}<button type="button" disabled={busy} onClick={() => ungroupBooklet(activeBooklet)}>Ungroup</button></div>}
    <main ref={viewportRef} aria-label="Board canvas" className={`board-viewport${draggingFiles ? ' file-dragging' : ''}`} style={{ '--board-grid-size': `${24 * view.zoom}px`, '--board-grid-dot': `${Math.max(.55, .75 * view.zoom)}px`, '--board-grid-x': `${view.x}px`, '--board-grid-y': `${view.y}px` }} onDoubleClick={createNoteAt} onPointerDown={startPan} onPointerMove={(event) => { updateGripProximity(event); move(event); }} onPointerLeave={() => { setVisibleGrip(null); setForegroundGrip(null); }} onPointerUp={endGesture} onPointerCancel={cancelGesture}>
      {draggingFiles && <div className="board-drop-target">Drop files anywhere on the board</div>}
      {board.can_edit && board.staged_items?.length > 0 && (
        <aside className="board-staging" aria-label="Staging area">
          <header><strong>Staging</strong><span>Drag onto the board</span></header>
          <div className="board-staging-list">
            {board.staged_items.map((item) => (
              <article
                key={item.uuid}
                className="board-staging-card"
                draggable="true"
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-papol-staged-item', String(item.uuid));
                }}
              >
                <div className="board-staging-card-head">
                  <span className={`board-staging-kind ${item.kind}`}>{item.kind === 'image' ? 'Clip' : 'Excerpt'}</span>
                  <span className="board-staging-drag" aria-hidden="true">Drag to place</span>
                </div>
                {item.kind === 'image' && imageUrls[item.uuid]
                  ? <img src={imageUrls[item.uuid]} alt="Clipped paper content" draggable="false" />
                  : item.kind === 'image' && imageErrors[item.uuid]
                    ? <div className="board-image-error" role="status">Image unavailable</div>
                  : item.kind === 'image'
                    ? <div className="board-staging-image-loading"><span className="board-loading-spinner" /></div>
                    : <blockquote>{item.excerpt_text}</blockquote>}
                {item.content && <p className="board-staging-comment">{item.content}</p>}
                <footer>
                  <a href={item.source_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{stagedSourceLabel(item)}</a>
                  <button type="button" aria-label="Remove staged item" title="Remove" onPointerDown={(event) => event.stopPropagation()} onClick={async () => { await deleteBoardItem(item.uuid); load(); }}>×</button>
                </footer>
              </article>
            ))}
          </div>
        </aside>
      )}
      {marquee && <div className="board-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      <div ref={stageRef} className="board-stage" style={{ '--board-ui-scale': 1 / view.zoom, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {bookletLayouts.map((booklet) => <div key={`${booklet.uuid}:${bookletRedraws[booklet.uuid] || 0}`} data-group-uuid={booklet.uuid} className={`board-booklet ${booklet.kind}${booklet.auto_arrange ? ' auto-arrange' : ''}${selectedBooklet === booklet.uuid ? ' selected' : ''}${dropBooklet === booklet.uuid ? ' drop-active' : ''}`} style={{ transform: `translate(${booklet.x}px, ${booklet.y}px)`, width: booklet.kind === 'collection' ? booklet.width : undefined, height: booklet.height }} onContextMenu={(event) => handleGroupContextMenu(event, booklet)} onPointerDown={(event) => { if (booklet.kind === 'collection' && event.target === event.currentTarget) startBookletMove(event, booklet); }}>
          {board.can_edit && <button type="button" className="board-booklet-spine" aria-label={`Move or select ${booklet.kind === 'collection' ? 'collection' : 'booklet'}${booklet.title ? ` ${booklet.title}` : ''}`} aria-pressed={selectedBooklet === booklet.uuid} onPointerDown={(event) => startBookletMove(event, booklet)} onClick={() => { if (suppressBookletClick.current === booklet.uuid) { suppressBookletClick.current = null; return; } setSelectedItems([]); setMenuItem(null); setSelectedBooklet((current) => current === booklet.uuid ? null : booklet.uuid); }} />}
          <div className="board-booklet-heading" style={{ width: Math.max(0, booklet.width - 14) }}>
            {editingBooklet === booklet.uuid
              ? <input className="board-booklet-title" aria-label={`${booklet.kind === 'collection' ? 'Collection' : 'Booklet'} title`} placeholder={`${booklet.kind === 'collection' ? 'Collection' : 'Booklet'} title`} autoFocus maxLength="240" value={bookletTitleDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setBookletTitleDraft(event.target.value)} onBlur={() => saveBookletTitle(booklet)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setEditingBooklet(null); } }} />
              : <button type="button" disabled={!board.can_edit} className={`board-booklet-title${booklet.title ? '' : ' empty'}`} onPointerDown={(event) => startBookletMove(event, booklet)} onClick={() => { if (suppressBookletClick.current === booklet.uuid) { suppressBookletClick.current = null; return; } setBookletTitleDraft(booklet.title); setEditingBooklet(booklet.uuid); }}>{booklet.title || (board.can_edit ? `${booklet.kind === 'collection' ? 'Collection' : 'Booklet'} title` : '')}</button>}
          </div>
          <div className="board-booklet-header" style={{ width: Math.max(0, booklet.width - 14) }}>
            {editingBookletHeader === booklet.uuid
              ? <textarea className="board-booklet-header-text" aria-label={`${booklet.kind === 'collection' ? 'Collection' : 'Booklet'} header text`} placeholder="Add header text…" autoFocus maxLength="4000" rows="2" value={bookletHeaderDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setBookletHeaderDraft(event.target.value)} onBlur={() => saveBookletHeader(booklet)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setEditingBookletHeader(null); } }} />
              : <button type="button" disabled={!board.can_edit} className={`board-booklet-header-text${booklet.header ? '' : ' empty'}`} onPointerDown={(event) => startBookletMove(event, booklet)} onClick={() => { if (suppressBookletClick.current === booklet.uuid) { suppressBookletClick.current = null; return; } setBookletHeaderDraft(booklet.header || ''); setEditingBookletHeader(booklet.uuid); }}>{booklet.header || (board.can_edit ? 'Add header text…' : '')}</button>}
          </div>
          {booklet.kind === 'booklet' && booklet.branches.map((branch) => <span key={branch.uuid} data-branch-uuid={branch.uuid} className="board-booklet-branch" style={{ top: branch.top, width: branch.width }} />)}
        </div>)}
        {urlLoading.map((item) => <div key={item.uuid} className="board-youtube-loading" style={{ transform: `translate(${item.x}px, ${item.y}px)` }} onPointerDown={(event) => startLoadingDrag(event, item)}><span className="board-loading-spinner" aria-hidden="true" /><span>{item.label}</span></div>)}
        {[...board.items].sort((a, b) => a.position - b.position || compareUuid(a.uuid, b.uuid)).map((item) => <article key={`${item.uuid}:${bookletRedraws[item.group_uuid] || 0}`} data-item-uuid={item.uuid} className={`board-canvas-card ${item.kind}${selectedItems.includes(item.uuid) ? ' selected' : ''}`} style={{ zIndex: (item.position || 0) + 1, width: item.width || 300, transform: `translate(${item.x}px, ${item.y}px)`, backfaceVisibility: cardPaintState }} onContextMenu={(event) => handleCardContextMenu(event, item)} onPointerDown={(e) => startDrag(e, item)}>
          {board.can_edit && <button type="button" className={`board-card-drag-handle${visibleGrip === item.uuid ? ' grip-visible' : ''}${foregroundGrip === item.uuid ? ' grip-foreground' : ''}${draggingGrip === item.uuid ? ' grip-dragging' : ''}`} aria-label="Move card to another group" title="Drag to reorder or change group" onPointerEnter={() => { showGrip(item.uuid); setForegroundGrip(item.uuid); }} onPointerDown={(event) => startMembershipDrag(event, item)}><span aria-hidden="true" /></button>}
          <header className="board-card-header">
            <span className="board-card-kind"><i aria-hidden="true">{itemTypeIcons[item.kind]}</i>{itemTypeLabels[item.kind]}</span>
            {(board.can_edit || item.source_url || item.kind !== 'comment') && <button type="button" className="board-card-more" aria-label="Card actions" aria-expanded={menuItem === item.uuid} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedItems([]); setSelectedBooklet(null); setMenuItem((current) => current === item.uuid ? null : item.uuid); }}>•••</button>}
          </header>
          <div className="board-card-content" onPointerDown={preventModifiedTextSelection}>
          {hasCardPreview(item) && !imageUrls[item.uuid] && (imageErrors[item.uuid]
            ? <div className="board-image-error" role="status">Image unavailable</div>
            : <div className="board-image-loading" role="status" aria-label="Loading image"><span className="board-loading-spinner" aria-hidden="true" /></div>)}
          {hasCardPreview(item) && imageUrls[item.uuid] && <img src={imageUrls[item.uuid]} alt={item.content || item.original_filename || 'Board image'} draggable="false" />}
          {!hasCardPreview(item) && ['youtube', 'webpage'].includes(item.kind) && <div className="board-link-placeholder"><span aria-hidden="true">{item.kind === 'youtube' ? '▶' : '↗'}</span><span>{item.kind === 'youtube' ? 'Video saved offline' : 'Page saved offline'}</span></div>}
          {item.kind === 'file' && <div className="board-canvas-file"><span aria-hidden="true">↧</span><span>{item.original_filename}</span></div>}
          {item.kind === 'excerpt' && <blockquote className="board-excerpt-text">{item.excerpt_text}</blockquote>}
          {!item.source_url && item.kind !== 'image' && item.content && (board.can_edit && editingText === item.uuid
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={textDraft} onFocus={(event) => { if (newNoteToSelect.current === item.uuid) { event.currentTarget.select(); newNoteToSelect.current = null; } }} onChange={(event) => setTextDraft(event.target.value)} onBlur={() => saveText(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="4" maxLength="10000" /></div>
            : <p className="board-editable-text" style={{ textAlign: item.text_align || 'left' }} onPointerDown={prepareCardTextPointerDown} onClick={(event) => { if (!board.can_edit) return; if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelectedItems(mergeSelection(selectedItems, [item.uuid], selectionMode(event))); return; } setSelectedItems([]); setSelectedBooklet(null); setMenuItem(null); setTextDraft(item.content); setEditingText(item.uuid); }}>{item.content}</p>)}
          {(item.source_url || item.kind === 'image') && (item.content || board.can_edit) && (board.can_edit && editingDescription === item.uuid
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} onBlur={() => saveDescription(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="3" maxLength="10000" /></div>
            : <p className={`board-youtube-description${item.content ? '' : ' empty'}`} style={{ textAlign: item.text_align || 'left' }} onPointerDown={prepareCardTextPointerDown} onClick={(event) => { if (!board.can_edit) return; if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelectedItems(mergeSelection(selectedItems, [item.uuid], selectionMode(event))); return; } setSelectedItems([]); setSelectedBooklet(null); setMenuItem(null); setDescriptionDraft(item.content || ''); setEditingDescription(item.uuid); }}>{item.content || 'Add description'}</p>)}
          {['excerpt', 'image'].includes(item.kind) && item.source_url && <a className="board-excerpt-source" href={item.source_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{item.source_label || 'Open source'}</a>}
          </div>
          {menuItem === item.uuid && (board.can_edit || item.source_url || item.kind !== 'comment') && <div className="board-item-menu" onPointerDown={(e) => e.stopPropagation()}>
            {item.source_url && <button onClick={() => window.open(item.source_url, '_blank', 'noopener,noreferrer')}>{item.kind === 'youtube' ? 'Open video' : 'Open page'}</button>}
            {item.kind !== 'comment' && hasCardPreview(item) && <button onClick={() => downloadItem(item)}>Download</button>}
            {board.can_edit && <button type="button" className="remove" disabled={busy} onClick={() => removeItem(item)}>Remove card</button>}
          </div>}
          {board.can_edit && <button className="board-resize-handle" aria-label="Resize card" title="Resize card" onPointerDown={(event) => startResize(event, item)} />}
        </article>)}
      </div>
    </main>
  </div>;
}
