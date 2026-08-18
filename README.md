# Papol - A Nook for Every Reader

A webapp for documenting PDF papers with automatic DOI/metadata extraction, now with
a social layer: every reader gets a **nook** for the papers they read, anyone can
**call for a seminar** on a paper — notifying all its readers — and whoever answers
to lead plans it in a **room** (availability, platform, discussion). See
[USER_STORIES.md](USER_STORIES.md) for the full feature set.

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

1. Register with your email, display name, and affiliation — or continue as a
   guest to browse read-only (existing databases are migrated automatically;
   papers created before the social upgrade have no owner and won't appear in
   any nook)
2. In **My nook**, drop a PDF on the upload area, review/edit auto-extracted
   metadata, rate the paper (expertise / reading depth / merit), and save
3. Browse **Readers** and **Papers** to see other nooks and everyone's ratings
4. On any paper, **call for a seminar** — every reader of it gets notified in
   their Inbox
5. A reader answers to lead, and everyone coordinates in the **room**:
   availability, discussion, then the leader announces the time and platform
