# Papol vocabulary

The words Papol uses for its own parts, where each one is spoken (product
prose, UI label, code, database), and where two words are doing one job or one
word two jobs.

Papol's source is written in prose — docstrings that explain a decision rather
than restate a column. That style only pays if the nouns hold still. This file
is where they are held.

Three registers run through every entry below:

- **Product** — the word `USER_STORIES.md` and the UI say to a user.
- **Code** — the identifier in the source.
- **Store** — the table or column.

Where the three disagree, the entry says so, and §12 collects the ones worth
acting on.

---

## 1. People and places

| Term | Meaning | Notes |
| --- | --- | --- |
| **User** | Someone who uses Papol. | One word in all three registers: `User`, `users`, "user" on the page. Papol has exactly one kind of person, so it needs exactly one noun for them — **not "user"**, which names a role someone is currently playing rather than the account that holds their papers. |
| **Visitor** | A user who is not signed in. | Sees the demo, a sharable, and the sign-in pages — nothing else. |
| **Nook** | One user's public reading corner: their copies, shelves, boards, tags. | Product word. The code calls the same payload a **Space** (`getUserSpace`, `Space.jsx`). See §12.1. |
| **Shelf** | One of a user's five homes for papers, each **public** or **private**. | *Visibility lives here and nowhere else.* `Copy.is_public` asks the shelf each time rather than keeping a second copy of the fact. |
| **Library** | **Every** paper there is, and every user who displays one. The place a paper is found rather than owned. | No display gates it (§2b); what display governs is the row of users shown against a paper. There is no separate word for the list of users — papers and the people who read them are two views of one Library, not two places. |
| **Demo** | A fictional Papol that lives entirely in the browser; the URL is the sole authority for whether it is on. | `shared/demo.js`, `shared/demoWorld.js`. No request reaches the backend in demo. |
| **Admin** | A user who can see feedback, settings and the tables page. | |

## 2. Works

| Term | Meaning | Notes |
| --- | --- | --- |
| **Paper** | The canonical work, **keyed by DOI** (title when there is no DOI). One row, shared by every user who has it, and **owned by none of them**. | Metadata, the seminar cohort and "also read by" hang off the paper, not off a copy. Nothing in the code asks whose a paper is (`USER_STORIES.md` §2b). |
| **Edition** | One PDF file of a paper. | A re-upload *adds* an edition; it never replaces the file someone is reading. A byte-identical upload reuses the existing edition (`sha256`). |
| **Copy** | One user's holding of one paper: shelf, ratings, summary, thought, tags, and the edition they read. **The only thing here a user owns.** | Everything private in Papol hangs off a copy, never off a paper. Prefer **copy** over "entry"; see §12.2. |
| **Adopt** | To move my copy to a newer edition. | Only the user's own click ever moves it, and Papol never realigns annotations afterwards. `ignored_edition_uuid` records the newest edition already waved away. |
| **Summary** | My private prose about a paper. Mine alone, whatever the shelf says. | Belongs to the copy, so only its own user reads or writes it. |
| **Thought** | My **public** one-line take, shown on my chip wherever I appear beside the paper. | Labelled "My thought". Distinct from Summary in both length and audience — the labels are the only thing keeping the pair apart. |
| **Ratings** | Three optional 1–5 dimensions: **My expertise**, **Reading depth**, **Merit**. | Stored as `rating_expertise`, `rating_reading`, `rating_liking`. The third column's name predates its label. See §12.6. |
| **Tag** | A user's own label, applied to their copies. | Private to the user; `copy_tags` joins them. |

## 3. Annotations — what a user leaves on a PDF

One table, `annotations`, three kinds. They differ in geometry, not in nature:
each belongs to one user, sits on one edition of one paper, and is private
until that user shares a reading.

| Term | Meaning | Notes |
| --- | --- | --- |
| **Annotation** | The umbrella over all three. | The table's word, the API's word, and the product's word — one noun in all three registers. Prose that reaches for "mark" is reaching for a synonym Papol does not need; the source's older "a mark belongs to…" comments should say *annotation*. |
| **Note** | Words, optionally **anchored** to a place on a page. | A located note is not a second kind of thing — it is a note with an anchor. One list, not two. |
| **Anchor** | A note's place on a page. Typed: today `point`; `rect`, `polygon`, `quote` can join without a migration. | Drawn as a **pin**. Prose says "place" and "pin"; code says `anchor`. Prefer **anchor** for the datum, **pin** only for the thing on screen. |
| **Ink** | A stroke drawn over the page, in one of five colours and four widths. | The kind is `'ink'`; the UI verb is **paint**. See §12.4 — the project's sharpest collision. |
| **Clip** | A movable view of one rectangle of the page. | Its rectangle is its **frame**. |
| **Stroke group** | Several stored strokes that are one logical annotation — text painted across lines is drawn as separate paths, picked up and erased as one. | `group_uuid`. Unrelated to a board group (§5). |
| **Reading** | One user's annotations on one edition, taken together. | The thing a rich sharable carries. Named, not copied: reword a note and everyone holding the link sees the rewording. Worth promoting from a phrase to a term — sharing is unexplainable without it. |

**Coordinates.** All annotation geometry is fractions of the page, so zoom, DPI and
screen size never enter it. But there are *two* fraction conventions in Papol
and both are spoken of as "fractions of the page":

- **PDF-space fraction** — origin bottom-left, y up, as PDF measures. Used by
  anchors, ink points and clip frames.
- **Screen-space fraction** — origin top-left, y down. Used by citation boxes,
  link boxes and backlink bands.

Distinct from both: **page units**, PDF points from the top-left, used inside
the viewer's text-layer geometry. See §12.7.

## 4. Apparatus — what the PDF itself says

| Term | Meaning | Notes |
| --- | --- | --- |
| **Analyzer** | The optional service that reads a PDF's bibliography and links. | Optional by design: where it is not running, everything else works and citations are simply not clickable. |
| **Reference** | One work cited by an edition, as printed. | `raw` is the line exactly as the author printed it — what a search matches, and what to show when nothing matches. |
| **Citation** | One in-text marker — the "[12]" a user clicks — and its box. | "[3, 5]" is two citations, because each leads somewhere different. `inferred` marks one matched only by reading its number: a guess, shown as one. |
| **Link** | An analyzed cross-reference to another position in the same PDF — "see Section 3.2", "Figure 4". | Following one offers **← Back to where you were** (the *return pill*). |
| **Resolution** | What the bibliographic lookup added to a reference: `none`, `ok`, `miss`, `error`. | Filled the first time someone opens that reference, and kept. |

Reading a bibliography happens once per **edition** and is kept, so only the
first user of a PDF waits.

## 5. Boards

| Term | Meaning | Notes |
| --- | --- | --- |
| **Board** | A private ideation space inside one user's nook, served full-screen at `/boards/<guid>`. | |
| **Card** | One item on a board. Its `kind` is `comment`, `excerpt`, `image`, `file`, `youtube` or `webpage`. | `board_items`. "Card" is the product word; "item" is the schema word. |
| **Board group** | A visual and behavioural grouping of cards: a **booklet** or a **collection**. | `board_groups.kind`. Unrelated to a stroke group (§3). |
| **Excerpt** | Text carried out of the viewer onto a board — a selection, a painted passage, or a clip's contents. | Unwrapped from the PDF's visual line breaks on the way out; genuine paragraph breaks kept. |
| **Backlink** | The canonical viewer URL a card keeps, so it can send the user back to the place it came from. | Stored canonical rather than machine-local so it survives leaving one computer. |
| **Staged** | A card that has arrived but not yet been placed — it waits in a tray until dragged onto the board. | |

## 6. Sharing

| Term | Meaning | Notes |
| --- | --- | --- |
| **Sharable** | A link that opens a PDF in the viewer for whoever holds it, signed in or not. The UUID in the link is the whole of the permission. | |
| **Rich** | A sharable carrying one user's **reading** — their annotations on that edition. Belongs to them; shown on their paper page; theirs to revoke. | |
| **Lean** | A sharable carrying the PDF alone. One per edition, belongs to nobody, names no user. | Never shown on a paper page and never counted against its maker: nothing of theirs is in it. |
| **Demote** | To turn a rich link lean, permanently, when the user takes the paper out of their nook or drops their annotations. | Permanent by design — putting the paper back must not quietly re-expose annotations to everyone still holding the link. |
| **Revoke** | To stop a link opening at all. Final; sharing again mints a new one. | One word, matching `revokeSharable()` and `revoked_at`. Do **not** say "close": it borrows a window's word for something with no reopening. The row survives revocation, so a revoked link is answered with "no longer shared" rather than a 404 that reads as a typo. |

**Sharing is not displaying.** A shelf says who can *find* the paper; a link
says who may *read this PDF*. Neither moves the other.

## 7. Seminars

| Term | Meaning | Notes |
| --- | --- | --- |
| **Call** | Requesting a spontaneous seminar on a paper. Notifies every user of that paper, including users whose own copy is private. | |
| **Cohort** | The group where a called seminar is planned: leader, availability, platform, discussion. | Code and store call it a **Room** (`rooms`, `RoomPage.jsx`, `shared/api/rooms.js`). See §12.5. |
| **Leader** | The user who answers a call and takes charge. | `seminarStyles.js` calls this user the *host*; see §12.9. |
| **Participant** | The caller, the leader, and users who join or contribute. | |
| **Availability** | Free-form text, editable until the seminar is scheduled, visible to the cohort. | |
| **Style** | How the leader intends to run it: *A Presentation*, *Bring your questions*, *Guided discussion*, *Deep critique*, or their own free text. | Present in the product but absent from `USER_STORIES.md` §5 entirely. |
| **States** | **called** → **planning** → **scheduled**. | Stored as `open`, `planning`, `scheduled`, `finished`. The first and last do not match the product's names; see §12.5. |

## 8. Handoff to Papol for Mac

| Term | Meaning | Notes |
| --- | --- | --- |
| **Papol for Mac** | The native macOS app. Same three surfaces, same account: a paper open in a browser and in the app is one paper, not a copy. | |
| **Handoff** | Moving the document in front of the user *right now* from the browser into the app — same document, same place. | Distinct from the **download banner**, which advertises the app in general. A handoff names the thing; an advertisement names the software. |
| **Handoff address** | The web address the user is already at, re-addressed to the app: `https://host/papol/viewer/?pdf=…` becomes `papol://host/papol/viewer/?pdf=…`. | One vocabulary, not two. Only the keys naming a document and a place in it cross over, because anyone at all can send the app one of these. |
| **Document** | What the offer names: *this paper* or *this board*. Never "the app". | `handoffDocument()`. The demo has no document — nothing of the visitor's own to open. |
| **Not now / Don't ask again / Always open in Papol** | The three answers: this document, this browser, from now on. Papol never ticks the third itself. | `DEFERRED_KEY`, `RETIRED_KEY`, `ALWAYS_KEY`. |

Papol **cannot tell whether the app is installed** and does not pretend to. The
only signal is whether the tab loses attention shortly after asking, which is a
guess. The bar therefore never announces a verdict about the user's computer.

## 9. Surfaces and platform

| Term | Meaning | Notes |
| --- | --- | --- |
| **Surface** | One of Papol's three browser entry points: **library** (`frontend`), **viewer**, **board**. Separate applications that may share `shared/` but never import one another. | Enforced by the dependency-boundary test. |
| **Adapter** | Per-application platform wiring, in `configurePlatform.js` — the only layer that imports Tauri. | |
| **Native repository** | The finite set of desktop queries and atomic transactions exposed to the bundled UI, mirrored by a closed enum in Rust. | |
| **Revision / tombstone / outbox** | The sync primitives: a server-side counter per row; a `deleted_at` that stands in for the row; the durable local record committed in the same transaction as the edit it describes. | |
| **Client gate** | The compatibility check that refuses a client too old for the server's schema. | |
| **Feature state** | Something Papol has shown a user, or been told by them, remembered in this browser. | One list in `featureStates.js`, so Admin can list and reset them without changes. |

## 10. Voice

From `frontend/DESIGN.md`, repeated here because it governs every label above:

- Labels that **name the user's own content** say *my*: "My nook", "My
  thought", "My expertise".
- Prose that **speaks to** the user says *you / your*: placeholders,
  warnings, confirmations, empty states.
- The test: a heading or button naming a thing that belongs to the user is
  "my"; the app talking is "your".

---

## 11. Words to prefer

For new prose and new identifiers.

| Say | Not | Because |
| --- | --- | --- |
| user | user | One noun for the person, in all three registers. |
| copy | entry, my paper | One noun for the per-user row. |
| annotation | mark, marks | One noun for the umbrella, in all three registers. |
| public shelf, private shelf | on display, displayed | Visibility is a property of a shelf. |
| paint *(verb)* | paint *(noun)* | The noun is **ink**. |
| leader | host | "Host" means three things; see §12.9. |
| cohort | room | Room is the table name only. |
| adopt an edition | update, upgrade | Nothing is replaced; the user moves. |
| reading | "my notes and annotations" | The reading is the unit a rich link carries. |
| revoke | close | A revoked link does not reopen. |
| library | directory | Papers and the people who read them are two views of one library. |
| the copy's user | the paper's owner | A copy is owned; a paper is not. |

---

## 12. Drift and collisions

Each of these is one word doing two jobs, or two words doing one. Entries
marked **settled** have been acted on and are kept as the record of what was
decided; the rest carry a recommendation and nothing more.

### 12.1 Nook / Space

**Nook** is the product word for a user's corner. The code calls the same
payload a **Space** — `getUserSpace()`, `Space.jsx`, the `space` prop threaded
through the desktop chrome — while `nookTransition.js`, `NookManager.jsx` and
`sourcePath()` say *nook* right beside it. Two words for one object, in files
that import each other.

*Recommend* renaming `Space` → `Nook` (`getUserSpace` → `getNook`). "Space" is
also a section heading in `DESIGN.md` meaning whitespace, which is the second
reason to give it up.

### 12.2 Copy / entry

`USER_STORIES.md` uses **entry** ("the user in whose nook the entry lives",
"a displayed entry"), **copy** ("my copy is pinned to one of them"), and "my
paper" for the same row. The code says `Copy` throughout.

*Recommend* **copy** everywhere, and retire "entry".

### 12.3 On display / public — settled

Was the largest drift in the project: `USER_STORIES.md` defined **on display**
as a per-paper switch and built §§3–5 on "a **displayed** entry", while the
product had already moved visibility onto the **shelf**.

Settled twice over. Visibility belongs to the shelf, and the toggle in
`NookManager.jsx` reads **Public / Private**; and display was narrowed to what
it actually governs — *a copy*, never the paper (§2b, US-2.11). Say **a copy
on a public shelf**; of the paper there is nothing to say.

### 12.4 Ink / paint

One substance, two names, and each name has a second job.

- The stored kind is `'ink'`; the offline architecture doc says "notes, ink and
  clips"; `selectionInk.js`, `INK_COLORS`, `selectedInk`.
- Every label a user reads says **paint**: "Paint selected text", "Remove
  paint", "Send painted text to a board"; `paintText.js`.
- **paint** is also the renderer: `const paint = async () => …` in `PdfPage`,
  `first-contentful-paint` in `performance.js`, `board-card-paint-state`.
- **ink** is also one of the five colours (`{ hex: '#14161a', name: 'Ink' }`)
  *and* the design system's text-colour tokens (`--ink`, `--ink-soft`,
  `--ink-faint`).

So "the selected ink" could be a stroke or a swatch, and "paint the page" could
be a user's act or a frame being drawn.

*Recommend*: **ink** is the noun — the substance, the kind, the stored stroke.
**paint** is the verb and only the verb; never "a paint", "the paint",
"paints". Rename the fifth colour from *Ink* to *Black*, which is what it is.
Leave `--ink-*` alone (it is CSS, and unambiguous there) but keep "ink" out of
prose about text colour.

### 12.5 Cohort / Room, and the state names

Product says **cohort**; store and code say **room** (`rooms`,
`room_participants`, `RoomPage.jsx`, `roomsApi.test.js`,
`shared/api/rooms.js`). Separately, the product's three states are **called →
planning → scheduled**, while `Room.status` holds `open`, `planning`,
`scheduled`, `finished`: the first name differs and the fourth has no product
meaning at all.

*Recommend* renaming `Room` → `Cohort` in code, `open` → `called`, and either
documenting `finished` or dropping it.

### 12.6 Merit / liking

The rating labelled **Merit** is stored as `rating_liking`. The column says
something the label deliberately does not — merit is a judgement about the
paper, liking is a fact about the user.

*Recommend* renaming the column to `rating_merit`.

### 12.7 Two kinds of "fractions of the page"

`Annotation` says coordinates are "fractions of the page in PDF user space …
y from the bottom". `EditionCitation` says the box is "fractions of the page
from its top-left corner". Both are true; both are called the same thing; and a
value of one kind passed where the other is expected is wrong by exactly the
page height, which looks plausible near the middle of a page.

*Recommend* naming them in comments and identifiers: **PDF-space fraction**
(bottom-left) for annotation geometry, **screen-space fraction** (top-left) for
citations, links and backlinks. A `y` that crosses between them should change
name when it changes convention.

### 12.8 Frame

A **clip**'s rectangle is its `frame`; a **YouTube card**'s captured still is
also called a frame; and `viewport` / `frame` sit together in `PdfPage`.

*Recommend* keeping `frame` for the clip rectangle and calling the YouTube
still a **still** or a **thumbnail** (`'thumbnail'` is already a kind used
nearby).

### 12.9 Host — settled

`USER_STORIES.md` used to define **Host** as "the owner of a paper entry",
while `seminarStyles.js` used *host* for the user running a seminar and the
source used `host` overwhelmingly for a hostname — `url.host`, `SMTP_HOST`,
the DOM element a layer is drawn into.

Settled by removing the idea rather than the word: a paper has no owner, so
there is nobody for "host" to name. The vocabulary entry is gone. In a seminar
say **leader**; of a copy say **its user**; and `host` now means a hostname
everywhere it appears.

### 12.10 Source

Three unrelated meanings, all live:

- `desktopSources.js` — *which listing the macOS paper browser is showing*
  (`'all'`, `'shelf:<uuid>'`, `'library'`).
- `viewer/src/source.js` — *where this document and its notes come from*
  (`?pdf=`, `?share=`, demo).
- `board_items.source_url` / `source_label` — *where a card came from on the
  web*.

*Recommend* keeping `source_url` (it is the web's own word), renaming the
desktop one to **listing**, and the viewer one to **origin**.

### 12.11 Group

An annotation's `group_uuid` (strokes erased as one) and a board's `board_groups`
(booklets and collections) are unrelated. Both are correct in isolation and
confusing in any sentence that mentions boards and annotations together.

*Recommend* **stroke group** and **board group** whenever both are in scope.

---

## 13. Terms proposed here

New words this document introduces, all of them naming something the product
already does but had no noun for:

- **Reading** (§3) — one user's annotations on one edition, as a unit. What a rich
  sharable carries and a lean one does not.
- **PDF-space fraction** / **screen-space fraction** (§3) — the two coordinate
  conventions, told apart.
- **Adopt** (§2) — the user's own move to a newer edition.
- **Demote** (§6) — a rich link becoming lean, permanently.
- **Surface** (§9) — one of the three browser applications.
- **Handoff address** (§8) — the web address re-addressed to the app.
- **Stroke group** / **board group** (§§3, 5) — the two groups, told apart.
