# Papol Social — User Stories

Vocabulary ("The Nook" theme):
- **Nook** — a reader's public reading corner: the papers they uploaded, with their ratings.
- **Readers** — the members of Papol; the directory lists every reader.
- **Host** — the owner of a paper entry (the reader in whose nook the entry lives).
- **On display** — an entry the host shows to other readers; hidden entries are visible only to their host.
- **Call** — requesting a seminar on a paper; it notifies every reader of that paper.
- **Cohort** — the group where a called seminar is planned: leader, availability, platform, discussion. A seminar moves through three named states, used consistently across the app: **called** (waiting for a leader) → **planning** (leader took charge) → **scheduled** (time and platform announced).
- **Leader** — the reader who answers a call and takes charge of the seminar.

Papers are **keyed by DOI** (falling back to title): entries in different nooks with the same DOI are the same paper — they share metadata, seminar cohorts, and the "also read by" listing.

## 1. Accounts

- **US-1.1** As a visitor, I can register with my email, a display name, an affiliation (optional), and a password, so I get my own nook. My email is used only to sign in; other readers see my display name and affiliation, never my email.
- **US-1.2** As a reader, I can log in with my email and password, and log out; my session persists across page reloads.
- **US-1.3** As a visitor who is not logged in, I land on the login/register page.
- **US-1.4** As a visitor, I can **continue as a guest**: I can browse the readers directory, visit nooks, and view papers, ratings, and seminar announcements — read-only. Everything that writes requires signing in, and the app invites me to do so in those places.
- **US-1.5** As a reader, I can edit my profile (display name and affiliation) and change my password from a profile page reached by clicking my name in the navigation. My email is my login identifier and cannot be changed.
- **US-1.6** As a reader, I can upload a profile image (PNG/JPEG/WebP, up to 2 MB), replace or remove it; it appears wherever I do. Without one, my initial shows in its place.

## 2. Papers, ratings, and display

- **US-2.1** As a reader, I can upload a PDF into my own nook; metadata (DOI, title, authors, journal, year) is auto-extracted for me to review and edit.
- **US-2.2** As a reader, I can rate each paper 1–5 on three dimensions — **My expertise**, **Reading depth**, **Merit** — directly on the paper page, one click per change. Each dimension is optional: a set rating shows a small "clear" control; an unset one reads "not rated". Visitors see unrated dimensions as a quiet "not rated".
- **US-2.3** As a reader, only I can delete papers in my nook (via Edit Metadata → Delete paper) and edit my personal fields: summary, ratings, display.
- **US-2.4** **Metadata is shared and keyed by DOI**: any reader can Edit Metadata on any visible paper, and the change applies to every entry with that DOI. The edit form warns about this. "Edit Metadata" and "Edit Summary" are separate buttons — summary is personal and owner-only.
- **US-2.5** As a reader, I choose per paper whether to put it **on display** (the default). Displayed entries appear to nook visitors, in the Papers tab, and in "also read by". Hidden entries are visible only to me. I toggle with the switch in my nook's side column (hover explains it); displayed papers sort to the top and hidden rows are muted. Summaries and private notes are always host-only, displayed or not.
- **US-2.6** As a reader, I can keep private, timestamped notes on my own papers; no one else can read or write them.

## 3. Browsing

- **US-3.1** As a reader (or guest), I can see a directory of all readers with avatar, affiliation, and how many papers each has on display.
- **US-3.2** As a reader (or guest), I can visit another reader's nook and browse their displayed papers with their ratings. Summaries and notes stay private to the host.
- **US-3.3** As a reader (or guest), I can open a **Papers** tab listing every displayed paper. Papers read by several readers appear once, with a row per reader (avatar, name, ratings) linking to their entry. Search matches papers and reader names.
- **US-3.4** As a reader (or guest), a paper's page shows "Also read by" chips for every other reader with a displayed entry of the same paper. Hovering a chip shows their ratings; clicking visits their nook.

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

## Non-functional

- **US-6.1** Minimalist, academic visual style: serif typography, restrained palette, generous whitespace, no decorative chrome.
- **US-6.2** Responsive: usable on phone-width screens (single column, touch-friendly controls).
