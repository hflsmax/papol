# Where else a paper cites this work

Stories: US-7.36 – US-7.41 (`USER_STORIES.md`, §7b).

A reader clicks "[12]", the card says what [12] is, and the next question is
nearly always *what else do the authors say about it?* Today the answer is a
search for "12", which also finds page 12, equation (12) and "[112]". The
viewer already knows every place the paper cites the work; this puts them one
click apart on the card, as a short exploration the reader can always undo.

## What the reader sees

The card gets one new row at its foot, below the links row. It belongs to the
card, not the header: the header's `← 1/3 →` (`ref-range-nav`) changes *which
work*; this row changes *where in the paper*. Two navigations in one header
would read as one. The glyphs differ for the same reason — left/right is
across a marker's range, up/down is earlier/later in the paper.

At rest, before any step:

```
┌──────────────────────────────────────────────┐
│ EXPERIMENTAL                     ← 1/3 →   × │
│ Attention Is All You Need                    │
│ Vaswani, Shazeer, Parmar, and 5 others       │
│ NeurIPS · 2017                Cited by 120k  │
│ The dominant sequence transduction models…   │
│ In Papol  PDF  DOI  Scholar  Report a problem│
│ ──────────────────────────────────────────── │
│ Cited 4 times in this paper            ↑  ↓  │
└──────────────────────────────────────────────┘
```

| Places | Row reads | Controls |
|---|---|---|
| 1 | *Cited only here* | none |
| 2 or more | *Cited 4 times in this paper* | ↑ ↓ |

*Cited only here* is worth saying: it tells the reader the work is mentioned
in passing, which is itself an answer.

Buttons only; there are no key bindings for stepping.

A card opens on an analyzed paper, so the places come from the analysis and
nothing else. (A `pdf:` card — a hyperref marker clicked in the moment before
the analysis lands — has no reference uuid to count by, and shows no row.)

## Exploring

The first press of ↑ or ↓ starts an **exploration**. It is a mode, and it
looks like one: the reader has left their place on loan, and the screen says
so until they settle it.

```
┌─ pages ─────────────────────────────────────────────── accent frame ─┐
│                                                                      │
│      …as shown in [12], attention alone suffices for…                │
│                  ▔▔▔▔ lit, pulses once                               │
│   ┌──────────────────────────────────────────────┐                   │
│   │ EXPERIMENTAL                     ← 1/3 →   × │                   │
│   │ Attention Is All You Need                    │                   │
│   │ …                                            │                   │
│   │ ┌──────────────────────────────────────────┐ │                   │
│   │ │ Exploring  2 of 4 · page 7          ↑  ↓ │ │  ← accent strip  │
│   │ │ ‹ Back to page 3   Esc       Stay here   │ │                   │
│   │ └──────────────────────────────────────────┘ │                   │
│   └──────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

What marks the mode:

- **The foot row turns into a strip** in `--accent` tint: *Exploring*, the
  position `2 of 4 · page 7`, the steps, and on its second line the two
  exits. *Back to page 3* is the primary one and shows its key, `Esc`, as a
  keycap. It names the page the reader came from, as the return pill does, so
  the way home is stated, not implied. A place matched only by its number
  adds `· guessed`, as the marker is drawn dashed (`cite guessed`).
- **The pages get a thin `--accent` inset frame** around the scroller for as
  long as the exploration lasts — the "you are in a mode" cue a screen share
  uses. It is the one signal visible wherever the card has scrolled to, and
  it vanishes the moment the exploration ends, which is what makes the end
  felt.
- **The return pill is hidden** while exploring, if it was showing, and comes
  back afterwards. The steps are not jumps, so none of them lands in
  `linkHistory`; only how the exploration ends can put anything there
  (below).
- **The marker the reader started from** keeps an outline (`cite start`), so
  a reader who scrolls back by hand sees where home is.

How it ends:

| Action | Result |
|---|---|
| **Esc**, *Back to page 3*, or the card's × | The view returns to exactly where it was when the first step was taken (scroll and zoom, via `restoreView`). The card is back on the clicked marker, the strip back to the resting row. A second Esc closes the card, as today. |
| **Stay here** | The exploration ends where the reader is. The card stays on the current marker, the frame goes, and the start goes into history (below). |
| A press elsewhere on the page (click away) | Stay here, and the card closes, as a press elsewhere closes it today (`useDismiss`). The press is aimed at what is on screen; going back would move the page from under it. |
| Clicking another citation | Stay here, then that citation's card opens. The reader chose to read there. |
| Scrolling or zooming by hand | Allowed; the exploration continues and Back still returns to the start. |

### Ending away from home is one move

Going back leaves no trace: nothing was moved. Every other ending leaves the
reader somewhere else, and that is a move like following a link, so it is
recorded as one:

- `startView` (the view when the first step was taken) is pushed onto
  `linkHistory.back` and `forward` is cleared — what `followLink` does.
- The return pill shows *Back to page 3*; `[` returns there and `]` comes
  back to where the reader stayed, through the existing `moveThroughLinks`.
- One entry, however many steps were taken: the steps between are not
  history. And none at all when the exploration ends on the view it started
  from (the reader stepped round to the clicked marker, or scrolled home by
  hand) — the same "did it actually go anywhere" test `followLink` uses.

While exploring, the × is titled *Back to page 3*, because closing a
temporary thing means putting things back.

## Stepping: the marker comes to the card

The card is placed beside its marker (`ReferenceCard`'s `place()`), so if it
simply re-anchored to the next marker it would jump away from the pointer
each step, and ↓ would never be under the cursor twice. Instead:

1. Take the current marker's position in the viewport.
2. Scroll the pages so the next marker lands at that same viewport position
   (same `top`; `left` too when the page is wider than the window).
3. Re-anchor the card to the new marker. Because the marker is where the old
   one was, `place()` computes the same spot and the card does not move.

Only when the scroller cannot go far enough (the first lines of page 1, the
foot of the last page) does the marker land elsewhere, and the card then
follows it as it does today. A step within the same screen does not scroll at
all. A short jump scrolls smoothly and a far one is instant, as in
`followLink` (`far` there), so the eye does not ride through ten pages.

The marker stepped to is lit with the cite layer's existing `open` state,
plus one pulse so the eye finds it.

## Which places, in what order

`citationOccurrences(analysis, referenceUuid)` in `viewer/src/references.js`,
a pure function with its own tests, returns
`[{ page, x, y, w, h, label, exact }]` in reading order. It is built from
`analysis.citations`, which the viewer holds for the whole paper. The page
overlays can't be used: `PdfPage` only works them out for pages near the view
(the `near` effect), so they cannot answer for page 19 while the reader is on
page 3.

1. Every citation row with this `reference_uuid`. A marker set across a line
   break is several rows of one marker (grouped by `ordinal`, below). A
   grouped marker like "[2, 7, 9]" has a row per work, so it is found for
   each of them without special handling.
2. **The marker the reader clicked** is found in the list by page and
   overlap (the `overlaps` test `pageOverlays` uses), which gives the `2` in
   `2 of 4`. The page overlays can add markers the analyzer missed (recovered
   from the text, or a PDF link); if the clicked one is such a marker it is
   inserted at its page, so the count is never short by the one being read.

### Reading order needs one server change

The Worker returns citations `ORDER BY page, y, x, uuid`
(`cloudflare/src/papers/references.ts`). On a two-column page that
interleaves the columns: the top of the right column comes before the foot
of the left. GROBID emits markers in document order, and `tei.ts` walks them
in that order, so the fix is to keep it:

- `paper_citations.ordinal INTEGER` — the marker's index in the TEI walk,
  shared by every box of one marker. New migration; nullable, so existing rows
  are valid.
- Insert it in `references.ts`; select `ORDER BY page, ordinal, y, x, uuid`.
  A paper's rows either all have an ordinal or none do, so a paper analyzed
  before the migration keeps today's order. No re-analysis is forced; a paper
  read again later gets the ordering.
- `CitationOut` gains `ordinal` (optional). The wire contract only grows.

Until a paper has ordinals, the viewer orders by page, then column, then
`y`: a box whose centre is left of the page's middle is column one when the
page has markers on both sides of it. Good enough for older analyses, and
unused once `ordinal` is there.

## Wrapping (US-7.40)

↓ on the last place goes to the first, ↑ on the first to the last, as the
find bar does. The counter is the reader's orientation, so wrapping never
passes unnoticed. With two places, ↑ and ↓ both go to the other one.

## A marker that cites several works (US-7.41)

The occurrence list is computed for `openCite.referenceUuid`, the work the
card shows. Pressing → in the range nav changes that uuid, and the row
recounts for the new work, starting from the marker already open (which, by
construction, cites it too). Changing work mid-exploration keeps the
exploration and its starting point: Back still goes home.

## Where it lives in the code

| Piece | Change |
|---|---|
| `viewer/src/references.js` | `citationOccurrences()` and its tests |
| `viewer/src/App.jsx` | `openCite` gains `occurrences` and `at`; an `exploring` state holding `{ startView, startAnchor, startReferenceUuid }`; `stepOccurrence(±1)` (scroll-to-same-spot, anchor swap, starts the exploration on the first step); `endExploration('back' \| 'stay')`, where `stay` pushes `startView` onto `linkHistory` unless the view is still there; the card's Escape effect calls `endExploration('back')` when exploring, else closes as today; the return pill is not rendered while exploring; the `.pages` scroller gets an `exploring` class for the frame |
| `viewer/src/PdfPage.jsx` | after a step the target page may not have worked out its overlays yet, so `PdfPage` takes `occurrenceBox` and draws a plain positioned span there (`.cite-occurrence`), which exists as soon as the page element does; the card anchors to it and the pulse plays on it. `startBox` draws the `cite start` outline the same way |
| `viewer/src/ReferenceCard.jsx` | the foot row at rest, the exploring strip, `onPreviousOccurrence` / `onNextOccurrence` / `onBack` / `onStay`; a press elsewhere (`useDismiss`) calls `onStay` then closes while exploring, and the × is rewired to `onBack` |
| `cloudflare/…` | `ordinal` column, insert, `ORDER BY`; migration |

The scroll arithmetic is `followLink`'s: a fraction down a page is a pixel
position once the page's box is known, at any zoom. Reuse its conversion
rather than a second one. Returning uses `currentView()` / `restoreView()`,
which already carry scale.

## Not doing

- **Key bindings for stepping.** Buttons only; Esc is the one key, and it
  already means "put the transient thing away".
- **A list of every place with its sentence**, in the card or a side panel.
  It answers the same question at a glance, but it needs the sentence text
  for every marker, and it makes the card a panel. Stepping shows the real
  sentence in its real paragraph, which is what a reader wants to judge.
- **Marks on the Navigator for every place.** A good second step — the
  Navigator already draws note marks — but not needed to cycle.
- **Places in other papers** ("who else cites this"). That is the card's
  *Cited by* number's job, and a different feature.

## Checks

- Unit: `citationOccurrences` — grouped markers, a marker split over two
  lines, two-column ordering with and without `ordinal`, the clicked marker
  missing from the list.
- Viewer e2e (share-e2e's CDP driver): open a citation cited three times,
  press ↓ twice; assert the lit marker's page, the card's
  `getBoundingClientRect()` unchanged between steps, the frame present and the
  return pill absent. Esc restores the starting `scrollTop` and scale, puts
  the card back on the clicked marker, removes the frame, and leaves
  `linkHistory` empty. Stay here, and separately a press on the page, keep
  the view, remove the frame and leave one `linkHistory` entry however many
  steps were taken; `[` then restores the starting view and `]` the stayed
  one. ↓ from the last wraps to the first.
- It is a UI change: the PR carries screenshots and a short recording
  (orphan `citation-occurrences-screenshots` branch).
