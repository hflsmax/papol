# Papol Design System

The canonical tokens and cross-product component styles live in
`shared/applicationStyles.js`. The web app and board use that sheet; Papol
Desktop's scoped rules live in `shared/desktopStyles.js`, which the canonical
sheet appends. The PDF viewer is a separate application and mirrors the
canonical foundations in `viewer/src/styles.js`. Token values must match
across those files so moving from Desk to viewer to board feels like one
product.

Every rule should derive from the tokens where a role is shared. When adding
UI, pick tokens — don't invent new hexes, font sizes, radii, focus colors,
shadows, or animation timings. Runtime identity values such as shelf colors,
brush colors, and board zoom variables are expected component inputs rather
than design tokens.

## Color

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1d2129` | Primary text |
| `--ink-soft` | `#4d5561` | Secondary text, labels |
| `--ink-faint` | `#66717f` | Hints and metadata; remains AA-legible on `--paper` |
| `--paper` | `#f5f6f8` | Page background, subtle hovers |
| `--paper-sunken` | `#f1f3f6` | Recessed rows (hidden nook entries) |
| `--card` | `#ffffff` | Panels, inputs |
| `--line` | `#dde2e8` | Borders, separators |
| `--line-strong` | `#b4becb` | Button borders, emphasized edges |
| `--ink-inverse` | `#ffffff` | Text/knobs on saturated fills |
| `--fill` / `--fill-strong` | `#ccd4dd` / `#b8c2cf` | Neutral control fills (switch tracks) |
| `--accent` | `#2b4a6f` | Brand navy: links, primary buttons, selection |
| `--accent-strong` | `#1e3752` | Primary button hover |
| `--accent-soft` | `#eaeff5` | Tinted cards (notes, summaries, quotes) |
| `--focus` / `--focus-soft` | accent / translucent accent | Keyboard focus and inset field focus |
| `--chrome` | `#eaedf1` (`#f9ecea` in development) | Papol macOS sidebar ground; light red distinguishes development builds |
| `--chrome-hover` / `--chrome-selected` | ink at 6% / 10% | Desktop sidebar and toolbar row hover / current row |
| `--chrome-radius` | `6px` | Desktop sidebar rows and toolbar buttons only |

Semantic hues — states carry meaning consistently across the app:

| Family | Tokens | Meaning |
|---|---|---|
| Gold | `--gold`, `--gold-ink`, `--gold-soft` | planning state, notice banners |
| Green | `--green`, `--green-ink`, `--green-soft` | live/called state, "public" badges, success notices |
| Red | `--red`, `--red-soft` | danger actions, errors |
| Grey | `--grey` | finished/neutral state pills |

Each family has the same four roles: the base is the saturated fill/border,
`*-soft` is the tinted background, `*-line` is the border that goes on that
tint, and `*-ink` is text placed on it. Seminar state always reads the same
way, everywhere: called = accent, planning = gold, scheduled = green,
finished = grey — all rendered by the single `StatePill` component, never
restyled per page.

**Identity colors** are a separate axis from the semantic ones: six
`--identity-*` tokens, chosen per user by id, back the initial shown when
someone has no profile picture (applied via `.avatar-initial.avatar-tint-N`,
two classes so role colors like the leader's gold still win). They say
"which person", never "what state".

## Type

Three families, by role:

- `--font-serif` (Georgia …) — prose: body text, headings, paper titles.
  This is the default on `body`.
- `--font-ui` (system sans) — interface chrome: buttons, badges, pills,
  forms, banners.
- `--font-mono` — identifiers and data: DOIs, SQL, admin tables.

Form controls (`input`, `textarea`, `select`) **inherit** their context's
family rather than setting one, so a field is serif inside a panel, mono
inside an admin data table, and UI sans inside the announce form. Never
leave a control unstyled: a bare `<textarea>` falls back to the browser's
monospace default, which is how the seminar message box drifted out of the
system. Prose the user writes (notes, summaries, messages) is serif;
structured configuration (the announce form) is UI sans.

Scale (use the nearest step, never a bespoke rem value):

| Token | Value | Typical use |
|---|---|---|
| `--fs-2xs` | 0.7rem | Badge/pill text only — never body or control labels |
| `--fs-xs` | 0.78rem | Fine print, row actions, small buttons |
| `--fs-sm` | 0.85rem | Hints, dates, section kickers |
| `--fs-md` | 0.92rem | Compact body (cards, notes) |
| `--fs-base` | 0.95rem | Body, nav, inputs |
| `--fs-lg` | 1.05rem | Emphasized body, small headings |
| `--fs-xl` | 1.2rem | Panel headings |
| `--fs-2xl` | 1.4rem | Page headings (paper title) |
| `--fs-3xl` | 1.5rem | Brand wordmark |
| `--fs-hero` | 2.1rem | Home hero only |

Section kickers ("Your ratings", "My thought", mini-titles) are
`font-variant: small-caps` with slight letter-spacing at `--fs-sm`/`--fs-xs`.

## Shape

- `--radius` (3px) — everything: panels, buttons, inputs, cards.
- `--radius-lg` (10px) — large soft containers (chip pops).
- `--radius-pill` (999px) — state pills, badges, toggles.
- Avatars are `border-radius: 50%`.

## Space, elevation, and motion

- `--space-1` through `--space-7` are 4, 8, 12, 16, 24, 32, and 48px.
  Prefer these for new component padding and gaps. Existing optical offsets
  may remain when they align text or icons rather than establish layout rhythm.
- `--shadow-sm` separates a control or card from its immediate surface,
  `--shadow-md` identifies a popover, and `--shadow-overlay` belongs to modal
  layers. Shadows communicate stacking, never importance.
- `--motion-fast` is for direct control feedback; `--motion-base` is for a
  panel or state transition. Use `--ease-out`. Never use `transition: all`.
- Motion must not be required to understand a state change. Under
  `prefers-reduced-motion: reduce`, transitions and nonessential animation
  collapse to effectively instantaneous feedback.

## Interaction and accessibility

- Ordinary interactive elements use the global `--focus` outline on
  `:focus-visible`. A component may reshape that treatment when a rectangular
  ring would misrepresent the object (for example an anchor placed on a PDF),
  but it must retain a visible keyboard state.
- Hover is enhancement, not disclosure. Actions hidden at rest become visible
  on `:focus-within` and on non-hover/touch devices.
- Every form label is associated using `htmlFor`/`id`, or wraps its control.
  A heading for a compound control uses `.form-label` plus an accessible group
  name; do not leave a freestanding `<label>` with no labelled control.
- Placeholder text supplements a label and never replaces it. It uses
  `--ink-faint` at full opacity so browser defaults cannot make it illegible.
- `--ink-faint` is the lightest color for readable text. Disabled controls use
  opacity in addition to an explicit disabled state and do not carry essential
  information.
- Touch-first layouts give primary actions and toolbar controls at least a
  40px target; isolated actions should reach 44px where the layout permits.
- Status updates that arrive asynchronously use `role="status"` and
  `aria-live="polite"`; errors that need immediate correction use
  `role="alert"`. Focus moves into modal dialogs and returns to their trigger.

## Responsive layout

- The web app is content-first at a 760px reading measure. At 560px, navigation
  becomes a full-width tab row, forms become one column, paired actions stack,
  and controls must remain usable without hover.
- The PDF viewer is one column at every width — the pages, under the bar —
  and compacts toolbar labels at 560px. Pages remain the only document
  scroller at every width.
- The board compacts its toolbar at 700px and scales canvas affordances against
  zoom. Screen-space targets must remain usable even while board content is
  transformed.
- New breakpoints should follow one of those existing behavioral transitions,
  not a particular device model. Test at 320, 560, 760/860, and a wide desktop.

## Recurring patterns

- **Learn lesson** — tutorial videos live on the public Learn page in a
  two-column grid of bordered white cards. Each card contains only a 16:9
  video and one serif title. The grid collapses to one column on narrow
  screens; new lessons are added as catalog entries.

- **Navigator** — the viewer's navigation, and the only kind it has: the
  paper drawn across `.viewer-bar`, in the room the spacer used to hold —
  to length, evened out enough that every section can be read. Nothing opens. It is 40px tall — all the room the desktop title
  bar has to give — and centred in the bar, in three lanes at one scale: a
  7px lane of subsection ticks over the strip, the 18px strip of sections,
  and a 15px lane of anchors and notes under it (strip to lower lane is
  six parts to five). What the paper says
  about itself stands above the strip and what the reader has put on it
  hangs below. A lane with nothing in it takes no room, except that the
  upper one is kept whenever there are marks below: it is also what sets
  the strip a little under centre, where a solid band over a few specks
  looks centred.
  section is a segment as wide as the section is long, so a glance says
  Model Architecture is a quarter of the paper and Conclusion is a
  paragraph — which a list of names can never say. Subsections are left out
  on purpose: they outnumber sections three to one and, drawn as their
  equals, turn the strip into a barcode of boxes too narrow to name.
  They are not left out, though: a subsection is a small `--ink-faint`
  caret (10px by 7px) in the lane over the strip, pointing down at the top
  edge of its section, at its place. It is the anchors' triangle again,
  smaller and turned over: the reader's marks point up at the strip from
  below and the paper's own point down at it from above, so the two lanes
  are one idea seen twice. (A plain stub standing over the strip was tried
  first and read as a stray stroke; dots floated free of the strip, tabs
  were heavier than the anchors they should be less than, and a hairline
  carried on through the strip crossed the names.) It divides nothing, so
  the two levels can never be taken for each other; it is a button (13px
  wide, reaching 4px into the strip, because the mark and the thing you
  press are not the same size) and a click makes the journey a press on
  the strip makes, so the marker ends up standing under the caret.
  Which level is "the sections" is read from the outline (`topLevel`), and
  each heading keeps the depth the outline gave it: folding the depths
  together once poured a paper's subsections in among its sections as
  equals, which is exactly the barcode. **Sections are evened out by one number**
  (`EVENNESS` in `Navigator.jsx`, 0.7). Drawn strictly to length, a paper
  is mostly its longest section: one segment spends half the bar saying
  one name, and the short sections after it share a thumb's width. The
  width a long section has beyond its name says nothing, and it is exactly
  what the short ones lack. So each length is raised to the power
  (1 − evenness) before the bar is shared out (`evened`): 0 is the paper to
  scale, 1 is every section alike, and at 0.7 a section ten times as long
  is drawn twice as wide. Longer is always still wider — the order of
  the lengths never changes, only how far apart they stand — so the shape
  of the paper is still read at a glance, and so are its names. Under
  that there is a 36px floor (`shareOut`), for what evening out cannot
  reach: the one-line sections that end a paper, and the section of no
  length at all — two headings side by side in two columns start at one
  height, and the first is then nothing long. Where there are more
  sections than floors to go round, they share the bar equally. **The two ends of
  the paper are not evened out; they are given their width outright** —
  56px to the front (the stretch before the first heading, and the abstract
  where the outline names one, taken as a run from the very start) and 76px
  to the bibliography, room for the word "References". Between them they
  are a third of a typical paper by length, and neither is a place anybody
  goes *into*: all either needs is its name and a door at the end of the
  bar it stands at. The names are read off the outlines held and
  hold nothing else (`isFrontMatter`, `isBibliography`): 29 of 42 papers
  open on "Abstract" and no other front-matter heading occurs in any of
  them, so "Abstract" is the whole list. The obvious other names — Summary
  at Cell, Significance at PNAS, Highlights at Elsevier — wait until a
  paper on the shelf is seen to use one. A name nobody here prints is a
  guess, and a guess here narrows a section somebody may be reading. **A
  journal's end-of-paper notices are not drawn at all** —
  Acknowledg(e)ments, Author contributions, Competing interests, Data
  availability (statement), Additional and Further information,
  Publisher's note (`isEndMatter` in `sections.js`, whole titles only, so
  "Funding models for open science" is still a section). Each is a
  sentence or two of form, they come four or five in a row, and on a bar
  where every section is given room to be read they took that room from
  the sections a reader does go to; the section before them simply runs on
  through. That list too is only what the outlines
  here carry — 34 of 1071 entries, in 24 of 42 papers. The rest of the same
  publishers' end matter (Funding, Conflict of interest, Ethics
  declarations, Reporting summary) is left out on the same principle. **Subsections are evened inside their
  section by the same number**, so a section of one long part and three
  short ones does not draw the three as one crowd against its edge. The
  section keeps the width it was given — this only sets the pace within it
  — so the two levels never disturb each other. The scale therefore
  changes pace from section to section and within one, and *everything* on the bar is
  placed through the one scale that results (`barScale`, a piecewise map
  over every cell the two levels cut the paper into): ticks, marks,
  the marker and a press. Stretching a short section moves all of them
  together, so a place on the bar is still one place in the paper, and the
  marker on a section's edge still means its heading is at the middle of
  the window. A name is dropped only below 20px, which a very narrow
  window can still produce. Segments are *placed* on the scale, never flowed along it: flowed, each
  one's padding and rule took room before the rest was shared out, and the
  heads of the sections drifted off the scale everything else is on. The
  left edge of a segment is where its section begins, exactly — bring the
  marker to that edge and the heading is at the middle of the window. The
  rest of the height is the lane under the strip, where every anchor is a
  triangle pointing up at its place and every note is a dialog box with
  its tip turned up from the middle to do the same. Its corners are as
  round as a box can take: square, a box with a tip in the middle of its
  lid reads as a briefcase at this size, and rounder still as an acorn.
  The lane has no ground of its own — the marks stand on the bar's white.
  That makes the pair top-heavy: the strip is a solid band and the marks
  are specks, so a box centred by the ruler reads as sitting high, and the
  Navigator is set 2px below centre, where it looks centred. With no
  anchors or notes there is no lane, the box is only the strip, and it is
  centred exactly. A mark under the middle of Results is *in*
  Results and nothing has to say so; that shared scale is the whole idea,
  and it is why the two lanes are stacked rather than merged. The marks
  differ in silhouette, not only in colour (`--accent` for an anchor,
  `--accent-strong` for a note), and each is a button that goes to its
  place. **The Navigator is a scrubber.** A press anywhere on it — the
  strip, or the lane between two marks — goes to *exactly* that place, not
  to the head of the section it falls in, and the press can be held and
  drawn along: the paper closes on the pointer a fraction of the way each
  frame, so it glides rather than steps, and a place more than a window and
  a half away is landed near at once because the distance in between is
  only waiting. A mark keeps its own click and goes to its anchor. Grounds carry meaning and colour does not: `--paper`
  for a section, `--paper-sunken` for the front of the paper (title,
  authors, abstract — the one stretch with no heading of its own),
  `--accent-soft` for the appendix, because back matter is a part of a
  document rather than a state of it. **Sections alternate**: every other
  segment is a shade darker (`--line` in the body, `--accent-line` in the
  appendix, with the name stepped to `--ink-soft`), so where one section
  ends and the next begins is read off the grounds and not off a hairline —
  and each family keeps to itself, so the alternation never hides where the
  back matter starts. Hover is `--line-strong`, darker than any ground a
  segment can have. **No segment is lit for the section
  being read.** A 2px `--ink` marker across the strip says where the reader
  is, to the line: it stands at the middle of the window, on the strip's
  scale, and is moved by the scroll itself, frame by frame. It stops short
  of the lane, where the marks are doing their own pointing. The middle is
  also where a press brings a place to, so the marker arrives under the
  pointer — pressing a spot and being at it are one point on the bar.
  Every segment is named, cut short with an ellipsis where it must be, and
  the tooltip carries the whole of it. **The tooltip is the Navigator's
  own, and instant.**
  The browser's waits a second and will not move until the pointer rests
  again, which suits a toolbar of large separate buttons; here a paper is
  ruled off along a few hundred pixels, a section can be five of them
  wide, and the hand moves a pixel at a time asking "and this?". So the
  name of whatever is under the pointer — section, subsection, anchor —
  is shown the moment it is there and follows it, as an `--ink` chip under
  the bar, during a held press too. Each lane is one tab stop with arrows
  to walk it: a bar must not cost twenty-five presses to get past. The keyboard has no
  spot to point at, so Enter on a segment goes to the head of its section.

- **Jacket** — `.board-jacket`, `.paper-jacket`: a work's one screen in the
  Desk, where what is known about it is kept and from which it is opened.
  A paper has had one all along; a board's is new, and it is why the board's
  `description` column finally has somewhere to be read. Both sit inside the
  Desk's own chrome with a Back to the nook or Library they were opened
  from (`jacketOrigin.js`, one remembered place per tab serving both kinds).
  The board's two writable fields — its name and its description — are kept
  the way an anchor's card keeps its own: when the field is left, not when a
  button is pressed. The way in is one `primary` button, because a jacket
  has exactly one thing it is for.

- **Anchor card** — `.note-pop`: an anchor's name, its note and its delete,
  on a `--card` ground with `--shadow-md`, hung off its pin on the page.
  It replaced the rail. The rail did two jobs: it listed the anchors, which
  the Navigator now does better — at their places, on the paper's own
  scale — and it edited them, a window's width from what they were about.
  Editing belongs where the anchor is, so the card opens on the page and
  the text it concerns stays under the reader's eyes. It opens from a
  click on the pin, and only from there: a mark on the Navigator *goes* to
  its anchor and opens nothing, because getting to a place and working on
  it are different wishes and the bar is for the first. The one card that
  opens by itself is that of an anchor just dropped, with the note already
  in hand: type and it
  is a note, click away and it is an anchor. A pin that is only clicked
  takes no keyboard focus — pins are read far more often than rewritten.
  **There is no Save.** A field is kept when it is left, and the card is
  left by clicking anywhere else; Escape takes back what was typed in the
  field it is pressed in, and undo takes back what was already kept. The
  name is a field that does not look like one until hovered; empty, it asks
  for a title ("Write a title…") rather than showing the page number, which
  read as the anchor's name when it was only the lack of one. The glyph
  in the card's corner is the pin's own and changes with it, an anchor
  until the first letter is written. The card is set in the page's
  percentages so it survives zoom, is centred under the pin but held
  inside the sheet (the next sheet paints over whatever hangs past this
  one), and turns upwards in the lowest part of a page. In a shared
  reading it is the same card without its fields or its delete.

- **Tool rack** — `.tools`: in the viewer's bar the tool palette shows only
  the tool in hand, and opens to the full set on hover, on `:focus-within`,
  and while one of its sheets is open. It opens *downwards*, out of the bar
  and over the page, on a `--card` ground with `--shadow-md`: opening
  sideways would reach back across the Navigator it just made room for,
  and the stretch it would cover is the map's end — the appendix, the part
  of a paper a reader is least likely to be holding in mind. Choosing a
  tool still costs one click; the others are a pointer-move away, not a
  click away, which is the rule the palette was built on. **The tool in
  hand keeps the top of the rack** (`order: -1`), so the glyph under the
  pointer when the rack opens is the glyph that was under it a moment
  before — let the palette keep its printed order instead and a user
  holding the brush who clicks without looking ends up holding the arrow.
  The other five keep their order relative to one another. A touch screen
  has no hover to open it with, so under `(hover: none)` the rack is never
  collapsed, stands as a row, keeps its printed order, and takes its room
  back from the map. Nothing else in the bar hides this way: the rack earns
  it by being six controls wide next to a map that wants every pixel.

- **Panel** — `.panel`: white card, `--line` border, `--radius`.
- **Tinted card** — `--radius`, compact padding, tinted by visibility:
  `--green-soft` for public fields (ratings, thought) and `--accent-soft`
  for private ones (summary, notes). The tint matches the field's
  visibility badge, so a user can tell at a glance who sees what
  without reading the badges.
- **Visibility fields in forms** — tint the container, never the text box:
  `--green-soft` surrounds public fields and `--accent-soft` surrounds
  private fields. Inputs and tag editors remain `--card` inside that tint,
  with a border from the matching semantic family. This keeps every input
  recognizable as an editable white control while the surrounding colour
  communicates who can see its value. Apply the matching ink colour to the
  field label as a secondary cue.
- **State pill** — small-caps/uppercase `--fs-2xs` UI-font text on a
  semantic fill (`--gold`/`--green`/`--grey`), `--radius-pill`.
- **Visibility badge** — `public` (green-soft) / `private` (accent-soft)
  chip beside a *heading* ("My ratings", "Summary"). A control that states
  its own meaning in a full sentence takes the tint alone — appending a
  badge to a sentence reads as if the word belongs to it.
- **User chip** — a circular avatar in a ring, used wherever users are
  listed. A user who authored the paper gets `.author`: squared off and
  gold, so the role reads by shape as well as colour and never depends on
  colour alone.
- **Icon button** — `.icon-btn`: chrome-free (no border, fill or shadow),
  inline SVG drawn with `stroke="currentColor"` so the glyph follows the
  button's colour, `--ink-faint` at rest. Add `.danger-icon` for a
  destructive one: red at rest, on a red tint on hover — a destructive
  control should not wait for a hover to say so. It must always carry both a
  `title` and an `aria-label`: an icon has no name of its own. Use it only
  where the surrounding context makes the action obvious and space is
  genuinely tight — a labelled button is the default.
- **Item actions** — `shared/ui/ItemActions.jsx`: the single contextual action
  surface for a selected or bounded object (PDF selection, paint, clip, board
  card). Selection is the disclosure gesture, so a compact glyph toolbar appears
  immediately without an ellipsis or second click. Every glyph has a tooltip and
  accessible name; danger is the final red control. The surface owns consistent
  sizing, grouping, collision-aware placement, and Arrow/Home/End navigation. Use
  `below-end` by default, `above-end` when the selection sits below its anchor,
  and `right-start` on spacious canvases. Show it only for a single selected
  object; do not recreate contextual actions with ad-hoc positioned buttons.
- **Danger button** — `button.danger`: a modifier on the base button, for
  an action that changes what a user's own work depends on (Replace PDF).
  It takes the red family in its tint/line/ink roles — `--red-soft` fill,
  `--red-line` border, `--red` text — not the saturated fill a `.primary`
  uses, so it warns without competing for the one prominent action. This is
  the one sanctioned use of a semantic hue on a control: red for danger,
  never red for emphasis. For a destructive action that reads as a link in
  a row of text, use `.danger-link` instead.
- **Paired controls** — two controls offering one choice (`.pdf-row`) are
  the same size: equal flex width and an explicit `line-height`, because an
  `a.btn` inherits the body's 1.65 while a `button` does not, and the pair
  would otherwise render at two different heights.
- **Header action** — a `.link-btn` sitting inside an `h4` heading
  ("edit", "Add a note") instead of a separate row: saves vertical space.
- **Inline edit** — `.inline-edit` + `.inline-edit-box` textarea +
  `.inline-edit-actions` (primary Save/Add, plain Cancel, Esc cancels).
  Use it for every in-place composer so boxes are the same size. The box
  is `components/AutoTextarea.jsx`, which grows with the text and caps at
  a screenful: `rows` sets the height it opens at, not a window the user
  writes through. Its leading is tighter than body prose (1.4), because in
  a composer the line breaks are the user's own structure.
- **Markdown prose** — the user's own long-form writing (summary, notes)
  is Markdown: written in an `.inline-edit` box under a `.md-hint` line
  naming the syntax, and displayed through `components/Markdown.jsx`, which
  renders a small subset to React elements — never to HTML, so a user's
  text can never become markup. Its blocks style off `.md` and keep the
  card's own tint; only code takes a surface of its own (`--card`, so it
  reads as inset on the tint). Headings inside a note start at `--fs-lg`,
  a step under the section heading above the card: prose a user wrote is
  never louder than the app's own structure.
- **Checkbox** — always `.checkbox-row`: a 15px box in `--accent`, label in
  the UI font. Add `.inline` when the option trails the line it qualifies
  instead of standing on its own row (smaller `--fs-xs` text in
  `--ink-faint`). Never restyle the box itself — no bespoke sizes and no
  other accent colour. A checkbox is a control, so it takes the control
  colour; semantic hues label state, not inputs.
- **Shelf** — every nook entry belongs to exactly one shelf. Shelf colour is
  identity, not visibility: show it as a narrow vertical swatch on paper rows
  and beside shelf selectors. Visibility is always stated in words (`Public`
  / `Private`) because a user can rename and recolour any shelf. The
  current-shelf swatch on an owned paper row opens a compact shelf palette;
  forms use the same shelf names and visibility wording in a compact select.
  Shelf configuration is secondary to reading, so the nook exposes it through
  a `Manage nook` button and keeps the full editor in a focused modal.
  Visibility is a compact Public/Private switch. The default shelf is a radio
  group because exactly one shelf receives newly added papers; do not present
  either choice as an action button.
  Shelf selection itself is private configuration, including in upload forms,
  so its label and control border use the private accent family. Select options
  still state each shelf's paper visibility explicitly as `Public` or `Private`.
  `Manage nook` also owns the private tag vocabulary: tags can be created or
  deleted there, while assignment stays on individual papers. Deleting a tag
  removes only that label from papers, never the papers themselves.
  Shelves use the same compact black × removal affordance as tags. Removing a
  shelf moves its papers to another shelf; the final shelf cannot be removed.
- **Desktop shell** — inside Papol macOS (the Tauri app;
  `shared/desktopShell.js` stamps `data-shell="desktop"` on `<html>`, and
  `?shell=desktop` previews it in a browser tab) the website masthead gives
  way to a native reference-manager layout. A 220px `--chrome` source-list
  sidebar (`components/DesktopChrome.jsx`) lists the user's sources — All
  papers, each shelf (by its swatch, once there are two), Boards, their tags —
  then Desk, Inbox, Learn, with Manage nook as the icon beside "My nook".
  Reading is three panes (`components/DesktopDesk.jsx`): the Desk sidebar picks
  a source, a 320px white list pane shows it as compact rows with a search
  field, and the selected paper opens beside the list in the ordinary
  `PaperDetail`. A selected board opens a read-only overview there instead:
  identity and shelf, incoming excerpts or clips waiting to be placed, and a
  fitted canvas preview. One click selects a board; double-click, Return, or
  the overview's Open Board button opens its document window. The Library is
  for recognising and resuming a board, never for editing its canvas. A newly
  created board becomes the selected board in the Desk and shows this
  overview; creation never opens the document window on the user's behalf.
  Adding a paper or a board also happens in the detail pane. Every
  other page (Inbox, Profile, Learn, a seminar, someone else's nook) fills the
  space beside the sidebar under a toolbar holding just its title.
  Papol is small enough that the sidebar is all the navigation the app needs:
  its window has no Back or Forward and no history to walk (⌘1…⌘4 open the
  sidebar's numbered rows). The viewer and a board are the exception, because
  they replace the sidebar: their bars lead with `shared/ui/DesktopNav.jsx`,
  a single borderless Back chevron at the leading edge, as in the App Store
  and System Settings, which returns to Papol; ⌘[ presses it. Nothing lies
  ahead of either, so there is no Forward.
  There is never a "← Back" text link in the app. Jumps inside a PDF (a followed "see Section 3" link)
  are the document's own history, shown in the viewer on the web and in the app
  alike as a return pill centred over the pages: it names the page to go back
  to ("Back to page 4", or "‹ Page 4 │ Page 12 ›" once there is a way forward
  too), answers to [ and ], and exists only while there is somewhere to return
  to. Its × hides it for good in that browser: a Learn Papol card takes its
  place, says [ and ] still work, offers Undo, and stays until dismissed.
  What a browser remembers having shown or been told — the tip, the hidden
  pill — is listed in `shared/featureStates.js`, and Admin's Feature
  introductions panel puts each on a switch.
  Chrome is UI sans at `--fs-sm`, never selectable, and uses the arrow cursor
  rather than the pointing hand; rows and toolbar buttons are borderless,
  shadowless `--chrome-radius` shapes tinted `--chrome-hover` /
  `--chrome-selected`, with `--accent` line glyphs. Paper titles in the list
  stay serif. A selected row is `--chrome-selected` grey, and `--accent` with
  inverse text while the list has focus, as native lists do. Arrow keys move
  the selection without adding history. A row from the user's own nook can
  be dragged onto a shelf in the sidebar to move the paper there; the shelf
  under the pointer lights in `--accent` with inverse text, like a native
  drop target. Anything the chrome already offers
  leaves the page: the About link, the guest pitch (a signed-out window opens
  on Sign in), the floating Feedback button (now a sidebar row) and in-page
  `.back-btn` links. The unread count is a quiet trailing number, as in Mail,
  not a badge. On macOS the title bar is transparent and overlays the page, so
  every top bar — the toolbar, `.viewer-bar`, `.board-toolbar` — is 52px
  tall, carries `data-tauri-drag-region="deep"` so its empty stretches move
  the window, and under `[data-platform='mac']` leaves 88px on the left for the
  traffic lights. Keys follow the platform: ⌘[ for Back in the viewer and
  boards, and ⌘1…⌘4 for the sidebar's numbered rows.
  Beside the list, the paper sits flush on a white pane rather than as a card
  on a card. Inbox marks unread with an `--accent` dot, as Mail does, instead
  of a tinted row and badge. The desktop sign-in card is centred in the window
  and lifted by a shadow. The macOS webview shows no JavaScript dialogs, so
  every "are you sure?" goes through `shared/confirmAction.js`: the browser's
  `confirm()` on the web, and in the app a sheet with the action named on its
  button (never a bare OK), destructive actions in `--red` and never the
  default button. Never call `window.confirm`, `alert` or `prompt` directly.

## Voice

Labels that *name* the user's own content say **my**: "My nook",
"My ratings", "My thought", "My expertise", "Add to my nook".

Prose that *speaks to* the user says **you/your**: placeholders ("Your
one-line take on this paper"), warnings ("your changes apply to this paper
for every user"), confirmations ("Your ratings and notes will be
deleted"), empty states, and notices.

The test: if it is a heading or a button naming a thing that belongs to the
user, it is "my"; if the app is talking, it is "your".

## Extending the system

When a screen needs something the system does not cover, extend the closest
existing component with a modifier class — `.checkbox-row.inline`, not a new
`.author-claim`. A parallel class with its own sizes and colours is how the
system rots: it looks fine alone and wrong beside its siblings.

If the pattern is genuinely new, add it to this file in the same commit as
the code. A rule that lives only in one component is not a system.

Two traps worth naming, both hit in practice:

- **Borrowing a semantic hue for a control.** Gold, green, and red label
  *state*; `--accent` is the colour of things you operate. An input styled
  gold reads as a new kind of widget.
- **Reaching below the scale for "small".** `--fs-2xs` belongs to badges. A
  control label that needs to be quiet uses `--fs-xs` with `--ink-faint`;
  quietness comes from weight and colour, not from shrinking past the scale.

## Rules of thumb

- Experimental features carry the shared `ExperimentalBadge`: a gold flask
  with an explicit label where space permits, and the same flask alone in
  compact navigation. Its tooltip always says that the feature may change.

- Public content sits above a panel's separator and is tinted green;
  private content (summary, notes) sits below it, tinted blue, badged
  `private`.
- Vertical compactness is a feature: prefer header actions and
  on-request composers over always-visible inputs.
- Vertical spacing belongs to the row, not to the text inside it. Where a
  line is a flex row of a heading plus its controls (`.detail-title-row`,
  `.detail-authors-row`), the margin goes on the row; a margin on the inner
  `h2` or `p` moves the text and leaves the controls beside it behind.
- One prominent action per view (`button.primary`); everything else is a
  plain button or a `.link-btn`.
