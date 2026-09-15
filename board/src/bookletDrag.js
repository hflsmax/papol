export const BOOKLET_GAP = 18;
export const BOOKLET_MIN_HEIGHT = 74;
export const DRAG_THRESHOLD_PX = 4;
export const DEFAULT_CARD_WIDTH = 300;
export const COLLECTION_TIDY_GAP = 80;
export const COLLECTION_MASONRY_GAP = 18;

export function exceedsDragThreshold(startX, startY, clientX, clientY) {
  return Math.hypot(clientX - startX, clientY - startY) > DRAG_THRESHOLD_PX;
}

export function cardCenter(position, width, height) {
  return { x: position.x + width / 2, y: position.y + height / 2 };
}

export function bookletDropTarget(booklets, center, originGroupUuid = null) {
  return booklets.find((booklet) => {
    const horizontal = center.x >= booklet.x && center.x <= booklet.x + booklet.width;
    if (originGroupUuid != null) return booklet.uuid === originGroupUuid && horizontal;
    return horizontal && center.y >= booklet.y && center.y <= booklet.y + booklet.height;
  }) || null;
}

export function bookletInsertionIndex(members, draggedCenterY) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const index = sorted.findIndex((member) => draggedCenterY <= member.y + member.height / 2);
  return index < 0 ? sorted.length : index;
}

export function stackWithInsertion(members, dragged, groupUuid, anchor = null) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const insertAt = bookletInsertionIndex(sorted, dragged.centerY);
  const x = anchor?.x ?? (sorted.length ? Math.min(...sorted.map((member) => member.x)) : dragged.x);
  let y = anchor?.y ?? (sorted.length ? Math.min(...sorted.map((member) => member.y)) : dragged.y);
  const order = [...sorted];
  order.splice(insertAt, 0, dragged);
  const positions = order.map((member) => {
    const position = { uuid: member.uuid, group_uuid: groupUuid, x, y };
    y += member.height + BOOKLET_GAP;
    return position;
  });
  return { positions, insertAt };
}

export function stackWithout(members, removedUuid, groupUuid) {
  const sorted = [...members].sort((a, b) => a.y - b.y);
  const remaining = sorted.filter((member) => member.uuid !== removedUuid);
  if (!sorted.length) return [];
  const x = Math.min(...sorted.map((member) => member.x));
  let y = Math.min(...sorted.map((member) => member.y));
  return remaining.map((member) => {
    const position = { uuid: member.uuid, group_uuid: groupUuid, x, y };
    y += member.height + BOOKLET_GAP;
    return position;
  });
}

export function previewBookletHeight(bookletY, positions, heights) {
  if (!positions.length) return BOOKLET_MIN_HEIGHT;
  const bottom = Math.max(...positions.map((position) => position.y + heights.get(position.uuid)));
  return Math.max(BOOKLET_MIN_HEIGHT, bottom - bookletY);
}

export function membershipHistorySnapshots(items, draggedUuid, targetGroupUuid, destination, originLayout = [], targetLayout = []) {
  const affectedUuids = new Set([
    draggedUuid,
    ...originLayout.map((position) => position.uuid),
    ...targetLayout.map((position) => position.uuid),
  ]);
  const before = items
    .filter((item) => affectedUuids.has(item.uuid))
    .map((item) => ({ uuid: item.uuid, group_uuid: item.group_uuid || null, x: item.x, y: item.y }));
  const afterByUuid = new Map(before.map((item) => [item.uuid, { ...item }]));
  originLayout.forEach((position) => afterByUuid.set(position.uuid, { ...position }));
  targetLayout.forEach((position) => afterByUuid.set(position.uuid, { ...position }));
  afterByUuid.set(draggedUuid, { uuid: draggedUuid, group_uuid: targetGroupUuid || null, x: destination.x, y: destination.y });
  return { before, after: [...afterByUuid.values()] };
}

/** Apply a completed membership drag without re-fetching the whole board. */
export function applyMembershipLayout(board, draggedUuid, targetGroupUuid, destination, originLayout = [], targetLayout = []) {
  const dragged = board.items.find((item) => item.uuid === draggedUuid);
  const originGroupUuid = dragged?.group_uuid || null;
  const positions = new Map([
    ...originLayout.map((position) => [position.uuid, position]),
    ...targetLayout.map((position) => [position.uuid, position]),
    [draggedUuid, {
      uuid: draggedUuid,
      group_uuid: targetGroupUuid || null,
      x: destination.x,
      y: destination.y,
    }],
  ]);
  return {
    ...board,
    items: board.items.map((item) => {
      const position = positions.get(item.uuid);
      return position ? { ...item, ...position } : item;
    }),
    groups: board.groups.map((group) => {
      if (group.uuid === targetGroupUuid) {
        const itemUuids = targetLayout.length
          ? targetLayout.map((position) => position.uuid)
          : group.item_uuids.includes(draggedUuid)
            ? group.item_uuids
            : [...group.item_uuids, draggedUuid];
        return itemUuids === group.item_uuids ? group : { ...group, item_uuids: itemUuids };
      }
      if (group.uuid === originGroupUuid) {
        return { ...group, item_uuids: group.item_uuids.filter((uuid) => uuid !== draggedUuid) };
      }
      return group;
    }),
  };
}

export function tidyCollectionPositions(cards, maxGap = COLLECTION_TIDY_GAP) {
  const placed = [];
  return cards.map((card) => {
    const current = { ...card };
    const overlaps = placed.some((other) => !(
      current.x + current.width <= other.x || other.x + other.width <= current.x
      || current.y + current.height <= other.y || other.y + other.height <= current.y
    ));
    if (!placed.length || overlaps) { placed.push(current); return { uuid: current.uuid, x: current.x, y: current.y }; }
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
    return { uuid: current.uuid, x: current.x, y: current.y };
  });
}

function collectionMasonryLayoutInOrder(ordered, width, gap) {
  if (!ordered.length) return { columns: 0, rows: 0, positions: [] };
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const rows = Math.ceil(ordered.length / columns);
  const anchorX = Math.min(...ordered.map((card) => card.x));
  const anchorY = Math.min(...ordered.map((card) => card.y));
  const columnBottoms = Array(columns).fill(anchorY);
  return {
    columns,
    rows,
    positions: ordered.map((card) => {
      const column = columnBottoms.reduce(
        (shortest, bottom, index) => bottom < columnBottoms[shortest] ? index : shortest,
        0,
      );
      const position = { uuid: card.uuid, x: anchorX + column * (width + gap), y: columnBottoms[column] };
      columnBottoms[column] += card.height + gap;
      return position;
    }),
  };
}

export function collectionMasonryLayout(cards, width = DEFAULT_CARD_WIDTH, gap = COLLECTION_MASONRY_GAP) {
  const ordered = [...cards].sort((a, b) => a.y - b.y || a.x - b.x || a.uuid - b.uuid);
  return collectionMasonryLayoutInOrder(ordered, width, gap);
}

export function collectionReorderLayout(cards, draggedUuid, point, width = DEFAULT_CARD_WIDTH, gap = COLLECTION_MASONRY_GAP) {
  if (!cards.length) return { columns: 0, rows: 0, positions: [] };
  const dragged = cards.find((card) => card.uuid === draggedUuid);
  if (!dragged) return collectionMasonryLayout(cards, width, gap);
  const ordered = [...cards].sort((a, b) => a.y - b.y || a.x - b.x || a.uuid - b.uuid);
  const initial = collectionMasonryLayoutInOrder(ordered, width, gap);
  const byUuid = new Map(cards.map((card) => [card.uuid, card]));
  const center = { x: point.x + dragged.width / 2, y: point.y + dragged.height / 2 };
  const targetIndex = initial.positions.map((position, index) => {
    const occupant = byUuid.get(position.uuid);
    return {
      index,
      distance: Math.hypot(
        center.x - (position.x + occupant.width / 2),
        center.y - (position.y + occupant.height / 2),
      ),
    };
  }).sort((a, b) => a.distance - b.distance || a.index - b.index)[0].index;
  const withoutDragged = ordered.filter((card) => card.uuid !== draggedUuid);
  withoutDragged.splice(targetIndex, 0, dragged);
  return collectionMasonryLayoutInOrder(withoutDragged, width, gap);
}

export function boardPointFromClient(clientX, clientY, bounds, view, offset = {}) {
  return {
    x: (clientX - bounds.left - view.x) / view.zoom - (offset.x || 0),
    y: (clientY - bounds.top - view.y) / view.zoom - (offset.y || 0),
  };
}
