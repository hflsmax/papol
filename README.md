# Papol

Papol is your paper reading companion. It keeps you close to the papers, the
ideas, and the people that shape your thinking.

Three places do the work: your **nook**, the **viewer**, and your **boards**.

## Nook — where your papers live

![A nook listing papers](docs/screenshots/nook.png)

Drop a PDF in and Papol reads the title, authors, DOI and year off it. Each
paper sits on a shelf you choose: a paper on display carries your name to
other people, a personal one is yours alone. Rate it on expertise, reading
depth and merit; keep a private summary, private notes and your own tags.

The Library lists every paper and everyone who shows a copy, so you can see
who else has read the thing you are reading. When you want to talk about a
paper, call a seminar on it: everyone who has that paper hears about it,
someone steps up to lead, and the group settles on a time.

## Viewer — where you read

![The viewer with a painted passage](docs/screenshots/viewer.png)

Read the PDF in Papol and leave your marks on it. Paint over a passage, pin a
note to the exact spot on the page it belongs to, or clip a rectangle out and
move it around. Everything you leave is private until you share it.

Click a citation — "[12]" — and a card tells you what it is: title, authors,
where it appeared, its abstract. It offers a free PDF where one exists, the
publisher's page, and the paper itself if somebody in Papol already has it.
"See Section 3.2" and "Figure 4" jump you there and offer a way back.

You can hand someone a link. The plain link carries the PDF and names nobody.
Your own link carries your reading — your notes, paint and clips — and stays
yours to stop at any time.

## Board — where you think

![A board of cards](docs/screenshots/board.png)

A board is a full-screen space for one line of thought. Drag cards around it:
your own comments, excerpts carried over from the viewer, images, files,
YouTube frames and web pages. Every excerpt remembers where it came from, so
one click takes you back to that spot in the PDF. Group cards into booklets
and collections when a pile starts to mean something.

## Papol for Mac

![Papol running on macOS](docs/screenshots/macos.png)

The same account, the same three places, in a native window. A paper open in
your browser can be handed to the app at the page you were on — same
document, same place, no second sign-in.

---

For native-resolution YouTube frames on boards, set `PAPOL_YOUTUBE_PO_TOKEN`
to an mweb GVS PO token and optionally `PAPOL_YOUTUBE_COOKIES` to an absolute
Netscape-format cookies file path in Papol's `.env`. Without them, YouTube may
expose only a lower-resolution public stream; Papol scales that fallback for
display but cannot recreate its missing detail.
