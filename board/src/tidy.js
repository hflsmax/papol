// The board's gentle tidy, as pure geometry (docs/tidying.md). The board is
// a set of blocks — a group with its heading and frame, or a loose card —
// and tidying stops them overlapping without otherwise moving them: a block
// that overlaps nothing stays exactly where it is, one that does moves the
// shortest way right or down that clears, and then settles on the grid the
// canvas draws. Inside a freeform collection the same is done to its cards,
// after drawing in any that have strayed. Each result is a fixed point, so
// tidying a tidy board changes nothing.
import { tidyCollectionPositions } from './bookletDrag.js';

export const GRID = 24;
export const BLOCK_GUTTER = 24;
export const CARD_GUTTER = 18;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width
  && a.y < b.y + b.height && b.y < a.y + a.height;
// Groups hold their ground and loose cards make way for them; among
// equals, the one read first stays.
const readingOrder = (a, b) => (a.rank || 0) - (b.rank || 0) || a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id));
const ceilTo = (value, step) => Math.ceil(value / step - 1e-9) * step;

// Push `rect` along one axis until it overlaps none of `placed`. Every step
// only increases the coordinate, so it ends.
function clearAlong(rect, placed, axis, gutter, grid) {
  let next = { ...rect };
  for (let guard = 0; guard <= placed.length * 2 + 2; guard += 1) {
    const hits = placed.filter((other) => overlaps(next, other));
    if (!hits.length) return next;
    const edge = axis === 'x'
      ? Math.max(...hits.map((other) => other.x + other.width)) + gutter
      : Math.max(...hits.map((other) => other.y + other.height)) + gutter;
    next = { ...next, [axis]: grid ? ceilTo(edge, grid) : edge };
  }
  return next;
}

/**
 * Where each block must go so none overlap. `blocks` are
 * `{ id, x, y, width, height, movable, rank }`; immovable blocks are
 * obstacles, and a lower rank is placed first.
 * Returns the blocks that moved, as `{ id, x, y, dx, dy }`.
 */
export function resolveOverlaps(blocks, { gutter = BLOCK_GUTTER, grid = GRID } = {}) {
  const placed = blocks.filter((block) => !block.movable).map((block) => ({ ...block }));
  const moves = [];
  [...blocks].filter((block) => block.movable).sort(readingOrder).forEach((block) => {
    if (!placed.some((other) => overlaps(block, other))) { placed.push({ ...block }); return; }
    const start = grid ? { ...block, x: ceilTo(block.x, grid), y: ceilTo(block.y, grid) } : block;
    const right = clearAlong(start, placed, 'x', gutter, grid);
    const down = clearAlong(start, placed, 'y', gutter, grid);
    const distance = (candidate) => Math.hypot(candidate.x - block.x, candidate.y - block.y);
    const chosen = distance(right) < distance(down) ? right : down;
    placed.push(chosen);
    moves.push({ id: block.id, x: chosen.x, y: chosen.y, dx: chosen.x - block.x, dy: chosen.y - block.y });
  });
  return moves;
}

/**
 * A freeform collection's cards, drawn in and pulled apart until neither
 * changes anything. `cards` are `{ uuid, x, y, width, height }`; returns the
 * cards with their tidied `x` and `y`.
 */
export function tidyFreeformCards(cards) {
  let current = cards.map((card) => ({ ...card }));
  for (let round = 0; round < 6; round += 1) {
    const drawn = new Map(tidyCollectionPositions(current).map((position) => [position.uuid, position]));
    const pulled = current.map((card) => {
      const position = drawn.get(card.uuid);
      // A card already within reach is left exactly where it is.
      return Math.hypot(position.x - card.x, position.y - card.y) > 0.5 ? { ...card, x: position.x, y: position.y } : card;
    });
    const separated = new Map(resolveOverlaps(
      pulled.map((card) => ({ ...card, id: card.uuid, movable: true })),
      { gutter: CARD_GUTTER, grid: 0 },
    ).map((move) => [move.id, move]));
    const next = pulled.map((card) => separated.has(card.uuid) ? { ...card, x: separated.get(card.uuid).x, y: separated.get(card.uuid).y } : card);
    const changed = next.some((card, index) => card.x !== current[index].x || card.y !== current[index].y);
    current = next;
    if (!changed) break;
  }
  return current;
}

/**
 * The nearest place to `rect` where it overlaps none of `obstacles`,
 * searched outward on the grid; `rect` itself when it is already free.
 */
export function nearestFreeSpot(rect, obstacles, { gutter = BLOCK_GUTTER, grid = GRID } = {}) {
  const padded = obstacles.map((other) => ({
    x: other.x - gutter, y: other.y - gutter, width: other.width + gutter * 2, height: other.height + gutter * 2,
  }));
  const free = (candidate) => !padded.some((other) => overlaps(candidate, other));
  if (free(rect)) return { x: rect.x, y: rect.y };
  const originX = Math.round(rect.x / grid) * grid;
  const originY = Math.round(rect.y / grid) * grid;
  for (let ring = 1; ring <= 200; ring += 1) {
    const candidates = [];
    for (let step = -ring; step <= ring; step += 1) {
      candidates.push([step, -ring], [step, ring], [-ring, step], [ring, step]);
    }
    const found = candidates
      .map(([i, j]) => ({ ...rect, x: originX + i * grid, y: originY + j * grid }))
      .filter(free)
      .sort((a, b) => Math.hypot(a.x - rect.x, a.y - rect.y) - Math.hypot(b.x - rect.x, b.y - rect.y) || a.y - b.y || a.x - b.x)[0];
    if (found) return { x: found.x, y: found.y };
  }
  return { x: rect.x, y: rect.y };
}
