import React, { useEffect, useRef, useState } from 'react';
import { boardFileBlob } from '../../../shared/api/boards.js';
import { nativeDataActive } from '../../../shared/nativeData.js';
import Glyph from './DesktopGlyph';

// A board seen from a distance: each card drawn where it sits, at its size,
// fitted to the frame. Pictures are drawn in where a card has one — from the
// card's own address on the web, from the replica's copy on the Mac.

const previewCardHeight = (item) => {
  if (['image', 'youtube', 'bilibili', 'webpage'].includes(item.kind)) return 180;
  if (item.kind === 'excerpt') return 145;
  if (item.kind === 'file') return 82;
  return 112;
};

const previewCardLabel = (item) => item.content || item.excerpt_text || item.original_filename || item.source_label || {
  comment: 'Thought', excerpt: 'Excerpt', image: 'Image', file: 'File', youtube: 'YouTube video', bilibili: 'Bilibili video', webpage: 'Webpage',
}[item.kind] || 'Card';

const hasPicture = (item) => ['image', 'youtube', 'bilibili', 'webpage'].includes(item.kind)
  && Boolean(item.sha256 || item.file_path);

// The web draws a card's picture straight from its address. The Mac reads the
// bytes out of the replica into an object URL, which is let go when it is no
// longer shown.
function usePictures(items) {
  const [urls, setUrls] = useState({});
  const blobs = useRef({});
  const pictured = items.filter(hasPicture);
  const key = pictured.map((item) => `${item.uuid}:${item.sha256 || item.file_path}`).join(',');

  useEffect(() => {
    if (!nativeDataActive()) {
      setUrls(Object.fromEntries(pictured.filter((item) => item.file_url).map((item) => [item.uuid, item.file_url])));
      return undefined;
    }
    let active = true;
    const wanted = new Map(pictured.map((item) => [item.uuid, `${item.sha256 || item.file_path}`]));
    for (const [uuid, held] of Object.entries(blobs.current)) {
      if (wanted.get(uuid) === held.source) continue;
      URL.revokeObjectURL(held.url);
      delete blobs.current[uuid];
    }
    const current = () => Object.fromEntries(Object.entries(blobs.current).map(([uuid, held]) => [uuid, held.url]));
    setUrls(current());
    pictured.forEach(async (item) => {
      if (blobs.current[item.uuid]) return;
      try {
        const url = await boardFileBlob(item);
        if (!active) { URL.revokeObjectURL(url); return; }
        blobs.current[item.uuid] = { url, source: wanted.get(item.uuid) };
        setUrls(current());
      } catch (error) {
        console.warn('Could not load board preview image', item.uuid, error);
      }
    });
    return () => { active = false; };
  }, [key]);

  useEffect(() => () => {
    Object.values(blobs.current).forEach((held) => URL.revokeObjectURL(held.url));
    blobs.current = {};
  }, []);

  return urls;
}

export default function BoardPreview({ board, onOpen }) {
  const items = board.items || [];
  const pictures = usePictures(items);
  const opening = {
    role: 'button',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onOpen();
    },
  };

  if (!items.length) {
    return (
      <div className="board-preview empty" {...opening} aria-label="Open this empty board">
        <Glyph name="boards" />
        <strong>This board is empty</strong>
        {board.can_edit && <span>Open it to add a thought, drop a file, or paste a link.</span>}
      </div>
    );
  }

  const cards = items
    .map((item) => ({ ...item, width: item.width || 300, previewHeight: previewCardHeight(item) }))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  // The cards' own bounding box and a small margin around it; the frame
  // takes the box's proportions, so the cards fill it.
  const left = Math.min(...cards.map((item) => item.x));
  const top = Math.min(...cards.map((item) => item.y));
  const right = Math.max(...cards.map((item) => item.x + item.width));
  const bottom = Math.max(...cards.map((item) => item.y + item.previewHeight));
  const margin = Math.max(24, 0.03 * Math.max(right - left, bottom - top));
  const minX = left - margin;
  const minY = top - margin;
  const maxX = right + margin;
  const maxY = bottom + margin;
  const ratio = (maxX - minX) / (maxY - minY);

  return (
    <div
      className="board-preview"
      {...opening}
      style={{ '--preview-ratio': ratio }}
      aria-label={`Open ${board.name}`}
      title="Open board"
    >
      <svg
        viewBox={`${minX} ${minY} ${Math.max(1, maxX - minX)} ${Math.max(1, maxY - minY)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Preview of ${board.name}, containing ${items.length} ${items.length === 1 ? 'card' : 'cards'}`}
      >
        {cards.map((item) => {
          const label = previewCardLabel(item).replace(/\s+/g, ' ').trim();
          const clipped = label.length > 38 ? `${label.slice(0, 37)}…` : label;
          const clip = `board-preview-clip-${item.uuid}`;
          return (
            <g key={item.uuid} className={`board-preview-card ${item.kind}`}>
              <title>{label}</title>
              <rect x={item.x} y={item.y} width={item.width} height={item.previewHeight} rx="8" />
              <line x1={item.x} y1={item.y + 32} x2={item.x + item.width} y2={item.y + 32} />
              <text className="kind" x={item.x + 13} y={item.y + 21}>{item.kind}</text>
              {pictures[item.uuid] ? (
                <>
                  <clipPath id={clip}>
                    <rect x={item.x + 1} y={item.y + 33} width={item.width - 2} height={item.previewHeight - 34} rx="7" />
                  </clipPath>
                  <image
                    href={pictures[item.uuid]}
                    x={item.x + 1}
                    y={item.y + 33}
                    width={item.width - 2}
                    height={item.previewHeight - 34}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${clip})`}
                  />
                </>
              ) : <text x={item.x + 13} y={item.y + 58}>{clipped}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
