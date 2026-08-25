# Papol Social — User Stories

Papol exists to make **spontaneous seminars** happen: a seminar is never scheduled top-down, it springs up whenever a reader calls one on a paper and others answer.

Vocabulary ("The Nook" theme):
- **Nook** — a reader's public reading corner: the papers they uploaded, with their ratings.
- **Readers** — the members of Papol; the directory lists every reader.
- **Host** — the owner of a paper entry (the reader in whose nook the entry lives).
- **On display** — an entry the host shows to other readers; hidden entries are visible only to their host.
- **Located note** — a private note with a place in the PDF attached. Not a separate kind of thing: the same note, pinned.
- **Edition** — one PDF file of a paper. A paper may have several; each reader's copy is pinned to the one they read, and only they can move it.
- **Call** — requesting a spontaneous seminar on a paper; it notifies every reader of that paper.
- **Cohort** — the group where a called seminar is planned: leader, availability, platform, discussion. A seminar moves through three named states, used consistently across the app: **called** (waiting for a leader) → **planning** (leader took charge) → **scheduled** (time and platform announced).
- **Leader** — the reader who answers a call and takes charge of the seminar.

Papers are **keyed by DOI** (falling back to title): entries in different nooks with the same DOI are the same paper — they share metadata, seminar cohorts, and the "also read by" listing.

## 1. Accounts

- **US-1.1** As a visitor, I can register with my email, a display name, an affiliation (optional), and a password, so I get my own nook.
- **US-1.7** As a reader, I choose whether my email shows on my nook, with a tick box on my profile. It is on by default; turning it off keeps my address to myself, and it is never sent to other readers while off. My email is always my login identifier and cannot be changed.
- **US-1.2** As a reader, I can log in with my email and password, and log out; my session persists across page reloads.
- **US-1.3** As a visitor who is not logged in, I am not met by a login wall: I land in the demo, greeted by a welcome message, and the sign-in and register pages are one click away.
- **US-1.4** As a visitor without an account, the demo is my only way to explore: every page of the real community requires signing in. Signing out returns me to the demo landing.
- **US-1.5** As a reader, I can edit my profile (display name and affiliation) and change my password from a profile page reached by clicking my name in the navigation. My email is my login identifier and cannot be changed.
- **US-1.6** As a reader, I can upload a profile image (PNG/JPEG/WebP, up to 2 MB), replace or remove it; it appears wherever I do. Without one, my initial shows in its place.

## 2. Papers, ratings, and display

- **US-2.1** As a reader, I can upload a PDF into my own nook; metadata (DOI, title, authors, journal, year) is auto-extracted for me to review and edit.
- **US-2.2** As a reader, I can rate each paper 1–5 on three dimensions — **My expertise**, **Reading depth**, **Merit** — directly on the paper page, one click per change. Each dimension is optional: a set rating shows a small "clear" control; an unset one reads "unrated". Visitors see unrated dimensions as a quiet "unrated".
- **US-2.3** As a reader, only I can delete papers in my nook (via Edit Metadata → Delete paper) and edit my personal fields: summary, ratings, display.
- **US-2.4** **Metadata is shared and keyed by DOI**: any reader can Edit Metadata on any visible paper, and the change applies to every entry with that DOI. The edit form warns about this. "Edit Metadata" and "Edit Summary" are separate buttons — summary is personal and owner-only.
- **US-2.5** As a reader, I choose per paper whether to put it **on display** (the default). Displayed entries appear to nook visitors, in the Papers tab, and in "also read by". Hidden entries are visible only to me. I toggle with the switch in my nook's side column (hover explains it); displayed papers sort to the top and hidden rows are muted. Summaries and private notes are always host-only, displayed or not.
- **US-2.6** As a reader, I can keep private, timestamped notes on my own papers; no one else can read or write them.
- **US-2.7** A paper's PDF is versioned into **editions**, and my copy is pinned to one of them. Uploading a PDF for a paper that already has one adds an edition — it never replaces the file anyone else is reading. An upload byte-identical to an existing edition reuses it instead of adding a duplicate.
- **US-2.8** When a newer edition exists, my paper page shows an **info sign** naming who added it and when, and offers to move my copy. It warns that located notes were placed on my edition and may not line up on a different PDF. Nothing but my own click ever moves my copy, and Papol never realigns notes for me — adopting is my risk to take.
- **US-2.9** Nothing shared is destroyed by one reader: leaving a paper removes my copy and my notes only. The paper, its editions and their files stay, so a paper with no readers is simply absent from the Library until someone adds it again. No PDF is ever deleted automatically.

## 3. Browsing

- **US-3.1** As a reader, I can see a directory of all readers with avatar, affiliation, and how many papers each has on display.
- **US-3.2** As a reader, I can visit another reader's nook and browse their displayed papers with their ratings. Summaries and notes stay private to the host.
- **US-3.3** As a reader, I can open a **Papers** tab listing every displayed paper. Papers read by several readers appear once, with a row per reader (avatar, name, ratings) linking to their entry. Search matches papers and reader names.
- **US-3.4** As a reader, a paper's page shows "Also read by" chips for every other reader with a displayed entry of the same paper. Hovering a chip shows their ratings; clicking visits their nook.

## 4. Calling a seminar

- **US-4.1** As a reader with a **displayed** entry of a paper, I can **call for a seminar** on it. The call notifies **every reader of the paper — even readers who keep their own copy of it hidden** — via the in-app inbox. Readers without a displayed entry cannot call, join, or write in the cohort; the UI tells them so.
- **US-4.2** As a notified reader with a hidden entry, I can put my entry on display right from the cohort, which lets me appear among the readers and become eligible to lead.
- **US-4.3** Only one call can be active per paper (waiting or planning); after a seminar is scheduled, a new one can be called.
- **US-4.4** As a reader, I have an **Inbox** in the navigation with an unread badge; opening it shows my notifications (calls, a leader stepping up, scheduled seminars) and marks them read. Clicking one opens the cohort.

## 5. The cohort

- **US-5.1** A call forms a **cohort** for the paper, in "waiting for a leader" state. Any reader with a *displayed* entry of the paper can **answer to lead** and takes charge; everyone is notified when they do.
- **US-5.2** All planning happens in the cohort: participants (the caller, the leader, and readers who join or contribute) are shown as chips. Only readers with a **displayed** entry of the paper can join, message, or submit availability — hidden-entry readers are invited to put their copy on display first, right from the cohort.
- **US-5.3** Every participant can submit and update their **availability** (free-form) until the seminar is scheduled; all availability is visible in the cohort.
- **US-5.4** The cohort has a **discussion thread** for coordination — short messages with author and time.
- **US-5.5** The **leader announces** the seminar by picking a time and a platform; the cohort switches to "scheduled", the paper page shows the result, and participants and readers are notified.
- **US-5.6** The paper page always reflects the cohort: none called, waiting for a leader, planning, or scheduled — with a "Join the cohort" door for signed-in readers.

## 6. Feedback

- **US-6.1** As anyone using Papol — reader, demo visitor, or someone who cannot even sign in — I can report a bug or ask for a feature from a **Feedback** button floating in the bottom-right corner of every page — one box, free text, no form to fill in — without leaving the page I am on. A visitor may leave an email so the admins can reply.
- **US-6.2** Every report is one piece of free text — no categories to pick. It is stored, and reaches every admin twice over: as an inbox message and as an email sent right away. A report sent while email is unconfigured still waits in the admin inbox and on the admin page.
- **US-6.3** As an admin, I see every report on the admin page — reporter, the page it came from, and time — and can mark one done or reopen it.

## 7. Reading and located notes

- **US-7.1** As a reader, I can open any paper in my nook in Papol's **PDF viewer** — a separate app served at `/viewer`, on the same origin, so my session carries over with no second sign-in.
- **US-7.2** As a reader, I can take a **located note**: choose *Add a note*, click the spot on the page it belongs to, and write it. A located note **is** one of my notes — the same private notes that live on the paper page, with a place in the PDF attached. There is one list, not two.
- **US-7.3** A note's location is **typed**. Today the type is `point`, stored as fractions of the page in PDF user space, so a note lands in the same place at any zoom, on any screen. `rect`, `polygon` and `quote` join later without a migration and without disturbing existing notes.
- **US-7.4** My notes are listed in a rail beside the page — all of them, whether or not they have a place; the ones that do show their page, carry a pin, and scroll there when clicked. A note taken on a different edition is marked as such, and never moved for me.
- **US-7.5** On the paper page, a note that has a place shows a **page** chip that opens the viewer at that note. A note taken there and a note typed on the paper page are the same kind of thing, in the same list.

## 7b. Following a citation

- **US-7.6** As a reader, when I meet a citation in the text — "[12]" — I can click it and see what it is without leaving my place: title, authors, where and when it appeared, its abstract, and how often it has been cited.
- **US-7.7** The card offers what can be done with the work: a free PDF where one exists, the publisher's page, and a Scholar search. When the cited paper is **already in Papol**, that link comes first — a citation is how a reader finds the next paper in their nook, and the next seminar.
- **US-7.8** A reference Papol cannot match is not hidden: the card shows the line exactly as the author printed it, with a way to go and search for it. A thin answer beats a blank one.
- **US-7.9** Clickable citations come from the PDF where the PDF has them — papers built with LaTeX carry a link on every marker, and the author's own link is better than any analysis. Where they are absent, the analyzer's reading of the page is used, and a marker matched only by counting its number is marked as the guess it is.
- **US-7.10** Reading a paper's bibliography happens once per **edition** and is kept, so only the first reader of a PDF waits. Looking up a particular reference happens the first time someone opens it, and is kept too.
- **US-7.11** As a reader, the paper's **other links work too**: "see Section 3.2" and "Figure 4" scroll me there, and a URL opens in a new tab. Following a cross-reference offers **← Back to where you were**, because a jump that loses my place is worse than no link at all.
- **US-7.12** The analyzer is optional. Where it is not running, everything else in Papol works exactly as before and citations are simply not clickable.

## Non-functional

- **US-8.1** Minimalist, academic visual style: serif typography, restrained palette, generous whitespace, no decorative chrome.
- **US-8.2** Responsive: usable on phone-width screens (single column, touch-friendly controls).
