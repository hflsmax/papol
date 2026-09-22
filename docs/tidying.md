# One way to tidy a board

Status: **proposed**. Nothing here is built yet except where "Today" says so.
It replaces the four tidies the board has now with three verbs, each of
which means one thing wherever it appears.

## The story

> **US-5.10** As a user whose board has grown by pasting, dropping and
> dragging, I can make it tidy again without losing how I laid it out. I
> press one button and cards stop overlapping and line up. Nothing moves
> between groups, no booklet is reordered, and no card I deliberately
> widened shrinks. What changed is shown to me, and one Undo puts it back.
> When I do want a group laid out properly, I ask that group for it. When
> I want cards back at their standard size, I ask for that by name.

A board is a spatial document. Where a card sits is part of what it says:
two clusters far apart are far apart on purpose. So tidying is a matter of
straightening what is there, not a rearrangement the user did not ask for.

## Today

| Where | Label | What it does |
| --- | --- | --- |
| Board toolbar | Tidy | Every card to 300 px wide. Cards in a collection that are more than 80 px from their neighbours are pulled closer (`tidyCollectionPositions`). Loose cards are not moved. |
| Selection pill, card context menu | Tidy up / Tidy N Cards | The same, for the selected cards. |
| Collection options | Tidy up | The collection's cards to 300 px, then laid out in columns (`collectionMasonryLayout`). |
| Collection options | Auto-arrange | Columns that stay columns while cards are dragged. Widths are left as they are, and the column is as wide as the widest card. |
| Booklet | (none) | Always a stack, 18 px apart, re-laid out whenever a card changes height and when the board opens. |

What this gets wrong:

1. **"Tidy" means three different things.** The toolbar resizes cards and
   nudges them. The collection's Tidy up lays them out in columns. And
   "tidy" in a collection overlaps with Auto-arrange, which does the same
   layout without the resize.
2. **It doesn't fix the actual mess.** Pasted and dropped cards land at the
   centre of the view, 28 px apart, on top of whatever is already there.
   No tidy separates overlapping loose cards, or a group that has been
   dragged over another group.
3. **It throws away deliberate sizes.** A screenshot widened to 600 px so
   its text can be read goes back to 300 px with everything else.
4. **Board Tidy breaks auto-arranged collections.** It narrows their cards
   and nudges them instead of re-flowing them, so the collection is left
   out of columns until something is dragged in it.
5. **No feedback, and no visible way back.** When nothing needs doing, the
   button does nothing and says nothing. Undo is ⌘Z, or the desktop's
   right-click menu; the web shows no Undo anywhere.

## The design: three verbs

| Verb | Scope | Promise |
| --- | --- | --- |
| **Tidy up** | Board, or selection | Stops overlaps and lines things up. It never changes a card's size, which group a card is in, the order of a booklet, or a collection's layout mode. It is safe to press at any time, and pressing it twice does nothing the second time. |
| **Arrange** | One group | Puts the group into its form at the standard card width: a collection into columns, a booklet into a stack. **Auto-arrange** is Arrange that stays on. |
| **Reset size** | Card, or selection | Back to 300 px wide. Nothing else. |

The rule underneath: **the wider the scope, the gentler the change.** The
board-wide button only straightens. Rearranging and resizing happen only
where the user pointed, and only when they asked by name.

### Tidy up (board and selection)

Tidy up treats the board as **blocks**. A block is either a group, with
its heading and frame, or a loose card.

1. **Inside freeform collections**, cards that overlap are separated, and
   cards more than 80 px from their nearest neighbour are pulled in. This
   is today's `tidyCollectionPositions` with overlap resolution added.
   Auto-arranged collections and booklets are already in their form and
   are left alone inside.
2. **Between blocks**, overlaps are resolved in reading order (top to
   bottom, then left to right). Each block that overlaps one already placed
   moves the shortest distance right or down that clears it, plus a 24 px
   gutter. Blocks that don't overlap anything stay where they are, and
   relative order is never swapped.
3. **Every block that moved snaps its top-left corner** to the 24 px grid
   the canvas already draws. Blocks that did not move are not snapped, so
   a tidy board stays put.
4. Big empty spaces between blocks are **kept**. Distance is meaning. Tidy
   does not pull a far-away cluster back towards the rest.

For a selection, only the selected blocks move. Everything else on the
board counts as an obstacle they must not overlap. Selecting every card in
a group selects the group as a block.

The layout is a pure function, `tidyBoardPositions(blocks) → moves`, in a
new `board/src/tidy.js` beside `bookletDrag.js`. It is unit-tested for
three things: it is deterministic, running it on its own output changes
nothing, and it never produces an overlap.

### Arrange (one group)

- **Collection, Freeform:** the group's options bar shows **Arrange into
  columns** in place of today's Tidy up. It lays the cards out in columns
  at 300 px, as `tidyCollection` does now, and the collection stays
  Freeform.
- **Collection, Auto-arrange:** turning it on *is* arranging. The cards go
  to 300 px and into columns in one undo step, so the bar needs no Arrange
  button in this mode. (Today turning it on keeps each card's width.)
- **Booklet:** always in its form. Nothing to offer, and nothing changes.

### Reset size (card and selection)

- A card's actions and its context menu gain **Reset size**, shown only
  when the card is not already 300 px.
- The selection pill's "Tidy up" becomes **Tidy up** (the gentle kind)
  plus **Reset size**.
- Resizing every card on the board, today's toolbar behaviour, is still
  two steps: ⌘A, then Reset size.

### What the user sees

- Moved cards and groups **glide** to their new places, using the same
  180 ms transition as a reorder, and not at all under
  `prefers-reduced-motion`.
- A **status toast** under the toolbar says what happened and offers the
  way back: "Tidied 6 cards and 1 collection · **Undo**". If nothing needed
  doing it says "Already tidy" and no undo step is added. The toast goes
  after 6 s or on the next edit. It is the board's first on-screen Undo,
  and Arrange and Reset size use it too.
- Every tidy, arrange or reset is **one undo step**. It is recorded as
  before/after snapshots of positions, widths and group layouts, the shape
  the `membership` history entry already uses.
- The toolbar button keeps its name and icon. Its tooltip becomes "Tidy
  up: clear overlaps and line things up".

### Where each verb lives

| Surface | Tidy up | Arrange | Reset size |
| --- | --- | --- | --- |
| Board toolbar | ✓ (the board) | | |
| Selection pill | ✓ (the selection) | | ✓ |
| Group options bar | | ✓ (Freeform collections) | |
| Card actions | | | ✓ |
| Desktop context menus | ✓ on the canvas and on a selection | ✓ on a group | ✓ on a card or selection |

## Keeping it tidy

The best tidy is the one never needed. New cards from a paste, a file drop
or the staging tray are placed at the **nearest free spot** to where they
would have landed today. "Free" means not overlapping any block, found by
searching outward on the 24 px grid. A note made by double-clicking still
lands exactly under the pointer, because the user chose that place.

## Acceptance

- Pressing Tidy up twice leaves the board unchanged the second time, and
  the toast says "Already tidy".
- After Tidy up, no two blocks overlap and no two cards inside a freeform
  collection overlap.
- Tidy up never changes a card's width, a card's group, a booklet's order,
  or a collection's mode.
- One ⌘Z (or the toast's Undo) restores every position and width that a
  tidy, arrange or reset changed.
- Turning Auto-arrange on and pressing Arrange into columns leave a
  collection in the same layout.
- An auto-arranged collection is still in columns after a board Tidy up.
- A pasted image never lands on top of an existing card.

## Decisions for the owner

1. **Board Tidy stops resetting sizes.** This is the one change existing
   users will notice. Recommended, because resizing is the destructive part
   and it still exists by name. The alternative is to keep it and accept
   that "tidy" can shrink a card someone widened on purpose.
2. **Snap to the 24 px grid.** Recommended only for blocks that moved.
   Snapping everything would move nearly every card by a few pixels on the
   first press.
3. **Closing large gaps.** Not recommended at board scope, since distance
   is meaning. It could come later as a separate verb ("Bring together")
   on a selection.

## Order of work

1. **Words and group forms.** Split Reset size out. Make the collection
   options say Arrange into columns, and only in Freeform. Make turning on
   Auto-arrange arrange. Fix board Tidy re-flowing auto-arranged
   collections (problem 4). This is all UI, with no new layout code.
2. **Gentle Tidy up.** `tidy.js` and its tests, the single undo step, the
   glide, and the toast.
3. **Free-spot placement** for pastes, drops and staged cards.
