import React, { useEffect, useRef, useState } from 'react';
import { addBoardFile, addBoardWebpage, addBoardYouTube, boardFileBlob, createBoardGroup, downloadBoardFile, deleteBoard, deleteBoardItem, getBoard, layoutBoardGroup, moveBoardGroup, moveBoardItem, placeStagedBoardItem, restoreBoardItem, ungroupBoardGroup, updateBoard, updateBoardGroup, updateBoardItem } from '../../frontend/src/api.js';
import ExperimentalBadge from '../../frontend/src/components/ExperimentalBadge.jsx';
import { cardCenter, chapterDropTarget, exceedsDragThreshold, previewChapterHeight, stackWithInsertion, stackWithout } from './chapterDrag.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const selectionMode = (event) => event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'add' : 'replace';
const mergeSelection = (base, hits, mode) => {
  if (mode === 'replace') return hits;
  const next = new Set(base);
  hits.forEach((id) => {
    if (mode === 'toggle' && next.has(id)) next.delete(id);
    else next.add(id);
  });
  return [...next];
};

const defaultBoardView = () => ({ x: window.innerWidth / 2 - 150, y: 150, zoom: 1 });
const savedBoardView = (boardId) => {
  try {
    const value = JSON.parse(localStorage.getItem(`papol_board_view_${boardId}`));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.zoom)) {
      return { x: value.x, y: value.y, zoom: clamp(value.zoom, 0.25, 3) };
    }
  } catch { /* a damaged local preference should not stop the board opening */ }
  return null;
};
const initialBoardView = (boardId) => window.innerWidth > 700
  ? savedBoardView(boardId) || defaultBoardView()
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
const itemTypeIcons = { comment: '✦', excerpt: '“', image: '▧', file: '↧', youtube: '▶', webpage: '↗' };
const browserDate = (value) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
const formatLastEdit = (value) => new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: browserDate(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(browserDate(value));

export default function BoardPage({ boardId, onBack }) {
  const [board, setBoard] = useState(null);
  const [view] = useState(() => initialBoardView(boardId));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState({});
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [menuItem, setMenuItem] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [urlLoading, setUrlLoading] = useState([]);
  const [showNewBoardHint, setShowNewBoardHint] = useState(false);
  const urlLoadingRef = useRef([]);
  const [chapterLayouts, setChapterLayouts] = useState([]);
  const [dropChapter, setDropChapter] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [editingChapter, setEditingChapter] = useState(null);
  const [chapterTitleDraft, setChapterTitleDraft] = useState('');
  const [editingChapterHeader, setEditingChapterHeader] = useState(null);
  const [chapterHeaderDraft, setChapterHeaderDraft] = useState('');
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
  const activeBoardId = useRef(boardId);
  const centerInitialView = useRef(window.innerWidth <= 700 || savedBoardView(boardId) == null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const suppressChapterClick = useRef(null);
  const cardHoverTimer = useRef(null);
  const showCardHandle = (itemId) => {
    if (cardHoverTimer.current != null) clearTimeout(cardHoverTimer.current);
    cardHoverTimer.current = null;
    setHoveredCard(itemId);
  };
  const hideCardHandleSoon = (itemId) => {
    if (cardHoverTimer.current != null) clearTimeout(cardHoverTimer.current);
    cardHoverTimer.current = setTimeout(() => {
      setHoveredCard((current) => current === itemId ? null : current);
      cardHoverTimer.current = null;
    }, 220);
  };
  useEffect(() => () => {
    if (cardHoverTimer.current != null) clearTimeout(cardHoverTimer.current);
  }, []);
  const load = () => getBoard(boardId).then(setBoard).catch((err) => setError(err.message));

  useEffect(() => {
    if (menuItem == null) return undefined;
    const closeMenu = (event) => {
      if (!event.target.closest('.board-item-menu')) setMenuItem(null);
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
      isNewBoard = sessionStorage.getItem('papol.newBoardHint') === boardId;
      if (isNewBoard) sessionStorage.removeItem('papol.newBoardHint');
    } catch { /* best effort */ }
    setShowNewBoardHint(isNewBoard);
    if (!isNewBoard) return undefined;
    const timer = window.setTimeout(() => setShowNewBoardHint(false), 7000);
    return () => window.clearTimeout(timer);
  }, [boardId]);

  useEffect(() => {
    if (viewSaveTimer.current != null) {
      clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = null;
      try {
        localStorage.setItem(`papol_board_view_${activeBoardId.current}`, JSON.stringify(viewRef.current));
      } catch { /* best effort while switching boards */ }
    }
    activeBoardId.current = boardId;
    const saved = window.innerWidth > 700 ? savedBoardView(boardId) : null;
    centerInitialView.current = saved == null;
    const restored = saved || defaultBoardView();
    viewRef.current = restored;
    pendingView.current = restored;
    paintView(restored);
    load();
  }, [boardId]);
  useEffect(() => { document.body.classList.add('board-workspace-open'); return () => document.body.classList.remove('board-workspace-open'); }, []);
  useEffect(() => {
    if (!board?.items.length || !centerInitialView.current) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!centerInitialView.current || !viewportRef.current || !stageRef.current) return;
      const weighted = board.items.map((item) => {
        const element = stageRef.current.querySelector(`[data-item-id="${item.id}"]`);
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
      paintView({ x: bounds.width / 2 - centerX * zoom, y: bounds.height / 2 - centerY * zoom, zoom });
    });
    return () => cancelAnimationFrame(frame);
  }, [board?.id]);
  const imageIds = board?.items.filter((item) => ['image', 'youtube', 'webpage'].includes(item.kind)).map((item) => item.id).join(',') || '';
  useEffect(() => {
    if (!board) return undefined;
    let active = true; const urls = [];
    setImageUrls({});
    board.items.filter((item) => ['image', 'youtube', 'webpage'].includes(item.kind)).forEach(async (item) => {
      try {
        const url = await boardFileBlob(item);
        if (!active) { URL.revokeObjectURL(url); return; }
        urls.push(url);
        setImageUrls((current) => ({ ...current, [item.id]: url }));
      } catch { /* the card remains as its visible loading box */ }
    });
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [imageIds]);
  const chapterKey = board?.groups?.map((group) => `${group.id}:${group.title}:${group.header}:${group.item_ids.join(',')}`).join('|') || '';
  useEffect(() => {
    if (!board?.groups?.length || !stageRef.current) { setChapterLayouts([]); return undefined; }
    let reflowTimer = null;
    const compact = () => {
      if (!board.can_edit) return;
      if (['item', 'resize'].includes(gesture.current?.type)) return;
      const layouts = board.groups.map((group) => {
        const members = group.item_ids.map((id) => board.items.find((item) => item.id === id)).filter(Boolean).sort((a, b) => a.y - b.y);
        if (members.length < 2) return null;
        const x = Math.min(...members.map((item) => item.x));
        let y = members[0].y;
        const items = members.map((item) => {
          const position = { id: item.id, group_id: group.id, x, y };
          const element = stageRef.current?.querySelector(`[data-item-id="${item.id}"]`);
          y += (element?.offsetHeight || 0) + 18;
          return position;
        });
        const changed = items.some((position) => {
          const item = board.items.find((candidate) => candidate.id === position.id);
          return Math.abs(item.x - position.x) > .5 || Math.abs(item.y - position.y) > .5;
        });
        return changed ? { group, items } : null;
      }).filter(Boolean);
      if (!layouts.length) return;
      const positions = new Map(layouts.flatMap((layout) => layout.items).map((position) => [position.id, position]));
      setBoard((current) => ({ ...current, items: current.items.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id) } : item) }));
      Promise.all(layouts.map((layout) => layoutBoardGroup(layout.group.id, layout.items))).catch((err) => { setError(err.message); load(); });
    };
    const scheduleCompact = () => {
      if (reflowTimer != null) clearTimeout(reflowTimer);
      reflowTimer = setTimeout(compact, 60);
    };
    const measure = () => {
      setChapterLayouts(board.groups.map((group) => {
        const members = group.item_ids.map((id) => {
          const item = board.items.find((candidate) => candidate.id === id);
          const element = stageRef.current?.querySelector(`[data-item-id="${id}"]`);
          return item && element ? { ...item, height: element.offsetHeight } : null;
        }).filter(Boolean);
        if (!members.length) return null;
        const minX = Math.min(...members.map((item) => item.x));
        const minY = Math.min(...members.map((item) => item.y));
        const maxRight = Math.max(...members.map((item) => item.x + item.width));
        const maxBottom = Math.max(...members.map((item) => item.y + item.height));
        const x = minX - 34; const y = minY - 86;
        return {
          ...group, x, y, width: maxRight - minX + 34,
          height: maxBottom - minY + 86,
          branches: members.map((item) => ({ id: item.id, top: item.y - y + 18, width: item.x - x - 10 })),
        };
      }).filter(Boolean));
      scheduleCompact();
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    stageRef.current.querySelectorAll('.board-canvas-card').forEach((element) => observer.observe(element));
    return () => { cancelAnimationFrame(frame); observer.disconnect(); if (reflowTimer != null) clearTimeout(reflowTimer); };
  }, [chapterKey, imageIds, board?.items]);

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
      paintView(pendingView.current);
    });
    if (viewSaveTimer.current != null) clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = setTimeout(() => {
      viewSaveTimer.current = null;
      try {
        localStorage.setItem(`papol_board_view_${activeBoardId.current}`, JSON.stringify(viewRef.current));
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
        localStorage.setItem(`papol_board_view_${activeBoardId.current}`, JSON.stringify(viewRef.current));
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
  }, [Boolean(board), boardId]);
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
        const current = viewRef.current;
        const origin = {
          x: (bounds.width / 2 - current.x) / current.zoom - 150,
          y: (bounds.height / 2 - current.y) / current.zoom - 100,
        };
        setBusy(true); setError(null);
        try {
          const items = await Promise.all(images.map((image, index) => addBoardFile(board.guid, image, '', {
            x: origin.x + index * 28, y: origin.y + index * 28,
          })));
          items.forEach((item) => undoStack.current.push({ type: 'add', id: item.id }));
          redoStack.current = [];
          await load();
          setSelectedItems(items.map((item) => item.id));
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
      const current = viewRef.current;
      const x = (bounds.width / 2 - current.x) / current.zoom - 150;
      const y = (bounds.height / 2 - current.y) / current.zoom - 100;
      const loadingId = `${Date.now()}-${Math.random()}`;
      const loadingItem = { id: loadingId, x, y, label: isYouTube ? 'Loading video frame…' : 'Capturing webpage…' };
      urlLoadingRef.current = [...urlLoadingRef.current, loadingItem];
      setUrlLoading(urlLoadingRef.current);
      setBusy(true); setError(null);
      try {
        const item = isYouTube
          ? await addBoardYouTube(board.guid, text, x, y)
          : await addBoardWebpage(board.guid, text, x, y);
        const finalPosition = urlLoadingRef.current.find((candidate) => candidate.id === loadingId);
        if (finalPosition && (finalPosition.x !== x || finalPosition.y !== y)) {
          try {
            await moveBoardItem(item.id, finalPosition.x, finalPosition.y);
          } catch (moveError) {
            setError(moveError.message);
          }
        }
        undoStack.current.push({ type: 'add', id: item.id });
        redoStack.current = [];
        await load();
        setSelectedItems([item.id]);
      } catch (err) { setError(err.message); } finally {
        urlLoadingRef.current = urlLoadingRef.current.filter((item) => item.id !== loadingId);
        setUrlLoading(urlLoadingRef.current);
        setBusy(false);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [board?.id]);
  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('.board-canvas-card, .board-youtube-loading')) return;
    setSelectedChapter(null);
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
    setSelectedChapter(null);
    setMenuItem(null);
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    if (!board.can_edit) {
      setSelectedItems([item.id]);
      return;
    }
    if (item.group_id != null) {
      const group = board.groups?.find((candidate) => candidate.id === item.group_id);
      const members = group?.item_ids.map((id) => {
        const member = board.items.find((candidate) => candidate.id === id);
        const element = stageRef.current?.querySelector(`[data-item-id="${id}"]`);
        return member && element ? { id, x: member.x, y: member.y, element } : null;
      }).filter(Boolean);
      const chapter = chapterLayouts.find((candidate) => candidate.id === group?.id);
      const chapterElement = stageRef.current?.querySelector(`[data-group-id="${group?.id}"]`);
      if (group && members?.length) {
        gesture.current = {
          type: 'chapter-move', groupId: group.id, members, chapter, chapterElement,
          clickedId: item.id, sx: event.clientX, sy: event.clientY,
        };
      }
      return;
    }
    gesture.current = {
      type: 'item', id: item.id, originGroupId: null, members: null, originalBefore: null,
      chapter: null, chapterElement: null, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y,
      element: event.currentTarget, mode: selectionMode(event), baseSelected: [...selectedItems],
    };
  };
  const startLoadingDrag = (event, item) => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { type: 'loading-item', id: item.id, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y, element: event.currentTarget };
  };
  const startResize = (event, item) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const group = item.group_id ? board.groups?.find((candidate) => candidate.id === item.group_id) : null;
    const beforePositions = group?.item_ids.map((id) => {
      const member = board.items.find((candidate) => candidate.id === id);
      return { id, group_id: group.id, x: member.x, y: member.y };
    });
    gesture.current = {
      type: 'resize', id: item.id, sx: event.clientX,
      width: item.width || 300, element: event.currentTarget.closest('.board-canvas-card'),
      groupId: group?.id, beforePositions,
    };
  };
  const compactChapterPositions = (groupId) => {
    const group = board.groups.find((candidate) => candidate.id === groupId);
    const members = group.item_ids.map((id) => board.items.find((item) => item.id === id)).sort((a, b) => a.y - b.y);
    const x = Math.min(...members.map((item) => item.x));
    let y = members[0].y;
    return members.map((item) => {
      const position = { id: item.id, group_id: groupId, x, y };
      const element = stageRef.current?.querySelector(`[data-item-id="${item.id}"]`);
      y += (element?.offsetHeight || 0) + 18;
      return position;
    });
  };
  const startChapterReorder = (event, chapter, itemId) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedChapter(null);
    setMenuItem(null);
    const members = chapter.item_ids.map((id) => {
      const item = board.items.find((candidate) => candidate.id === id);
      const element = stageRef.current?.querySelector(`[data-item-id="${id}"]`);
      const branchElement = stageRef.current?.querySelector(`[data-branch-id="${id}"]`);
      return item && element ? { id, x: item.x, y: item.y, height: element.offsetHeight, element, branchElement } : null;
    }).filter(Boolean);
    const item = board.items.find((candidate) => candidate.id === itemId);
    const dragged = members.find((member) => member.id === itemId);
    if (!item || !dragged) return;
    members.forEach((member) => member.element.classList.add('chapter-reorder-peer'));
    dragged.element.classList.add('chapter-reordering');
    setSelectedItems([item.id]);
    gesture.current = {
      type: 'item', id: item.id, originGroupId: chapter.id, members,
      originalBefore: members.map((member) => ({ id: member.id, group_id: chapter.id, x: member.x, y: member.y })),
      chapter, chapterElement: stageRef.current?.querySelector(`[data-group-id="${chapter.id}"]`),
      sx: event.clientX, sy: event.clientY, x: item.x, y: item.y,
      element: dragged.element, mode: 'replace', baseSelected: [item.id],
      draggedMember: dragged,
    };
  };
  const startChapterMove = (event, chapter) => {
    if (event.button !== 0 || !board.can_edit) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const members = chapter.item_ids.map((id) => {
      const item = board.items.find((candidate) => candidate.id === id);
      const element = stageRef.current?.querySelector(`[data-item-id="${id}"]`);
      return item && element ? { id, x: item.x, y: item.y, element } : null;
    }).filter(Boolean);
    if (!members.length) return;
    setSelectedItems([]);
    setSelectedChapter(null);
    setMenuItem(null);
    gesture.current = {
      type: 'chapter-move', groupId: chapter.id, members, chapter,
      chapterElement: stageRef.current?.querySelector(`[data-group-id="${chapter.id}"]`),
      sx: event.clientX, sy: event.clientY,
    };
  };
  const clearJoinPreview = (drag) => {
    drag?.joinPreview?.members.forEach((member) => {
      member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
    });
    if (drag?.joinPreview?.chapterElement) {
      drag.joinPreview.chapterElement.style.height = `${drag.joinPreview.originalHeight}px`;
    }
    if (drag) drag.joinPreview = null;
  };
  const move = (event) => {
    const g = gesture.current; if (!g) return;
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
      const hitIds = [...viewportRef.current.querySelectorAll('.board-canvas-card')]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left <= x2 && rect.right >= x1 && rect.top <= y2 && rect.bottom >= y1;
        })
        .map((card) => Number(card.dataset.itemId));
      setSelectedItems(mergeSelection(g.baseSelected, hitIds, g.mode));
    } else if (g.type === 'pan') queueView({ ...g.origin, x: g.origin.x + event.clientX - g.sx, y: g.origin.y + event.clientY - g.sy });
    else if (g.type === 'chapter-move') {
      const dx = (event.clientX - g.sx) / viewRef.current.zoom;
      const dy = (event.clientY - g.sy) / viewRef.current.zoom;
      g.current = { dx, dy };
      g.moved = exceedsDragThreshold(g.sx, g.sy, event.clientX, event.clientY);
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x + dx}px, ${member.y + dy}px)`; });
      if (g.chapter && g.chapterElement) g.chapterElement.style.transform = `translate(${g.chapter.x + dx}px, ${g.chapter.y + dy}px)`;
    }
    else if (g.type === 'item' || g.type === 'loading-item') {
      const zoom = viewRef.current.zoom;
      g.current = { x: g.x + (event.clientX - g.sx) / zoom, y: g.y + (event.clientY - g.sy) / zoom };
      g.moved = exceedsDragThreshold(g.sx, g.sy, event.clientX, event.clientY);
      g.element.style.transform = `translate(${g.current.x}px, ${g.current.y}px)`;
      if (g.draggedMember?.branchElement) {
        g.draggedMember.branchElement.style.transform = `translate(${g.current.x - g.x}px, ${g.current.y - g.y}px)`;
      }
      if (g.type === 'item') {
        const width = g.element.offsetWidth || 300;
        const height = g.element.offsetHeight || 1;
        const center = cardCenter(g.current, width, height);
        const target = chapterDropTarget(chapterLayouts, center, g.originGroupId);
        g.dropGroupId = target?.id || null;
        setDropChapter(g.dropGroupId);
        if (!target) {
          clearJoinPreview(g);
          if (g.originGroupId) {
            const remaining = g.members.filter((member) => member.id !== g.id);
            const after = stackWithout(g.members, g.id, g.originGroupId);
            const positions = new Map(after.map((position) => [position.id, position]));
            remaining.forEach((member) => {
              const position = positions.get(member.id);
              member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
              if (member.branchElement) member.branchElement.style.transform = `translate(${position.x - member.x}px, ${position.y - member.y}px)`;
            });
            const heights = new Map(remaining.map((member) => [member.id, member.height]));
            if (g.chapterElement) g.chapterElement.style.height = `${previewChapterHeight(g.chapter.y, after, heights)}px`;
            g.leavePreview = { groupId: g.originGroupId, members: remaining, after, chapterElement: g.chapterElement };
          }
        }
        else {
          const group = board.groups.find((candidate) => candidate.id === target.id);
          const members = group.item_ids.filter((id) => id !== g.id).map((id) => {
            const member = board.items.find((candidate) => candidate.id === id);
            const element = stageRef.current?.querySelector(`[data-item-id="${id}"]`);
            const branchElement = stageRef.current?.querySelector(`[data-branch-id="${id}"]`);
            return member && element ? { id, x: member.x, y: member.y, height: element.offsetHeight, element, branchElement } : null;
          }).filter(Boolean).sort((a, b) => a.y - b.y);
          members.forEach((member) => member.element.classList.add('chapter-reorder-peer'));
          g.element.classList.add('chapter-reordering');
          if (g.joinPreview?.groupId !== target.id) clearJoinPreview(g);
          const dragged = { id: g.id, x: g.x, y: g.y, height, centerY: center.y };
          const anchor = target.id === g.originGroupId && g.members?.length
            ? {
                x: Math.min(...g.members.map((member) => member.x)),
                y: Math.min(...g.members.map((member) => member.y)),
              }
            : null;
          const { positions: after } = stackWithInsertion(members, dragged, target.id, anchor);
          const chapterElement = stageRef.current?.querySelector(`[data-group-id="${target.id}"]`);
          const heights = new Map([...members.map((member) => [member.id, member.height]), [g.id, height]]);
          if (chapterElement) chapterElement.style.height = `${previewChapterHeight(target.y, after, heights)}px`;
          const positions = new Map(after.map((position) => [position.id, position]));
          members.forEach((member) => {
            const position = positions.get(member.id);
            member.element.style.transform = `translate(${position.x}px, ${position.y}px)`;
            if (member.branchElement) member.branchElement.style.transform = `translate(${position.x - member.x}px, ${position.y - member.y}px)`;
          });
          g.joinPreview = {
            groupId: target.id,
            members,
            before: target.id === g.originGroupId
              ? g.originalBefore
              : members.map((member) => ({ id: member.id, group_id: target.id, x: member.x, y: member.y })),
            after,
            chapterElement,
            originalHeight: target.height,
          };
          g.leavePreview = null;
        }
      }
      if (g.type === 'loading-item') {
        urlLoadingRef.current = urlLoadingRef.current.map((item) => item.id === g.id ? { ...item, ...g.current } : item);
      }
    } else if (g.type === 'resize') {
      g.current = clamp(g.width + (event.clientX - g.sx) / viewRef.current.zoom, 120, 1200);
      g.element.style.width = `${g.current}px`;
    }
  };
  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    setDropChapter(null);
    setMarquee(null);
    touches.current.clear();
    if (!g) return;
    if (g.type === 'item' || g.type === 'loading-item') {
      g.element.style.transform = `translate(${g.x}px, ${g.y}px)`;
      g.element.classList.remove('chapter-reordering');
      const members = new Map([
        ...(g.members || []).map((member) => [member.id, member]),
        ...(g.joinPreview?.members || []).map((member) => [member.id, member]),
      ]);
      members.forEach((member) => {
        member.element.style.transform = `translate(${member.x}px, ${member.y}px)`;
        member.element.classList.remove('chapter-reorder-peer');
        if (member.branchElement) member.branchElement.style.transform = '';
      });
      if (g.draggedMember?.branchElement) g.draggedMember.branchElement.style.transform = '';
      const chapterElement = g.joinPreview?.chapterElement || g.leavePreview?.chapterElement;
      const originalHeight = g.joinPreview?.originalHeight ?? g.chapter?.height;
      if (chapterElement && originalHeight != null) chapterElement.style.height = `${originalHeight}px`;
    } else if (g.type === 'chapter-move') {
      g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
      if (g.chapter && g.chapterElement) g.chapterElement.style.transform = `translate(${g.chapter.x}px, ${g.chapter.y}px)`;
    } else if (g.type === 'resize') {
      g.element.style.width = `${g.width}px`;
    }
  };
  const endGesture = (event) => {
    const g = gesture.current; gesture.current = null;
    setDropChapter(null);
    if (g?.type === 'item') {
      g.element.classList.remove('chapter-reordering');
      const previewElements = new Set([
        ...(g.members || []).map((member) => member.element),
        ...(g.joinPreview?.members || []).map((member) => member.element),
      ]);
      setTimeout(() => previewElements.forEach((element) => element.classList.remove('chapter-reorder-peer')), 190);
      const previewBranches = new Set([
        ...(g.members || []).map((member) => member.branchElement),
        ...(g.joinPreview?.members || []).map((member) => member.branchElement),
      ].filter(Boolean));
      setTimeout(() => previewBranches.forEach((branch) => { branch.style.transform = ''; }), 190);
    }
    if (g?.type === 'chapter-move') {
      const { dx = 0, dy = 0 } = g.current || {};
      if (g.moved) {
        suppressChapterClick.current = g.groupId;
        setSelectedItems([]);
        setSelectedChapter(null);
        setMenuItem(null);
        undoStack.current.push({ type: 'group-move', id: g.groupId, dx, dy });
        redoStack.current = [];
        const ids = new Set(g.members.map((member) => member.id));
        setBoard((current) => ({ ...current, items: current.items.map((item) => ids.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item) }));
        moveBoardGroup(g.groupId, dx, dy).catch((err) => { setError(err.message); load(); });
      } else {
        g.members.forEach((member) => { member.element.style.transform = `translate(${member.x}px, ${member.y}px)`; });
        if (g.chapter && g.chapterElement) g.chapterElement.style.transform = `translate(${g.chapter.x}px, ${g.chapter.y}px)`;
        if (g.clickedId != null) {
          setSelectedItems([g.clickedId]);
          setSelectedChapter(null);
          setMenuItem(null);
        }
      }
    }
    if (event?.pointerType === 'touch') {
      touches.current.delete(event.pointerId);
      const remaining = [...touches.current.values()][0];
      if (remaining) gesture.current = { type: 'pan', sx: remaining.x, sy: remaining.y, origin: viewRef.current };
    }
    if (g?.type === 'item') {
      const item = board.items.find((candidate) => candidate.id === g.id);
      if (item) {
        const point = g.current || { x: g.x, y: g.y };
        const moved = Boolean(g.moved);
        if (moved) {
          undoStack.current.push(g.joinPreview
            ? g.originGroupId
              ? { type: 'layout', id: g.originGroupId, before: g.originalBefore, after: g.joinPreview.after }
              : { type: 'chapter-join', id: item.id, groupId: g.joinPreview.groupId, from: { x: g.x, y: g.y }, before: g.joinPreview.before, after: g.joinPreview.after }
            : g.leavePreview
              ? { type: 'chapter-leave', id: item.id, groupId: g.originGroupId, from: { x: g.x, y: g.y }, to: point, before: g.originalBefore, after: g.leavePreview.after }
              : { type: 'move', id: item.id, from: { x: g.x, y: g.y }, to: point });
          redoStack.current = [];
          if (g.joinPreview && g.originGroupId) {
            const positions = new Map(g.joinPreview.after.map((position) => [position.id, position]));
            const final = positions.get(item.id);
            void g.element.offsetWidth;
            g.element.style.transform = `translate(${final.x}px, ${final.y}px)`;
            if (g.draggedMember?.branchElement) {
              g.draggedMember.branchElement.style.transform = `translate(${final.x - g.x}px, ${final.y - g.y}px)`;
            }
            setBoard((current) => ({ ...current, items: current.items.map((candidate) => positions.has(candidate.id) ? { ...candidate, ...positions.get(candidate.id) } : candidate) }));
            layoutBoardGroup(g.originGroupId, g.joinPreview.after).catch((err) => { setError(err.message); load(); });
          } else if (g.joinPreview) {
            const positions = new Map(g.joinPreview.after.map((position) => [position.id, position]));
            const joined = positions.get(item.id);
            setBoard((current) => ({
              ...current,
              groups: current.groups.map((group) => group.id === g.joinPreview.groupId ? { ...group, item_ids: [...group.item_ids, item.id] } : group),
              items: current.items.map((candidate) => positions.has(candidate.id) ? { ...candidate, ...positions.get(candidate.id) } : candidate),
            }));
            updateBoardItem(item.id, { x: joined.x, y: joined.y, group_id: g.joinPreview.groupId })
              .then(() => layoutBoardGroup(g.joinPreview.groupId, g.joinPreview.after))
              .catch((err) => { setError(err.message); load(); });
          } else if (g.leavePreview) {
            const positions = new Map(g.leavePreview.after.map((position) => [position.id, position]));
            setBoard((current) => ({
              ...current,
              groups: current.groups.map((group) => group.id === g.originGroupId ? { ...group, item_ids: group.item_ids.filter((id) => id !== item.id) } : group),
              items: current.items.map((candidate) => candidate.id === item.id
                ? { ...candidate, ...point, group_id: null }
                : positions.has(candidate.id) ? { ...candidate, ...positions.get(candidate.id) } : candidate),
            }));
            updateBoardItem(item.id, { ...point, group_id: null })
              .then(() => g.leavePreview.after.length ? layoutBoardGroup(g.originGroupId, g.leavePreview.after) : null)
              .catch((err) => { setError(err.message); load(); });
          } else {
            clearJoinPreview(g);
            setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, ...point } : candidate) }));
            moveBoardItem(item.id, point.x, point.y).catch((err) => setError(err.message));
          }
        }
        else {
          clearJoinPreview(g);
          setSelectedItems(mergeSelection(g.baseSelected, [item.id], g.mode));
        }
      }
    }
    if (g?.type === 'loading-item') {
      const point = g.current || { x: g.x, y: g.y };
      urlLoadingRef.current = urlLoadingRef.current.map((item) => item.id === g.id ? { ...item, ...point } : item);
      setUrlLoading(urlLoadingRef.current);
    }
    if (g?.type === 'resize') {
      const width = g.current ?? g.width;
      if (Math.abs(width - g.width) > 1) {
        const afterPositions = g.groupId ? compactChapterPositions(g.groupId) : null;
        undoStack.current.push({ type: 'resize', id: g.id, from: g.width, to: width, groupId: g.groupId, beforePositions: g.beforePositions, afterPositions });
        redoStack.current = [];
        const positions = new Map(afterPositions?.map((position) => [position.id, position]));
        setBoard((current) => ({ ...current, items: current.items.map((item) => ({
          ...item,
          ...(item.id === g.id ? { width } : {}),
          ...(positions?.get(item.id) || {}),
        })) }));
        Promise.all([
          updateBoardItem(g.id, { width }),
          ...(g.groupId ? [layoutBoardGroup(g.groupId, afterPositions)] : []),
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
        setSelectedItems(mergeSelection(g.baseSelected, hits.map((card) => Number(card.dataset.itemId)), g.mode));
      } else if (g.mode === 'replace') {
        setSelectedItems([]);
      }
      setMarquee(null);
    }
  };
  const removeItem = async (item, ask = true) => {
    if (ask && !window.confirm('Remove this card?')) return;
    setBusy(true); setError(null);
    try {
      await deleteBoardItem(item.id);
      undoStack.current.push({ type: 'delete', id: item.id });
      redoStack.current = [];
      setSelectedItems([]);
      setMenuItem(null);
      setBoard((current) => ({
        ...current,
        item_count: Math.max(0, current.item_count - 1),
        items: current.items.filter((candidate) => candidate.id !== item.id),
      }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const saveDescription = async (item) => {
    setBusy(true); setError(null);
    try {
      const updated = await updateBoardItem(item.id, { content: descriptionDraft });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? updated : candidate) }));
      setEditingDescription(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const removeSelectedItems = async () => {
    if (!selectedItems.length) return;
    const ids = [...selectedItems];
    setBusy(true); setError(null);
    try {
      await Promise.all(ids.map(deleteBoardItem));
      undoStack.current.push({ type: 'delete-many', ids });
      redoStack.current = [];
      setSelectedItems([]);
      setBoard((current) => ({
        ...current,
        item_count: Math.max(0, current.item_count - ids.length),
        items: current.items.filter((item) => !ids.includes(item.id)),
      }));
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const saveText = async (item) => {
    setBusy(true); setError(null);
    try {
      const updated = await updateBoardItem(item.id, { content: textDraft });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? updated : candidate) }));
      setEditingText(null);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const alignText = async (item, textAlign) => {
    try {
      const updated = await updateBoardItem(item.id, { text_align: textAlign });
      setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? updated : candidate) }));
    } catch (err) { setError(err.message); }
  };
  const groupAsChapter = async () => {
    if (selectedItems.some((id) => board.items.find((item) => item.id === id)?.group_id != null)) return;
    setBusy(true); setError(null);
    try {
      const previous = selectedItems.map((id) => {
        const item = board.items.find((candidate) => candidate.id === id);
        return { id, group_id: item.group_id || null, x: item.x, y: item.y };
      });
      const group = await createBoardGroup(board.guid, { kind: 'chapter', title: '', item_ids: selectedItems });
      undoStack.current.push({ type: 'group', id: group.id, boardGuid: board.guid, title: '', header: '', itemIds: [...selectedItems], previous });
      redoStack.current = [];
      setSelectedItems([]);
      await load();
      setChapterTitleDraft('');
      setEditingChapter(group.id);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const ungroupChapter = async (chapter) => {
    const items = chapter.item_ids.map((id) => {
      const item = board.items.find((candidate) => candidate.id === id);
      return { id, group_id: null, x: item.x, y: item.y };
    });
    setBusy(true); setError(null);
    try {
      await ungroupBoardGroup(chapter.id, items);
      undoStack.current.push({
        type: 'ungroup', id: chapter.id, boardGuid: board.guid,
        title: chapter.title, header: chapter.header, itemIds: [...chapter.item_ids], items,
      });
      redoStack.current = [];
      setSelectedChapter(null);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const tidyItems = async (itemIds) => {
    const ids = new Set(itemIds);
    const items = board.items.filter((item) => ids.has(item.id));
    if (items.length < 2) return;
    const width = Math.max(...items.map((item) => item.width || 300));
    const changes = items.map((item) => ({ id: item.id, from: item.width || 300, to: width }));
    if (changes.every((change) => change.from === change.to)) return;
    setBusy(true); setError(null);
    try {
      await Promise.all(changes.map((change) => updateBoardItem(change.id, { width: change.to })));
      undoStack.current.push({ type: 'resize-many', changes });
      redoStack.current = [];
      setBoard((current) => ({ ...current, items: current.items.map((item) => ids.has(item.id) ? { ...item, width } : item) }));
    } catch (err) { setError(err.message); await load(); } finally { setBusy(false); }
  };
  const tidySelectedItems = () => tidyItems(selectedItems);
  const tidyBoard = () => tidyItems(board.items.map((item) => item.id));
  const saveChapterTitle = async (chapter) => {
    setEditingChapter(null);
    try {
      const updated = await updateBoardGroup(chapter.id, { title: chapterTitleDraft });
      for (let index = undoStack.current.length - 1; index >= 0; index -= 1) {
        const action = undoStack.current[index];
        if (action.type === 'group' && action.id === chapter.id) { action.title = updated.title; break; }
      }
      setBoard((current) => ({ ...current, groups: current.groups.map((group) => group.id === chapter.id ? updated : group) }));
    } catch (err) { setError(err.message); }
  };
  const saveChapterHeader = async (chapter) => {
    setEditingChapterHeader(null);
    try {
      const updated = await updateBoardGroup(chapter.id, { header: chapterHeaderDraft });
      for (let index = undoStack.current.length - 1; index >= 0; index -= 1) {
        const action = undoStack.current[index];
        if (action.type === 'group' && action.id === chapter.id) { action.header = updated.header; break; }
      }
      setBoard((current) => ({ ...current, groups: current.groups.map((group) => group.id === chapter.id ? updated : group) }));
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
        await moveBoardItem(action.id, point.x, point.y);
      } else if (action.type === 'chapter-join') {
        const joined = action.after.find((position) => position.id === action.id);
        if (direction === 'undo') {
          await updateBoardItem(action.id, { group_id: null, ...action.from });
          if (action.before.length) await layoutBoardGroup(action.groupId, action.before);
        } else {
          await updateBoardItem(action.id, { group_id: action.groupId, x: joined.x, y: joined.y });
          await layoutBoardGroup(action.groupId, action.after);
        }
      } else if (action.type === 'chapter-leave') {
        const original = action.before.find((position) => position.id === action.id);
        if (direction === 'undo') {
          await updateBoardItem(action.id, { group_id: action.groupId, x: original.x, y: original.y });
          await layoutBoardGroup(action.groupId, action.before);
        } else {
          await updateBoardItem(action.id, { group_id: null, ...action.to });
          if (action.after.length) await layoutBoardGroup(action.groupId, action.after);
        }
      } else if (action.type === 'group-move') {
        const factor = direction === 'undo' ? -1 : 1;
        await moveBoardGroup(action.id, action.dx * factor, action.dy * factor);
      } else if (action.type === 'group') {
        if (direction === 'undo') {
          await ungroupBoardGroup(action.id, action.previous);
        } else {
          const previousId = action.id;
          const group = await createBoardGroup(action.boardGuid, {
            kind: 'chapter', title: action.title, header: action.header, item_ids: action.itemIds,
          });
          action.id = group.id;
          source.forEach((pending) => {
            if (pending.type === 'group-move' && pending.id === previousId) pending.id = group.id;
          });
        }
      } else if (action.type === 'ungroup') {
        if (direction === 'undo') {
          const group = await createBoardGroup(action.boardGuid, {
            kind: 'chapter', title: action.title, header: action.header, item_ids: action.itemIds,
          });
          action.id = group.id;
        } else {
          await ungroupBoardGroup(action.id, action.items);
        }
      } else if (action.type === 'resize') {
        await updateBoardItem(action.id, { width: direction === 'undo' ? action.from : action.to });
        if (action.groupId) await layoutBoardGroup(
          action.groupId,
          direction === 'undo' ? action.beforePositions : action.afterPositions,
        );
      } else if (action.type === 'resize-many') {
        await Promise.all(action.changes.map((change) => updateBoardItem(
          change.id, { width: direction === 'undo' ? change.from : change.to },
        )));
      } else if (action.type === 'layout') {
        await layoutBoardGroup(action.id, direction === 'undo' ? action.before : action.after);
      } else if (action.type === 'delete') {
        if (direction === 'undo') await restoreBoardItem(action.id);
        else await deleteBoardItem(action.id);
      } else if (action.type === 'delete-many') {
        await Promise.all(action.ids.map((id) => direction === 'undo' ? restoreBoardItem(id) : deleteBoardItem(id)));
      } else {
        if (direction === 'undo') await deleteBoardItem(action.id);
        else await restoreBoardItem(action.id);
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
      if (event.metaKey && !event.ctrlKey && !event.altKey && event.key === '[') {
        event.preventDefault();
        window.history.back();
        return;
      }
      if (event.key === 'Escape') {
        boardActionsRef.current?.removeAttribute('open');
        setSelectedItems([]);
        setSelectedChapter(null);
        setMenuItem(null);
        cancelGesture();
        setEditingDescription(null);
        setEditingText(null);
        setEditingChapter(null);
        setEditingChapterHeader(null);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
        event.preventDefault();
        if (board.can_edit) applyHistory(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
        event.preventDefault();
        setMenuItem(null);
        setSelectedItems(board.items.map((item) => item.id));
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
    const stagedId = Number(event.dataTransfer.getData('application/x-papol-staged-item'));
    if (Number.isInteger(stagedId) && stagedId > 0) {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const currentView = viewRef.current;
      const x = (event.clientX - bounds.left - currentView.x) / currentView.zoom - 150;
      const y = (event.clientY - bounds.top - currentView.y) / currentView.zoom - 50;
      setBusy(true); setError(null);
      try {
        const item = await placeStagedBoardItem(stagedId, x, y);
        undoStack.current.push({ type: 'add', id: item.id });
        redoStack.current = [];
        await load();
        setSelectedItems([item.id]);
      } catch (err) { setError(err.message); } finally { setBusy(false); }
      return;
    }
    const files = [...event.dataTransfer.files]; if (!files.length) return;
    const currentView = viewRef.current;
    const origin = { x: (event.clientX - currentView.x) / currentView.zoom, y: (event.clientY - 55 - currentView.y) / currentView.zoom };
    setBusy(true); setError(null);
    try {
      await Promise.all(files.map((file, index) => addBoardFile(board.guid, file, '', {
        x: origin.x + index * 28, y: origin.y + index * 28,
      })));
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const removeBoard = async () => {
    if (!window.confirm(`Delete “${board.name}”? This cannot be undone.`)) return;
    setBusy(true); setError(null);
    try {
      await deleteBoard(board.guid);
      try { localStorage.removeItem(`papol_board_view_${board.guid}`); } catch { /* best effort */ }
      onBack();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="loading">Loading board…</div>;
  const canGroupSelection = selectedItems.every((id) =>
    board.items.find((item) => item.id === id)?.group_id == null
  );
  const activeChapter = board.groups?.find((chapter) => chapter.id === selectedChapter);
  return <div className="infinite-board">
    <header className="board-toolbar">
      <button className="board-back" onClick={onBack}>← <span>Back</span></button>
      <input className="board-toolbar-title" value={board.name} aria-label="Board name" maxLength="120" readOnly={!board.can_edit} onChange={(e) => setBoard({ ...board, name: e.target.value })} onBlur={(e) => board.can_edit && e.target.value.trim() && updateBoard(board.guid, { name: e.target.value.trim() })} />
      <time className="board-toolbar-edited" dateTime={board.updated_at}>Last edited {formatLastEdit(board.updated_at)}</time>
      {!board.can_edit && <span className="board-readonly-badge">Read only</span>}
      <span className="board-toolbar-spacer" />
      {board.can_edit && <button type="button" className="board-tidy-button" disabled={busy || board.items.length < 2} onClick={tidyBoard} title="Make every card the same width"><TidyGlyph /><span>Tidy</span></button>}
      <div className="board-card-count" aria-label={`${board.item_count} cards`}><strong>{board.item_count}</strong> {board.item_count === 1 ? 'card' : 'cards'}</div>
      <ExperimentalBadge />
      {board.can_edit && <details ref={boardActionsRef} className="board-actions-menu"><summary aria-label="Board actions" title="Board actions"><i /><i /><i /></summary><div className="board-actions-popover"><button type="button" className="remove" disabled={busy} onClick={removeBoard}>Delete board</button></div></details>}
    </header>
    {showNewBoardHint && <div className="board-new-hint" role="status"><span>Drop files anywhere, or paste an image or link to get started.</span><button type="button" aria-label="Dismiss" onClick={() => setShowNewBoardHint(false)}>×</button></div>}
    {error && <div className="board-canvas-error">{error}</div>}
    {board.can_edit && selectedItems.length > 1 && <div className="board-selection-menu"><span>{selectedItems.length} selected</span><button type="button" disabled={busy} onClick={tidySelectedItems}>Tidy up</button>{canGroupSelection && <button type="button" disabled={busy} onClick={groupAsChapter}>Group as chapter</button>}</div>}
    {board.can_edit && activeChapter && <div className="board-selection-menu"><span>Chapter selected</span><button type="button" disabled={busy} onClick={() => ungroupChapter(activeChapter)}>Ungroup</button></div>}
    <main ref={viewportRef} className={`board-viewport${draggingFiles ? ' file-dragging' : ''}`} style={{ '--board-grid-size': `${24 * view.zoom}px`, '--board-grid-dot': `${Math.max(.55, .75 * view.zoom)}px`, '--board-grid-x': `${view.x}px`, '--board-grid-y': `${view.y}px` }} onPointerDown={startPan} onPointerMove={move} onPointerUp={endGesture} onPointerCancel={cancelGesture} onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDraggingFiles(true); } }} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-papol-staged-item')) e.preventDefault(); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingFiles(false); }} onDrop={dropFiles}>
      {draggingFiles && <div className="board-drop-target">Drop files anywhere on the board</div>}
      {board.can_edit && board.staged_items?.length > 0 && (
        <aside className="board-staging" aria-label="Staging area">
          <header><strong>Staging</strong><span>Drag onto the board</span></header>
          <div className="board-staging-list">
            {board.staged_items.map((item) => (
              <article
                key={item.id}
                className="board-staging-card"
                draggable="true"
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-papol-staged-item', String(item.id));
                }}
              >
                <p>{item.excerpt_text}</p>
                <footer>
                  <a href={item.source_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{item.source_label || 'Open source'}</a>
                  <button type="button" aria-label="Remove staged excerpt" title="Remove" onPointerDown={(event) => event.stopPropagation()} onClick={async () => { await deleteBoardItem(item.id); load(); }}>×</button>
                </footer>
              </article>
            ))}
          </div>
        </aside>
      )}
      {marquee && <div className="board-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      <div ref={stageRef} className="board-stage" style={{ '--board-ui-scale': 1 / view.zoom, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {chapterLayouts.map((chapter) => <div key={chapter.id} data-group-id={chapter.id} className={`board-chapter${selectedChapter === chapter.id ? ' selected' : ''}${dropChapter === chapter.id ? ' drop-active' : ''}`} style={{ transform: `translate(${chapter.x}px, ${chapter.y}px)`, height: chapter.height }}>
          {board.can_edit && <button type="button" className="board-chapter-spine" aria-label={`Move or select chapter${chapter.title ? ` ${chapter.title}` : ''}`} aria-pressed={selectedChapter === chapter.id} onPointerDown={(event) => startChapterMove(event, chapter)} onClick={() => { if (suppressChapterClick.current === chapter.id) { suppressChapterClick.current = null; return; } setSelectedItems([]); setMenuItem(null); setSelectedChapter((current) => current === chapter.id ? null : chapter.id); }} />}
          <div className="board-chapter-heading" style={{ width: Math.max(0, chapter.width - 14) }}>
            {editingChapter === chapter.id
              ? <input className="board-chapter-title" aria-label="Chapter title" placeholder="Chapter title" autoFocus maxLength="240" value={chapterTitleDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setChapterTitleDraft(event.target.value)} onBlur={() => saveChapterTitle(chapter)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setEditingChapter(null); } }} />
              : <button type="button" disabled={!board.can_edit} className={`board-chapter-title${chapter.title ? '' : ' empty'}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setChapterTitleDraft(chapter.title); setEditingChapter(chapter.id); }}>{chapter.title || (board.can_edit ? 'Chapter title' : '')}</button>}
          </div>
          <div className="board-chapter-header" style={{ width: Math.max(0, chapter.width - 14) }}>
            {editingChapterHeader === chapter.id
              ? <textarea className="board-chapter-header-text" aria-label="Chapter header text" placeholder="Add header text…" autoFocus maxLength="4000" rows="2" value={chapterHeaderDraft} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setChapterHeaderDraft(event.target.value)} onBlur={() => saveChapterHeader(chapter)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setEditingChapterHeader(null); } }} />
              : <button type="button" disabled={!board.can_edit} className={`board-chapter-header-text${chapter.header ? '' : ' empty'}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setChapterHeaderDraft(chapter.header || ''); setEditingChapterHeader(chapter.id); }}>{chapter.header || (board.can_edit ? 'Add header text…' : '')}</button>}
          </div>
          {chapter.branches.map((branch) => <span key={branch.id} data-branch-id={branch.id} className="board-chapter-branch" style={{ top: branch.top, width: branch.width }}>{board.can_edit && <button type="button" className={`board-chapter-reorder-handle${hoveredCard === branch.id ? ' card-hovered' : ''}${selectedItems.includes(branch.id) ? ' card-selected' : ''}`} aria-label="Move card within or out of chapter" title="Drag card" onPointerEnter={() => showCardHandle(branch.id)} onPointerLeave={() => hideCardHandleSoon(branch.id)} onPointerDown={(event) => startChapterReorder(event, chapter, branch.id)}><i /><i /><i /></button>}</span>)}
        </div>)}
        {urlLoading.map((item) => <div key={item.id} className="board-youtube-loading" style={{ transform: `translate(${item.x}px, ${item.y}px)` }} onPointerDown={(event) => startLoadingDrag(event, item)}><span className="board-loading-spinner" aria-hidden="true" /><span>{item.label}</span></div>)}
        {board.items.map((item) => <article key={item.id} data-item-id={item.id} className={`board-canvas-card ${item.kind}${selectedItems.includes(item.id) ? ' selected' : ''}`} style={{ width: item.width || 300, transform: `translate(${item.x}px, ${item.y}px)` }} onPointerEnter={() => item.group_id != null && showCardHandle(item.id)} onPointerLeave={() => item.group_id != null && hideCardHandleSoon(item.id)} onPointerDown={(e) => startDrag(e, item)}>
          <header className="board-card-header">
            <span className="board-card-kind"><i aria-hidden="true">{itemTypeIcons[item.kind]}</i>{itemTypeLabels[item.kind]}</span>
            {(board.can_edit || item.source_url || item.kind !== 'comment') && <button type="button" className="board-card-more" aria-label="Card actions" aria-expanded={menuItem === item.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedItems([item.id]); setMenuItem((current) => current === item.id ? null : item.id); }}>•••</button>}
          </header>
          <div className="board-card-content">
          {['image', 'youtube', 'webpage'].includes(item.kind) && !imageUrls[item.id] && <div className="board-image-loading" role="status" aria-label="Loading image"><span className="board-loading-spinner" aria-hidden="true" /></div>}
          {['image', 'youtube', 'webpage'].includes(item.kind) && imageUrls[item.id] && <img src={imageUrls[item.id]} alt={item.content || item.original_filename || 'Board image'} draggable="false" />}
          {item.kind === 'file' && <div className="board-canvas-file"><span aria-hidden="true">↧</span><span>{item.original_filename}</span></div>}
          {item.kind === 'excerpt' && <blockquote className="board-excerpt-text">{item.excerpt_text}</blockquote>}
          {!item.source_url && item.kind !== 'image' && item.content && (board.can_edit && editingText === item.id
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onBlur={() => saveText(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="4" maxLength="10000" /></div>
            : <p className="board-editable-text" style={{ textAlign: item.text_align || 'left' }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (!board.can_edit) return; if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelectedItems(mergeSelection(selectedItems, [item.id], selectionMode(event))); return; } setSelectedItems([item.id]); setTextDraft(item.content); setEditingText(item.id); }}>{item.content}</p>)}
          {(item.source_url || item.kind === 'image') && (item.content || board.can_edit) && (board.can_edit && editingDescription === item.id
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} onBlur={() => saveDescription(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="3" maxLength="10000" /></div>
            : <p className={`board-youtube-description${item.content ? '' : ' empty'}`} style={{ textAlign: item.text_align || 'left' }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { if (!board.can_edit) return; if (event.shiftKey || event.metaKey || event.ctrlKey) { setSelectedItems(mergeSelection(selectedItems, [item.id], selectionMode(event))); return; } setSelectedItems([item.id]); setDescriptionDraft(item.content || ''); setEditingDescription(item.id); }}>{item.content || 'Add description'}</p>)}
          {item.kind === 'excerpt' && item.source_url && <a className="board-excerpt-source" href={item.source_url} target="_blank" rel="noreferrer" onPointerDown={(event) => event.stopPropagation()}>{item.source_label || 'Open source'}</a>}
          </div>
          {selectedItems.length === 1 && selectedItems[0] === item.id && menuItem === item.id && (board.can_edit || item.source_url || item.kind !== 'comment') && <div className="board-item-menu" onPointerDown={(e) => e.stopPropagation()}>
            {item.source_url && <button onClick={() => window.open(item.source_url, '_blank', 'noopener,noreferrer')}>{item.kind === 'youtube' ? 'Open video' : 'Open page'}</button>}
            {item.kind !== 'comment' && <button onClick={() => downloadBoardFile(item)}>Download</button>}
            {board.can_edit && <button type="button" className="remove" disabled={busy} onClick={() => removeItem(item)}>Remove card</button>}
          </div>}
          {board.can_edit && selectedItems.length === 1 && selectedItems[0] === item.id && <button className="board-resize-handle" aria-label="Resize card" onPointerDown={(event) => startResize(event, item)} />}
        </article>)}
      </div>
    </main>
  </div>;
}
