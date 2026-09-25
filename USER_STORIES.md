# Papol Social — User Stories

Papol exists to make **spontaneous seminars** happen: a seminar is never scheduled top-down, it springs up whenever a user calls one on a paper and others answer.

`docs/VOCABULARY.md` defines every term Papol uses, across product, code and
store. The user-facing core:
- **Nook** — a user's public reading corner: their copies, shelves, boards and tags.
- **Users** — the members of Papol; the Library lists every user alongside the papers they keep on public shelves.
- **Shelf** — one of a user's homes for papers, public or private. The shelf says whether my copy of a paper, and my name with it, is shown to other users. It says nothing about the paper: every paper is in the Library whoever holds it. A copy on a private shelf is mine alone.
- **Paper** — one PDF and what is known about it. The PDF's content hash is the paper's identity: two files of the same work are two papers, even when they print the same DOI.
- **Copy** — my holding of a paper: its shelf, my ratings, my summary, my thought, my tags. The only thing a user owns.
- **Located note** — a private note with a place in the PDF attached. Not a separate kind of thing: the same note, pinned.
- **Sharable** — a link that opens a PDF in the viewer for whoever holds it, signed in or not: the UUID in the link is the whole of the permission. A **rich** link carries one user's reading — their annotations on that paper — and is theirs. A **lean** link carries the PDF alone, is one per paper, and is nobody's.
- **Papol for Mac** — the native macOS application. It carries the same three surfaces (library, viewer, boards) and reads the same account, so a paper open in a browser and the same paper open in the app are one paper, not a copy.
- **Handoff** — moving what I am reading right now from the browser into Papol for Mac: the same document, at the same place, in the app instead of the tab.
- **Call** — requesting a spontaneous seminar on a paper; it notifies every user of that paper.
- **Cohort** — the group where a called seminar is planned: leader, availability, platform, discussion. A seminar moves through four named states: **called** (waiting for a leader) → **planning** (leader took charge) → **scheduled** (time and platform announced) → **finished** (the leader marks it held).
- **Leader** — the user who answers a call and takes charge of the seminar.

Papers are **keyed by the content hash of the PDF**: the same file in different nooks is the same paper — one row, sharing its metadata, its seminar cohorts and its "also read by" listing. Two different files are two papers, even when they print the same DOI (§2, US-2.7).

## 1. Accounts

- **US-1.1** As a visitor, I can register with my email, a display name, an affiliation (optional), and a password, so I get my own nook.
- **US-1.7** As a user, I choose whether my email shows on my nook, with a tick box on my profile. It is on by default; turning it off keeps my address to myself, and it is never sent to other users while off. My email is always my login identifier and cannot be changed.
- **US-1.2** As a user, I can log in with my email and password, and log out; my session persists across page reloads.
- **US-1.3** As a visitor who is not logged in, I am not met by a login wall: I land on the home page, which says what Papol is, and the sign-in and register pages are one click away.
- **US-1.4** As a visitor without an account, every page of the community requires signing in; a sharable someone sent me (§7c) reads without one. Signing out returns me to the home page.
- **US-1.5** As a user, I can edit my profile (display name and affiliation) and change my password from a profile page reached by clicking my name in the navigation. My email is my login identifier and cannot be changed.
- **US-1.6** As a user, I can upload a profile image (PNG/JPEG/WebP, up to 2 MB), replace or remove it; it appears wherever I do. Without one, my initial shows in its place.

## 2. Papers, ratings, and shelves

- **US-2.1** As a user, I can upload a PDF into my own nook; metadata (DOI, title, authors, journal, year) is auto-extracted for me to review and edit.
- **US-2.2** As a user, I can rate each paper 1–5 on three dimensions — **My expertise**, **Reading depth**, **Merit** — directly on the paper's jacket, one click per change. Each dimension is optional: a set rating shows a small "clear" control; an unset one reads "unrated". Visitors see unrated dimensions as a quiet "unrated".
- **US-2.3** As a user, only I can delete papers in my nook (via Edit Metadata → Delete paper) and edit my copy's fields: summary, ratings, shelf. Deleting takes my copy and my notes; my ink and clips stay where they are, for when I add the paper again.
- **US-2.4** **Metadata is shared**: any user can Edit Metadata on any visible paper, and the change applies to every copy of it. The edit form warns about this. "Edit Metadata" and "Edit Summary" are separate buttons — summary belongs to the copy, so only its own user may edit it.
- **US-2.5** As a user, I choose the shelf my copy sits on, and every shelf is **public** or **private**. A copy on a public shelf shows me standing against the paper — to nook visitors, in the Library, and in "also read by". A copy on a private shelf is mine alone: nobody is told I have it. Notes are mine either way.
- **US-2.5a** As a user, each of my copy's **thought**, **ratings**, **summary** and **tags** is public or private on its own, shown by the chip beside it on the paper's jacket; clicking the chip turns it the other way. Thought and ratings start public, summary and tags private. A public field is seen only while the copy is on a public shelf, and a private one is simply absent for everyone else — nobody can tell a private rating from no rating.
- **US-2.6** As a user, I can keep private, timestamped notes on my own papers; no one else can read or write them.
- **US-2.7** **A paper is its PDF.** The file's content hash is the paper's identity, so uploading a PDF Papol already holds adds me to that paper rather than making a second one, and uploading a different PDF makes a paper of its own — even when it prints a DOI Papol has already seen. Nothing ever replaces the file under anyone's notes, because nothing can: a different file is a different paper.

## 2b. A paper is not owned

- **US-2.10** **A paper belongs to nobody.** A paper is a file that exists; no
  user can alter or remove one, and leaving a paper never takes it away. What a
  user owns is their **copy**: the shelf it sits on, their ratings, their
  summary, their annotations.
- **US-2.11** **A shelf governs a copy, not a paper.** The shelf my copy sits
  on (US-2.5) says whether *I* am shown standing against the paper. Every
  paper is in the Library whoever holds it, and anyone signed in can open one
  and take a copy of their own.
- **US-2.11a** **A paper nobody holds is still in the Library**, listed like
  any other with no readers shown against it. The last reader leaving is not a
  deletion, and a file that arrived without anyone keeping it is still a file
  Papol has — either way the paper is there to be found, opened and taken.
- **US-2.12** **What a user keeps to themselves.** My summary, my notes, my ink
  and clips — and that I keep this paper at all: a user whose copy is on a
  private shelf is named nowhere on the paper.
- **US-2.13** **A paper's jacket is for people with accounts.** The Library asks
  for one (US-1.4), and the jacket is the Library's. The shelf decides nothing
  here: it governs the copy it holds and nothing else.

## 2c. Bringing in a folder of papers

A literature review ends with a list: works, and why each one matters. My
agent gathers their PDFs into a folder, with a **manifest** beside them, and
I drop the folder into Papol. The agent never touches Papol; I bring the
papers in, and I decide where they go.

- **US-2.20** As a user, I can **drop a folder** onto Papol, in Papol for Mac or in the browser, and every PDF in it is brought in as if I had uploaded each one (US-2.1, US-2.7) — after a review, never before. **Several PDFs** dropped or chosen together come through the same review, as a folder with no manifest; one PDF is still the one-paper upload.
- **US-2.21** If the folder holds a **`papol.json`**, Papol reads it. It describes the papers, not where they go: for each PDF its identifier, its title, and a note on why it is in the review — and for a work the agent could not get a PDF of, the work alone. It names no shelf and no tag; one that does is read as if it did not. A folder with no manifest still comes in, every PDF listed; a manifest that cannot be read is said so, and the folder comes in as if it had none.
- **US-2.22** **I get the instructions where I add papers.** Every upload box — the Library's, my nook's, the Mac's — says *Drop PDFs or a folder here* and carries an *Add a folder* link on the same line, and on the Mac a folder button sits beside the **+**; nothing else is added to the page. Where a batch arrives with no manifest, its review offers the prompt, folded: that is the moment someone gathering papers by hand learns an agent could do it. It says in a line how this works, shows a prompt I may give my agent, and takes the folder when I come back with it. The prompt points to a page on Papol that describes the folder (`/agent-folder.txt`), so the format is kept in one place and a prompt I saved long ago still works.
- **US-2.23** Dropping a folder opens **one review of the whole batch**, not a form per paper: a row per work, in the manifest's order, then the folder's other PDFs. Each PDF goes up and is read while I look, and its row says what it is: **new**, **already in Papol**, **already in my nook** (skipped, never sent), or a problem — **not in the folder**, **no PDF** (find it yourself), **too large**. I can untick a row, and fix a title.
- **US-2.24** **I file the batch in the review**: the shelf, picked as for one upload, or a new private shelf named after the folder; and private tags, given to every paper in it. Nothing arrives already filed, so an agent cannot put me on display or fill my tags with its own grouping.
- **US-2.25** **The manifest fills gaps only.** Metadata is shared (US-2.4): an identifier or a title from the manifest is used only where the PDF says nothing, and a PDF Papol already holds keeps the metadata it has. When Papol holds another version of the work, the row offers it, as the upload form does.
- **US-2.26** The agent's **note** becomes a note on my copy, private like every note. It never goes into my summary or my thought, which are mine to write.
- **US-2.27** **Dropping the same folder again is safe**: papers already in my nook are skipped and left untouched, so an agent may add to a folder and I may drop all of it again.
- **US-2.28** One paper failing never stops the rest. The review ends on what happened — *34 added, 2 already yours, 4 problems* — with each problem still on its row.

## 3. Browsing

- **US-3.1** As a user, I can see every user in the Library with avatar, affiliation, and how many copies each keeps on public shelves. The people and the papers are two views of one Library, not two places.
- **US-3.2** As a user, I can visit another user's nook and browse the copies on their public shelves, with whatever of each copy its user has made public (US-2.5a). Notes stay private to the user who wrote them.
- **US-3.3** As a user, I can open the **Library**, which lists **every paper** — not only the ones somebody keeps on a public shelf, because no user's shelf decides what is findable. Each paper appears once, with a row per user whose copy is on a public shelf (avatar, name, ratings) linking to theirs; a paper with no such copy shows no such row. Search matches papers and user names.
- **US-3.4** As a user, a paper's jacket shows "Also read by" chips for every other user whose copy of the same paper is on a **public shelf**. Users who keep theirs on a private shelf are not named. Hovering a chip shows what they have made public of their copy — thought, ratings, summary, tags; clicking visits their nook.

## 4. Calling a seminar

- **US-4.1** As a user with a copy of a paper on a **public shelf**, I can **call for a seminar** on it. The call notifies **every user of the paper — including users whose own copy is on a private shelf** — via the in-app inbox. Users without a copy on a public shelf cannot call, join, or write in the cohort; the UI tells them so.
- **US-4.2** As a notified user whose copy is on a private shelf, I can move it to a public shelf right from the cohort, which lets me appear among the users and become eligible to lead.
- **US-4.3** Only one call can be active per paper (called or planning); after a seminar is scheduled, a new one can be called.
- **US-4.4** As a user, I have an **Inbox** in the navigation with an unread badge; opening it shows my notifications (calls, a leader stepping up, scheduled seminars) and marks them read. Clicking one opens the cohort.

## 5. The cohort

- **US-5.1** A call forms a **cohort** for the paper, in the **called** state. Any user with a copy of the paper on a public shelf can **answer to lead** and takes charge; everyone is notified when they do.
- **US-5.2** All planning happens in the cohort: participants (the caller, the leader, and users who join or contribute) are shown as chips. Only users with a copy of the paper on a **public shelf** can join, message, or submit availability — users whose copy is on a private shelf are invited to move it to a public shelf first, right from the cohort.
- **US-5.3** Every participant can submit and update their **availability** (free-form) until the seminar is scheduled; all availability is visible in the cohort.
- **US-5.4** The cohort has a **discussion thread** for coordination — short messages with author and time.
- **US-5.5** The **leader announces** the seminar by picking a time and a platform; the cohort switches to **scheduled**, the paper's jacket shows the result, and participants and users are notified.
- **US-5.6** A paper's jacket always reflects the cohort: none called, called, planning, or scheduled — with a "Join the cohort" door for signed-in users.

## 5b. Boards

- **US-5.7** As a user, I can open a board in a dedicated full-screen app served at `/boards/<uuid>`, on the same origin as Papol so my session carries over without a second sign-in. Board discovery and creation are in my nook.

- **US-5.8** **A board has a jacket, as a paper does.** Every work in the
  Library has one screen where what is known about it is kept and from which
  it is opened: a paper's jacket at `/paper/<name>`, a board's at
  `/board/<uuid>`. A board row in a nook opens its jacket, the jacket opens
  the canvas, and the canvas comes back to the jacket. The jacket is where a
  board's **description** is read and written, beside its name, how many
  cards it holds, when it was last edited, and whose it is when it is not
  mine.

- **US-5.9** The canvas has one way out, the **home button**, and it leads
  where the board is kept: its jacket. The viewer's house does the same — out
  of the paper and onto the paper's jacket — and reaches for Papol itself only
  where there is no jacket to go to, which is a shared reading or a file
  opened from disk. On the desktop the canvas is a document window beside the
  Library, so closing it is the way out and the jacket is still open behind
  it.

- **US-5.10** **Tidying keeps my layout.** When cards pile up from pasting
  and dragging, **Tidy up** (on the toolbar, or on a selection) separates
  whatever overlaps and lines up what it moved. It never changes a card's
  size, its group, a booklet's order, or a collection's layout. A group is
  put into its own form only when I ask it: a collection's **Arrange into
  columns**, or **Auto-arrange** to keep it that way. A card goes back to
  the standard width only on **Reset size**. Each of these says what it
  did and offers **Undo**, and each is one undo step. New cards land in
  free space instead of on top of what is there. See `docs/tidying.md`.

## 5c. My activity

- **US-5c.1** As a user, the time I spend reading a paper in the viewer, or working on one of my boards, is recorded while its window is in front of me and I have used it in the last three minutes — a paper left open behind other windows adds nothing. Time spent offline, on the Mac or in the browser, arrives when Papol can be reached.
- **US-5c.2** On my profile page, **My activity** shows that time by **Day** (when I was reading which paper, and on which board, hour by hour, each paper in a colour of its own), **Week** (seven such days, each with its total) and **Month** (a calendar shaded by how much time each day held), with the total, the reading and the board time, and each paper and board the time went to. A day in the week or month opens that day.
- **US-5c.3** On my own nook, each paper says, in small type on its author line, how long I have spent reading it. Pressing it opens that paper's time: the total and since when, its last twelve weeks as a small calendar, and my latest days with it. Nobody else sees my activity or my effort, on my nook or anywhere.
- **US-5c.4** My activity is in my data export, and goes when I close my account.

## 6. Feedback

- **US-6.1** As anyone using Papol — user, visitor, or someone who cannot even sign in — I can report a bug or ask for a feature from a **Feedback** button floating in the bottom-right corner of every page — one box, free text, no form to fill in — without leaving the page I am on. A visitor may leave an email so the admins can reply.
- **US-6.2** Every report is one piece of free text — no categories to pick. It is stored, and reaches every admin twice over: as an inbox message and as an email sent right away. A report sent while email is unconfigured still waits in the admin inbox and on the admin page.
- **US-6.3** As an admin, I see every report on the admin page — reporter, the page it came from, and time — and can mark one done or reopen it.

## 7. Reading and located notes

- **US-7.1** As a user, I can open any paper in my nook in Papol's **PDF viewer** — a separate app served at `/viewer`, on the same origin, so my session carries over with no second sign-in.
- **US-7.2** As a user, I can take a **located note**: choose *Add a note*, click the spot on the page it belongs to, and write it. A located note **is** one of my notes — the same private notes that live on the paper's jacket, with a place in the PDF attached. There is one list, not two.
- **US-7.3** A note's location is **typed**. Today the type is `point`, stored as fractions of the page in PDF user space, so a note lands in the same place at any zoom, on any screen. `rect`, `polygon` and `quote` join later without a migration and without disturbing existing notes.
- **US-7.4** Every note that has a place is on the page as a **pin** and on the **Navigator** as a mark — a triangle for a bare anchor, a dialog box once something is written on it — and clicking the mark goes there. Clicking the pin opens the anchor's **card**, hung off the pin — as dropping a new anchor does: its name, its note, and the way to delete it. The card is where an anchor is edited, and the only place; nothing is saved by a button, a field is kept when it is left. There is no list beside the page. A note with no place has no pin to hang a card on, so it is read and written on the paper's jacket, where it was made.
- **US-7.5** On a paper's jacket, a note that has a place shows a **page** chip that opens the viewer at that note. A note taken there and a note typed on its jacket are the same kind of thing, in the same list.

## 7b. Following a citation

- **US-7.6** As a user, when I meet a citation in the text — "[12]" — I can click it and see what it is without leaving my place: title, authors, where and when it appeared, its abstract, and how often it has been cited.
- **US-7.7** The card offers what can be done with the work: a free PDF where one exists, the publisher's page, and a Scholar search. When the cited paper is **already in Papol**, that link comes first — a citation is how a user finds the next paper in their nook, and the next seminar.
- **US-7.8** A reference Papol cannot match is not hidden: the card shows the line exactly as the author printed it, with a way to go and search for it. A thin answer beats a blank one.
- **US-7.9** Clickable citations come from the PDF where the PDF has them — papers built with LaTeX carry a link on every marker, and the author's own link is better than any analysis. Where they are absent, the analyzer's reading of the page is used, and a marker matched only by counting its number is marked as the guess it is.
- **US-7.10** Reading a paper's bibliography happens once per **paper** and is kept, so only the first user of a PDF waits. Looking up a particular reference happens the first time someone opens it, and is kept too.
- **US-7.11** As a user, the paper's **other links work too**: "see Section 3.2" and "Figure 4" scroll me there, and a URL opens in a new tab. Following a cross-reference offers **← Back to where you were**, because a jump that loses my place is worse than no link at all.
- **US-7.12** The analyzer is optional. Where it is not running, everything else in Papol works and citations are simply not clickable.

## 7c. Sharing a reading

- **US-7.13** As a user, I can hand someone a **link to the PDF I am reading**, from the Share menu on the paper's jacket. It opens the PDF in Papol's viewer, read-only, for anyone holding it — no account, no sign-in.
- **US-7.14** One tick box decides **what the link carries, and therefore whose it is**. Left alone, I get the PDF's own link: the same link for everyone, carrying the paper and naming nobody — I copy it and pass it on, and that is the end of my part in it. Ticked, Papol makes **my** link, carrying my notes, ink and clips.
- **US-7.15** A link is one or the other for its whole life. I have **one link of my own per paper I read** — asking again gives it back rather than making a second — and the PDF's own link is beside it, not instead of it: having handed over one is never a reason to be refused the other.
- **US-7.16** What a visitor sees through my link is my reading **as it is now**, not a snapshot: a note I reword is reworded for everyone holding it. They see the PDF, my name, my annotations, and the paper's bibliography — and nothing else in my nook. The way out is the **home button**, which leads to Papol itself and names no paper: a link hands over a reading, not a place in the Library. Through the PDF's own link they see the paper and no user at all.
- **US-7.17** **Sharing is not displaying.** A shelf says who can find the paper in the Library; a link says who may read this PDF. I can share a paper nobody else can find, and moving it between a public and a private shelf never changes a link I have already handed out.
- **US-7.18** If I **take the paper out of my nook**, my link keeps opening the PDF but stops carrying the reading — permanently, so putting the paper back does not quietly re-expose my annotations — and stops being mine along with them.
- **US-7.19** **Stopping** asks what I mean: *drop my annotations*, which leaves the link working for whoever has it and hands it out of my keeping for good, or *revoke the link*, which stops it opening. Revoking is final — sharing again mints a new link, and the old one stays dead. Whoever follows a revoked link is told it is no longer shared, not that it never existed.
- **US-7.20** **A link of mine is a state of the paper, shown on its jacket**, so nothing I do can leave one serving that I have forgotten about. The PDF's own link is never shown there and never counted against me: I am not told whether one exists, because nothing of mine is in it.

## 7d. Handing a reading to Papol for Mac

The download banner tells a visitor the Mac app exists. This is the other
half: when I am *already* looking at something the app can open better — a
PDF, a board — Papol offers to move it there, and only there.

- **US-7.22** As a user on a Mac with a paper open in the browser's viewer, or a board open in the board app, Papol offers to **open this one in Papol for Mac**. The offer is a quiet bar at the top of what I am reading, never a dialog over it: I came here to read, and an offer that blocks the page is worse than no offer.
- **US-7.23** The offer names **what it will open** — "Open this paper in Papol" or "Open this board in Papol" — not the app. A handoff is about the thing in front of me; an advertisement for software is what the download banner does elsewhere.
- **US-7.24** The offer is made only where it can be honoured: a Mac browser, a document the app can open, and never inside Papol for Mac itself. On Windows, Linux, or a phone there is nothing to hand off to, so nothing is said.
- **US-7.25** A handoff carries **the place, not just the document**. The page I am on, the note I followed, the excerpt or clip a link named — all of it arrives. A handoff that drops me at page 1 of a paper I was reading on page 14 is worse than no handoff, and an already-open window in the app is moved to that place rather than a second window being opened.
- **US-7.26** **The browser is never left broken.** Accepting never navigates the tab: the reading stays exactly where it was, at the same page and scroll, while the app is asked to open. Whatever the app does or fails to do, the tab behind it is still the paper I was reading — Papol never trades a reading I have for one it hopes to give me.
- **US-7.27** I decide, and I decide once. **Not now** puts the offer away for this document; **Don't ask again** retires it for this browser, and my profile can bring it back. There is no standing answer to give: the app is never opened without my asking on the document in front of me, so nothing can be set going that I then have to find the way to stop.
- **US-7.28** **The bar is not a trap.** Only the button hands off, never the bar's whole width; the dismiss is a target a person can actually hit, not a hairline cross; and no part of the bar quietly means "download" when it says "open". The web's ordinary "Open in App" banner is a deceptive pattern precisely because it inverts these three, and Papol would rather be refused honestly than accepted by accident.
- **US-7.29** **The handoff is not a sign-in.** The app opens as whoever is signed in on this computer. If that is nobody, or somebody else, the app says so and asks — it never quietly shows one user's Papol to another, and it never carries a browser session across.
- **US-7.30** A **sharable** someone handed me is offered the same way, and the offer is **never withheld until it has been earned**: whether or not this browser has ever handed anything off, whether or not I have an account, I am told the app can open this. Papol cannot see what is installed and does not guess from what I did last time — it makes the offer and lets me answer it. What opens is the same read-only reading, carrying no more of the sharer than the browser does, and declining leaves me reading in the tab (US-7.26).
- **US-7.32** **The handoff address mirrors the one I am already at.** `https://papol.io/viewer/?pdf=…` becomes `papol://papol.io/viewer/?pdf=…`, so the app turns it straight back into the document the browser was showing, and there is no second vocabulary to keep in step. Only the keys that name a document and a place in it cross over: anybody at all can send the app one of these, so it is read as an address a stranger typed rather than as a message from Papol.
- **US-7.33** **Papol for Mac does not claim Papol's web addresses.** A `https://papol.io/viewer/…` link followed from a mail or another application arrives in the browser, where the bar makes the offer. Claiming addresses would do nothing for this section's case — a user already standing on an address cannot follow a link to where they already are — and would bring Safari's own "open in the app" control, to which Papol's bar would have to yield rather than ask twice for one paper.
- **US-7.34** **Papol cannot tell whether the app is installed, and does not pretend to.** No browser will answer that question; the only signal is whether this tab loses attention shortly after asking, which is a guess and is sometimes wrong. So the bar never announces a verdict about my computer. When nothing appears to have happened it offers the download — plainly, as an offer — and if the app did open after all, the bar simply goes away rather than arguing with what I can see.
- **US-7.35** **The download remembers what I was opening.** Once the app is installed, the same bar is still there on the same paper, and one click hands it over — I never have to find my way back to the paper to finish what I started. Until then the tab reads exactly as it did before I asked, and nothing about the offer is repeated at me on the next page.

## Non-functional

- **US-8.1** Minimalist, academic visual style: serif typography, restrained palette, generous whitespace, no decorative chrome.
- **US-8.2** Responsive: usable on phone-width screens (single column, touch-friendly controls).
