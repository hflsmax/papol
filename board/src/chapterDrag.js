export const CHAPTER_GAP = 18;
export const CHAPTER_MIN_HEIGHT = 74;
export const DRAG_THRESHOLD_PX = 4;
export const DEFAULT_CARD_WIDTH = 300;
export const COLLECTION_TIDY_GAP = 80;

export function exceedsDragThreshold(startX, startY, clientX, clientY) {
  return Math.hypot(clientX - startX, clientY - startY) > DRAG_THRESHOLD_PX;
}

export function cardCenter(position, width, height) {
  return { x: position.x + width / 2, y: position.y + height / 2 };
}

export function chapterDropTarget(chapters, center, originGroupId = null) {
  return chapters.find((chapter) => {
    const horizontal = center.x >= chapter.x && center.x <= chapter.x + chapter.width;
    if (originGroupId != null) return chapter.id === originGroupId && horizontal;
    return horizontal && center.y >= chapter.y && center.y <= chapter.y + chapter.height;
  }) || null;
}

export function chapterInsertionIndex(members, draggedCenterY) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const index = sorted.findIndex((member) => draggedCenterY <= member.y + member.height / 2);
  return index < 0 ? sorted.length : index;
}

export function stackWithInsertion(members, dragged, groupId, anchor = null) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const insertAt = chapterInsertionIndex(sorted, dragged.centerY);
  const x = anchor?.x ?? (sorted.length ? Math.min(...sorted.map((member) => member.x)) : dragged.x);
  let y = anchor?.y ?? (sorted.length ? Math.min(...sorted.map((member) => member.y)) : dragged.y);
  const order = [...sorted];
  order.splice(insertAt, 0, dragged);
  const positions = order.map((member) => {
    const position = { id: member.id, group_id: groupId, x, y };
    y += member.height + CHAPTER_GAP;
    return position;
  });
  return { positions, insertAt };
}

export function stackWithout(members, removedId, groupId) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const remaining = sorted.filter((member) => member.id !== removedId);
  if (!sorted.length) return [];
  const x = Math.min(...sorted.map((member) => member.x));
  let y = Math.min(...sorted.map((member) => member.y));
  return remaining.map((member) => {
    const position = { id: member.id, group_id: groupId, x, y };
    y += member.height + CHAPTER_GAP;
    return position;
  });
}

export function previewChapterHeight(chapterY, positions, heights) {
  if (!positions.length) return CHAPTER_MIN_HEIGHT;
  const bottom = Math.max(...positions.map((position) => position.y + heights.get(position.id)));
  return Math.max(CHAPTER_MIN_HEIGHT, bottom - chapterY);
}

export function membershipHistorySnapshots(items, draggedId, targetGroupId, destination, originLayout = [], targetLayout = []) {
  const affectedIds = new Set([
    draggedId,
    ...originLayout.map((position) => position.id),
    ...targetLayout.map((position) => position.id),
  ]);
  const before = items
    .filter((item) => affectedIds.has(item.id))
    .map((item) => ({ id: item.id, group_id: item.group_id || null, x: item.x, y: item.y }));
  const afterById = new Map(before.map((item) => [item.id, { ...item }]));
  originLayout.forEach((position) => afterById.set(position.id, { ...position }));
  targetLayout.forEach((position) => afterById.set(position.id, { ...position }));
  afterById.set(draggedId, { id: draggedId, group_id: targetGroupId || null, x: destination.x, y: destination.y });
  return { before, after: [...afterById.values()] };
}

export function tidyCollectionPositions(cards, maxGap = COLLECTION_TIDY_GAP) {
  const placed = [];
  return cards.map((card) => {
    const current = { ...card };
    const overlaps = placed.some((other) => !(
      current.x + current.width <= other.x || other.x + other.width <= current.x
      || current.y + current.height <= other.y || other.y + other.height <= current.y
    ));
    if (!placed.length || overlaps) { placed.push(current); return { id: current.id, x: current.x, y: current.y }; }
    const nearest = placed.map((other) => {
      const dx = Math.max(0, other.x - (current.x + current.width), current.x - (other.x + other.width));
      const dy = Math.max(0, other.y - (current.y + current.height), current.y - (other.y + other.height));
      return { other, gap: Math.hypot(dx, dy) };
    }).sort((a, b) => a.gap - b.gap)[0];
    if (nearest.gap > maxGap) {
      const fromX = current.x + current.width / 2; const fromY = current.y + current.height / 2;
      const toX = nearest.other.x + nearest.other.width / 2; const toY = nearest.other.y + nearest.other.height / 2;
      const distance = Math.hypot(toX - fromX, toY - fromY) || 1;
      const amount = nearest.gap - maxGap;
      current.x += (toX - fromX) / distance * amount;
      current.y += (toY - fromY) / distance * amount;
    }
    placed.push(current);
    return { id: current.id, x: current.x, y: current.y };
  });
}
