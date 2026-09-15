# Papol UI/UX audit

Audited 15 September 2026 across the web library, authentication and public
pages, paper detail and upload, seminar flow, desktop library shell, PDF
viewer, and infinite board. The audit covers source-level visual consistency,
interaction states, semantics, responsive rules, and the documented design
system. It does not replace moderated usability testing with active readers.

## Executive assessment

Papol has a strong and recognizable product idea: a quiet, paper-like reading
environment with serif content, navy controls, restrained semantic color, and
desktop behavior inspired by native reference managers. The best parts of the
system are unusually well reasoned: private/public fields have distinct but
subtle tints, shelf color is kept separate from visibility, destructive actions
use a consistent red family, and the viewer and board protect the primary task
instead of surrounding it with dashboard chrome.

The main risk was implementation drift rather than an absence of direction.
The canonical stylesheet had grown to almost 5,000 lines, while the viewer
manually copied only part of its token set. That produced missing focus colors,
undefined aliases, different type foundations, and a faint text color that did
not meet the normal-text contrast target. Forms also mixed properly associated
labels with visually identical but unassociated labels.

This pass consolidates foundations without redesigning Papol's character.

## Experience consistency matrix

| Area | Web library | Desktop shell | PDF viewer | Board | Decision |
|---|---|---|---|---|---|
| Content type | Serif | Serif in content panes | Serif | Serif on cards | Keep |
| Interface type | Previously mixed on buttons | Sans | Sans | Sans toolbar | Standardize on `--font-ui` |
| Primary action | Navy fill | Navy selection/action | Navy held tool | Navy selection/action | Keep |
| Secondary action | White, bordered | Native flat chrome | White, bordered | White, bordered | Keep contextual difference |
| Danger | Red tint/ink | Red ink/action | Red remove | Red remove | Keep |
| Focus | Partial and component-specific | Strong | One unresolved token | Several hover-equivalent states | Add shared baseline, preserve shaped exceptions |
| Faint text | 3.36:1 on page ground | Same | Same | Same | Darken to AA-capable step |
| Radius | 3px / 10px / pill | plus 6px chrome | subset copied | app tokens | Centralize |
| Responsive model | 560/760px | 760/900px | 560/860px | 560/700px | Keep behavior-based breakpoints |
| Motion preference | Board only | Partial | Missing global rule | Present | Add product-wide reduction |

## Changes made in this pass

### One source of truth

- Added `shared/designTokens.js` as the canonical source for color,
  typography, shape, spacing, elevation, focus, and motion.
- The app, board, desktop shell, and PDF viewer now consume the same token
  source. Viewer-only annotation colors remain local because they identify a
  drawing tool, not shared product state.
- Replaced undefined aliases (`--muted`, `--surface-muted`, `--ink-muted`,
  `--paper-soft`, `--radius-sm`, and `--wash`) with their canonical roles.
  Remaining apparently undefined properties are deliberate runtime inputs such
  as shelf colors, brush colors, board zoom, and rail width.

### Accessibility and interaction

- Darkened `--ink-faint` from `#7e8794` to `#66717f`. It now reaches about
  4.59:1 against `--paper`, while primary and secondary text remain unchanged.
- Added a shared `:focus-visible` baseline and repaired the viewer selection
  action's unresolved focus color.
- Added an inset focus halo to ordinary form fields, consistent with selects.
- Associated labels with authentication, paper metadata, paper upload, and
  seminar controls. Compound groups use an accessible group name rather than a
  freestanding label.
- Normalized placeholder contrast and added a global reduced-motion response.
- Added one modal keyboard contract across the web app and viewer: initial
  focus, trapped Tab navigation, Escape, scroll containment, stacked-dialog
  safety, and focus restoration.
- Filter groups now expose pressed state, search controls have explicit names,
  and filtered-empty results offer a direct “Clear filters” recovery action.
- Loading and error feedback now uses consistent live-region semantics across
  application, administration, viewer, and board surfaces. The viewer's clipped
  content resize handle also supports precise arrow-key operation.

### Visual language

- Buttons now consistently use the UI sans family. Prose and user-authored
  writing remain serif; identifiers and admin data remain mono.
- Added documented spacing, elevation, and motion scales. New components can
  now express rhythm and layer depth without introducing one-off values.
- Replaced broad `transition: all` on buttons with explicit, low-cost visual
  properties.
- Unified text-selection, paint, PDF clip, and board-card actions in one
  directly visible glyph toolbar. Selection itself reveals the actions, so
  there is no ellipsis indirection. The shared primitive owns sizing, placement,
  elevation, danger ordering, tooltips, accessible names, and arrow-key
  navigation across viewer and board surfaces.

## Flow-level analysis

### Navigation and information architecture

The web navigation is compact and appropriate for a small product. The desktop
sidebar is even stronger: it maps the reader's mental model (all papers,
shelves, boards, tags, inbox, learning) directly to stable sources. The viewer
and board correctly become focused document windows, with one route back to the
library. Preserve this distinction; adding browser-like history or duplicating
sidebar destinations inside content would weaken the model.

On phones, the masthead becomes a full-width tab row and secondary form actions
stack. This is coherent. As new destinations appear, resist adding more equal
tabs; move low-frequency destinations behind the account surface before the
row wraps into two lines.

### Library and nook

Shelf color, public/private meaning, reader identity, and seminar state each
have separate visual encodings. This is a major strength. Cards and rows are
compact enough for scanning, and serif paper titles preserve a reading-first
feel. The most likely usability pressure is filter accumulation: shelf tabs,
reader filters, tags, search, and sort can all coexist. Keep a single clear
result count and provide one “Clear filters” action whenever two or more filter
families are active; do not add more persistent filter chrome.

Empty states use plain language, but they should consistently answer both
“what happened?” and “what can I do?” The empty library already has an upload
entry point nearby. Filtered-empty states should keep the query visible and
offer to clear filters rather than resemble a genuinely empty collection.

### Paper detail and upload

The detail page's strongest UX idea is visibility by container tint: public
ratings/thoughts and private summary/notes are distinguishable before their
badges are read. Metadata editing also warns that changes affect all readers.
These patterns should remain canonical.

Upload is information-dense but correctly staged as review rather than blind
submission. Continue to keep extracted data editable and never make metadata
lookup a blocking requirement. The form would benefit from a future progressive
disclosure pass: bibliographic essentials first, then shelf/tags and optional
reflection. This should be validated with users before changing field order,
because local import and public upload have different motivations.

### Seminars

Semantic state colors and a single `StatePill` component make seminar status
consistent. Host transfer and uncall actions are explicit. The announce form's
style choices are now exposed as a named radio group. A future usability test
should examine whether “planning”, “called”, and “scheduled” match readers'
natural vocabulary; color consistency cannot compensate for an unfamiliar
state model.

### PDF viewer

The viewer protects document scroll, keeps anchors in a stable rail, and moves
that rail over the page on narrow windows. Annotation tools show held state with
fill rather than border alone. These are sound, task-specific decisions.

The toolbar is the densest surface. Keyboard hints are helpful, but every new
tool competes with title, search, zoom, and navigation. Add future tools behind
an overflow or contextual action instead of shrinking targets below 32px. On a
touch device, tool discovery must not depend on hover; current touch rules
already reveal hover-only note actions and should be applied to any new action.

### Infinite board

The board separates world-space content from screen-space chrome, scales
handles against zoom, supports multi-selection, and provides a staging area.
This is the right conceptual model. The initial hint (“drop or paste”) is
useful, and mobile toolbar controls are expanded to 40px.

The board has the highest learnability cost in Papol. Preserve the existing
first-use hint, but measure whether readers discover double-click-to-create,
grouping, and booklet reordering. If not, prefer a small contextual empty-canvas
action or a replayable help entry over permanent toolbar labels.

## Remaining priorities

### P1 — usability and modal behavior

1. Run keyboard-only task tests for sign in, upload, edit metadata, announce a
   seminar, search a PDF, create an anchor, and organize a board. The source now
   guarantees a baseline focus style, but task testing is needed to catch focus
   order and focus restoration defects.
2. Extend the shared modal contract to any new modal surface and add an
   integration test for nested confirmation sheets.
3. Test the upload/review flow and the board's grouping model with readers. The
   main open questions are conceptual, not cosmetic.

### P2 — component consolidation

1. Extract shared primitives for Button, Field, Notice, Dialog, Popover, and
   EmptyState. Keep visual variants small: primary, secondary, danger, link,
   and icon. The goal is to reduce CSS coupling, not introduce a generic UI kit.
2. Replace repeated hard-coded shadows and animation timings incrementally with
   the new tokens when touching each component. A mechanical global rewrite is
   risky because several shadows describe PDF ink and board geometry rather
   than UI elevation.
3. Keep the new automated token checks current when adding a legitimate
   runtime property; an unresolved visual alias should fail tests rather than
   silently fall back in the browser.

### P3 — validation and product evidence

1. Add screenshot regression coverage at 320, 560, 760/860, and 1280px for the
   main library, a long paper title, upload review, viewer with open rail, and a
   populated board.
2. Add an accessibility check to CI for label associations, dialog names,
   keyboard focus, and obvious contrast regressions.
3. Track completion and abandonment for upload review, first annotation, and
   first board grouping. Those measures will show where simplification matters
   more than additional polish.

## Definition of done for new UI

A new interface is ready when it uses canonical tokens, has loading/empty/error/
success behavior as relevant, works without hover, has a visible keyboard
state, exposes an accessible name and state, respects reduced motion, and is
checked at the nearest behavioral breakpoints. It should preserve Papol's
reading-first hierarchy: content in serif, actions in UI sans, one prominent
action per decision, and semantic color only when it carries stable meaning.
