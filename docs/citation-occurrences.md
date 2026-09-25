# Where else a paper cites this work

Stories: US-7.36 – US-7.41 (`USER_STORIES.md`, §7b).

A reader clicks "[12]", the card says what [12] is, and the next question is
nearly always *what else do the authors say about it?* Today the answer is a
search for "12", which also finds page 12, equation (12) and "[112]". The
viewer already knows every place the paper cites the work; this puts them one
click apart on the card.

## What the reader sees

The card gets one new row at its foot, below the links row. It belongs to the
card, not the header: the header's `← 1/3 →` (`ref-range-nav`) changes *which
work*; this row changes *where in the paper*. Two navigations in one header
would read as one. The glyphs differ for the same reason — left/right is
across a marker's range, up/down is earlier/later in the paper.

```
┌──────────────────────────────────────────────┐
│ EXPERIMENTAL                     ← 1/3 →   × │
│ Attention Is All You Need                    │
│ Vaswani, Shazeer, Parmar, and 5 others       │
│ NeurIPS · 2017                Cited by 120k  │
│ The dominant sequence transduction models…   │
│ In Papol  PDF  DOI  Scholar  Report a problem│
│ ──────────────────────────────────────────── │
│ Cited 4 times here        ↑  2 of 4 · p.7  ↓ │
└──────────────────────────────────────────────┘
```

| Places known | Row reads | Controls |
|---|---|---|
| 1 | *Cited only here* | none |
| 2 or more | *Cited 4 times in this paper* · `2 of 4 · p. 7` | ↑ ↓, keys `p` / `n` |
| still counting (PDF links, below) | nothing yet | — |
| unknown (no analysis, no links) | row absent | — |

*Cited only here* is worth saying: it tells the reader the work is mentioned
in passing, which is itself an answer.

A place matched only by its number (`inferred`, "matched by number" on the
page) shows the position as `2 of 4 · p. 7 · guessed`, as the marker itself
is drawn dashed (`cite guessed`).

Keys: `n` next, `p` previous, only while the card is open. Neither is a tool
key (`TOOLS` in `viewer/src/App.jsx` uses z x v c a m); both are named in the
buttons' titles and added to the help sheet. Escape still closes the card.

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
all. Smooth scrolling is used when the jump is short, as `followLink` does
(`far` there); a far jump is instant so the eye does not ride through ten
pages.

The marker stepped to is lit with the `open` state the cite layer already
has (`cite … open`), plus a brief pulse so the eye finds it; the previously
open marker drops back.

## Keeping the reader's place (US-7.38)

The first step of an outing pushes the view from *before the first step* onto
`linkHistory.back`, exactly as `followLink` does, so the return pill appears
as *Back to page 3* and `[` works. Later steps in the same outing do not push:
an outing is the time from the first step until the card closes or another
marker is clicked. Four steps are one trip, and one `[` ends it.

## Which places, in what order

`citationOccurrences(analysis, referenceUuid)` in `viewer/src/references.js`,
a pure function with its own tests, returns
`[{ page, x, y, w, h, label, exact }]` in reading order. It is built from
data the viewer already holds for the whole paper — not from the page
overlays, which `PdfPage` only works out for pages near the view
(`PdfPage.jsx`, the `near` effect) and so cannot answer for page 19 while the
reader is on page 3.

1. **The analyzer's citations** — `analysis.citations` with this
   `reference_uuid`. A marker set across a line break is several rows with one
   label; those are one place (the analyzer's `ordinal`, below, groups them).
   A grouped marker like "[2, 7, 9]" has a row per work, so it is found for
   each of them without special handling.
2. **The PDF's own links**, where there is no analysis or it has not finished
   (a `pdf:` reference uuid, from `namedCitation`): every link annotation
   whose `dest` is the same named destination. That needs `getAnnotations` on
   every page, so it runs once per document in the background when the first
   citation card opens, is kept for the rest of the visit, and the row appears
   when it is done. Its order is page, then annotation order, which is the
   order the text was set in.
3. **Merging.** A PDF link that overlaps an analyzer box is the same place
   (the same `overlaps` test `pageOverlays` uses).
4. **The marker the reader clicked** is found in the list by page and
   overlap, which gives the `2` in `2 of 4`. If it is missing — a marker the
   analyzer never saw but the page overlays recovered from text — it is
   inserted at its page so the count is never short by the one being read.

### Reading order needs one server change

The Worker returns citations `ORDER BY page, y, x, uuid`
(`cloudflare/src/papers/references.ts`). On a two-column page that
interleaves the columns: the top of the right column comes before the foot
of the left. GROBID emits markers in document order, and `tei.ts` walks them
in that order, so the fix is to keep it:

- `paper_citations.ordinal INTEGER` — the marker's index in the TEI walk,
  shared by every box of one marker. New migration; nullable, so existing rows
  are valid.
- Insert it in `references.ts`; select `ORDER BY page, ordinal, y, x, uuid`
  A paper's rows either all have an ordinal or none do, so a paper analyzed
  before the migration keeps today's order. No re-analysis is forced; a paper
  read again later gets the ordering.
- `CitationOut` gains `ordinal` (optional). The wire contract only grows.

Until a paper has ordinals, the viewer orders by page, then column, then
`y`: a box whose centre is left of the page's middle is column one when the
page has markers on both sides of it. Good enough for the fallback, and
thrown away once `ordinal` is there.

## Wrapping (US-7.39)

↓ on the last place goes to the first, ↑ on the first to the last, as the
find bar does. The counter is the reader's orientation, so wrapping never
passes unnoticed. With two places, ↑ and ↓ both go to the other one.

## A marker that cites several works (US-7.40)

`openCite` gains nothing new for the range: the occurrence list is computed
for `openCite.referenceUuid`, the work the card shows. Pressing → in the
range nav changes that uuid, and the row recounts for the new work, starting
from the marker already open (which, by construction, cites it too).

## Where it lives in the code

| Piece | Change |
|---|---|
| `viewer/src/references.js` | `citationOccurrences()` and its tests; the all-pages link collection for PDF-native citations |
| `viewer/src/App.jsx` | `openCite` gains `occurrences` and `at`; `stepOccurrence(±1)` does the scroll-to-same-spot, the anchor swap, and the one-per-outing history push; `n`/`p` in the key handler while `openCite` is set |
| `viewer/src/PdfPage.jsx` | the anchor after a step is the cite button on the target page. That page may not have worked out its overlays yet, so `PdfPage` also takes `occurrenceBox` and draws a plain positioned span there (`.cite-occurrence`), which exists as soon as the page element does; the card anchors to it and the pulse plays on it |
| `viewer/src/ReferenceCard.jsx` | the foot row: `occurrenceCount`, `occurrenceAt`, `onPreviousOccurrence`, `onNextOccurrence` |
| `cloudflare/…` | `ordinal` column, insert, `ORDER BY`; migration |

The scroll arithmetic is `followLink`'s: a fraction down a page is a pixel
position once the page's box is known, at any zoom. Reuse its conversion
rather than a second one.

## Not doing

- **A list of every place with its sentence**, in the card or a side panel.
  It answers the same question at a glance, but it needs the sentence text
  for every marker (a text-layer read of every page, or the analyzer carrying
  context), and it makes the card a panel. Stepping shows the real sentence,
  in its real paragraph, which is what a reader wants to judge. Worth
  revisiting if readers ask for an overview.
- **Marks on the Navigator for every place.** A good second step — the
  Navigator already draws note marks — but not needed to cycle.
- **Places in other papers** ("who else cites this"). That is the card's
  *Cited by* number's job, and a different feature.

## Checks

- Unit: `citationOccurrences` — grouped markers, a marker split over two
  lines, two-column ordering with and without `ordinal`, PDF-only links,
  merge of a link and an analyzer box, the clicked marker missing from the
  list.
- Viewer e2e (share-e2e's CDP driver): open a citation cited three times,
  press ↓ twice, assert the lit marker's page and that the card's
  `getBoundingClientRect()` did not move between steps; `[` returns to the
  starting view; ↓ from the last wraps to the first.
- It is a UI change: the PR carries screenshots and a short recording
  (orphan `citation-occurrences-screenshots` branch).
