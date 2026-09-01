#!/usr/bin/env bash
# Papol's deployment, all of it.
#
#   ./deploy.sh dev            run development here, rebuilding as you save
#   ./deploy.sh prod [ref]     promote a ref, then sync data (default: main)
#                  [--no-sync] deploy code without the usual data sync
#   ./deploy.sh sync           publish admin dev data, then refresh from prod
#   ./deploy.sh status         what is running where
#
# Code goes up with `prod`, then admin development data goes up and the
# resulting production data comes back down. `sync` runs that data step alone.
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

confirm_deploy() {
  local sync=${1:-yes} answer action="Deploy this revision to production"
  [ "$sync" = yes ] && action="$action, then synchronize data"
  [ -t 0 ] || die "production deployment requires confirmation from a terminal"
  printf '\n%s? [y/N] ' "$action"
  IFS= read -r answer || die "deployment confirmation was not received"
  case "$answer" in
    y|Y|yes|YES|Yes) ;;
    *) die "deployment cancelled" ;;
  esac
}

usage() {
  sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

# The three Vite apps. `npm ci` only when the lockfile has moved on: a deploy
# that changes no dependency should not spend a minute proving it.
build_tree() {
  local dir=$1 app
  for app in frontend viewer board; do
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
BACKEND_PID=

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

stop_dev() {
  if [ -n "$BACKEND_PID" ]; then
    kill -TERM "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    BACKEND_PID=
  fi
  stop_watchers
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
    # A watch process performs a full build as soon as it starts. Preserve
    # the synchronous build already being served while that first pass runs;
    # otherwise Vite briefly removes dist/assets and a simultaneous backend
    # reload cannot import its StaticFiles mounts.
    nix develop "$DEV_DIR" --command bash -c \
      "cd '$DEV_DIR/$app' && npm run build -- --watch --emptyOutDir false" 2>&1 | sed -u "s/^/[$app] /" || true
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
  for app in frontend viewer board; do
    watch_app "$app" &
    WATCH_PIDS+=($!)
  done
  set +m
  trap stop_dev EXIT INT TERM
}

# Uvicorn's reload parent does not exit when a newly spawned application
# process fails to import. Keep checking the listening socket so that such a
# failure ends this command, instead of leaving a healthy-looking reloader and
# three frontend watchers running forever.
run_backend() {
  local missed=0 backend_pid status

  cd "$DEV_DIR/backend"
  nix develop "$DEV_DIR" --command \
    uvicorn main:app --reload --host 127.0.0.1 --port "$DEV_PORT" &
  backend_pid=$!
  BACKEND_PID=$backend_pid

  while kill -0 "$backend_pid" 2>/dev/null; do
    # The reload parent owns the listening socket, so probing the port cannot
    # distinguish it from a live application. Its spawn child is the process
    # that actually imported and serves main:app.
    if pgrep -P "$backend_pid" -f 'multiprocessing.spawn' >/dev/null; then
      missed=0
    else
      missed=$((missed + 1))
      # Normal reloads briefly replace the worker. Ten half-second misses leave
      # room for that while still turning a dead worker into a failed deploy.
      if [ "$missed" -ge 10 ]; then
        note "backend stopped answering during startup or reload"
        kill -TERM "$backend_pid" 2>/dev/null || true
        wait "$backend_pid" 2>/dev/null || true
        BACKEND_PID=
        return 1
      fi
    fi
    sleep 0.5
  done

  if wait "$backend_pid"; then status=0; else status=$?; fi
  BACKEND_PID=
  return "$status"
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
  # in the three dist directories. Building first is what makes the name show
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

  # Uvicorn's reload supervisor deliberately stays alive when its worker
  # cannot import the application. That is useful after a bad edit, but at
  # startup it makes a failed deployment look healthy. Import once in the
  # foreground so missing builds and every other startup error end this run
  # before watchers or the reload supervisor are launched.
  (cd "$DEV_DIR/backend" && nix develop "$DEV_DIR" --command python -c 'import main')

  [ "$watch" = yes ] && start_watchers
  # start_watchers installs this too, but --no-watch still needs Ctrl-C and
  # shell exit to reap the now-supervised background server.
  trap stop_dev EXIT INT TERM

  say "Development on http://127.0.0.1:$DEV_PORT, and http://papol.local on the LAN"
  if [ "$watch" = yes ]; then
    note "saving a file rebuilds it: backend reloads itself; frontend, viewer,"
    note "and board rebuild into dist — reload the page to see them"
  else
    note "not watching; backend still reloads itself"
  fi
  note "For hot reload without a page refresh, npm run dev gives you 5173–5175."
  note "Ctrl-C stops everything."
  echo

  # This shell outlives the server so it can detect a dead reload worker and
  # take the asset watchers with it on the way out.
  run_backend
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
  if [ -d "$DEV_DIR/board_uploads" ] && [ ! -d "$PROD_DIR/board_uploads" ]; then
    cp -a "$DEV_DIR/board_uploads" "$PROD_DIR/board_uploads"
    note "copied board_uploads/"
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
  local ref=main sync=yes ref_set=no arg
  for arg in "$@"; do
    case "$arg" in
      --no-sync) sync=no ;;
      -*) die "unknown prod option: $arg (only --no-sync)" ;;
      *)
        [ "$ref_set" = no ] || die "prod takes one ref (default: main)"
        ref=$arg
        ref_set=yes
        ;;
    esac
  done
  [ "$DEV_DIR" = "$PROD_DIR" ] && die "run this from your working tree, not from production"

  init_prod "$ref"
  check_system_config
  if [ "$sync" = yes ] && dev_is_up; then
    die "the development server is answering on $DEV_PORT — stop it before the default production deploy, or use --no-sync"
  fi

  [ -n "$(git -C "$PROD_DIR" status --porcelain)" ] \
    && die "$PROD_DIR has uncommitted changes; production is a checkout, not a workspace"

  local rev old
  rev=$(git -C "$DEV_DIR" rev-parse --verify "$ref^{commit}") \
    || die "no such ref: $ref"
  old=$(git -C "$PROD_DIR" rev-parse HEAD)

  if [ "$old" = "$rev" ]; then
    say "Production revision"
    note "current and target: $(git -C "$DEV_DIR" log -1 --oneline "$rev")"
  else
    say "Commits for $ref → production"
    note "current: $(git -C "$DEV_DIR" log -1 --oneline "$old")"
    note "target:  $(git -C "$DEV_DIR" log -1 --oneline "$rev")"
    git -C "$DEV_DIR" log --oneline --left-right "$old...$rev" 2>/dev/null \
      | sed -e 's/^</    remove /' -e 's/^>/    add    /' || true
  fi

  # Deploying something no remote has is allowed — it is a solo project —
  # but it should be said out loud, because production is then the only
  # copy of those commits.
  if git -C "$DEV_DIR" rev-parse --verify -q origin/main >/dev/null \
     && ! git -C "$DEV_DIR" merge-base --is-ancestor "$rev" origin/main; then
    note "note: $ref is ahead of origin/main — these commits are not pushed anywhere"
  fi

  confirm_deploy "$sync"

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
  [ "$sync" = yes ] && sync_data
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

# --- synchronizing development and production data ---------------------------

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

# An admin is the one person whose development nook is intentional data rather
# than a disposable copy of production. Publish each admin's profile and nook
# first, while retaining every production reader, then copy that combined
# database back to development. IDs deliberately have to agree: development
# begins as a production snapshot, and silently guessing after both sides have
# reused an ID could attach a private note to the wrong reader or paper.
sync_data() {
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
    local bak="$DEV_DIR/backend/papol.db.bak-$(date +%F-%H%M)-pre-sync"
    cp -p "$DEV_DIR/backend/papol.db" "$bak"
    say "Kept development's database as $(basename "$bak")"
  fi

  local prod_bak="$PROD_DIR/backend/papol.db.bak-$(date +%F-%H%M)-pre-sync"
  sqlite "$PROD_DIR/backend/papol.db" ".backup '$prod_bak'"
  say "Kept production's database as $(basename "$prod_bak")"

  # A column mismatch means development has code/schema that production does
  # not have yet. Deploy it first; SELECT * must never shuffle unlike rows.
  local table dev_cols prod_cols
  for table in users papers paper_editions edition_references edition_citations edition_links \
      tags copies copy_tags comments ink_strokes; do
    dev_cols=$(sqlite "$DEV_DIR/backend/papol.db" "PRAGMA table_info($table)" | cut -d'|' -f2)
    prod_cols=$(sqlite "$PROD_DIR/backend/papol.db" "PRAGMA table_info($table)" | cut -d'|' -f2)
    [ -n "$dev_cols" ] && [ "$dev_cols" = "$prod_cols" ] \
      || die "$table differs between development and production — deploy the schema first"
  done
  local required column
  for table in shelves boards board_groups board_items; do
    case "$table" in
      shelves) required="id user_id name color is_public is_default position created_at" ;;
      boards) required="id guid user_id shelf_id name description created_at updated_at" ;;
      board_groups) required="id board_id kind title header created_at" ;;
      board_items) required="id board_id group_id kind content excerpt_text file_path original_filename mime_type source_url source_label staged text_align position x y width deleted_at created_at" ;;
    esac
    for column in $required; do
      dev_cols=$(sqlite "$DEV_DIR/backend/papol.db" "SELECT 1 FROM pragma_table_info('$table') WHERE name='$column'")
      prod_cols=$(sqlite "$PROD_DIR/backend/papol.db" "SELECT 1 FROM pragma_table_info('$table') WHERE name='$column'")
      [ "$dev_cols" = 1 ] && [ "$prod_cols" = 1 ] \
        || die "$table.$column is missing — deploy the schema first"
    done
  done

  say "Publishing admin development data"
  sqlite "$PROD_DIR/backend/papol.db" <<SQL
.bail on
ATTACH DATABASE '$DEV_DIR/backend/papol.db' AS dev;
PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TEMP TABLE sync_admins (id INTEGER PRIMARY KEY);
INSERT INTO sync_admins SELECT id FROM dev.users WHERE is_admin = 1 AND deleted_at IS NULL;
CREATE TEMP TABLE sync_assert (ok INTEGER CHECK (ok = 1));
INSERT INTO sync_assert SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM sync_admins);
INSERT INTO sync_assert SELECT 0 WHERE EXISTS (
  SELECT 1 FROM sync_admins a
  LEFT JOIN users p ON p.id = a.id
  JOIN dev.users d ON d.id = a.id
  WHERE p.id IS NULL OR p.email <> d.email OR p.is_admin <> 1
);

-- Refuse an integer ID reused by somebody else while the two databases were
-- apart. User-owned foreign keys make overwriting such a row unrecoverable.
INSERT INTO sync_assert SELECT 0 WHERE EXISTS (
  SELECT 1 FROM dev.shelves d JOIN shelves p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.tags d JOIN tags p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.copies d JOIN copies p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.comments d JOIN comments p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.ink_strokes d JOIN ink_strokes p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.boards d JOIN boards p ON p.id=d.id
    WHERE d.user_id IN sync_admins AND p.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.board_items d JOIN board_items p ON p.id=d.id
    JOIN dev.boards db ON db.id=d.board_id JOIN boards pb ON pb.id=p.board_id
    WHERE db.user_id IN sync_admins AND pb.user_id NOT IN sync_admins
  UNION ALL SELECT 1 FROM dev.board_groups d JOIN board_groups p ON p.id=d.id
    JOIN dev.boards db ON db.id=d.board_id JOIN boards pb ON pb.id=p.board_id
    WHERE db.user_id IN sync_admins AND pb.user_id NOT IN sync_admins
);

-- Bring across shared paper/edition records needed by the admin's nook. A
-- matching ID must describe the same object; new ones can then retain all of
-- their reference-analysis rows and stable foreign keys.
CREATE TEMP TABLE sync_papers AS
  SELECT DISTINCT paper_id AS id FROM dev.copies WHERE user_id IN sync_admins;
CREATE TEMP TABLE sync_editions AS
  SELECT DISTINCT edition_id AS id FROM dev.copies
    WHERE user_id IN sync_admins AND edition_id IS NOT NULL
  UNION SELECT DISTINCT ignored_edition_id FROM dev.copies
    WHERE user_id IN sync_admins AND ignored_edition_id IS NOT NULL;
INSERT INTO sync_assert SELECT 0 WHERE EXISTS (
  SELECT 1 FROM sync_papers n JOIN dev.papers d ON d.id=n.id JOIN papers p ON p.id=n.id
  WHERE lower(coalesce(p.doi,'')) <> lower(coalesce(d.doi,'')) OR p.title <> d.title
);
INSERT INTO sync_assert SELECT 0 WHERE EXISTS (
  SELECT 1 FROM sync_editions n JOIN dev.paper_editions d ON d.id=n.id
    JOIN paper_editions p ON p.id=n.id
  WHERE coalesce(p.sha256,'') <> coalesce(d.sha256,'')
);

INSERT INTO papers SELECT d.* FROM dev.papers d JOIN sync_papers n ON n.id=d.id
  WHERE NOT EXISTS (SELECT 1 FROM papers p WHERE p.id=d.id);
INSERT INTO paper_editions SELECT d.* FROM dev.paper_editions d JOIN sync_editions n ON n.id=d.id
  WHERE NOT EXISTS (SELECT 1 FROM paper_editions p WHERE p.id=d.id);
INSERT INTO edition_references SELECT d.* FROM dev.edition_references d JOIN sync_editions n ON n.id=d.edition_id
  WHERE NOT EXISTS (SELECT 1 FROM edition_references p WHERE p.id=d.id);
INSERT INTO edition_citations SELECT d.* FROM dev.edition_citations d JOIN sync_editions n ON n.id=d.edition_id
  WHERE NOT EXISTS (SELECT 1 FROM edition_citations p WHERE p.id=d.id);
INSERT INTO edition_links SELECT d.* FROM dev.edition_links d JOIN sync_editions n ON n.id=d.edition_id
  WHERE NOT EXISTS (SELECT 1 FROM edition_links p WHERE p.id=d.id);

DELETE FROM copy_tags WHERE copy_id IN (SELECT id FROM copies WHERE user_id IN sync_admins)
  OR tag_id IN (SELECT id FROM tags WHERE user_id IN sync_admins);
DELETE FROM comments WHERE user_id IN sync_admins;
DELETE FROM ink_strokes WHERE user_id IN sync_admins;
DELETE FROM board_items WHERE board_id IN (SELECT id FROM boards WHERE user_id IN sync_admins);
DELETE FROM board_groups WHERE board_id IN (SELECT id FROM boards WHERE user_id IN sync_admins);
DELETE FROM boards WHERE user_id IN sync_admins;
DELETE FROM copies WHERE user_id IN sync_admins;
DELETE FROM tags WHERE user_id IN sync_admins;
DELETE FROM shelves WHERE user_id IN sync_admins;

INSERT OR REPLACE INTO users SELECT d.* FROM dev.users d JOIN sync_admins a ON a.id=d.id;
INSERT INTO shelves (id,user_id,name,color,is_public,is_default,position,created_at)
  SELECT d.id,d.user_id,d.name,d.color,d.is_public,d.is_default,d.position,d.created_at
  FROM dev.shelves d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO tags SELECT d.* FROM dev.tags d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO copies SELECT d.* FROM dev.copies d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO comments SELECT d.* FROM dev.comments d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO ink_strokes SELECT d.* FROM dev.ink_strokes d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO boards (id,guid,user_id,shelf_id,name,description,created_at,updated_at)
  SELECT d.id,d.guid,d.user_id,d.shelf_id,d.name,d.description,d.created_at,d.updated_at
  FROM dev.boards d JOIN sync_admins a ON a.id=d.user_id;
INSERT INTO board_groups (id,board_id,kind,title,header,created_at)
  SELECT d.id,d.board_id,d.kind,d.title,d.header,d.created_at
  FROM dev.board_groups d
  JOIN dev.boards b ON b.id=d.board_id JOIN sync_admins a ON a.id=b.user_id;
INSERT INTO board_items (
  id,board_id,group_id,kind,content,file_path,original_filename,mime_type,source_url,
  text_align,position,x,y,width,deleted_at,created_at,source_label,staged,excerpt_text
)
  SELECT d.id,d.board_id,d.group_id,d.kind,d.content,d.file_path,d.original_filename,
    d.mime_type,d.source_url,d.text_align,d.position,d.x,d.y,d.width,
    d.deleted_at,d.created_at,d.source_label,d.staged,d.excerpt_text
  FROM dev.board_items d
  JOIN dev.boards b ON b.id=d.board_id JOIN sync_admins a ON a.id=b.user_id;
INSERT INTO copy_tags SELECT d.* FROM dev.copy_tags d
  JOIN dev.copies c ON c.id=d.copy_id JOIN sync_admins a ON a.id=c.user_id;

COMMIT;
DETACH DATABASE dev;
SQL
  note "admin profiles and nooks are now in production"

  if [ "$uploads" = yes ]; then
    say "Publishing development uploads"
    rsync -a "$DEV_DIR/uploads/" "$PROD_DIR/uploads/"
    rsync -a "$DEV_DIR/board_uploads/" "$PROD_DIR/board_uploads/"
  fi

  # .backup takes a consistent snapshot while production continues serving.
  say "Refreshing development from production"
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
    say "Refreshing uploads from production"
    rsync -a --delete "$PROD_DIR/uploads/" "$DEV_DIR/uploads/"
    rsync -a --delete "$PROD_DIR/board_uploads/" "$DEV_DIR/board_uploads/"
    note "$(du -sh "$DEV_DIR/uploads" | cut -f1)"
  else
    note "uploads left alone — papers whose PDF is only in production will 404"
  fi

  say "Done. Admin data is in production; everyone is now current in development."
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
  prod)   shift; deploy_prod "$@" ;;
  sync)   sync_data "${2:-}" ;;
  status) status ;;
  ""|-h|--help) usage ;;
  *)      die "unknown target: $1 (try dev, prod, sync, status)" ;;
esac
