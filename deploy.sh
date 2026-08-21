#!/usr/bin/env bash
# Papol's deployment, all of it.
#
#   ./deploy.sh dev            build this working tree
#   ./deploy.sh prod [ref]     promote a ref (default: main) to production
#   ./deploy.sh status         what is running where
#
# Development runs from this tree, by hand, on port 8000. Production runs
# from a checkout of its own under /srv/papol/prod, as papol.service, on
# the port that tree's module.nix gives it. They share a host and a GROBID
# container and nothing else — separate databases, separate uploads,
# separate .env. Promoting is the only thing that moves code between them.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PAPOL_PROD_DIR:-/srv/papol/prod}"
PROD_BRANCH=production
UNIT=papol
KEEP_BACKUPS=10

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- building ---------------------------------------------------------------

# The two Vite apps, built in whichever tree is given. `npm ci` only when
# the lockfile has moved on: a deploy that changes no dependency should not
# spend a minute proving it.
build_tree() {
  local dir=$1 app
  for app in frontend viewer; do
    say "Building $app ($dir)"
    if [ ! -d "$dir/$app/node_modules" ] \
       || [ "$dir/$app/package-lock.json" -nt "$dir/$app/node_modules" ]; then
      note "dependencies changed — npm ci"
      (cd "$dir" && nix develop --command bash -c "cd $app && npm ci")
    fi
    (cd "$dir" && nix develop --command bash -c "cd $app && npm run build")
  done
}

# --- production -------------------------------------------------------------

# The port the running unit was actually given, rather than a copy of it
# kept here that could drift from module.nix.
prod_port() {
  systemctl cat "$UNIT" 2>/dev/null \
    | sed -n 's/.*ExecStart=.*--port \([0-9]\+\).*/\1/p' | head -1
}

# First run: the worktree, and the state production starts life with. The
# database and uploads are copied from this tree only when production has
# none — today they are one and the same service, and this is the moment
# they stop being.
init_prod() {
  [ -d "$PROD_DIR/.git" ] && return 0

  say "Creating $PROD_DIR"
  if [ ! -d "$(dirname "$PROD_DIR")" ]; then
    note "needs root once, to make the directory"
    sudo install -d -o "$(id -un)" -g "$(id -gn)" "$(dirname "$PROD_DIR")"
  fi
  git -C "$DEV_DIR" worktree add "$PROD_DIR" -b "$PROD_BRANCH" "${1:-main}"

  say "Seeding production state from $DEV_DIR"
  local f
  for f in backend/papol.db .env; do
    if [ -e "$DEV_DIR/$f" ] && [ ! -e "$PROD_DIR/$f" ]; then
      cp -p "$DEV_DIR/$f" "$PROD_DIR/$f"
      note "copied $f"
    fi
  done
  if [ -d "$DEV_DIR/uploads" ] && [ ! -d "$PROD_DIR/uploads" ]; then
    cp -a "$DEV_DIR/uploads" "$PROD_DIR/uploads"
    note "copied uploads/"
  fi
  chmod 600 "$PROD_DIR/.env" 2>/dev/null || true

  cat <<MSG

    Production now has its own copy of the database, the uploads and the
    secrets. What is left in $DEV_DIR is development's, and diverges from
    here on. Two things to do to it, once:

      - point SMTP at a sink in .env, so development cannot mail readers
        (SMTP_HOST=localhost, SMTP_PORT=1025, SMTP_STARTTLS=0)
      - PAPOL_URL, if you want development's links to say so
MSG
}

# Is the system still configured against the old, in-tree service?
check_system_config() {
  local nixos=/etc/nixos/configuration.nix
  grep -q "$PROD_DIR" "$nixos" 2>/dev/null && return 0
  cat <<MSG

$nixos still runs papol from a source tree rather than from
$PROD_DIR. Until it points here, a deploy moves files that
nothing reads. Replace the papol lines with:

  imports = [ $PROD_DIR/module.nix ];

  services.papol = {
    enable = true;
    srcDir = "$PROD_DIR";
    port = 8001;          # development keeps 8000, the one you type by hand
    hostAliasPort = 8000; # http://papol.local reaches development
    grobid.enable = true;
    contactEmail = "hflsmax@gmail.com";
    cloudflare = { enable = true; tunnelId = "9c2e5542-9cc6-407e-bd24-96890af50130"; };
  };

then run this again.
MSG
  exit 1
}

deploy_prod() {
  local ref=${1:-main}
  [ "$DEV_DIR" = "$PROD_DIR" ] && die "run this from your working tree, not from production"

  init_prod "$ref"
  check_system_config

  [ -n "$(git -C "$PROD_DIR" status --porcelain)" ] \
    && die "$PROD_DIR has uncommitted changes; production is a checkout, not a workspace"

  local rev old
  rev=$(git -C "$DEV_DIR" rev-parse --verify "$ref^{commit}") \
    || die "no such ref: $ref"
  old=$(git -C "$PROD_DIR" rev-parse HEAD)

  if [ "$old" = "$rev" ]; then
    note "production is already at $(git -C "$DEV_DIR" log -1 --oneline "$rev")"
  else
    say "Promoting $ref → production"
    git -C "$DEV_DIR" log --oneline "$old..$rev" 2>/dev/null | sed 's/^/    /' || true
  fi

  # Deploying something no remote has is allowed — it is a solo project —
  # but it should be said out loud, because production is then the only
  # copy of those commits.
  if git -C "$DEV_DIR" rev-parse --verify -q origin/main >/dev/null \
     && ! git -C "$DEV_DIR" merge-base --is-ancestor "$rev" origin/main; then
    note "note: $ref is ahead of origin/main — these commits are not pushed anywhere"
  fi

  git -C "$PROD_DIR" reset --hard "$rev" --quiet
  note "production is at $(git -C "$PROD_DIR" log -1 --oneline)"

  build_tree "$PROD_DIR"

  # module.nix and flake.nix describe the service itself, and the running
  # system reads them from this checkout. When they move, restarting is not
  # enough — the unit has to be rebuilt around them.
  local rebuild=no
  if [ "$old" != "$rev" ] \
     && ! git -C "$PROD_DIR" diff --quiet "$old" "$rev" -- module.nix flake.nix flake.lock; then
    rebuild=yes
    note "module.nix or flake.nix changed — this deploy rebuilds the system"
  fi

  say "Stopping $UNIT"
  sudo systemctl stop "$UNIT"

  # Taken with the service down, and immediately before the new backend
  # runs its startup migrations — which is the thing a backup is for.
  if [ -e "$PROD_DIR/backend/papol.db" ]; then
    local bak="$PROD_DIR/backend/papol.db.bak-$(date +%F-%H%M)-pre-deploy"
    cp -p "$PROD_DIR/backend/papol.db" "$bak"
    note "database backed up to $(basename "$bak")"
    ls -1t "$PROD_DIR"/backend/papol.db.bak-*-pre-deploy 2>/dev/null \
      | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --
  fi

  if [ "$rebuild" = yes ]; then
    say "nixos-rebuild switch"
    sudo nixos-rebuild switch
  else
    say "Starting $UNIT"
    sudo systemctl start "$UNIT"
  fi

  health_check
}

# The service is up when it serves the page — which also says the build
# landed, not just that uvicorn survived importing itself.
health_check() {
  local port; port=$(prod_port)
  [ -z "$port" ] && { note "could not read the unit's port; skipping the health check"; return 0; }

  say "Checking http://127.0.0.1:$port/"
  local i
  for i in $(seq 30); do
    if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$port/"; then
      note "production is answering on $port"
      return 0
    fi
    sleep 1
  done

  printf '\n'
  sudo journalctl -u "$UNIT" -n 30 --no-pager
  die "production did not come up — the log is above, and the database backup is beside it"
}

# --- status -----------------------------------------------------------------

status() {
  local port; port=$(prod_port)
  say "development — $DEV_DIR"
  note "$(git -C "$DEV_DIR" log -1 --oneline 2>/dev/null || echo 'not a checkout')"
  if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:8000/ 2>/dev/null; then
    note "running on 8000, and http://papol.local reaches it"
  else
    note "not running (cd backend && uvicorn main:app --reload)"
  fi

  say "production — $PROD_DIR"
  if [ -d "$PROD_DIR/.git" ]; then
    note "$(git -C "$PROD_DIR" log -1 --oneline)"
  else
    note "not created yet (./deploy.sh prod)"
  fi
  note "$(systemctl is-active "$UNIT" 2>/dev/null || true) — $UNIT${port:+ on $port}"
}

# --- ------------------------------------------------------------------------

case "${1:-}" in
  dev)    build_tree "$DEV_DIR"; say "Done. Development serves this build on 8000." ;;
  prod)   deploy_prod "${2:-main}" ;;
  status) status ;;
  ""|-h|--help) usage ;;
  *)      die "unknown target: $1 (try dev, prod, status)" ;;
esac
