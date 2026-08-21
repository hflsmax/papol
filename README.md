# Papol - A Nook for Every Reader

A webapp for documenting PDF papers with automatic DOI/metadata extraction, built to
make **spontaneous seminars** happen: every reader gets a **nook** for the papers they
read, anyone can **call for a spontaneous seminar** on a paper — notifying all its
readers — and whoever answers to lead plans it in a **room** (availability, platform,
discussion). See [USER_STORIES.md](USER_STORIES.md) for the full feature set.

## NixOS Deployment

### 1. Initial Setup

Add to your NixOS configuration:

```nix
# /etc/nixos/configuration.nix
{ ... }: {
  imports = [ /home/congm/src/papol/module.nix ];

  services.papol.enable = true;
  # services.papol.domain = "papers.example.com";  # for HTTPS
}
```

Build frontend and switch:

```bash
cd /home/congm/src/papol
nix develop --command bash -c "cd frontend && npm install && npm run build"
sudo nixos-rebuild switch
```

Access at http://localhost

### 2. Updating

After code changes:

```bash
./update.sh
```

Or manually:

```bash
nix develop --command bash -c "cd frontend && npm run build"  # if frontend changed
sudo systemctl restart papol                      # if backend changed
```

## The reference analyzer (optional)

Clickable citations need [GROBID](https://github.com/kermitt2/grobid) (Apache-2.0),
which reads a PDF's bibliography and finds where each work is cited. It is a JVM
service, so it runs as a container beside Papol:

```nix
services.papol.grobid.enable = true;
# Identifies Papol to CrossRef and OpenAlex, which are asked what each
# reference turned out to be. Both are free and keyless; an address puts the
# requests in their faster pool.
services.papol.contactEmail = "you@example.com";
```

That pulls `grobid/grobid:0.9.1-crf` (about 1 GB, CPU-only) and binds it to
localhost. The backend finds it through `GROBID_URL`; in development:

```bash
docker run -d --rm --init -p 8070:8070 grobid/grobid:0.9.1-crf
cd backend && GROBID_URL=http://localhost:8070 uvicorn main:app --reload
```

Two public indexes answer "what is this reference": CrossRef matches the
printed line, and OpenAlex says how often it has been cited and where a free
copy is. OpenAlex began charging for *searches* in February 2026 — about ten a
day without a key, about a thousand with a free one from
[openalex.org](https://openalex.org/pricing). The key goes in a file, not in
`configuration.nix`: anything written into a NixOS option is copied into the
world-readable `/nix/store`. Papol reads `~/.config/papol/secrets.env` if it is
there — the same place and shape as hoom's, and where `SMTP_*` belongs too:

```bash
umask 077
mkdir -p ~/.config/papol
echo 'PAPOL_OPENALEX_KEY=your-key-here' > ~/.config/papol/secrets.env
sudo systemctl restart papol
```

Papol is frugal with them regardless: CrossRef is asked first, and a search is
spent only when CrossRef has not confidently answered. Without a key most
references still resolve; the ones only OpenAlex knows about will say they
could not be looked up, and will try again next time rather than remembering a
wrong answer.

Reading one paper takes a second or two on a warm service. It happens once per
edition, in the background, the first time someone opens that PDF in the viewer.
Nothing else in Papol depends on it: with `GROBID_URL` unset the references
endpoint answers `unavailable` and the viewer shows no citation markers.

## Development

```bash
nix develop          # or `direnv allow` once, and it happens on cd

# Terminal 1
cd backend && uvicorn main:app --reload

# Terminal 2
cd frontend && npm run dev
```

Dependencies live in `flake.nix` and nowhere else. `.envrc` layers an optional
`.env` on top for local settings; everything in it has a working default.

The shell carries a browser, so the viewer's layout can be checked at sizes
this machine does not have:

```bash
python tools/check-viewer-layout.py
```

Open http://localhost:5173

## Usage

1. Register with your email, display name, and affiliation. Visitors without
   an account land in the browser-only demo; the real community is visible
   only to signed-in readers (existing databases are migrated automatically;
   papers created before the social upgrade have no owner and won't appear in
   any nook)
2. In **My nook**, drop a PDF on the upload area, review/edit auto-extracted
   metadata, rate the paper (expertise / reading depth / merit), and save
3. A paper's PDF is versioned into **editions**. Uploading a PDF for a paper
   that already has one adds an edition rather than replacing it; your copy
   stays on the edition you read until you adopt a newer one from the info
   sign on the paper page. PDFs are never deleted automatically
4. **Read & note** opens the paper in Papol's PDF viewer (a separate app in
   `viewer/`, served at `/viewer`). Choose *Add a note*, click the spot on the
   page, and write it. A located note is one of your ordinary private notes
   with a place attached — it appears in the paper's Notes list with a chip
   linking back to the spot
5. In the viewer, a citation in the text — **[12]** — is clickable: it opens a
   card with the cited paper's title, authors, venue, abstract and citation
   count, a link to a free PDF where one exists, and a link straight into
   Papol when the paper is already here. References are read once per
   edition and looked up the first time anyone opens them. This needs the
   reference analyzer (see below); without it the viewer behaves as before.
   The paper's other links work as well — a cross-reference to a section or
   figure scrolls there and offers a way back, and a URL opens in a new tab.
   Those need no analyzer, only a PDF that carries links
6. Browse **Readers** and **Papers** to see other nooks and everyone's ratings
7. On any paper, **call for a seminar** — every reader of it gets notified in
   their Inbox
8. A reader answers to lead, and everyone coordinates in the **room**:
   availability, discussion, then the leader announces the time and platform
9. The floating **Feedback** button in the bottom-right corner reports a bug
   or asks for a feature from wherever you are — open to visitors too. Each report is stored in the
   `feedback` table, lands in every admin's inbox, and is emailed to the
   admins right away when SMTP is configured; admins work through them on
   the admin page
