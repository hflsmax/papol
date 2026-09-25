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

The first press of ↑ or ↓ starts an **exploration**, and the screen says so
for as long as it lasts. Leaving it never moves the page: every way out
leaves the reader where they have got to, and `[` is the way back, as after
following any link in the paper.

```
┌─ pages ─────────────────────────────────────────────── accent frame ─┐
│                         ( ‹ Back to page 3 )   ← return pill, as today│
│      …as shown in [12], attention alone suffices for…                │
│                  ▔▔▔▔ lit, pulses once                               │
│   ┌──────────────────────────────────────────────┐                   │
│   │ EXPERIMENTAL                     ← 1/3 →   × │                   │
│   │ Attention Is All You Need                    │                   │
│   │ …                                            │                   │
│   │ ┌──────────────────────────────────────────┐ │                   │
│   │ │ Exploring  2 of 4 · page 7          ↑  ↓ │ │  ← accent strip  │
│   │ │ [ goes back to page 3                    │ │                   │
│   │ └──────────────────────────────────────────┘ │                   │
│   └──────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

What marks it:

- **The foot row turns into a strip** in `--accent` tint: *Exploring*, the
  position `2 of 4 · page 7`, the steps, and a second line saying how to get
  back — `[` as a keycap, *goes back to page 3*. The way home is stated, not
  implied. A place matched only by its number adds `· guessed`, as the
  marker is drawn dashed (`cite guessed`).
- **The pages get a thin `--accent` inset frame** around the scroller while
  the exploration lasts — the "you are in a mode" cue a screen share uses,
  visible wherever the card has scrolled to. It goes when the exploration
  ends.
- **The return pill shows *Back to page 3*** from the first step, as it does
  after a followed link, and is the button for anyone not using the keyboard.
- **The marker the reader started from** keeps an outline (`cite start`), so
  a reader who scrolls back by hand sees where they began.

### One move, recorded on the first step

The exploration is one move in the paper's history, however many steps it
takes:

- On the first step, the view at that moment (`startView`) is pushed onto
  `linkHistory.back` and `forward` is cleared — what `followLink` does. Later
  steps push nothing.
- So `[` works during the exploration and after it, through the existing
  `moveThroughLinks`: it returns to where the reader was, and `]` comes back
  to where they had got to.
- If the exploration ends on the view it started from (stepped all the way
  round, or scrolled home by hand), the entry is taken off again: nothing
  moved. The same "did it actually go anywhere" test `followLink` uses.

### How it ends

| Action | Result |
|---|---|
| **Esc**, the card's ×, or a press elsewhere on the page | The card closes as today, the frame goes, and the view stays where it is. |
| Clicking another citation | The exploration ends where it is and that citation's card opens. |
| **`[`** (or the return pill) | Back to `startView`; the card closes and the exploration ends. `]` returns to where the reader had got to. |
| Scrolling or zooming by hand | Allowed; the exploration continues. |

There is no *Stay here* and no Back button on the card: staying is what every
exit does, and going back is the viewer's one way back, which the strip names.

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
| `viewer/src/App.jsx` | `openCite` gains `occurrences` and `at`; an `exploring` state holding `{ startView, startBox }`; `stepOccurrence(±1)` (scroll-to-same-spot, anchor swap; on the first step it sets `exploring` and pushes `startView` onto `linkHistory`); `closeReference` and `moveThroughLinks` end the exploration, and take the entry off again when the view is still `startView`; the `.pages` scroller gets an `exploring` class for the frame |
| `viewer/src/PdfPage.jsx` | after a step the target page may not have worked out its overlays yet, so `PdfPage` takes `occurrenceBox` and draws a plain positioned span there (`.cite-occurrence`), which exists as soon as the page element does; the card anchors to it and the pulse plays on it. `startBox` draws the `cite start` outline the same way |
| `viewer/src/ReferenceCard.jsx` | the foot row at rest, the exploring strip with its `[` line, `onPreviousOccurrence` / `onNextOccurrence`; closing is unchanged |
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
  `getBoundingClientRect()` unchanged between steps, the frame present, and
  one `linkHistory` entry. Esc, ×, and a press on the page each close the
  card and keep `scrollTop`; `[` then restores the starting view and scale,
  and `]` the stayed one. `[` mid-exploration does the same and closes the
  card. Stepping all the way round and closing leaves `linkHistory` empty.
  ↓ from the last wraps to the first.
- It is a UI change: the PR carries screenshots and a short recording
  (orphan `citation-occurrences-screenshots` branch).
