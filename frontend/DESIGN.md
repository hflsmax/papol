# Papol Design System

All styles live in the template string in `src/App.jsx`. The system is a set
of CSS custom properties declared on `:root` at the top of that sheet; every
rule below the token block should derive from them. When you add UI, pick
tokens — don't invent new hexes, font sizes, or radii.

## Color

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1d2129` | Primary text |
| `--ink-soft` | `#4d5561` | Secondary text, labels |
| `--ink-faint` | `#7e8794` | Hints, dates, disabled-ish text |
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
`--identity-*` tokens, chosen per reader by id, back the initial shown when
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
system. Prose the reader writes (notes, summaries, messages) is serif;
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

## Recurring patterns

- **Panel** — `.panel`: white card, `--line` border, `--radius`.
- **Tinted card** — `--radius`, compact padding, tinted by visibility:
  `--green-soft` for public fields (ratings, thought) and `--accent-soft`
  for private ones (summary, notes). The tint matches the field's
  visibility badge, so a reader can tell at a glance who sees what
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
- **Reader chip** — a circular avatar in a ring, used wherever readers are
  listed. A reader who authored the paper gets `.author`: squared off and
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
- **Danger button** — `button.danger`: a modifier on the base button, for
  an action that changes what a reader's own work depends on (Replace PDF).
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
  a screenful: `rows` sets the height it opens at, not a window the reader
  writes through. Its leading is tighter than body prose (1.4), because in
  a composer the line breaks are the reader's own structure.
- **Markdown prose** — the reader's own long-form writing (summary, notes)
  is Markdown: written in an `.inline-edit` box under a `.md-hint` line
  naming the syntax, and displayed through `components/Markdown.jsx`, which
  renders a small subset to React elements — never to HTML, so a reader's
  text can never become markup. Its blocks style off `.md` and keep the
  card's own tint; only code takes a surface of its own (`--card`, so it
  reads as inset on the tint). Headings inside a note start at `--fs-lg`,
  a step under the section heading above the card: prose a reader wrote is
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

## Voice

Labels that *name* the reader's own content say **my**: "My nook",
"My ratings", "My thought", "My expertise", "Add to my nook".

Prose that *speaks to* the reader says **you/your**: placeholders ("Your
one-line take on this paper"), warnings ("your changes apply to this paper
for every reader"), confirmations ("Your ratings and notes will be
deleted"), empty states, and notices.

The test: if it is a heading or a button naming a thing that belongs to the
reader, it is "my"; if the app is talking, it is "your".

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
