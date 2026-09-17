# Papol Social — User Stories

Papol exists to make **spontaneous seminars** happen: a seminar is never scheduled top-down, it springs up whenever a user calls one on a paper and others answer.

Vocabulary ("The Nook" theme). The short list below is the user-facing
core; `docs/VOCABULARY.md` is the full lexicon — every term across product,
code and schema, the words to prefer, and the places where two words are
currently doing one job.
- **Nook** — a user's public reading corner: the papers they uploaded, with their ratings.
- **Users** — the members of Papol; the Library lists every user alongside the papers they show.
- **On display** — whether my copy of a paper, and my name with it, is shown to other users. It is the shelf that says so, and it says nothing about the paper: every paper is in the Library whoever displays it. A copy not on display is mine alone.
- **Located note** — a private note with a place in the PDF attached. Not a separate kind of thing: the same note, pinned.
- **Paper** — one PDF and what is known about it. The PDF's content hash is the paper's identity: two files of the same work are two papers, even when they print the same DOI.
- **Sharable** — a link that opens a PDF in the viewer for whoever holds it, signed in or not: the UUID in the link is the whole of the permission. A **rich** link carries one user's reading — their annotations on that paper — and is theirs. A **lean** link carries the PDF alone, is one per paper, and is nobody's.
- **Papol for Mac** — the native macOS application. It carries the same three surfaces (library, viewer, boards) and reads the same account, so a paper open in a browser and the same paper open in the app are one paper, not a copy.
- **Handoff** — moving what I am reading right now from the browser into Papol for Mac: the same document, at the same place, in the app instead of the tab.
- **Call** — requesting a spontaneous seminar on a paper; it notifies every user of that paper.
- **Cohort** — the group where a called seminar is planned: leader, availability, platform, discussion. A seminar moves through three named states, used consistently across the app: **called** (waiting for a leader) → **planning** (leader took charge) → **scheduled** (time and platform announced).
- **Leader** — the user who answers a call and takes charge of the seminar.

Papers are **keyed by DOI** (falling back to title): entries in different nooks with the same DOI are the same paper — they share metadata, seminar cohorts, and the "also read by" listing.

## 1. Accounts

- **US-1.1** As a visitor, I can register with my email, a display name, an affiliation (optional), and a password, so I get my own nook.
- **US-1.7** As a user, I choose whether my email shows on my nook, with a tick box on my profile. It is on by default; turning it off keeps my address to myself, and it is never sent to other users while off. My email is always my login identifier and cannot be changed.
- **US-1.2** As a user, I can log in with my email and password, and log out; my session persists across page reloads.
- **US-1.3** As a visitor who is not logged in, I am not met by a login wall: I land in the demo, greeted by a welcome message, and the sign-in and register pages are one click away.
- **US-1.4** As a visitor without an account, the demo is my only way to explore: every page of the real community requires signing in. Signing out returns me to the demo landing.
- **US-1.5** As a user, I can edit my profile (display name and affiliation) and change my password from a profile page reached by clicking my name in the navigation. My email is my login identifier and cannot be changed.
- **US-1.6** As a user, I can upload a profile image (PNG/JPEG/WebP, up to 2 MB), replace or remove it; it appears wherever I do. Without one, my initial shows in its place.

## 2. Papers, ratings, and display

- **US-2.1** As a user, I can upload a PDF into my own nook; metadata (DOI, title, authors, journal, year) is auto-extracted for me to review and edit.
- **US-2.2** As a user, I can rate each paper 1–5 on three dimensions — **My expertise**, **Reading depth**, **Merit** — directly on the paper's jacket, one click per change. Each dimension is optional: a set rating shows a small "clear" control; an unset one reads "unrated". Visitors see unrated dimensions as a quiet "unrated".
- **US-2.3** As a user, only I can delete papers in my nook (via Edit Metadata → Delete paper) and edit my personal fields: summary, ratings, display. Deleting takes my copy and my notes; my ink and clips stay where they are, for when I add the paper again.
- **US-2.4** **Metadata is shared**: any user can Edit Metadata on any visible paper, and the change applies to every copy of it. The edit form warns about this. "Edit Metadata" and "Edit Summary" are separate buttons — summary belongs to the copy, so only its own user may edit it.
- **US-2.5** As a user, I choose whether my copy is **on display**, by the shelf I keep it on. A displayed copy shows me standing against the paper — to nook visitors, in the Library, and in "also read by". A copy not on display is mine alone: nobody is told I have it. Summaries and private notes are mine either way.
- **US-2.6** As a user, I can keep private, timestamped notes on my own papers; no one else can read or write them.
- **US-2.7** **A paper is its PDF.** The file's content hash is the paper's identity, so uploading a PDF Papol already holds adds me to that paper rather than making a second one, and uploading a different PDF makes a paper of its own — even when it prints a DOI Papol has already seen. Nothing ever replaces the file under anyone's notes, because nothing can: a different file is a different paper.

## 2b. A paper is not owned

- **US-2.10** **A paper belongs to nobody.** A paper is a file that exists; no
  user can alter or remove one, and leaving a paper never takes it away. What a
  user owns is their **copy**: the shelf it sits on, their ratings, their
  summary, their annotations.
- **US-2.11** **Display governs a copy, not a paper.** Putting a copy on
  display (US-2.5) says whether *I* am shown standing against the paper. Every
  paper is in the Library whoever displays it, and anyone signed in can open
  one and take a copy of their own.
- **US-2.11a** **A paper nobody holds is still in the Library**, listed like
  any other with no readers shown against it. The last reader leaving is not a
  deletion, and a file that arrived without anyone keeping it is still a file
  Papol has — either way the paper is there to be found, opened and taken.
- **US-2.12** **What a user keeps to themselves.** My summary, my notes, my ink
  and clips — and that I keep this paper at all: a user who does not display
  their copy is named nowhere on the paper.
- **US-2.13** **A paper's jacket is for people with accounts.** The Library asks
  for one (US-1.4), and the jacket is the Library's. Display decides
  nothing here: it governs the copy it belongs to and nothing else.

## 3. Browsing

- **US-3.1** As a user, I can see every user in the Library with avatar, affiliation, and how many papers each has on display. The people and the papers are two views of one Library, not two places.
- **US-3.2** As a user, I can visit another user's nook and browse the copies they display, with their ratings. Summaries and notes stay private to the user who wrote them.
- **US-3.3** As a user, I can open the **Library**, which lists **every paper** — not only the ones somebody displays, because no user's shelf decides what is findable. Each paper appears once, with a row per user who displays a copy (avatar, name, ratings) linking to theirs; a paper nobody displays simply shows no such row. Search matches papers and user names.
- **US-3.4** As a user, a paper's jacket shows "Also read by" chips for every other user who **displays** a copy of the same paper. Users who keep theirs to themselves are not named. Hovering a chip shows their ratings; clicking visits their nook.

## 4. Calling a seminar

- **US-4.1** As a user with a **displayed** entry of a paper, I can **call for a seminar** on it. The call notifies **every user of the paper — even users who keep their own copy of it hidden** — via the in-app inbox. Users without a displayed entry cannot call, join, or write in the cohort; the UI tells them so.
- **US-4.2** As a notified user with a hidden entry, I can put my entry on display right from the cohort, which lets me appear among the users and become eligible to lead.
- **US-4.3** Only one call can be active per paper (waiting or planning); after a seminar is scheduled, a new one can be called.
- **US-4.4** As a user, I have an **Inbox** in the navigation with an unread badge; opening it shows my notifications (calls, a leader stepping up, scheduled seminars) and marks them read. Clicking one opens the cohort.

## 5. The cohort

- **US-5.1** A call forms a **cohort** for the paper, in "waiting for a leader" state. Any user with a *displayed* entry of the paper can **answer to lead** and takes charge; everyone is notified when they do.
- **US-5.2** All planning happens in the cohort: participants (the caller, the leader, and users who join or contribute) are shown as chips. Only users with a **displayed** entry of the paper can join, message, or submit availability — hidden-entry users are invited to put their copy on display first, right from the cohort.
- **US-5.3** Every participant can submit and update their **availability** (free-form) until the seminar is scheduled; all availability is visible in the cohort.
- **US-5.4** The cohort has a **discussion thread** for coordination — short messages with author and time.
- **US-5.5** The **leader announces** the seminar by picking a time and a platform; the cohort switches to "scheduled", the paper's jacket shows the result, and participants and users are notified.
- **US-5.6** A paper's jacket always reflects the cohort: none called, waiting for a leader, planning, or scheduled — with a "Join the cohort" door for signed-in users.

## 5b. Boards

- **US-5.7** As a user, I can open a board in a dedicated full-screen app served at `/boards/<guid>`, on the same origin as Papol so my session carries over without a second sign-in. Board discovery and creation remain in my nook.

- **US-5.8** **A board has a jacket, as a paper does.** Every work in the
  Library has one screen where what is known about it is kept and from which
  it is opened: a paper's jacket at `/paper/<name>`, a board's at
  `/board/<guid>`. A board row in a nook opens its jacket, the jacket opens
  the canvas, and the canvas comes back to the jacket. The jacket is where a
  board's **description** is read and written — it had nowhere to be shown
  before — beside its name, how many cards it holds, when it was last
  edited, and whose it is when it is not mine.

- **US-5.9** The canvas has two ways out and they mean different things: a
  **Back** to the board's jacket, which names where it returns to, and the
  **home button**, which leaves for Papol itself and names nothing (US-7.16).
  On the desktop there is no Back on the canvas at all: the jacket is still
  open in the Library window behind it, because the canvas is a document
  window beside that window rather than instead of it.

## 6. Feedback

- **US-6.1** As anyone using Papol — user, demo visitor, or someone who cannot even sign in — I can report a bug or ask for a feature from a **Feedback** button floating in the bottom-right corner of every page — one box, free text, no form to fill in — without leaving the page I am on. A visitor may leave an email so the admins can reply.
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
- **US-7.12** The analyzer is optional. Where it is not running, everything else in Papol works exactly as before and citations are simply not clickable.

## 7c. Sharing a reading

- **US-7.13** As a user, I can hand someone a **link to the PDF I am reading**, from the Share menu on the paper's jacket. It opens the PDF in Papol's viewer, read-only, for anyone holding it — no account, no sign-in.
- **US-7.14** One tick box decides **what the link carries, and therefore whose it is**. Left alone, I get the PDF's own link: the same link for everyone, carrying the paper and naming nobody — I copy it and pass it on, and that is the end of my part in it. Ticked, Papol makes **my** link, carrying my notes, paint and clips.
- **US-7.15** A link is one or the other for its whole life. I have **one link of my own per paper I read** — asking again gives it back rather than making a second — and the PDF's own link is beside it, not instead of it: having handed over one is never a reason to be refused the other.
- **US-7.16** What a visitor sees through my link is my reading **as it is now**, not a snapshot: a note I reword is reworded for everyone holding it. They see the PDF, my name, my annotations, and the paper's bibliography — and nothing else in my nook. The way out is the **home button**, which leads to Papol itself and names no paper: a link hands over a reading, not a place in the Library. Through the PDF's own link they see the paper and no user at all.
- **US-7.17** **Sharing is not displaying.** A shelf says who can find the paper in the Library; a link says who may read this PDF. I can share a paper nobody else can find, and moving it between a public and a private shelf never changes a link I have already handed out.
- **US-7.18** If I **take the paper out of my nook**, my link keeps opening the PDF but stops carrying the reading — permanently, so putting the paper back does not quietly re-expose my annotations — and stops being mine along with them.
- **US-7.19** **Stopping** asks what I mean: *drop my annotations*, which leaves the link working for whoever has it and hands it out of my keeping for good, or *revoke the link*, which stops it opening. Revoking is final — sharing again mints a new link, and the old one stays dead. Whoever follows a revoked link is told it is no longer shared, not that it never existed.
- **US-7.20** **A link of mine is a state of the paper, shown on its page**, so nothing I do can leave one serving that I have forgotten about. The PDF's own link is never shown there and never counted against me: I am not told whether one exists, because nothing of mine is in it.

## 7d. Handing a reading to Papol for Mac

The download banner tells a visitor the Mac app exists. This is the other
half: when I am *already* looking at something the app can open better — a
PDF, a board — Papol offers to move it there, and only there.

- **US-7.22** As a user on a Mac with a paper open in the browser's viewer, or a board open in the board app, Papol offers to **open this one in Papol for Mac**. The offer is a quiet bar at the top of what I am reading, never a dialog over it: I came here to read, and an offer that blocks the page is worse than no offer.
- **US-7.23** The offer names **what it will open** — "Open this paper in Papol" or "Open this board in Papol" — not the app. A handoff is about the thing in front of me; an advertisement for software is what the download banner already does elsewhere.
- **US-7.24** The offer is made only where it can be honoured: a Mac browser, a document the app can open, and never inside Papol for Mac itself. On Windows, Linux, or a phone there is nothing to hand off to, so nothing is said.
- **US-7.25** A handoff carries **the place, not just the document**. The page I am on, the note I followed, the excerpt or clip a link named — all of it arrives. A handoff that drops me at page 1 of a paper I was reading on page 14 is worse than no handoff, and an already-open window in the app is moved to that place rather than a second window being opened.
- **US-7.26** **The browser is never left broken.** Accepting never navigates the tab: the reading stays exactly where it was, at the same page and scroll, while the app is asked to open. Whatever the app does or fails to do, the tab behind it is still the paper I was reading — Papol never trades a reading I have for one it hopes to give me.
- **US-7.27** I decide, and I decide once. **Not now** puts the offer away for this document; **Don't ask again** retires it for this browser, and my profile can bring it back. There is no standing answer to give: the app is never opened without my asking on the document in front of me, so nothing can be set going that I then have to find the way to stop.
- **US-7.28** **The bar is not a trap.** Only the button hands off, never the bar's whole width; the dismiss is a target a person can actually hit, not a hairline cross; and no part of the bar quietly means "download" when it says "open". The web's ordinary "Open in App" banner is a known deceptive pattern precisely because it inverts these three, and Papol would rather be refused honestly than accepted by accident.
- **US-7.29** **The handoff is not a sign-in.** The app opens as whoever is signed in on this computer. If that is nobody, or somebody else, the app says so and asks — it never quietly shows one user's Papol to another, and it never carries a browser session across.
- **US-7.30** A **sharable** someone handed me is offered the same way, and the offer is **never withheld until it has been earned**: whether or not this browser has ever handed anything off, whether or not I have an account, I am told the app can open this. Papol cannot see what is installed and will not guess from what I did last time — it makes the offer and lets me answer it. What opens is the same read-only reading, carrying no more of the sharer than the browser does, and declining leaves me reading in the tab (US-7.26).
- **US-7.31** The demo makes no offer. A visitor exploring papers that are not theirs has nothing of their own to open, and the demo's job is to show Papol, not to ask for an installation.
- **US-7.32** **The handoff address mirrors the one I am already at.** `https://mc-pony.com/papol/viewer/?pdf=…` becomes `papol://mc-pony.com/papol/viewer/?pdf=…`, so the app turns it straight back into the document the browser was showing, and there is no second vocabulary to keep in step. Only the keys that name a document and a place in it cross over: anybody at all can send the app one of these, so it is read as an address a stranger typed rather than as a message from Papol.
- **US-7.33** *Not built.* **Papol for Mac could claim its own web addresses**, so that `https://mc-pony.com/papol/viewer/…` followed from anywhere — a colleague's mail, another application — arrives in the app rather than the browser. macOS has supported that since 10.15. It wants an entitlement Apple issues and a file served from the domain, and it does nothing for the case this section is about, because a user already standing on an address cannot follow a link to where they already are. It would bring Safari's own "open in the app" control with it, and Papol's bar should yield to that rather than ask twice for one paper.
- **US-7.34** **Papol cannot tell whether the app is installed, and does not pretend to.** No browser will answer that question; the only signal is whether this tab loses attention shortly after asking, which is a guess and is sometimes wrong. So the bar never announces a verdict about my computer. When nothing appears to have happened it offers the download — plainly, as an offer — and if the app did open after all, the bar simply goes away rather than arguing with what I can see.
- **US-7.35** **The download remembers what I was opening.** Once the app is installed, the same bar is still there on the same paper, and one click hands it over — I never have to find my way back to the paper to finish what I started. Until then the tab reads exactly as it did before I asked, and nothing about the offer is repeated at me on the next page.

## Non-functional

- **US-8.1** Minimalist, academic visual style: serif typography, restrained palette, generous whitespace, no decorative chrome.
- **US-8.2** Responsive: usable on phone-width screens (single column, touch-friendly controls).
