// One round of giving a board's cards the pictures they are missing
// (BoardPage): each card of `due` asked of `fill` in turn, a card that
// cannot be had now passed over quietly — it stays a link until the next
// visit — and the count of cards that were filled answered, so the board
// knows whether to load again.
export async function fillPictures(due, fill) {
  let filled = 0;
  for (const item of due) {
    try {
      if (await fill(item)) filled += 1;
    } catch {
      // Out of reach: the next card is tried all the same.
    }
  }
  return filled;
}
