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
nix-shell --run "cd frontend && npm install && npm run build"
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
nix-shell --run "cd frontend && npm run build"  # if frontend changed
sudo systemctl restart papol                      # if backend changed
```

## Development

```bash
nix-shell

# Terminal 1
cd backend && uvicorn main:app --reload

# Terminal 2
cd frontend && npm run dev
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
4. Browse **Readers** and **Papers** to see other nooks and everyone's ratings
5. On any paper, **call for a seminar** — every reader of it gets notified in
   their Inbox
6. A reader answers to lead, and everyone coordinates in the **room**:
   availability, discussion, then the leader announces the time and platform
7. The floating **Feedback** button in the bottom-right corner reports a bug
   or asks for a feature from wherever you are — open to visitors too. Each report is stored in the
   `feedback` table, lands in every admin's inbox, and is emailed to the
   admins right away when SMTP is configured; admins work through them on
   the admin page
