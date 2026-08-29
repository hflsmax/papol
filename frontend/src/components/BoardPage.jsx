import React, { useEffect, useRef, useState } from 'react';
import { addBoardFile, addBoardYouTube, boardFileBlob, downloadBoardFile, deleteBoardItem, getBoard, moveBoardItem, restoreBoardItem, updateBoard, updateBoardItem } from '../api';
import ExperimentalBadge from './ExperimentalBadge';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const defaultBoardView = () => ({ x: window.innerWidth / 2 - 150, y: 150, zoom: 1 });
const savedBoardView = (boardId) => {
  try {
    const value = JSON.parse(localStorage.getItem(`papol_board_view_${boardId}`));
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.zoom)) {
      return { x: value.x, y: value.y, zoom: clamp(value.zoom, 0.25, 3) };
    }
  } catch { /* a damaged local preference should not stop the board opening */ }
  return defaultBoardView();
};

function AlignGlyph({ align }) {
  const starts = align === 'left' ? [2, 2, 2] : align === 'center' ? [2, 5, 3] : [2, 8, 4];
  const widths = [16, 10, 14];
  return <svg className="board-align-glyph" viewBox="0 0 20 16" aria-hidden="true">{starts.map((x, index) => <line key={index} x1={x} x2={x + widths[index]} y1={3 + index * 5} y2={3 + index * 5} />)}</svg>;
}

export default function BoardPage({ boardId, onBack }) {
  const [board, setBoard] = useState(null);
  const [view] = useState(() => savedBoardView(boardId));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [imageUrls, setImageUrls] = useState({});
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [youtubeLoading, setYoutubeLoading] = useState([]);
  const [editingDescription, setEditingDescription] = useState(null);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingText, setEditingText] = useState(null);
  const [textDraft, setTextDraft] = useState('');
  const gesture = useRef(null);
  const touches = useRef(new Map());
  const viewportRef = useRef(null);
  const stageRef = useRef(null);
  const viewRef = useRef(view);
  const viewFrame = useRef(null);
  const pendingView = useRef(view);
  const viewSaveTimer = useRef(null);
  const activeBoardId = useRef(boardId);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const load = () => getBoard(boardId).then(setBoard).catch((err) => setError(err.message));

  useEffect(() => {
    if (viewSaveTimer.current != null) {
      clearTimeout(viewSaveTimer.current);
      viewSaveTimer.current = null;
      try {
        localStorage.setItem(`papol_board_view_${activeBoardId.current}`, JSON.stringify(viewRef.current));
      } catch { /* best effort while switching boards */ }
    }
    activeBoardId.current = boardId;
    const restored = savedBoardView(boardId);
    viewRef.current = restored;
    pendingView.current = restored;
    paintView(restored);
    load();
  }, [boardId]);
  useEffect(() => { document.body.classList.add('board-workspace-open'); return () => document.body.classList.remove('board-workspace-open'); }, []);
  const imageIds = board?.items.filter((item) => ['image', 'youtube'].includes(item.kind)).map((item) => item.id).join(',') || '';
  useEffect(() => {
    if (!board) return undefined;
    let active = true; const urls = [];
    Promise.all(board.items.filter((item) => ['image', 'youtube'].includes(item.kind)).map(async (item) => {
      const url = await boardFileBlob(item); urls.push(url); return [item.id, url];
    })).then((entries) => { if (active) setImageUrls(Object.fromEntries(entries)); }).catch(() => {});
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [imageIds]);

  const paintView = (next) => {
    if (stageRef.current) stageRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
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
    if (!board) return undefined;
    const handlePaste = async (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (!text) return;
      let parsed;
      try { parsed = new URL(text); } catch { return; }
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (host !== 'youtu.be' && host !== 'youtube.com' && host !== 'm.youtube.com') return;
      event.preventDefault();
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const current = viewRef.current;
      const x = (bounds.width / 2 - current.x) / current.zoom - 150;
      const y = (bounds.height / 2 - current.y) / current.zoom - 100;
      const loadingId = `${Date.now()}-${Math.random()}`;
      setYoutubeLoading((items) => [...items, { id: loadingId, x, y }]);
      setBusy(true); setError(null);
      try {
        const item = await addBoardYouTube(board.guid, text, x, y);
        undoStack.current.push({ type: 'add', id: item.id });
        redoStack.current = [];
        await load();
        setSelectedItem(item.id);
      } catch (err) { setError(err.message); } finally {
        setYoutubeLoading((items) => items.filter((item) => item.id !== loadingId));
        setBusy(false);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [board?.id]);
  const startPan = (event) => {
    if (event.button !== 0 || event.target.closest('.board-canvas-card')) return;
    setSelectedItem(null);
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
      gesture.current = { type: 'select', sx: event.clientX, sy: event.clientY, point };
      setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    gesture.current = { type: 'pan', sx: event.clientX, sy: event.clientY, origin: viewRef.current };
  };
  const startDrag = (event, item) => {
    if (event.button !== 0 || event.target.closest('button,a')) return;
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { type: 'item', id: item.id, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y, element: event.currentTarget };
  };
  const startResize = (event, item) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      type: 'resize', id: item.id, sx: event.clientX,
      width: item.width || 300, element: event.currentTarget.closest('.board-canvas-card'),
    };
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
    } else if (g.type === 'pan') queueView({ ...g.origin, x: g.origin.x + event.clientX - g.sx, y: g.origin.y + event.clientY - g.sy });
    else if (g.type === 'item') {
      const zoom = viewRef.current.zoom;
      g.current = { x: g.x + (event.clientX - g.sx) / zoom, y: g.y + (event.clientY - g.sy) / zoom };
      g.element.style.transform = `translate(${g.current.x}px, ${g.current.y}px)`;
    } else if (g.type === 'resize') {
      g.current = clamp(g.width + (event.clientX - g.sx) / viewRef.current.zoom, 120, 1200);
      g.element.style.width = `${g.current}px`;
    }
  };
  const endGesture = (event) => {
    const g = gesture.current; gesture.current = null;
    if (event?.pointerType === 'touch') {
      touches.current.delete(event.pointerId);
      const remaining = [...touches.current.values()][0];
      if (remaining) gesture.current = { type: 'pan', sx: remaining.x, sy: remaining.y, origin: viewRef.current };
    }
    if (g?.type === 'item') {
      const item = board.items.find((candidate) => candidate.id === g.id);
      if (item) {
        const point = g.current || { x: g.x, y: g.y };
        const moved = Math.hypot(point.x - g.x, point.y - g.y) > 2;
        if (moved) {
          undoStack.current.push({ type: 'move', id: item.id, from: { x: g.x, y: g.y }, to: point });
          redoStack.current = [];
          setBoard((current) => ({ ...current, items: current.items.map((candidate) => candidate.id === item.id ? { ...candidate, ...point } : candidate) }));
          moveBoardItem(item.id, point.x, point.y).catch((err) => setError(err.message));
        }
        else setSelectedItem((current) => current === item.id ? null : item.id);
      }
    }
    if (g?.type === 'resize') {
      const width = g.current ?? g.width;
      if (Math.abs(width - g.width) > 1) {
        undoStack.current.push({ type: 'resize', id: g.id, from: g.width, to: width });
        redoStack.current = [];
        setBoard((current) => ({ ...current, items: current.items.map((item) => item.id === g.id ? { ...item, width } : item) }));
        updateBoardItem(g.id, { width }).catch((err) => setError(err.message));
      }
    }
    if (g?.type === 'select') {
      const x1 = Math.min(g.sx, g.current?.clientX ?? g.sx);
      const y1 = Math.min(g.sy, g.current?.clientY ?? g.sy);
      const x2 = Math.max(g.sx, g.current?.clientX ?? g.sx);
      const y2 = Math.max(g.sy, g.current?.clientY ?? g.sy);
      if (x2 - x1 > 3 || y2 - y1 > 3) {
        const cards = [...viewportRef.current.querySelectorAll('.board-canvas-card')];
        const hit = cards.reverse().find((card) => {
          const rect = card.getBoundingClientRect();
          return rect.left < x2 && rect.right > x1 && rect.top < y2 && rect.bottom > y1;
        });
        setSelectedItem(hit ? Number(hit.dataset.itemId) : null);
      }
      setMarquee(null);
    }
  };
  const removeItem = async (item, ask = true) => {
    if (ask && !window.confirm('Remove this item?')) return;
    setBusy(true); setError(null);
    try {
      await deleteBoardItem(item.id);
      undoStack.current.push({ type: 'delete', id: item.id });
      redoStack.current = [];
      setSelectedItem(null);
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
      } else if (action.type === 'resize') {
        await updateBoardItem(action.id, { width: direction === 'undo' ? action.from : action.to });
      } else if (action.type === 'delete') {
        if (direction === 'undo') await restoreBoardItem(action.id);
        else await deleteBoardItem(action.id);
      } else {
        if (direction === 'undo') await deleteBoardItem(action.id);
        else await restoreBoardItem(action.id);
      }
      destination.push(action);
      setSelectedItem(null);
      await load();
    } catch (err) {
      source.push(action);
      setError(err.message);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedItem(null);
        setMarquee(null);
        setEditingDescription(null);
        setEditingText(null);
        gesture.current = null;
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
        event.preventDefault();
        applyHistory(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (!['Delete', 'Backspace'].includes(event.key) || selectedItem == null || busy) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      const item = board?.items.find((candidate) => candidate.id === selectedItem);
      if (!item) return;
      event.preventDefault();
      removeItem(item, false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, busy, board]);
  const dropFiles = async (event) => {
    event.preventDefault(); setDraggingFiles(false);
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

  if (error && !board) return <div className="error">{error}</div>;
  if (!board) return <div className="loading">Loading board…</div>;
  return <div className="infinite-board">
    <header className="board-toolbar">
      <button className="board-back" onClick={onBack}>← <span>Back</span></button>
      <input className="board-toolbar-title" value={board.name} aria-label="Board name" maxLength="120" onChange={(e) => setBoard({ ...board, name: e.target.value })} onBlur={(e) => e.target.value.trim() && updateBoard(board.guid, { name: e.target.value.trim() })} />
      <span className="board-toolbar-spacer" />
      <ExperimentalBadge />
    </header>
    {error && <div className="board-canvas-error">{error}</div>}
    <main ref={viewportRef} className={`board-viewport${draggingFiles ? ' file-dragging' : ''}`} style={{ '--board-grid-size': `${24 * view.zoom}px`, '--board-grid-dot': `${Math.max(.55, .75 * view.zoom)}px`, '--board-grid-x': `${view.x}px`, '--board-grid-y': `${view.y}px` }} onPointerDown={startPan} onPointerMove={move} onPointerUp={endGesture} onPointerCancel={endGesture} onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDraggingFiles(true); } }} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDraggingFiles(false); }} onDrop={dropFiles}>
      {draggingFiles && <div className="board-drop-target">Drop files anywhere on the board</div>}
      {marquee && <div className="board-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      <div ref={stageRef} className="board-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        {youtubeLoading.map((item) => <div key={item.id} className="board-youtube-loading" style={{ transform: `translate(${item.x}px, ${item.y}px)` }}><span className="board-loading-spinner" aria-hidden="true" /><span>Loading video frame…</span></div>)}
        {board.items.map((item) => <article key={item.id} data-item-id={item.id} className={`board-canvas-card ${item.kind}${selectedItem === item.id ? ' selected' : ''}`} style={{ width: item.width || 300, transform: `translate(${item.x}px, ${item.y}px)` }} onPointerDown={(e) => startDrag(e, item)}>
          {['image', 'youtube'].includes(item.kind) && imageUrls[item.id] && <img src={imageUrls[item.id]} alt={item.content || item.original_filename || 'Board image'} draggable="false" />}
          {item.kind === 'file' && <div className="board-canvas-file">↧ {item.original_filename}</div>}
          {!item.source_url && item.content && (editingText === item.id
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onBlur={() => saveText(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="4" maxLength="10000" /></div>
            : <p className="board-editable-text" style={{ textAlign: item.text_align || 'left' }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedItem(item.id); setTextDraft(item.content); setEditingText(item.id); }}>{item.content}</p>)}
          {item.source_url && (editingDescription === item.id
            ? <div className="board-inline-text-editor" onPointerDown={(event) => event.stopPropagation()}><div className="board-inline-format" role="group" aria-label="Text alignment"><button type="button" className={(item.text_align || 'left') === 'left' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'left')} title="Align left"><AlignGlyph align="left" /></button><button type="button" className={item.text_align === 'center' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'center')} title="Align center"><AlignGlyph align="center" /></button><button type="button" className={item.text_align === 'right' ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => alignText(item, 'right')} title="Align right"><AlignGlyph align="right" /></button></div><textarea className="board-inline-description" style={{ textAlign: item.text_align || 'left' }} autoFocus value={descriptionDraft} onChange={(event) => setDescriptionDraft(event.target.value)} onBlur={() => saveDescription(item)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur(); }} rows="3" maxLength="10000" /></div>
            : <p className={`board-youtube-description${item.content ? '' : ' empty'}`} style={{ textAlign: item.text_align || 'left' }} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedItem(item.id); setDescriptionDraft(item.content || ''); setEditingDescription(item.id); }}>{item.content || 'Add description'}</p>)}
          {selectedItem === item.id && <div className="board-item-menu" onPointerDown={(e) => e.stopPropagation()}>
            {item.source_url && <button onClick={() => window.open(item.source_url, '_blank', 'noopener,noreferrer')}>Open video</button>}
            {item.kind !== 'comment' && <button onClick={() => downloadBoardFile(item)}>Download</button>}
            <button type="button" className="remove" disabled={busy} onClick={() => removeItem(item)}>Remove</button>
          </div>}
          {selectedItem === item.id && <button className="board-resize-handle" aria-label="Resize item" onPointerDown={(event) => startResize(event, item)} />}
        </article>)}
      </div>
    </main>
  </div>;
}
