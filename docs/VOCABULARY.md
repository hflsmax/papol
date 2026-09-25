# Papol vocabulary

The words Papol uses for its own parts, and what each one means. One word
names one thing, and it is the same word in prose, in labels and in code.

Every term is spoken in three registers: **product** is the word
`USER_STORIES.md` and the UI say to a user; **code** is the identifier in the
source; **store** is the table or column. Where code or store carries an
identifier of its own, the notes column gives it.

---

## 1. People and places

| Term | Meaning | Notes |
| --- | --- | --- |
| **User** | Someone with a Papol account. Papol has one kind of person and one noun for them. | `User`, `users`. |
| **Visitor** | A user who is not signed in. | Sees the home page, a sharable and the sign-in pages; the community's pages ask them to sign in. |
| **Nook** | One user's public reading corner: their copies, shelves, boards and tags. | `Nook.jsx`, `getNook()`, `GET /api/users/<uuid>/nook`, `route.page === 'nook'` at `/u/<uuid>`. |
| **Shelf** | One of a user's homes for papers, each **public** or **private**. *The shelf says whether a copy is on display at all; of a copy on display, each of its thought, ratings, summary and tags says for itself.* | `shelves.is_public`. A copy is on display when its shelf is public; the toggle in `NookManager.jsx` reads Public / Private. The fields' own say is `copies.thought_public`, `ratings_public`, `summary_public`, `tags_public`, turned by the chip beside each on the jacket (`VisibilityChip.jsx`). |
| **Library** | Every paper there is, and every user with a copy on a public shelf. The place a paper is found rather than owned. | Papers and the people who read them are two views of one Library, not two places. `/library`, `route.page === 'papers'`. |
| **Admin** | A user who can see feedback, settings and the tables page. | |

## 2. Works

| Term | Meaning | Notes |
| --- | --- | --- |
| **Paper** | One PDF and what is known about it, **keyed by the content hash** of that file. One row, shared by every user who holds it, and **owned by none of them**. | `papers`, primary key `sha256`. Metadata, the seminar cohort and "also read by" hang off the paper, never off a copy. Nothing in the code asks whose a paper is. Two PDFs of the same work — a preprint and the published version — are two papers, even when they print the same DOI. |
| **DOI** | A paper's DOI, stored bare: `10.1000/xyz`, without `https://doi.org/`. The server strips the resolver prefix from whatever it is given, so the link is built on the way out. | `papers.doi`; `bare_doi()` in `schemas.py`. |
| **Copy** | One user's holding of one paper: shelf, ratings, summary, thought, tags. **The only thing here a user owns.** | `copies`, `Copy`. A paper payload carries `copy_uuid` and `is_public` for the viewer's own copy. Everything private in Papol hangs off a copy. |
| **Jacket** | A work's one screen in the Library: what is known about it, and the way in. A paper's is at `/paper/<name>`, a board's at `/board/<uuid>`. | `PaperJacket.jsx`, `BoardJacket.jsx`, `jacketOrigin.js`, `.paper-jacket`; `route.page` is `paper` or `board`. A jacket is a place in a surface (§9), not the application that opens the work. On the desktop it sits in the Library window while the work opens in a document window of its own. |
| **Page** | One sheet of a PDF. | `annotations.page`, `data-page`, `.pdf-page`, "page 7" in the Navigator. `route.page` is the frontend router's index of screens (`home`, `signin`, `paper`, `board`, `nook`…), not a work's page. |
| **Summary** | My prose about a paper. **Private** unless I make it public. | `copies.summary`, `copies.summary_public`. Only its own user writes it. |
| **Thought** | My one-line take, shown on my chip wherever I appear beside the paper. **Public** unless I make it private. | `copies.thought`, `copies.thought_public`, labelled "My thought". |
| **Ratings** | Three optional 1–5 dimensions: **My expertise**, **Reading depth**, **Merit**. **Public** unless I make them private, all three together. | Stored on `copies` as `rating_expertise`, `rating_reading`, `rating_liking`, `ratings_public`; labels in `Rating.jsx`. |
| **Tag** | A user's own label, applied to their copies. | `tags`, joined by `copy_tags`. A copy's tags are private unless `copies.tags_public` says otherwise; the list of a user's tags is theirs alone. |
| **Folder** | PDFs an agent gathered into one directory, dropped into Papol and brought in after one review of the batch. | `FolderImport.jsx`, `agentFolder.js`. Client-side only: each PDF goes up and is saved as one upload would be. |
| **Manifest** | The `papol.json` beside a folder's PDFs: for each work its file, identifier, title and the agent's note. It describes papers and never where they go; shelf and tags are the user's, picked in the review. | Format 1, described at `/agent-folder.txt` (`frontend/public/agent-folder.txt`), which the prompt shown for the agent points to. `parseManifest()`. |

### Activity

| Term | Meaning | Notes |
| --- | --- | --- |
| **Activity** | The time a user spends reading a paper in the viewer. Boards are not recorded. One rule: time runs from one **use** (a scroll, key or pointer in its window while in front, or bringing the window back) to the next, and a pause between two uses counts if it is ten minutes or less (`gap_ms`) and was not spent on another paper in Papol. Nothing after the last use counts. Theirs alone: nobody else sees any of it. | `activity`, `shared/activity.js`, `POST`/`GET /api/activity`, `ActivityPanel.jsx` on the profile page. Not synchronized: the desktop sends it as the browser does. |
| **Span** | One stretch of reading: the paper's sha256 (`subject`; `kind` is always `reading`), when it started and ended, and the seconds in it that counted. At most half an hour. | Named by the window that saw it and sent again as it grows; the server keeps the longest. Kept in the browser's **outbox** (`papol.activity.span.*`) until sent. |
| **Effort** | A user's total reading of one paper, shown on its author line in their own nook: a clock and the time on a pill tinted by its **effort level**, one of five at fixed marks (under 30 min, 30 min–2 h, 2–5 h, 5–10 h, 10 h or more). It opens the paper's time — the level's key, its last twelve weeks and latest days. | `effort` on the nook's paper entries, null for anyone but the nook's user; `GET /api/activity/<kind>/<subject>`; `EffortPop.jsx`; `effortLevel()`, `EFFORT_MARKS`. Boards carry none on the nook. |

## 3. Annotations

Everything a user leaves on a PDF. One table, `annotations`, three kinds that
differ in geometry, not in nature: each belongs to one user, sits on one
paper, and is private until that user shares a reading.

| Term | Meaning | Notes |
| --- | --- | --- |
| **Annotation** | The umbrella over the three kinds. | `annotations.kind` is `note`, `ink` or `clip`. One noun in all three registers. |
| **Note** | Words, optionally **anchored** to a place on a page. A located note is a note with an anchor: one list, not two. | `kind = 'note'`; `page` is null for a note not on a page. |
| **Anchor** | A note's place on a page, as a PDF-space fraction. Typed: `point` today; `rect`, `polygon` and `quote` can join without a migration. | `anchor` in `cloudflare/src/validate.ts`. Drawn as a **pin** on the page and a mark on the Navigator; edited in its **card** (`NoteCard.jsx`, `.note-pop`), which hangs off the pin. "Anchor" is the datum; "pin" is the thing on screen. |
| **Ink** | A stroke drawn over the page, in one of five colours and four widths. Ink is the noun; **paint** is the verb. | `kind = 'ink'`, `InkPoint`, `INK_COLORS`, `selectionInk.js`, `paintText.js`; labels say "Paint selected text", "Remove paint". |
| **Stroke group** | Several stored strokes that are one annotation: text painted across lines is drawn as separate paths and picked up and erased as one. | `annotations.group_uuid`. Not a board group (§5). |
| **Clip** | A movable view of one rectangle of the page. The rectangle it shows is its **frame**. | `kind = 'clip'`; `ClipRect` is the source rectangle, `ClipFrame` where it sits. |
| **Reading** | One user's annotations on one paper, taken together. The unit a rich sharable carries. | Named, not copied: reword a note and everyone holding the link sees the rewording. |
| **PDF-space fraction** | A coordinate as a fraction of the page with origin bottom-left and y up, as PDF measures. The convention of anchors, ink points and clip rectangles. | `Anchor`, `InkPoint`, `ClipRect`. |
| **Screen-space fraction** | A coordinate as a fraction of the page with origin top-left and y down. The convention of citation boxes, link boxes and backlink bands. | `CitationOut`, `DocumentLinkOut`, `references.js`. A `y` that crosses between the two conventions changes name when it changes convention. |
| **Page units** | PDF points from the top-left, inside the viewer's text-layer geometry. Neither fraction. | `PdfPage.jsx`. |

All annotation geometry is fractions of the page, so zoom, DPI and screen
size never enter it.

## 4. Apparatus

What the PDF itself says.

| Term | Meaning | Notes |
| --- | --- | --- |
| **Analyzer** | The optional service that reads a PDF's bibliography and links. | Where it is not running, everything else works and citations are not clickable. |
| **Reference** | One work cited by a paper, as printed. | `ReferenceOut`. `raw` is the line exactly as the author printed it: what a search matches, and what is shown when nothing matches. |
| **Citation** | One in-text marker — the "[12]" a user clicks — and its box, a screen-space fraction. | `CitationOut`. "[3, 5]" is two citations, because each leads somewhere different. `inferred` marks one matched only by reading its number: a guess, shown as one. |
| **Link** | An analyzed cross-reference to another position in the same PDF — "see Section 3.2", "Figure 4". | `DocumentLinkOut`. Following one offers **← Back to where you were**, the **return pill** (`ReturnPill.jsx`). |
| **Job** | Work the server took on and finishes after answering: reading an upload, the reference pass over a paper, a card's picture, an email. A request queues it; the **worker** runs it; the client polls it. | `jobs`, `services/jobs.py`, `worker.py`, `GET /api/jobs/<uuid>` (`JobOut`: `queued`, `running`, `done`, `failed`). A paper's pass is also visible as `papers.references_status`. |
| **Resolution** | What the bibliographic lookup added to a reference. | `resolved_status` is null until the reference is first opened, then `ok` or `bibliography` (the lookup found nothing and the printed line stands). Kept once filled. |
| **Section** | One heading the paper declares, and the run of the paper under it — down to a subsection, no further. | Read from the PDF's own outline and from nowhere else; a paper without an outline has no sections. Float bookmarks (`Fig. 3 …`, `Table 1 …`) are dropped. An **appendix** is a section marked as back matter: the part after the bibliography, or one that names itself. A journal's **end-of-paper notices** (Acknowledgements, Competing interests, Data availability…) are headings but not sections. `sections.js`. |
| **Navigator** | The viewer's navigation, and the only kind it has: the paper drawn to length across the bar, its sections as segments as wide as they are long, the reader's anchors (triangles) and notes (dialog boxes) in a lane beneath at the same scale, and a marker at the middle of the window. A press goes to exactly that place. | `Navigator.jsx`, `.navigator-*`. It draws apparatus and annotations on one scale, which is what makes an anchor legible as being *in* a section. |

Reading a bibliography happens once per **paper** and is kept, so only the
first user of a PDF waits.

## 5. Boards

| Term | Meaning | Notes |
| --- | --- | --- |
| **Board** | A private ideation space inside one user's nook. | `boards`. Two addresses, as a paper has: its **jacket** (§2) in the Library, and the canvas it opens on, served full-screen at `/boards/<uuid>`. |
| **Card** | One item on a board. Its kind is `comment`, `excerpt`, `image`, `file`, `youtube`, `bilibili` or `webpage`. | `board_items`, `BoardItemOut`. |
| **Board group** | A grouping of cards: a **booklet** or a **collection**. | `board_groups.kind`. Not a stroke group (§3). |
| **Excerpt** | Text carried out of the viewer onto a board — a selection, a painted passage, or a clip's contents. | `board_items.excerpt_text`. Unwrapped from the PDF's visual line breaks on the way out; genuine paragraph breaks kept. |
| **Backlink** | The canonical viewer URL a card keeps, so it can send the user back to the place its excerpt came from. | `board_items.source_url`. Canonical rather than machine-local, so it survives leaving one computer. Only a card has one; the viewer's way out is the **home button** (§6). |
| **Staged** | A card that has arrived but not yet been placed. It waits in a tray until dragged onto the board. | `board_items.staged`. |

## 6. Sharing

| Term | Meaning | Notes |
| --- | --- | --- |
| **Sharable** | A link that opens a PDF in the viewer for whoever holds it, signed in or not. The code in the link is the whole of the permission. | `sharables`, `shared/api/sharables.js`. Handed out as `papol.io/s/<code>`: ten random characters of `0-9A-Za-z`, case-sensitive, drawn fresh and kept unique by the table's primary key. Links named any other way before (UUIDs, and twelve lower-case characters) were given one in their place by migration 0006; the old URLs no longer open. |
| **Rich** | A sharable carrying one user's **reading**. Belongs to them, shown on their paper's jacket, theirs to revoke. | `Paper.sharable_uuid` is the viewer's own rich link. |
| **Lean** | A sharable carrying the PDF alone. One per paper, belongs to nobody, names no user. | Never shown on a paper's jacket and never counted against its maker. The paper's own viewer URL, `/viewer/?pdf=<sha256>`, is a lean link too — its bytes are public under that digest — and a lean short link leads there. |
| **Demote** | To turn a rich link lean, permanently, when the user takes the paper out of their nook or drops their annotations. Putting the paper back never re-exposes annotations to anyone still holding the link. | `POST /api/sharables/<uuid>/lean`. |
| **Revoke** | To stop a link opening at all. Final; sharing again mints a new one. | `revokeSharable()`, `DELETE /api/sharables/<uuid>`, `revoked_at`. The row survives revocation, so a revoked link answers "no longer shared" rather than 404. |
| **Home button** | The house worn by the viewer, the board and the desktop toolbar alike: out of this document and into the place it is kept, its **jacket** (§2). | `source.homeHref`, `papolHome()`. It leads to Papol itself only where there is no jacket to reach: a shared reading, or a file opened from disk. It never steps *backwards*: it leads to where the work is kept, not to wherever this reader came from, so one house serves a link, a bookmark and a reload alike. Not a **backlink** (§5), and not the library app's **Back**, which is page history. |

**Sharing is not displaying.** A shelf says who can *find* the paper; a link
says who may *read this PDF*. Neither moves the other.

## 7. Seminars

| Term | Meaning | Notes |
| --- | --- | --- |
| **Call** | Requesting a spontaneous seminar on a paper. Notifies every user of that paper, including users whose copy is on a private shelf. | |
| **Cohort** | The group where a called seminar is planned: leader, availability, platform, discussion. | `rooms`, `Room`, `RoomPage.jsx`, `shared/api/rooms.js`, `/room/<uuid>`. |
| **Leader** | The user who answers a call and takes charge. | `rooms.leader_uuid`. Stepping down is `POST /api/rooms/<uuid>/unhost`. |
| **Participant** | The caller, the leader, and users who join or contribute. | `room_participants`. |
| **Availability** | Free-form text, editable until the seminar is scheduled, visible to the cohort. | |
| **Style** | How the leader intends to run it: *A Presentation*, *Bring your questions*, *Guided discussion*, *Deep critique*, or their own free text. | `seminarStyles.js`: keys `walkthrough`, `questions`, `guided`, `critique`; free text in `style_desc`. |
| **States** | **called** → **planning** → **scheduled** → **finished**. Called is waiting for a leader; planning is a leader in charge; scheduled is a time and platform announced; finished is the leader marking it held. | `rooms.status` is `open`, `planning`, `scheduled`, `finished`. `/announce` schedules, `/finish` finishes. |

## 8. Handoff to Papol for Mac

| Term | Meaning | Notes |
| --- | --- | --- |
| **Papol for Mac** | The native macOS app. Same three surfaces, same account: a paper open in a browser and in the app is one paper, not a copy. | `desktop/`. |
| **Handoff** | Moving the document in front of the user *right now* from the browser into the app: same document, same place. | `shared/macHandoff.js`, `MacHandoffBar.jsx`. Distinct from the **download banner**, which advertises the app in general. |
| **Handoff address** | The web address the user is already at, re-addressed to the app: `https://host/papol/viewer/?pdf=…` becomes `papol://host/papol/viewer/?pdf=…`. | Only the keys naming a document and a place in it cross over, because anyone at all can send the app one of these. |
| **Document** | What the offer names: *this paper* or *this board*. Never "the app". | `handoffDocument()`. |
| **Not now / Don't ask again** | The two answers: this document, or this browser. Papol never opens the app without being asked. | `DEFERRED_KEY`, `RETIRED_KEY`. |

Papol **cannot tell whether the app is installed** and does not pretend to.
The only signal is whether the tab loses attention shortly after asking, which
is a guess, so the bar never announces a verdict about the user's computer.

## 9. Surfaces and platform

| Term | Meaning | Notes |
| --- | --- | --- |
| **Surface** | One of Papol's three browser entry points: **library** (`frontend`), **viewer**, **board**. Separate applications that share `shared/` and never import one another. | Enforced by the dependency-boundary test; `docs/application-boundaries.md`. |
| **Adapter** | Per-application platform wiring, in each surface's `configurePlatform.js`: the only layer that imports Tauri. | |
| **Native repository** | The finite set of desktop queries and atomic transactions exposed to the bundled UI, mirrored by a closed enum in Rust. | `shared/nativeData.js`. |
| **Listing** | What the macOS paper browser's sidebar is showing: `all`, `shelf:<uuid>`, `tag:<uuid>`, `boards` or `library`. | `desktopListings.js`, `?listing=`. |
| **Sync change** | One row's movement between a replica and the server: the operation is `upsert` or `delete`. | `cloudflare/src/sync/`. A **revision** is the server-side counter per row; a **tombstone** is a `deleted_at` that stands in for the row; the **outbox** is the durable local record committed in the same transaction as the edit it describes. |
| **Schema version** | The one number that names the data model and the wire that carries it. The developer bumps it when a change lands that an existing database, replica or build cannot be read under. | `schema_version` in `schema/sync_registry.json`. The server refuses to start on a database at another version; the desktop discards a replica at another version and synchronizes the account back; every request carries it as `X-Papol-Schema`, and the server answers 426 to any other. Nothing detects shape. |
| **Client gate** | The 426 a client built for another schema version receives, and the covering panel it shows. | `services/client_requirements.py`, `shared/clientCompatibility.js`, `CompatibilityGate.jsx`. |
| **Feature state** | Something Papol has shown a user, or been told by them, remembered in this browser. | One list in `shared/featureStates.js`, so Admin can list and reset them. |

## 10. Voice

From `frontend/DESIGN.md` §Voice, which governs every label above:

- Labels that **name the user's own content** say *my*: "My nook", "My
  thought", "My expertise".
- Prose that **speaks to** the user says *you / your*: placeholders,
  warnings, confirmations, empty states.
- The test: a heading or button naming a thing that belongs to the user is
  "my"; the app talking is "your".

---

## 11. Words to prefer

For all prose and all new identifiers.

| Say | Not | Because |
| --- | --- | --- |
| copy | entry, my paper | One noun for the per-user row. |
| annotation | mark | One noun for the umbrella, in all three registers. |
| public shelf, private shelf | on display, displayed, hidden | Whether a copy is seen at all is a property of the shelf. |
| paint *(verb)* | paint *(noun)* | The noun is **ink**. |
| ink | paint *(noun)* | Ink is the substance, the kind and the stored stroke. |
| leader | host | `host` is a hostname. |
| cohort | room | Room is the code and store identifier only. |
| reading | "my notes and annotations" | The reading is the unit a rich link carries. |
| revoke | close | A revoked link does not reopen. |
| library | directory | Papers and the people who read them are two views of one Library. |
| the copy's user | the paper's owner | A copy is owned; a paper is not. |
| jacket | paper page, board page | A page is a sheet of a PDF. |
| listing | source | Source is where a document or a card came from. |
| stroke group, board group | group | Two unrelated groupings; say which. |
