#!/usr/bin/env bash
# Papol's deployment, all of it.
#
#   ./deploy.sh dev            run development here, rebuilding as you save
#   ./deploy.sh prod [ref]     promote a ref (default: main)
#   ./deploy.sh pull           overwrite development data from production
#   ./deploy.sh status         what is running where
#   ./deploy.sh macos dev      run the native app with Vite live reload
#                  [--backend URL] (default: http://127.0.0.1:8000)
#   ./deploy.sh macos prod     test, build, and install a production-backed app
#                  [--backend URL] [--universal] [--no-check] [--skip-notarize]
#                  loads .env.macos-notarization when present
#   ./deploy.sh macos credentials
#                  print the local signing/notarization values for GitHub
#   ./deploy.sh macos release [patch|minor|major|VERSION]
#                  bump, commit, tag, and push a macOS release
#
# Code goes up with `prod`. Data never goes from development to production;
# `pull` explicitly replaces development's database with production's.
#
# Production is deployed and stays up; development is a server that runs for
# as long as you leave this command running. Production is a checkout of its
# own under /srv/papol/prod, served by papol.service. The two share a host
# and a GROBID container and nothing else: separate databases, separate
# uploads, separate .env.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${PAPOL_PROD_DIR:-/srv/papol/prod}"
# Port 8000 is commonly occupied by local macOS tooling (including Codex),
# while Papol's NixOS development host intentionally reserves it for this
# server. Keep that established Linux default and make `./deploy.sh dev`
# immediately usable on a Mac; PAPOL_DEV_PORT remains an explicit override.
if [ "$(uname -s)" = Darwin ]; then
  DEFAULT_DEV_PORT=8001
else
  DEFAULT_DEV_PORT=8000
fi
DEV_PORT="${PAPOL_DEV_PORT:-$DEFAULT_DEV_PORT}"
PROD_BRANCH=production
UNIT=papol
KEEP_BACKUPS=10

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

confirm_deploy() {
  local answer action="Deploy this revision to production"
  [ -t 0 ] || die "production deployment requires confirmation from a terminal"
  printf '\n%s? [y/N] ' "$action"
  IFS= read -r answer || die "deployment confirmation was not received"
  case "$answer" in
    y|Y|yes|YES|Yes) ;;
    *) die "deployment cancelled" ;;
  esac
}

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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

  if [ "$dir" = "$PROD_DIR" ]; then
    say "Browser smoke test ($dir)"
    (cd "$dir/frontend" && npm run smoke:browser)
  fi
}

# --- macOS desktop ----------------------------------------------------------

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required for macOS desktop development"
}

# A local, ignored credential file lets a developer opt into Developer ID
# signing and notarization without putting secrets in this script, shell
# history, or the repository. Values already exported by the caller take the
# same path; the file is simply a convenient persistent source for them.
MACOS_NOTARIZING=no

# macOS's system Bash is still 3.2, so keep this deliberately simple: indexed
# arrays and the shell's monotonic-ish SECONDS counter, with no associative
# arrays or namerefs. The EXIT trap makes a failed build print the stages that
# completed and the time spent in the stage that failed.
MACOS_TIMING_LABELS=()
MACOS_TIMING_SECONDS=()
MACOS_TIMING_ACTIVE=
MACOS_TIMING_STARTED=0
MACOS_TIMING_TOTAL_STARTED=0

format_elapsed() {
  local elapsed=$1
  if [ "$elapsed" -ge 3600 ]; then
    printf '%dh %02dm %02ds' "$((elapsed / 3600))" "$(((elapsed % 3600) / 60))" "$((elapsed % 60))"
  elif [ "$elapsed" -ge 60 ]; then
    printf '%dm %02ds' "$((elapsed / 60))" "$((elapsed % 60))"
  else
    printf '%ds' "$elapsed"
  fi
}

macos_timing_begin() {
  MACOS_TIMING_ACTIVE=$1
  MACOS_TIMING_STARTED=$SECONDS
}

macos_timing_finish() {
  [ -n "$MACOS_TIMING_ACTIVE" ] || return 0
  MACOS_TIMING_LABELS+=("$MACOS_TIMING_ACTIVE")
  MACOS_TIMING_SECONDS+=("$((SECONDS - MACOS_TIMING_STARTED))")
  MACOS_TIMING_ACTIVE=
}

macos_timing_summary() {
  local index duration total
  total=$((SECONDS - MACOS_TIMING_TOTAL_STARTED))
  say "macOS pipeline timings"
  for ((index = 0; index < ${#MACOS_TIMING_LABELS[@]}; index++)); do
    duration=$(format_elapsed "${MACOS_TIMING_SECONDS[$index]}")
    printf '    %-34s %10s\n' "${MACOS_TIMING_LABELS[$index]}" "$duration"
  done
  printf '    %-34s %10s\n' "Total" "$(format_elapsed "$total")"
}

macos_timing_on_exit() {
  local status=$?
  macos_timing_finish
  macos_timing_summary
  return "$status"
}

load_macos_notarization() {
  local skip_notarize="${1:-no}" credentials_file permissions had_allexport=no
  credentials_file="${PAPOL_NOTARIZATION_ENV_FILE:-$DEV_DIR/.env.macos-notarization}"

  if [ -e "$credentials_file" ]; then
    [ -f "$credentials_file" ] || die "macOS notarization credentials are not a regular file: $credentials_file"
    permissions=$(/usr/bin/stat -f '%Lp' "$credentials_file")
    case "$permissions" in
      ?00) ;;
      *) die "macOS notarization credentials must not be readable by other users:
        chmod 600 $credentials_file" ;;
    esac

    case $- in *a*) had_allexport=yes ;; esac
    set -a
    # shellcheck disable=SC1090
    if ! source "$credentials_file"; then
      [ "$had_allexport" = yes ] || set +a
      die "could not load macOS notarization credentials from $credentials_file"
    fi
    [ "$had_allexport" = yes ] || set +a
  fi

  # No real signing identity means the existing ad-hoc local build. Supplying
  # any notarization credential without an identity is almost certainly a
  # configuration mistake, so fail instead of silently producing that build.
  if [ -z "${APPLE_SIGNING_IDENTITY:-}" ] || [ "$APPLE_SIGNING_IDENTITY" = - ]; then
    if [ -n "${APPLE_ID:-}${APPLE_PASSWORD:-}${APPLE_TEAM_ID:-}${APPLE_API_ISSUER:-}${APPLE_API_KEY:-}${APPLE_API_KEY_PATH:-}" ]; then
      die "notarization credentials were supplied without APPLE_SIGNING_IDENTITY"
    fi
    export APPLE_SIGNING_IDENTITY=-
    return 0
  fi

  if [ "$skip_notarize" = yes ]; then
    # Keep APPLE_SIGNING_IDENTITY so the app remains Developer ID signed, but
    # remove every authentication route Tauri recognizes for notarization.
    # Otherwise credentials loaded above would make `tauri bundle` submit even
    # though the caller explicitly asked for a local-only build.
    MACOS_NOTARIZING=no
    unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
    unset APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH
    return 0
  fi

  if [ -n "${APPLE_ID:-}${APPLE_PASSWORD:-}${APPLE_TEAM_ID:-}" ]; then
    [ -n "${APPLE_ID:-}" ] || die "APPLE_ID is missing from $credentials_file"
    [ -n "${APPLE_PASSWORD:-}" ] || die "APPLE_PASSWORD is missing from $credentials_file"
    [ -n "${APPLE_TEAM_ID:-}" ] || die "APPLE_TEAM_ID is missing from $credentials_file"
    MACOS_NOTARIZING=yes
  elif [ -n "${APPLE_API_ISSUER:-}${APPLE_API_KEY:-}${APPLE_API_KEY_PATH:-}" ]; then
    [ -n "${APPLE_API_ISSUER:-}" ] || die "APPLE_API_ISSUER is missing from $credentials_file"
    [ -n "${APPLE_API_KEY:-}" ] || die "APPLE_API_KEY is missing from $credentials_file"
    [ -n "${APPLE_API_KEY_PATH:-}" ] || die "APPLE_API_KEY_PATH is missing from $credentials_file"
    [ -f "$APPLE_API_KEY_PATH" ] || die "APPLE_API_KEY_PATH does not exist: $APPLE_API_KEY_PATH"
    MACOS_NOTARIZING=yes
  elif [ -e "$credentials_file" ]; then
    die "notarization authentication is missing from $credentials_file"
  fi
}

macos_credentials() {
  local credentials_file certificate_file certificate_password certificate_subject
  [ $# -eq 0 ] || die "macos credentials does not accept options"
  credentials_file="${PAPOL_NOTARIZATION_ENV_FILE:-$DEV_DIR/.env.macos-notarization}"
  certificate_file="${PAPOL_SIGNING_CERTIFICATE:-$DEV_DIR/.credentials/macos/developer-id.p12}"

  [ -f "$credentials_file" ] || die "cannot print credentials: $credentials_file does not exist"
  [ -f "$certificate_file" ] || die "cannot print credentials: $certificate_file does not exist"
  [ -t 0 ] || die "printing certificate credentials requires a terminal for the .p12 password prompt"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to verify $certificate_file"
  printf 'Developer ID .p12 export password: ' >&2
  IFS= read -r -s certificate_password
  printf '\n' >&2
  certificate_subject=$(openssl pkcs12 -in "$certificate_file" -clcerts -nokeys \
    -passin "pass:$certificate_password" 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null || true)
  case "$certificate_subject" in
    *"Developer ID Application:"*) ;;
    *) die "could not verify a Developer ID Application identity in $certificate_file" ;;
  esac
  load_macos_notarization
  printf 'APPLE_CERTIFICATE='
  base64 < "$certificate_file" | tr -d '\n'
  printf '\n'
  printf 'APPLE_CERTIFICATE_PASSWORD=%s\n' "$certificate_password"
  printf 'APPLE_SIGNING_IDENTITY=%s\n' "$APPLE_SIGNING_IDENTITY"
  printf 'APPLE_ID=%s\n' "${APPLE_ID:-}"
  printf 'APPLE_PASSWORD=%s\n' "${APPLE_PASSWORD:-}"
  printf 'APPLE_TEAM_ID=%s\n' "${APPLE_TEAM_ID:-}"
}

macos_release() {
  local requested="${1:-patch}" current version tag
  local desktop_package="$DEV_DIR/desktop/package.json"
  local desktop_lock="$DEV_DIR/desktop/package-lock.json"
  local tauri_config="$DEV_DIR/desktop/src-tauri/tauri.conf.json"
  # The crate carries the version the running application reports about
  # itself, so it moves with the rest. Its lock file holds the same number
  # and must move too, or every --locked build stops.
  local cargo_manifest="$DEV_DIR/desktop/src-tauri/Cargo.toml"
  local cargo_lock="$DEV_DIR/desktop/src-tauri/Cargo.lock"
  local -a version_files=(
    "desktop/package.json"
    "desktop/package-lock.json"
    "desktop/src-tauri/tauri.conf.json"
    "desktop/src-tauri/Cargo.toml"
    "desktop/src-tauri/Cargo.lock"
  )

  [ $# -le 1 ] || die "macos release accepts one version: patch, minor, major, or X.Y.Z"
  command -v node >/dev/null 2>&1 || die "node is required to prepare a macOS release"
  [ "$(git -C "$DEV_DIR" branch --show-current)" = main ] \
    || die "macos releases must be cut from the main branch"
  git -C "$DEV_DIR" diff --cached --quiet \
    || die "stage or unstage existing changes before cutting a release"
  git -C "$DEV_DIR" diff --quiet -- "${version_files[@]}" \
    || die "desktop version files have uncommitted changes"

  current=$(node -p "require('$desktop_package').version")
  if [[ ! $current =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    die "desktop version is not a stable semantic version: $current"
  fi
  case "$requested" in
    patch) version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))" ;;
    minor) version="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] + 1)).0" ;;
    major) version="$((BASH_REMATCH[1] + 1)).0.0" ;;
    *)
      [[ $requested =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
        || die "release version must be patch, minor, major, or X.Y.Z"
      version=$requested
      ;;
  esac
  [ "$version" != "$current" ] || die "desktop is already version $version"
  tag="macos-v$version"
  if git -C "$DEV_DIR" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    die "tag $tag already exists locally"
  fi
  if git -C "$DEV_DIR" ls-remote --exit-code --refs origin "refs/tags/$tag" >/dev/null 2>&1; then
    die "tag $tag already exists on origin"
  fi

  node - "$version" "$desktop_package" "$desktop_lock" "$tauri_config" \
    "$cargo_manifest" "$cargo_lock" <<'NODE'
const [version, packageFile, lockFile, tauriFile, cargoFile, cargoLockFile] =
  process.argv.slice(2);
const replace = (file, pattern) => {
  const source = require('node:fs').readFileSync(file, 'utf8');
  let count = 0;
  const updated = source.replace(pattern, (...parts) => {
    count += 1;
    return `${parts[1]}${version}${parts[2]}`;
  });
  if (count !== 1) throw new Error(`expected one version field in ${file}, found ${count}`);
  require('node:fs').writeFileSync(file, updated);
};
replace(packageFile, /^(  "version": ")[^"]+(",)$/m);
replace(lockFile, /^(  "version": ")[^"]+(",)$/m);
replace(lockFile, /^(      "version": ")[^"]+(",)$/m);
replace(tauriFile, /^(  "version": ")[^"]+(",)$/m);
// Only the crate's own [package] version sits at the start of a line; every
// dependency states its version indented or inline.
replace(cargoFile, /^(version = ")[^"]+(")$/m);
replace(cargoLockFile, /^(name = "papol-desktop"\nversion = ")[^"]+(")$/m);
NODE

  # A terminal makes diff open the pager even when it has nothing to say.
  git -C "$DEV_DIR" --no-pager diff --check
  git -C "$DEV_DIR" add -- "${version_files[@]}"
  git -C "$DEV_DIR" commit -m "Release Papol macOS v$version"
  git -C "$DEV_DIR" push origin main
  git -C "$DEV_DIR" tag -a "$tag" -m "Papol macOS v$version"
  git -C "$DEV_DIR" push origin "$tag"
  say "Published Papol macOS v$version"
}

# A previous interrupted desktop-dev run can leave one of the Vite children
# behind. Reclaim only Vite processes launched from this checkout; never kill
# an unrelated service that happens to use one of the development ports.
stop_existing_vite() {
  local port pid command attempt stopped
  for port in 5173 5174 5175; do
    while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      command=$(ps -p "$pid" -o command= 2>/dev/null || true)
      case "$command" in
        *"$DEV_DIR"/frontend/node_modules/.bin/vite*|*"$DEV_DIR"/viewer/node_modules/.bin/vite*|*"$DEV_DIR"/board/node_modules/.bin/vite*) ;;
        *) continue ;;
      esac
      say "Stopping previous Vite server on port $port"
      kill "$pid" 2>/dev/null || true
      stopped=no
      for attempt in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "$pid" 2>/dev/null || { stopped=yes; break; }
        sleep 0.1
      done
      if [ "$stopped" = no ]; then
        note "Vite did not exit cleanly; terminating it"
        kill -KILL "$pid" 2>/dev/null || true
      fi
    done < <(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u)
  done
}

# npm keeps the lockfile used to populate node_modules here. Comparing against
# that file avoids reinstalling on every run while still making a changed
# package.json or package-lock.json take effect before a build starts.
install_node_tree() {
  local dir=$1 marker expected staging backup
  marker="$dir/node_modules/.papol-package-input.sha256"
  expected=$(shasum -a 256 "$dir/package.json" "$dir/package-lock.json" | shasum -a 256 | cut -d' ' -f1)
  if [ -d "$dir/node_modules" ] && [ "$(cat "$marker" 2>/dev/null || true)" = "$expected" ]; then
    return 0
  fi

  # Adopt an existing valid tree on the first run. This is important on a
  # laptop that is temporarily offline, and `npm ls` still catches missing
  # or incompatible direct dependencies before a build starts.
  if [ -d "$dir/node_modules" ] && [ ! -e "$marker" ] \
     && (cd "$dir" && npm ls --depth=0 --ignore-scripts >/dev/null 2>&1); then
    printf '%s\n' "$expected" > "$marker"
    return 0
  fi

  say "Installing $(basename "$dir") dependencies"
  staging=$(mktemp -d "$dir/.papol-npm.XXXXXX")
  cp "$dir/package.json" "$dir/package-lock.json" "$staging/"
  if ! (cd "$staging" && npm ci); then
    rm -rf "$staging"
    die "dependency installation failed; the previous $(basename "$dir") node_modules was preserved"
  fi
  printf '%s\n' "$expected" > "$staging/node_modules/.papol-package-input.sha256"
  backup="$dir/.papol-node-modules-old.$$"
  if [ -d "$dir/node_modules" ]; then mv "$dir/node_modules" "$backup"; fi
  mv "$staging/node_modules" "$dir/node_modules"
  rm -rf "$staging" "$backup"
}

prepare_macos() {
  [ "$(uname -s)" = Darwin ] || die "the macos command must run on macOS"
  require_command node
  require_command npm
  require_command cargo
  require_command rustc
  require_command xcrun
  xcrun --show-sdk-path >/dev/null 2>&1 \
    || die "the Xcode Command Line Tools are missing; run: xcode-select --install"
  node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major === 20 ? +(minor < 19) : +(major < 22 || (major === 22 && minor < 12)))' \
    || die "Node.js 20.19+ or 22.12+ is required (found $(node --version))"

  # Tauri builds for the minimum declared in tauri.conf.json. Keep every Cargo
  # command in this process on that target too: Cargo fingerprints native C
  # dependencies by MACOSX_DEPLOYMENT_TARGET, so a plain release build that
  # inherits a newer SDK default otherwise invalidates Tauri's release cache.
  MACOSX_DEPLOYMENT_TARGET=$(node -p \
    "require('$DEV_DIR/desktop/src-tauri/tauri.conf.json').bundle.macOS.minimumSystemVersion")
  export MACOSX_DEPLOYMENT_TARGET

  if [ ! -x "$DEV_DIR/desktop/node_modules/.bin/tauri" ] \
     && ! cargo tauri --version >/dev/null 2>&1; then
    install_node_tree "$DEV_DIR/desktop"
  fi
  install_node_tree "$DEV_DIR/frontend"
  install_node_tree "$DEV_DIR/viewer"
  install_node_tree "$DEV_DIR/board"
}

# The UI suites do not share outputs, and Rust's test/lint pipeline has its own
# target directory. Run those four lanes together; keeping the Rust commands in
# one lane avoids making two cargo processes contend for the same build lock.
check_macos() {
  local logs failed=no failed_labels= index
  local -a pids labels
  logs=$(mktemp -d -t papol-macos-checks.XXXXXX)

  (cd "$DEV_DIR/frontend" && npm run test:unit) >"$logs/frontend" 2>&1 &
  pids+=("$!"); labels+=(frontend)
  (cd "$DEV_DIR/viewer" && npm test) >"$logs/viewer" 2>&1 &
  pids+=("$!"); labels+=(viewer)
  (cd "$DEV_DIR/board" && npm test) >"$logs/board" 2>&1 &
  pids+=("$!"); labels+=(board)
  (
    cd "$DEV_DIR/desktop"
    cargo fmt --check --manifest-path src-tauri/Cargo.toml \
      && cargo test --locked --manifest-path src-tauri/Cargo.toml \
      && cargo clippy --locked --manifest-path src-tauri/Cargo.toml \
        --all-targets --all-features -- -D warnings
  ) >"$logs/native" 2>&1 &
  pids+=("$!"); labels+=(native)

  for index in "${!pids[@]}"; do
    if wait "${pids[$index]}"; then
      note "${labels[$index]} checks passed"
    else
      printf '\n%s checks failed:\n' "${labels[$index]}" >&2
      cat "$logs/${labels[$index]}" >&2
      failed=yes
      failed_labels="${failed_labels:+$failed_labels, }${labels[$index]}"
    fi
  done
  if [ "$failed" = no ]; then
    rm -rf "$logs"
    return 0
  fi
  die "macOS application checks failed: $failed_labels
    Full logs were kept in $logs"
}

# create-dmg mounts a writable intermediate image while Finder lays out the
# installer window. An interrupted build can leave that image attached, and a
# previously opened output DMG can remain attached too. Both cases make a later
# bundle_dmg.sh run fail with only Tauri's generic "failed to run" message.
# Limit cleanup to images produced below this checkout's Tauri target directory;
# a volume named Papol from anywhere else is not ours to detach.
unmount_macos_build_images() {
  local target_root="$DEV_DIR/desktop/src-tauri/target/"
  local line image_path= device suffix attempt detached found=no failed=no

  while IFS= read -r line; do
    case "$line" in
      "image-path"*:*)
        image_path=${line#*: }
        ;;
      /dev/disk*)
        device=${line%%[[:space:]]*}
        suffix=${device#/dev/disk}
        # hdiutil lists the whole disk before its partitions. Detaching the
        # whole disk once avoids retrying each slice from the same image.
        case "$suffix" in
          ""|*[!0-9]*) continue ;;
        esac
        case "$image_path" in
          "$target_root"*) ;;
          *) continue ;;
        esac

        if [ "$found" = no ]; then
          say "Unmounting previous Papol build images"
          found=yes
        fi
        note "$device (${image_path#"$DEV_DIR/"})"
        detached=no
        for attempt in 1 2 3; do
          if hdiutil detach "$device" >/dev/null; then
            detached=yes
            break
          fi
          [ "$attempt" -eq 3 ] || sleep 1
        done
        if [ "$detached" = no ]; then
          note "warning: could not unmount $device"
          failed=yes
        fi
        ;;
    esac
  done < <(hdiutil info)

  [ "$failed" = no ]
}

valid_backend() {
  case "$1" in
    http://*|https://*) return 0 ;;
    *) die "backend must be an http:// or https:// URL: $1" ;;
  esac
}

macos_dev() {
  local backend="http://127.0.0.1:$DEV_PORT"
  while [ $# -gt 0 ]; do
    case "$1" in
      --backend)
        [ $# -ge 2 ] || die "--backend needs a URL"
        backend=$2
        shift
        ;;
      *) die "unknown macos dev option: $1 (only --backend URL)" ;;
    esac
    shift
  done
  valid_backend "$backend"
  prepare_macos

  stop_existing_vite
  local port
  for port in 5173 5174 5175; do
    port_busy "$port" && die "port $port is already in use; stop the existing Vite process first"
  done
  if ! curl -fs -o /dev/null --max-time 2 "$backend/" 2>/dev/null; then
    note "backend is not answering at $backend; cached/offline work remains available"
    note "start the backend separately when you need fresh server data"
  fi

  say "Papol macOS development"
  note "backend: $backend"
  note "frontend, viewer, and board use Vite live reload"
  note "Rust changes rebuild and relaunch the native app"
  note "Ctrl-C stops the app and all three Vite servers"
  if [ -x "$DEV_DIR/desktop/node_modules/.bin/tauri" ]; then
    (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" npm run dev)
  else
    (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" \
      cargo tauri dev --config src-tauri/tauri.dev.conf.json)
  fi
}

install_macos_app() {
  local source_app=$1 destination_app=/Applications/Papol.app
  local staging_dir staged_app previous_app bundle_executable attempt

  # Stage a complete bundle before touching the installed copy. Moving the
  # previous bundle aside makes the replacement exact (rather than merging
  # stale resources into it) and gives us something to restore if the final
  # move fails.
  staging_dir=$(mktemp -d -t papol-macos-install.XXXXXX)
  staged_app="$staging_dir/Papol.app"
  ditto "$source_app" "$staged_app" || {
    rm -rf "$staging_dir"
    die "could not stage the macOS application for installation"
  }
  bundle_executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
    "$staged_app/Contents/Info.plist" 2>/dev/null || true)
  case "$bundle_executable" in
    ""|*/*) bundle_executable= ;;
  esac
  [ -n "$bundle_executable" ] \
    && [ -x "$staged_app/Contents/MacOS/$bundle_executable" ] || {
    rm -rf "$staging_dir"
    die "the built Papol application has no executable"
  }

  # Replacing the bundle underneath a running process leaves `open` attached
  # to the old executable. Ask it to finish first, then refuse to proceed if
  # it has work that prevents it from quitting cleanly. The process name is
  # the bundle's executable (`papol-desktop` today), not its display name.
  if pgrep -x "$bundle_executable" >/dev/null 2>&1; then
    say "Closing the installed Papol application"
    osascript -e 'tell application id "com.mc-pony.papol" to quit' >/dev/null 2>&1 || true
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      pgrep -x "$bundle_executable" >/dev/null 2>&1 || break
      sleep 0.25
    done
    if pgrep -x "$bundle_executable" >/dev/null 2>&1; then
      rm -rf "$staging_dir"
      die "Papol is still running; quit it and run the macOS production build again"
    fi
  fi

  previous_app="/Applications/.Papol.previous.$$"
  if [ -e "$destination_app" ]; then
    as_root mv "$destination_app" "$previous_app"
  else
    previous_app=
  fi

  if ! as_root mv "$staged_app" "$destination_app"; then
    if [ -n "$previous_app" ] && [ -e "$previous_app" ]; then
      as_root mv "$previous_app" "$destination_app" \
        || note "warning: the previous app remains at $previous_app"
    fi
    rm -rf "$staging_dir"
    die "could not install Papol in /Applications"
  fi
  [ -z "$previous_app" ] || as_root rm -rf "$previous_app"
  rm -rf "$staging_dir"

  say "Installed Papol macOS"
  note "$destination_app"
  open "$destination_app"
}

macos_app_fingerprint() {
  local app=$1
  find "$app/Contents" -type f -exec shasum -a 256 {} + \
    | sed "s|  $app/|  |" \
    | LC_ALL=C sort \
    | shasum -a 256 \
    | cut -d' ' -f1
}

macos_prod() {
  local backend="https://mc-pony.com/papol" universal=no checks=yes skip_notarize=no
  local arg marker app dmg
  local app_hash cached_app_hash cached_dmg_hash dmg_hash dmg_marker bundle_root
  MACOS_TIMING_LABELS=()
  MACOS_TIMING_SECONDS=()
  MACOS_TIMING_ACTIVE=
  MACOS_TIMING_TOTAL_STARTED=$SECONDS
  trap macos_timing_on_exit EXIT

  while [ $# -gt 0 ]; do
    arg=$1
    case "$arg" in
      --backend)
        [ $# -ge 2 ] || die "--backend needs a URL"
        backend=$2
        shift
        ;;
      --universal) universal=yes ;;
      --no-check) checks=no ;;
      --skip-notarize) skip_notarize=yes ;;
      *) die "unknown macos prod option: $arg (--backend URL, --universal, --no-check, --skip-notarize)" ;;
    esac
    shift
  done
  valid_backend "$backend"

  macos_timing_begin "Prepare macOS environment"
  prepare_macos
  macos_timing_finish

  macos_timing_begin "Load signing configuration"
  load_macos_notarization "$skip_notarize"
  macos_timing_finish

  if [ "$checks" = yes ]; then
    macos_timing_begin "Test macOS application"
    say "Testing the macOS application"
    check_macos
    macos_timing_finish
  fi

  local -a args
  if [ "$MACOS_NOTARIZING" = yes ]; then
    # Build both outputs together. Tauri signs, submits, waits, and staples in
    # this pass; a second bundle pass would submit the same app twice.
    args=(--bundles app,dmg)
  else
    args=(--bundles app)
  fi
  if [ "$universal" = yes ]; then
    macos_timing_begin "Prepare universal targets"
    require_command rustup
    say "Preparing universal macOS targets"
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
    args+=(--target universal-apple-darwin)
    bundle_root="$DEV_DIR/desktop/src-tauri/target/universal-apple-darwin/release/bundle"
    macos_timing_finish
  else
    bundle_root="$DEV_DIR/desktop/src-tauri/target/release/bundle"
  fi
  app="$bundle_root/macos/Papol.app"

  macos_timing_begin "Clean up mounted build images"
  unmount_macos_build_images \
    || die "a previous Papol build image is still in use; eject it and try again"
  macos_timing_finish

  marker=$(mktemp -t papol-macos-build.XXXXXX)
  macos_timing_begin "Build application bundles"
  say "Building Papol macOS"
  note "backend: $backend"
  [ "$universal" = yes ] && note "architecture: universal (Apple Silicon and Intel)"
  [ "$MACOS_NOTARIZING" = no ] || note "distribution: Developer ID signed and notarized"
  if [ "$skip_notarize" = yes ] && [ "${APPLE_SIGNING_IDENTITY:-}" != - ]; then
    note "distribution: Developer ID signed; notarization skipped"
  fi
  if [ -x "$DEV_DIR/desktop/node_modules/.bin/tauri" ]; then
    (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" npm run build -- "${args[@]}") || {
      rm -f "$marker"
      unmount_macos_build_images || true
      die "the macOS application build failed"
    }
  elif ! (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" cargo tauri build "${args[@]}"); then
    rm -f "$marker"
    unmount_macos_build_images || true
    die "the macOS application build failed"
  fi
  macos_timing_finish

  macos_timing_begin "Resolve build artifacts"
  [ -d "$app" ] && [ "$app" -nt "$marker" ] \
    || die "the build completed but no new application bundle was found at $app"
  if [ "$MACOS_NOTARIZING" = yes ]; then
    dmg=$(find "$bundle_root/dmg" -type f -name '*.dmg' -newer "$marker" -print 2>/dev/null | head -1)
    [ -n "$dmg" ] || die "the notarized build completed but no new DMG was found"
  else
    dmg=$(find "$bundle_root/dmg" -type f -name '*.dmg' -print 2>/dev/null | head -1)
  fi
  dmg_marker="$bundle_root/dmg/.papol-app.sha256"
  app_hash=$(macos_app_fingerprint "$app")
  cached_app_hash=$(sed -n '1p' "$dmg_marker" 2>/dev/null || true)
  cached_dmg_hash=$(sed -n '2p' "$dmg_marker" 2>/dev/null || true)
  dmg_hash=
  if [ -n "$dmg" ] && [ -n "$cached_dmg_hash" ]; then
    dmg_hash=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
  fi

  if [ "$MACOS_NOTARIZING" = yes ]; then
    dmg_hash=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
  elif [ "$app_hash" = "$cached_app_hash" ] && [ "$dmg_hash" = "$cached_dmg_hash" ]; then
    note "application is unchanged — reusing the matching DMG"
  else
    macos_timing_finish
    macos_timing_begin "Build disk image"
    say "Building Papol disk image"
    local -a bundle_args
    bundle_args=(--bundles app,dmg)
    [ "$universal" = no ] || bundle_args+=(--target universal-apple-darwin)
    if [ -x "$DEV_DIR/desktop/node_modules/.bin/tauri" ]; then
      (cd "$DEV_DIR/desktop" \
        && APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" \
          ./node_modules/.bin/tauri bundle "${bundle_args[@]}") || {
        rm -f "$marker"
        unmount_macos_build_images || true
        die "the macOS disk image build failed"
      }
    elif ! (cd "$DEV_DIR/desktop" \
      && APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" \
        cargo tauri bundle "${bundle_args[@]}"); then
      rm -f "$marker"
      unmount_macos_build_images || true
      die "the macOS disk image build failed"
    fi
    dmg=$(find "$bundle_root/dmg" -type f -name '*.dmg' -newer "$marker" -print | head -1)
    [ -n "$dmg" ] || die "the build completed but no new DMG was found"
    app_hash=$(macos_app_fingerprint "$app")
    dmg_hash=$(shasum -a 256 "$dmg" | cut -d' ' -f1)
    printf '%s\n%s\n' "$app_hash" "$dmg_hash" > "$dmg_marker"
  fi
  macos_timing_finish
  rm -f "$marker"

  if [ "$MACOS_NOTARIZING" = yes ]; then
    macos_timing_begin "Verify signature and notarization"
    say "Verifying Developer ID signature and notarization ticket"
    codesign --verify --deep --strict --verbose=2 "$app"
    xcrun stapler validate "$app"
    spctl --assess --type execute --verbose=2 "$app"
    macos_timing_finish
  fi

  if [ "$checks" = yes ]; then
    macos_timing_begin "Smoke-test bundled web app"
    say "Smoke-testing the bundled macOS web application"
    (cd "$DEV_DIR/frontend" \
      && PAPOL_SMOKE_DIST="$DEV_DIR/desktop/dist" npm run smoke:browser)
    macos_timing_finish
  fi

  say "macOS application ready"
  note "$app"
  note "$dmg"
  note "$(du -h "$dmg" | cut -f1), SHA-256 $(shasum -a 256 "$dmg" | cut -d' ' -f1)"
  macos_timing_begin "Install and launch application"
  install_macos_app "$app"
  macos_timing_finish

  trap - EXIT
  macos_timing_summary
}

run_macos() {
  case "${1:-}" in
    dev) shift; macos_dev "$@" ;;
    prod|build) shift; macos_prod "$@" ;;
    credentials) shift; macos_credentials "$@" ;;
    release) shift; macos_release "$@" ;;
    ""|-h|--help)
      cat <<'MSG'
Usage:
  ./deploy.sh macos dev [--backend URL]
  ./deploy.sh macos prod [--backend URL] [--universal] [--no-check] [--skip-notarize]
  ./deploy.sh macos credentials
  ./deploy.sh macos release [patch|minor|major|VERSION]

`prod` and its `build` alias create an application bundle and DMG, install the
app in /Applications, and launch it. Local builds are ad-hoc signed unless a
.env.macos-notarization file supplies Developer ID and notarization credentials.
Tagged GitHub releases also sign and notarize. Add --universal to build one
binary for Apple Silicon and Intel. Add --skip-notarize to retain the configured
signing mode without submitting the build to Apple's notarization service.
`credentials` lists the GitHub Actions secrets needed for a signed and
notarized release, checks for a local Developer ID identity, and prints the
values in the local credential file for copying to GitHub.
`release` increments the desktop patch version by default (or accepts a minor,
major, or explicit stable version), commits only its three version files, and
pushes the matching `macos-v*` tag to trigger the GitHub release build.
MSG
      ;;
    *) die "unknown macos target: $1 (try dev, prod, build, credentials, or release)" ;;
  esac
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
    if [ "$(uname -s)" = Darwin ]; then
      die "something already has port $DEV_PORT.
    Choose an unused port with PAPOL_DEV_PORT=PORT ./deploy.sh dev."
    else
      die "something already has port $DEV_PORT.
    If that is still production, it has not been moved to 8001 yet — see the
    services.papol lines in /etc/nixos/configuration.nix."
    fi
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

  if [ "$(uname -s)" = Darwin ]; then
    say "Development on http://127.0.0.1:$DEV_PORT"
  else
    say "Development on http://127.0.0.1:$DEV_PORT, and http://papol.local on the LAN"
  fi
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

# First run: create the production worktree and seed only its configuration.
# Production data starts independently and is never copied from development.
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

  say "Seeding production configuration from $DEV_DIR"
  if [ -e "$DEV_DIR/.env" ] && [ ! -e "$PROD_DIR/.env" ]; then
    cp -p "$DEV_DIR/.env" "$PROD_DIR/.env"
    note "copied .env"
  fi

  # Development's .env points mail at a dead port, and the environment wins
  # over the settings table — so seeding that line into production is how
  # you notice, weeks later, that nobody has had an email. Production keeps
  # the rest of the file and gets its SMTP from the database, as before.
  if [ -e "$PROD_DIR/.env" ] && grep -q '^SMTP_HOST=localhost$' "$PROD_DIR/.env"; then
    sed -i '/^SMTP_HOST=localhost$/d; /^SMTP_PORT=1025$/d; /^SMTP_STARTTLS=0$/d' \
      "$PROD_DIR/.env"
    note "dropped development's mail sink from production's .env"
  fi
  chmod 600 "$PROD_DIR/.env" 2>/dev/null || true

  cat <<MSG

    Production now has its own checkout and secrets. Its database and uploads
    start independently from development. Two things to do to development's
    configuration, once:

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
  local ref=main ref_set=no arg
  for arg in "$@"; do
    case "$arg" in
      -*) die "unknown prod option: $arg" ;;
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

  confirm_deploy

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

# --- pulling production data into development -------------------------------

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

# Pulling is deliberately one-way and explicit. Production is read through
# SQLite's backup API and is never modified.
pull_data() {
  [ "$#" -eq 0 ] || die "pull takes no options"
  [ "$DEV_DIR" = "$PROD_DIR" ] && die "development and production are the same tree"
  [ -e "$PROD_DIR/backend/papol.db" ] \
    || die "no production database at $PROD_DIR/backend/papol.db"

  # Replacing a database beneath a running server can leave it using a mixture
  # of the old and new files.
  dev_is_up && die "the development server is answering on $DEV_PORT — stop it first"

  local dev_bak=""
  if [ -e "$DEV_DIR/backend/papol.db" ]; then
    dev_bak="$DEV_DIR/backend/papol.db.bak-$(date +%F-%H%M)-pre-pull"
    cp -p "$DEV_DIR/backend/papol.db" "$dev_bak"
    say "Kept development's database as $(basename "$dev_bak")"
  fi

  # .backup takes a consistent snapshot while production continues serving.
  local pulled="$DEV_DIR/backend/papol.db.pull-$$"
  trap 'rm -f "$pulled"' RETURN
  say "Pulling production database into development"
  sqlite "$PROD_DIR/backend/papol.db" ".backup '$pulled'"
  note "$(du -h "$pulled" | cut -f1)"

  # Production sessions must not work in development. Preserve development
  # sessions only where the account identity still matches the pulled data.
  if [ -n "$dev_bak" ]; then
    sqlite "$pulled" <<SQL
ATTACH DATABASE '$dev_bak' AS olddev;
BEGIN IMMEDIATE;
DELETE FROM auth_tokens;
INSERT INTO auth_tokens
  SELECT sessions.* FROM olddev.auth_tokens sessions
  JOIN olddev.users old_user ON old_user.uuid = sessions.user_uuid
  JOIN users current_user
    ON current_user.uuid = old_user.uuid AND current_user.email = old_user.email;
COMMIT;
DETACH DATABASE olddev;
SQL
    note "development sessions preserved"
  else
    sqlite "$pulled" "DELETE FROM auth_tokens"
  fi

  # Production credentials and URLs must not become active in development.
  say "Scrubbing production's reach out of the copy"
  sqlite "$pulled" <<SQL
DELETE FROM settings WHERE key LIKE 'smtp_%';
INSERT INTO settings (key, value) VALUES ('site_url', 'http://papol.local/')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
SQL
  mv -f "$pulled" "$DEV_DIR/backend/papol.db"
  note "production sessions and SMTP credentials dropped; site_url now points at development"
  trap - RETURN
  say "Done. Development now contains a sanitized copy of production's database."
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
  pull)   shift; pull_data "$@" ;;
  status) status ;;
  macos)  shift; run_macos "$@" ;;
  ""|-h|--help) usage ;;
  *)      die "unknown target: $1 (try dev, prod, pull, status, macos)" ;;
esac
