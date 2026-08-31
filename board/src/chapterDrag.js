export const CHAPTER_GAP = 18;
export const CHAPTER_MIN_HEIGHT = 74;
export const DRAG_THRESHOLD_PX = 4;

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

export function stackWithInsertion(members, dragged, groupId, anchor = null) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  let insertAt = sorted.findIndex((member) => dragged.centerY < member.y + member.height / 2);
  if (insertAt < 0) insertAt = sorted.length;
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
