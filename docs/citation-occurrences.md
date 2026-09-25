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

At rest the arrow keys scroll the page as ever; once exploring, ↑ and ↓ step
(below).

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
│   │ │ Exploring  2 of 4 · page 7  ‹ Back  ↑  ↓ │ │  ← accent strip  │
│   │ └──────────────────────────────────────────┘ │                   │
│   └──────────────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────┘
```

What marks it:

- **The foot row turns into a strip** in `--accent` tint: *Exploring*, the
  position `2 of 4 · page 7`, and the steps. A place matched only by its
  number adds `· guessed`, as the marker is drawn dashed (`cite guessed`).
  The way back is the return pill's, below, not a line on the card.
- **↑ and ↓ on the keyboard step** as the card's buttons do, for as long as
  the exploration lasts (not in a text field, not with a modifier). Before
  the first step they scroll the page, as they always have: it takes a
  deliberate press of a button to start exploring. A step waits for the last
  one's marker to be drawn, so a key held down cannot place the card against
  a marker that is not there yet.
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
  moved.
- The first step does not bring up the Learn Papol lesson on the pill
  (`LINK_NAVIGATION_TIP`), which a followed link does: it would sit over
  the ↑ ↓ the reader is stepping with, and the pill itself shows `[`.

### How it ends

| Action | Result |
|---|---|
| **Esc**, the card's ×, or a press elsewhere on the page | The card closes as today, the frame goes, and the view stays where it is. |
| Clicking another citation | The exploration ends where it is and that citation's card opens. |
| **Back** on the strip, **`[`**, or the return pill | Back to `startView`; the card closes and the exploration ends. `]` returns to where the reader had got to. Back is `[` itself (`moveThroughLinks('back')`), so the two cannot come apart. |
| Scrolling or zooming by hand | Allowed; the exploration continues. |

There is no *Stay here*: staying is what every other exit does. Back is on
the strip only while exploring; at rest there is nowhere to go back to.

The strip's buttons do not take the focus when pressed with the mouse
(`mousedown` is prevented). A reader who clicks ↓ and goes on with the
keyboard's ↓ would otherwise see the clicked button light up with the
browser's keyboard focus ring, as if it were selected. Tabbing to them still
focuses them, ring and all.

## Stepping: the marker comes to the card

The card is placed beside its marker (`ReferenceCard`'s `place()`), so if it
simply re-anchored to the next marker it would jump away from the pointer
each step, and ↓ would never be under the cursor twice. Instead:

1. Take the current marker's position in the viewport.
2. Scroll the pages at once so the next marker lands at that same position
   (down; across too only when the page is wider than the window). Not
   smoothly: the card is placed against the marker as soon as the marker is
   drawn, and a smooth scroll would still be carrying it along.
3. The card waits, hidden, for the page to draw the marker (below), and
   hangs off it. Being where the old one was, it gets the same height; and
   while exploring the card keeps its place across as well, so a marker in
   the other column does not carry it half a page sideways.

Only when the scroller cannot go far enough (the first lines of page 1, the
foot of the last page) does the marker land elsewhere, and the card then
follows it up or down as it does today.

The marker stepped to is drawn by its page from the analysis — a
`.cite-occurrence` span, lit as an open citation is, with one pulse (none
under reduced motion). It exists as soon as the page does, whether or not the
page has worked out its own citation buttons yet, and it is what the card
hangs off.

## Which places, in what order

`citationOccurrences(analysis, referenceUuid)` in `viewer/src/references.js`,
a pure function with its own tests, returns `[{ page, boxes, label, exact }]`
in reading order: one a marker, its boxes those on the page it begins on. It
is built from `analysis.citations`, which the viewer holds for the whole
paper. The page overlays can't be used: `PdfPage` only works them out for
pages near the view (the `near` effect), so they cannot answer for page 19
while the reader is on page 3.

- A citation is one marker whole (migration 0009): the works it names and
  every line it is printed on. So a marker broken over a line is one place,
  and "[2, 7, 9]" is a place for each of the works it names.
- **The marker the reader clicked** is found among them by page and overlap
  (`placeAmong`, with the `overlaps` test `pageOverlays` uses), which gives
  the `2` in `2 of 4`. The page overlays can add markers the analyzer missed
  (a PDF's own link, a number read off the text); if the clicked one is such
  a marker it is put in at its page, so the count is never short by the one
  being read.

### Reading order: one server change

The analyzer finds markers in reading order — it walks the text flows, and
each page's lines, in the order they are read — but the Worker sorted them
by `page, y, x`, which on a two-column page puts the top of the right column
before the foot of the left. So:

- `paper_citations.ordinal INTEGER` (migration 0010): the marker's place in
  the analyzer's list. Nullable, so rows already read stay valid.
- `references.ts` stores it and serves citations in that order. A paper read
  before the migration has none and is served in page order, as before; a
  paper read again gets its ordinals. No re-analysis is forced.
- The wire shape is unchanged: the order is the contract, and `ordinal`
  itself is not sent.

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
| `viewer/src/references.js` | `citationOccurrences()`, `placeAmong()`, and their tests |
| `viewer/src/App.jsx` | `openCite` gains `place`, `places` and `at`; an `exploring` state `{ startView, startPlace }`; `stepOccurrence(±1)` (the scroll, the hidden card until the marker is drawn, and on the first step `rememberJump(startView, { teach: false })`); `endExploration()` from `closeReference` and from a click on another citation (`openCitation`), taking the entry off again when the view is still `startView`; `moveThroughLinks` puts the card away during an exploration; `.viewer-body.exploring` for the frame |
| `viewer/src/PdfPage.jsx` | a clicked citation reports its place; `citationOccurrence` draws the lit `.cite-occurrence` and reports it to the card (`onOccurrenceShown`); `citationStart` draws the `.cite-start` outline |
| `viewer/src/ReferenceCard.jsx` | the foot row at rest, the exploring strip with Back, ↑ and ↓, none taking the focus from a mouse press; its left held while exploring; hidden while it has no marker to hang off |
| `viewer/src/styles.js` | the row, the strip, the frame, the lit marker and its pulse, the start outline |
| `cloudflare/` | migration 0010, `ordinal` stored and served in order, and a test |

## Not doing

- **Keys for stepping before the exploration starts.** At rest the arrows
  belong to the page; they step only once the reader has pressed ↑ or ↓ on
  the card.
- **A list of every place with its sentence**, in the card or a side panel.
  It answers the same question at a glance, but it needs the sentence text
  for every marker, and it makes the card a panel. Stepping shows the real
  sentence in its real paragraph, which is what a reader wants to judge.
- **Marks on the Navigator for every place.** A good second step — the
  Navigator already draws note marks — but not needed to cycle.
- **Places in other papers** ("who else cites this"). That is the card's
  *Cited by* number's job, and a different feature.

## Checks

- Unit (`viewer/src/references.test.js`): the places are the markers in the
  analysis's order, a grouped marker counts for each work, a marker over a
  line and a page is one place where it begins; the clicked marker is found
  among them, or put in at its page.
- Worker (`cloudflare/test/references.test.ts`): markers read in columns are
  served in the analyzer's order; without ordinals, in page order.
- Browser (`viewer/scripts/browser-smoke.mjs`, hermetic): a work cited on
  pages 1, 3 and 4. Stepping round and back and closing leaves no way back;
  ↓ keeps the card where it was, lights the marker on page 3, frames the
  pages, offers *Back to page 1*, and shows no lesson; steps wrap both ways;
  the ↓ and ↑ keys step while exploring; the strip's Back returns to the
  start and puts the card away;
  Esc and a press on the page each keep the view; `[` restores the start and
  `]` the place stayed at.
- Screenshots on a real paper (attention.pdf with the analyzer's reading) are
  on the PR.
