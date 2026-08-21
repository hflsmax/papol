# Papol - A Nook for Every Reader

A webapp for documenting PDF papers with automatic DOI/metadata extraction, built to
make **spontaneous seminars** happen: every reader gets a **nook** for the papers they
read, anyone can **call for a spontaneous seminar** on a paper — notifying all its
readers — and whoever answers to lead plans it in a **room** (availability, platform,
discussion). See [USER_STORIES.md](USER_STORIES.md) for the full feature set.

## Deployment

Papol runs twice on one machine. **Development** is this working tree, started
by hand on port 8000, holding its own database and free to break.
**Production** is a checkout of its own under `/srv/papol/prod`, run as
`papol.service`, with its own database, uploads and `.env`. Nothing crosses
between them except code, and only by promoting it.

The two are reached differently, which is the point:

| | development | production |
|---|---|---|
| address | `http://papol.local` on the LAN, `http://localhost:5173` here | `https://mc-pony.com/papol`, `http://localhost` |
| started by | you, in a shell | systemd, as `papol.service` |
| port | 8000 | 8001 |
| database | `backend/papol.db` in this tree | `backend/papol.db` in its own |

Production is deployed and stays up. Development runs for exactly as long as
you leave one command running:

```bash
./deploy.sh dev              # build both apps, watch them, and serve on 8000
./deploy.sh dev --no-build   # skip the initial build
./deploy.sh dev --no-watch   # build once and stop watching
```

It builds `frontend` and `viewer`, loads `.env` itself rather than trusting
direnv to have done it, and runs `uvicorn --reload` in the foreground. Ctrl-C
stops it and nothing survives. It refuses to start if something already holds
port 8000, which is the one way development and production can collide.

Saving a file rebuilds it. The backend reloads itself; the two Vite apps are
watched with `vite build --watch`, so a saved component is rebuilt into `dist`
within a second and the next page load has it. There is no hot reload here —
reload the page — and during the second a rebuild takes, the page is briefly
unavailable, which is Vite emptying `dist` before writing it. For hot reload
without a refresh, use the Vite servers below.

`papol.local` is the easy name to type from a phone across the room, so it
points at that server rather than at production — the copy that is allowed to
be half-finished. It reaches uvicorn on 8000, which serves what is in
`frontend/dist` and `viewer/dist`, so a page there is as fresh as the last
build. For the inner loop use the Vite servers instead, which reload as you
type and proxy the API back to 8000:

```bash
cd frontend && npm run dev   # 5173
cd viewer   && npm run dev   # 5174
```

Loading `.env` directly is deliberate. Papol reads the environment before the
`settings` table, and development's database is usually a copy of
production's — complete with production's SMTP credentials. A shell that
skipped direnv would otherwise mail real readers.

### Deploying

```bash
./deploy.sh dev            # run development here, in this shell
./deploy.sh prod           # promote main to production
./deploy.sh prod v1.2      # promote some other ref
./deploy.sh pull           # copy production's data down to development
./deploy.sh status         # what is running where
```

Code goes up with `prod`, data comes down with `pull`, and neither ever runs
the other way.

`deploy.sh prod` moves the production checkout to the ref, builds it, backs
up its database, restarts the service, and waits for it to answer. When
`module.nix` or `flake.nix` moved — or when the running unit is not yet this
checkout's — it runs `nixos-rebuild switch` instead of a plain restart, since
those files *are* the service. It refuses to deploy over uncommitted changes
in the production tree and says so when the ref is ahead of `origin/main`.

### Working against real data

`./deploy.sh pull` gives development production's database and PDFs, so a
change can be tried against the paper that actually renders oddly and the
nook that actually has a hundred entries. It is also how a schema change is
rehearsed: the copy arrives at production's schema and `migrate()` runs over
it on the next start, which is what the next deploy will do for real.

The copy is taken with SQLite's backup API rather than `cp`, so production can
keep serving readers while it runs, and nothing is ever written back the other
way. Development's own database is kept beside it as `papol.db.bak-*-pre-pull`
first. Pass `--no-uploads` to skip the 60-odd megabytes of PDFs, at the cost of
404s on papers whose file only exists in production.

Two things are scrubbed out of the copy on the way in, because a database is
not only data:

- the `smtp_*` rows, which are live credentials. `_smtp_cfg` reads the
  environment first and the `settings` table second, so an unscrubbed copy
  mails real readers from a development machine. Development's `.env` points
  SMTP at a dead port as well, but that only holds in a shell that loaded it —
  dropping the rows holds everywhere.
- `site_url`, rewritten to `http://papol.local/`, so a link generated here
  leads here.

It refuses to run while the development server is up: replacing a database
under a process that has it open is how you end up with half of each.

The first `./deploy.sh prod` creates the worktree and hands production a copy
of today's database, uploads and secrets, then prints the `configuration.nix`
it now needs:

```nix
# /etc/nixos/configuration.nix
imports = [ /srv/papol/prod/module.nix ];

services.papol = {
  enable = true;
  srcDir = "/srv/papol/prod";
  port = 8001;          # development keeps 8000, the one you type by hand
  hostAliasPort = 8000; # so http://papol.local reaches development
  grobid.enable = true;
  contactEmail = "you@example.com";
  # domain = "papers.example.com";  # for HTTPS on a name of its own
};
```

### Deploying without a password

A deploy stops the service, reads its log and sometimes rebuilds the system,
so parts of `deploy.sh` need root. Run from a terminal that is just a sudo
prompt; run by a cron job or an agent it is a script waiting forever on a
stdin nobody will answer. `deploy.sh` checks, per command, whether sudo would
ask — and when it would and there is no terminal, it says so and stops rather
than hanging.

To make it not ask:

```nix
services.papol.deploy.passwordless = true;
```

That grants NOPASSWD sudo for exactly what a deploy does and nothing else:
start, stop, restart, `status` and `journalctl` for the `papol` unit, and the
one `install -d` that makes the directory the checkout lives in. Every other
sudo still wants your password. It also declares that directory as a tmpfiles
rule, so after the first rebuild even that command is moot.

`nixos-rebuild switch` is deliberately not in that set, so a deploy that
changes the service itself still stops to ask. Adding it:

```nix
services.papol.deploy.passwordlessRebuild = true;
```

is a bigger step than it looks. The system builds `/srv/papol/prod/module.nix`
and that file is writable by the same user, so a passwordless rebuild is a
passwordless way to run anything as root. It grants no access that user did
not already have — they can sudo with a password — but it removes the password
as the thing between a process running as them and the machine. Left off,
unattended deploys still work; only the rare one that moves `module.nix` or
`flake.nix` needs a human.

The module is imported from the production checkout rather than from this
tree, so the service is described by the same commit that runs it, and an
unfinished edit here cannot break `nixos-rebuild`.

Two settings differ between the trees and must not be copied back and forth.
Production's `.env` carries the real SMTP credentials; development's points
them at a dead port, because `_smtp_cfg` falls back to the `settings` table
and a database copied from production will otherwise mail real readers.
`PAPOL_URL` decides which of the two an emailed link leads to.

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
world-readable `/nix/store`. Papol reads `.env` beside the code if it is there
— the same file direnv loads into a development shell, and where `SMTP_*`
belongs too. It is gitignored, and must stay that way. Each tree has its own,
so the key goes in whichever one you are setting up:

```bash
umask 077
echo 'PAPOL_OPENALEX_KEY=your-key-here' >> .env                  # development
echo 'PAPOL_OPENALEX_KEY=your-key-here' >> /srv/papol/prod/.env  # production
sudo systemctl restart papol                                     # production only
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
