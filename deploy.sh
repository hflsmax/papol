#!/usr/bin/env bash
# Papol's deployment, all of it.
#
#   ./deploy.sh dev            run development here, rebuilding as you save
#   ./deploy.sh prod [ref]     promote a ref (default: main) to production
#   ./deploy.sh pull           copy production's data down to development
#   ./deploy.sh status         what is running where
#
# Code goes up with `prod`, data comes down with `pull`, and neither ever
# runs the other way.
#
# Production is deployed and stays up; development is a server that runs for
# as long as you leave this command running. Production is a checkout of its
# own under /srv/papol/prod, served by papol.service. The two share a host
# and a GROBID container and nothing else: separate databases, separate
# uploads, separate .env.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PAPOL_PROD_DIR:-/srv/papol/prod}"
DEV_PORT="${PAPOL_DEV_PORT:-8000}"
PROD_BRANCH=production
UNIT=papol
KEEP_BACKUPS=10

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# Root, without hanging. A deploy run by a cron job or an agent has nobody
# to type a password at, and sudo waiting on a stdin that will never answer
# looks exactly like a deploy that is still working.
#
# `sudo -l CMD` cannot be asked this: once the user has any NOPASSWD rule at
# all it lists without a password and answers 0 for anything the wheel rule
# permits, password or not. So try it with -n, which refuses rather than
# prompts, and tell sudo saying no apart from the command saying no.
as_root() {
  local err status
  err=$(mktemp)
  if sudo -n "$@" 2>"$err"; then rm -f "$err"; return 0; fi
  status=$?

  if ! grep -q "password is required" "$err"; then
    cat "$err" >&2          # the command itself failed; that is its news
    rm -f "$err"
    return "$status"
  fi
  rm -f "$err"

  # sudo refused before running anything, so there is nothing to undo.
  if [ -t 0 ]; then
    sudo "$@"
  else
    die "needs root, sudo wants a password, and there is no terminal to type it at:
        sudo $*
    Run it from a terminal, or add it to services.papol.deploy.passwordless."
  fi
}

# --- building ---------------------------------------------------------------

# The two Vite apps. `npm ci` only when the lockfile has moved on: a deploy
# that changes no dependency should not spend a minute proving it.
build_tree() {
  local dir=$1 app
  for app in frontend viewer; do
    say "Building $app ($dir)"
    if [ ! -d "$dir/$app/node_modules" ] \
       || [ "$dir/$app/package-lock.json" -nt "$dir/$app/node_modules" ]; then
      note "dependencies changed — npm ci"
      (cd "$dir" && nix develop --command bash -c "cd $app && npm ci")
    fi
    if [ "$dir" = "$PROD_DIR" ] && [ "$app" = frontend ]; then
      (cd "$dir" && nix develop --command bash -c "cd frontend && VITE_BASE=/papol/ npm run build")
    else
      (cd "$dir" && nix develop --command bash -c "cd $app && npm run build")
    fi
  done
}

# --- development -------------------------------------------------------------

# Bound, by anyone. dev_is_up asks whether papol is answering; this asks the
# blunter question, which is the one that matters before binding it again.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

WATCH_PIDS=()

# Killing the group is the polite way and usually enough. It is not
# guaranteed, though: npm and nix each get a say in how the processes below
# them are grouped, and a watcher that ends up in a group of its own
# survives a signal aimed at its parent's. Since the thing left behind
# rebuilds into a directory the next run is about to serve, the sweep
# afterwards is worth the two lines.
stop_watchers() {
  local p
  [ "${#WATCH_PIDS[@]}" -eq 0 ] && return 0
  for p in "${WATCH_PIDS[@]}"; do
    kill -TERM -"$p" 2>/dev/null || true
  done
  WATCH_PIDS=()
  sleep 1
  kill -TERM $(pgrep -f 'vite build --watch' || true) 2>/dev/null || true
}

# Anything left rebuilding into dist from a run that is already over. Two
# watchers on one directory is worse than none: they take turns writing the
# same files and which one you are looking at is a race.
kill_stray_watchers() {
  local found
  found=$(pgrep -f 'vite build --watch' || true)
  [ -z "$found" ] && return 0
  note "an earlier watcher is still running — stopping it first"
  kill -TERM $found 2>/dev/null || true
  sleep 1
  kill -KILL $(pgrep -f 'vite build --watch' || true) 2>/dev/null || true
}

# One app's watcher, kept alive for as long as this run lasts.
#
# The loop is the point. A watcher is the only thing standing between a
# saved file and what papol.local hands out, and when one dies nothing says
# so — the server keeps serving, the page keeps loading, and every change
# made from then on is invisible. That is a silent failure and an expensive
# one: it costs you an afternoon of believing your own source.
#
# So a watcher that stops is restarted and complained about. `stop` is set
# by the trap when this run is ending, which is the one case where a
# watcher exiting is not news.
watch_app() {
  local app=$1 stop=no
  trap 'stop=yes' TERM INT
  while [ "$stop" = no ]; do
    # `|| true`: under pipefail this pipeline's exit status is whatever
    # killed the watcher, and set -e would otherwise take this whole
    # function down right here — silently, before the restart below ever
    # runs. That is the failure mode this loop exists to avoid.
    nix develop "$DEV_DIR" --command bash -c \
      "cd '$DEV_DIR/$app' && npm run build -- --watch" 2>&1 | sed -u "s/^/[$app] /" || true
    [ "$stop" = yes ] && break
    note "[$app] watcher stopped on its own — restarting"
    sleep 2
  done
}

# What the server on 8000 hands out is dist, not source, so saving a file
# changes nothing until something rebuilds it. `vite build --watch` is that
# something: it rebuilds on save, and the next page load is the new code.
#
# `set -m` gives each watcher a process group of its own. Ctrl-C then does
# not reach them — which is the point, because it means Ctrl-C reaches the
# server first and the trap below takes the watchers down whole, nix develop
# and npm and vite together, instead of orphaning vite to rebuild into a
# directory nobody is serving any more.
#
# Each watcher is backgrounded as a plain function call and not as a
# pipeline, which matters more than it looks. After `cmd | sed &`, `$!` is
# the pid of *sed* — while the process group `set -m` made is led by the
# first command in the pipeline. `kill -TERM -$!` then names a group that
# does not exist, the trap above quietly does nothing, and the watchers are
# left orphaned onto init to go on rebuilding into a directory nobody is
# serving. That is what used to happen here. A function call has one pid,
# it leads its own group, and the pipe now lives inside it where it cannot
# confuse the bookkeeping.
start_watchers() {
  local app
  kill_stray_watchers
  set -m
  for app in frontend viewer; do
    watch_app "$app" &
    WATCH_PIDS+=($!)
  done
  set +m
  trap stop_watchers EXIT INT TERM
}

# Development, in the foreground, for as long as this command runs. Nothing
# is installed and nothing survives Ctrl-C — which is the whole difference
# between this and production.
run_dev() {
  local build=yes watch=yes
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-build) build=no ;;
      --no-watch) watch=no ;;
      *) die "unknown option: $1 (--no-build, --no-watch)" ;;
    esac
    shift
  done

  if port_busy "$DEV_PORT"; then
    die "something already has port $DEV_PORT.
    If that is still production, it has not been moved to 8001 yet — see the
    services.papol lines in /etc/nixos/configuration.nix."
  fi

  # papol.local reaches this server, and this server hands out whatever is
  # in the two dist directories. Building first is what makes the name show
  # the code you are working on.
  [ "$build" = yes ] && build_tree "$DEV_DIR"

  # .env carries development's mail sink, and nothing here guarantees direnv
  # loaded it. Papol reads the environment before the settings table, so a
  # shell without this file mails real readers through the credentials in a
  # database copied from production. Read it directly rather than hope.
  if [ -e "$DEV_DIR/.env" ]; then
    set -a; . "$DEV_DIR/.env"; set +a
  fi
  if [ "${SMTP_HOST:-}" = "" ]; then
    note "warning: no SMTP_HOST in .env — this server can send real email"
  fi

  # Development and production share the host's GROBID container. The
  # production systemd unit receives this URL from module.nix; development
  # is a foreground process, so give it the same service automatically when
  # the standard localhost endpoint is alive. An explicit .env value still
  # wins for anyone running GROBID elsewhere.
  if [ "${GROBID_URL:-}" = "" ] &&
      [ "$(curl -fsS --max-time 2 http://127.0.0.1:8070/api/isalive 2>/dev/null || true)" = "true" ]; then
    export GROBID_URL=http://127.0.0.1:8070
    note "using the shared GROBID analyzer on 127.0.0.1:8070"
  fi

  [ "$watch" = yes ] && start_watchers

  say "Development on http://127.0.0.1:$DEV_PORT, and http://papol.local on the LAN"
  if [ "$watch" = yes ]; then
    note "saving a file rebuilds it: backend reloads itself, frontend and"
    note "viewer rebuild into dist — reload the page to see them"
  else
    note "not watching; backend still reloads itself"
  fi
  note "For hot reload without a page refresh, npm run dev gives you 5173/5174."
  note "Ctrl-C stops everything."
  echo

  # Not exec: this shell has to outlive the server to take the watchers with
  # it on the way out.
  cd "$DEV_DIR/backend"
  nix develop "$DEV_DIR" --command \
    uvicorn main:app --reload --host 127.0.0.1 --port "$DEV_PORT"
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
  [ -e "$PROD_DIR/.git" ] && return 0

  say "Creating $PROD_DIR"
  if [ ! -d "$(dirname "$PROD_DIR")" ]; then
    note "needs root once, to make the directory"
    as_root install -d -o "$(id -un)" -g "$(id -gn)" "$(dirname "$PROD_DIR")"
  fi
  if git -C "$DEV_DIR" rev-parse --verify -q "$PROD_BRANCH" >/dev/null; then
    git -C "$DEV_DIR" worktree add "$PROD_DIR" "$PROD_BRANCH"
  else
    git -C "$DEV_DIR" worktree add "$PROD_DIR" -b "$PROD_BRANCH" "${1:-main}"
  fi

  say "Seeding production state from $DEV_DIR"
  local f
  for f in backend/papol.db .env; do
    if [ -e "$DEV_DIR/$f" ] && [ ! -e "$PROD_DIR/$f" ]; then
      cp -p "$DEV_DIR/$f" "$PROD_DIR/$f"
      note "copied $f"
    fi
  done

  # Development's .env points mail at a dead port, and the environment wins
  # over the settings table — so seeding that line into production is how
  # you notice, weeks later, that nobody has had an email. Production keeps
  # the rest of the file and gets its SMTP from the database, as before.
  if [ -e "$PROD_DIR/.env" ] && grep -q '^SMTP_HOST=localhost$' "$PROD_DIR/.env"; then
    sed -i '/^SMTP_HOST=localhost$/d; /^SMTP_PORT=1025$/d; /^SMTP_STARTTLS=0$/d' \
      "$PROD_DIR/.env"
    note "dropped development's mail sink from production's .env"
  fi
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
  local rebuild=no running
  if [ "$old" != "$rev" ] \
     && ! git -C "$PROD_DIR" diff --quiet "$old" "$rev" -- module.nix flake.nix flake.lock; then
    rebuild=yes
    note "module.nix or flake.nix changed — this deploy rebuilds the system"
  fi
  # And the unit may not be this checkout's yet at all: on the first
  # promotion nothing tracked has changed, but everything has.
  running=$(systemctl show "$UNIT" -p WorkingDirectory --value 2>/dev/null || true)
  if [ "$running" != "$PROD_DIR/backend" ]; then
    rebuild=yes
    note "the unit still serves from ${running:-nowhere} — this deploy rebuilds the system"
  fi

  say "Stopping $UNIT"
  as_root systemctl stop "$UNIT"

  # Taken with the service down, and immediately before the new backend
  # runs its startup migrations — which is the thing a backup is for.
  if [ -e "$PROD_DIR/backend/papol.db" ]; then
    local bak="$PROD_DIR/backend/papol.db.bak-$(date +%F-%H%M%S)-pre-deploy"
    cp -p "$PROD_DIR/backend/papol.db" "$bak"
    note "database backed up to $(basename "$bak")"
    ls -1t "$PROD_DIR"/backend/papol.db.bak-*-pre-deploy 2>/dev/null \
      | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -- || true
  fi

  # From here production is down, so nothing may exit without either
  # bringing it back or saying plainly that it could not. A rebuild is
  # exactly where this bites: it runs when module.nix moved, and a
  # module.nix that does not evaluate is the likeliest reason for it to
  # fail — which would otherwise end the deploy with a stopped service and
  # a stack trace about Nix.
  if [ "$rebuild" = yes ]; then
    say "nixos-rebuild switch"
    if ! as_root nixos-rebuild switch; then
      note "the rebuild failed — putting the old service back"
      as_root systemctl start "$UNIT" \
        || die "the rebuild failed AND $UNIT would not start. Production is down.
    The database is untouched, backed up beside it, and the checkout is at
    $(git -C "$PROD_DIR" rev-parse --short HEAD); putting the code back is
    git -C $PROD_DIR reset --hard $old"
      die "the rebuild failed; the previous service is running again, from the
    new checkout. Fix module.nix or flake.nix and deploy again."
    fi
  else
    say "Starting $UNIT"
    as_root systemctl start "$UNIT" || die "$UNIT would not start. Production is down.
    journalctl -u $UNIT is where it says why; the pre-deploy database backup
    is beside the database."
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
    if curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:$port/"; then
      note "production is answering on $port"
      return 0
    fi
    sleep 1
  done

  printf '\n'
  as_root journalctl -u "$UNIT" -n 30 --no-pager
  die "production did not come up — the log is above, and the database backup is beside it"
}

# --- pulling production's data down ------------------------------------------

dev_is_up() {
  curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$DEV_PORT/" 2>/dev/null
}

# The dev shell carries sqlite3; a shell that skipped direnv does not.
sqlite() {
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$@"
  else
    (cd "$DEV_DIR" && nix develop --command sqlite3 "$@")
  fi
}

# Development gets production's database and PDFs so that a change can be
# tried against the real thing — the paper that renders oddly, the nook with
# a hundred entries. It is also how a schema change is rehearsed: the copy
# is at production's schema, and development's `migrate()` runs over it on
# the next start, which is exactly what the next deploy will do for real.
pull_prod() {
  local uploads=yes
  case "${1:-}" in
    --no-uploads) uploads=no ;;
    "") ;;
    *) die "unknown option: $1 (only --no-uploads)" ;;
  esac

  [ "$DEV_DIR" = "$PROD_DIR" ] && die "development and production are the same tree"
  [ -e "$PROD_DIR/backend/papol.db" ] \
    || die "no production database at $PROD_DIR/backend/papol.db"

  # A running server holds the file open, and writing a new database over
  # one that is being read is how you get half of each.
  dev_is_up && die "the development server is answering on $DEV_PORT — stop it first"

  if [ -e "$DEV_DIR/backend/papol.db" ]; then
    local bak="$DEV_DIR/backend/papol.db.bak-$(date +%F-%H%M)-pre-pull"
    cp -p "$DEV_DIR/backend/papol.db" "$bak"
    say "Kept development's database as $(basename "$bak")"
  fi

  # .backup rather than cp: production is serving readers while this runs,
  # and the backup API takes a consistent snapshot of a live database.
  say "Copying production's database"
  rm -f "$DEV_DIR/backend/papol.db"
  sqlite "$PROD_DIR/backend/papol.db" ".backup '$DEV_DIR/backend/papol.db'"
  note "$(du -h "$DEV_DIR/backend/papol.db" | cut -f1)"

  # The two things that must not make the trip. Development's .env already
  # points SMTP at a dead port, but that only holds in a shell that loaded
  # it; the credentials are gone from the copy either way. site_url would
  # otherwise put production's address in links generated here.
  say "Scrubbing production's reach out of the copy"
  sqlite "$DEV_DIR/backend/papol.db" <<SQL
DELETE FROM settings WHERE key LIKE 'smtp_%';
-- Upsert, not UPDATE: a production database without a site_url row would
-- leave this a silent no-op, and _site_url then falls through PAPOL_URL
-- (unset here) to a default that points at production. Development would
-- put production's address in every link it generated.
INSERT INTO settings (key, value) VALUES ('site_url', 'http://papol.local/')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
SQL
  note "SMTP credentials dropped; site_url now points at development"

  if [ "$uploads" = yes ]; then
    say "Syncing uploads"
    rsync -a --delete "$PROD_DIR/uploads/" "$DEV_DIR/uploads/"
    note "$(du -sh "$DEV_DIR/uploads" | cut -f1)"
  else
    note "uploads left alone — papers whose PDF is only in production will 404"
  fi

  say "Done. Start development and it will migrate the copy to this tree's schema."
}

# --- status -----------------------------------------------------------------

status() {
  local port; port=$(prod_port)
  say "development — $DEV_DIR"
  note "$(git -C "$DEV_DIR" log -1 --oneline 2>/dev/null || echo 'not a checkout')"
  if dev_is_up; then
    note "running on $DEV_PORT, and http://papol.local reaches it"
  else
    note "not running (./deploy.sh dev)"
  fi

  say "production — $PROD_DIR"
  if [ -e "$PROD_DIR/.git" ]; then
    note "$(git -C "$PROD_DIR" log -1 --oneline)"
  else
    note "not created yet (./deploy.sh prod)"
  fi
  note "$(systemctl is-active "$UNIT" 2>/dev/null || true) — $UNIT${port:+ on $port}"
}

# --- ------------------------------------------------------------------------

case "${1:-}" in
  dev)    shift; run_dev "$@" ;;
  prod)   deploy_prod "${2:-main}" ;;
  pull)   pull_prod "${2:-}" ;;
  status) status ;;
  ""|-h|--help) usage ;;
  *)      die "unknown target: $1 (try dev, prod, pull, status)" ;;
esac
