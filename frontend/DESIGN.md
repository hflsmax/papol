# Papol Design System

The canonical tokens and cross-product component styles live in
`shared/applicationStyles.js`. The web app and board use that sheet; Papol
Desktop's scoped rules live in `shared/desktopStyles.js`, which the canonical
sheet appends. The PDF viewer is a separate application and mirrors the
canonical foundations in `viewer/src/styles.js`. Token values must match
across those files so moving from library to viewer to board feels like one
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
| Gold | `--gold`, `--gold-ink`, `--gold-soft` | planning state, demo banner |
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

**Sanctioned exception:** `components/Avatar.jsx` also carries a six-color
pastel set used as the ground behind transparent demo portraits. It is the
only place outside the `:root` block allowed to name a color.

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
- The PDF viewer changes from a two-column page/anchor layout to an overlay
  rail at 860px, then compacts toolbar labels at 560px. Pages remain the only
  document scroller at every width.
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

- **Contents** — the viewer's one navigation control, at the leading edge of
  `.viewer-bar` beside Back: the left of that bar answers "where am I", the
  right is what you do to the page. It is not an icon with a menu behind it;
  it *names the section being read*, so the bar answers that question with
  nothing opened, and falls back to the word "Contents" where a paper offers
  no headings. Opening it gives one list under quiet small-caps kickers —
  Sections, Appendix, Anchors — separated by hairlines, never by three
  coloured headings. One row shape serves all three: a number column at the
  left, a page column at the right, the title taking what is between. That
  right-hand column running the height of the panel is what makes the
  paper's own structure and the reader's own marks read as one map of one
  document. Sections and anchors are grouped, never interleaved: nested
  under sections an anchor would take a third width of indent and the eye
  could no longer pick out "my anchors", which is the one thing that list is
  for. The section being read is marked with `--accent-soft` and `--accent`,
  as a selected desktop row is — never a rule or a bar drawn over the names
  around it. Where the paper numbers nothing, the number column is not set
  aside at all.

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
  then Library, Inbox, Learn, with Manage nook as the icon beside "My nook".
  Reading is three panes (`components/DesktopLibrary.jsx`): the sidebar picks
  a source, a 320px white list pane shows it as compact rows with a search
  field, and the selected paper opens beside the list in the ordinary
  `PaperDetail`. A selected board opens a read-only overview there instead:
  identity and shelf, incoming excerpts or clips waiting to be placed, and a
  fitted canvas preview. One click selects a board; double-click, Return, or
  the overview's Open Board button opens its document window. The library is
  for recognising and resuming a board, never for editing its canvas. A newly
  created board becomes the selected board in the Library and shows this
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
