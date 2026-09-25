#!/usr/bin/env bash
# Papol's deployment, all of it.
#
#   ./deploy.sh dev            the Worker and the three apps here, live-reloading
#   ./deploy.sh prod           run the worker workflow for production, then open its links
#   ./deploy.sh host           update the NixOS host: the analyzer and its tunnel
#   ./deploy.sh macos dev      run the native app with Vite live reload
#                  [--backend URL] (default: http://127.0.0.1:8787)
#   ./deploy.sh macos prod     test, build, and install a production-backed app
#                  [--backend URL] (default: https://papol.io)
#                  [--no-check] [--skip-notarize]
#                  loads .env.macos-notarization when present
#   ./deploy.sh macos credentials
#                  print the local signing/notarization values for GitHub
#   ./deploy.sh macos release [patch|minor|major|VERSION]
#                  bump, open a pull request that merges itself, then tag
#
# Production is the Cloudflare Worker in cloudflare/, at https://papol.io:
# the API, the jobs, and the three built apps served as its static assets,
# on D1, R2 and a Queue. Main deploys itself to dev.papol.io (the worker
# workflow, .github/workflows/worker.yml); `prod` asks that workflow for
# production, which tests, migrates D1 and deploys. The one thing that is not on Cloudflare is the analyzer
# (host/analyzer/), which reads papers by rules on a NixOS host and reaches
# the Worker through a tunnel; `host` updates that machine. Development is wrangler's
# local runtime on this machine, with a D1 and an R2 of its own under
# cloudflare/.wrangler, and the three Vite servers in front of it.
#
# Code goes up with `prod`. Data never goes from development to production.
# dev.papol.io takes a fresh copy of production's data from the refresh-dev
# workflow (.github/workflows/refresh-dev.yml), run by hand.
#
# Two things about the files bucket are set once, by hand, not by a deploy:
# a browser PUTs a paper's PDF to the bucket directly with a URL the Worker
# signs (cloudflare/src/files.ts), so the bucket needs the CORS
# rules in cloudflare/r2-cors-public.json (the same file allows reads
# from the bucket's domain),
#   (cd cloudflare && npx wrangler r2 bucket cors set papol-files --file r2-cors-public.json)
# (and `papol-files-dev` for dev), and the Worker needs an R2 API token as
# the secrets R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (`wrangler secret
# put`, `--env dev` for dev). Without the secrets, uploads still go through
# the Worker as before.
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Where the Worker listens in development: wrangler's default, and what the
# three Vite configs proxy /api and /uploads to.
WRANGLER_PORT=8787
# The NixOS host that runs the analyzer, and Papol's checkout on it.
HOST="${PAPOL_HOST:-congm@nixos}"
HOST_DIR="${PAPOL_HOST_DIR:-/srv/papol/prod}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

confirm() {
  local answer
  [ -t 0 ] || die "$1 requires confirmation from a terminal"
  printf '\n%s? [y/N] ' "$1"
  IFS= read -r answer || die "confirmation was not received"
  case "$answer" in
    y|Y|yes|YES|Yes) ;;
    *) die "cancelled" ;;
  esac
}

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# Root, without hanging. A command run by a cron job or an agent has nobody
# to type a password at, and sudo waiting on a stdin that will never answer
# looks exactly like a command that is still working. So try it with -n,
# which refuses rather than prompts, and tell sudo saying no apart from the
# command saying no.
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
        sudo $*"
  fi
}

# The tools come from mise.toml. A shell with mise activated (or direnv) has
# them; one that has not is handed the same environment for the one command,
# in the directory it was called from.
with_tools() {
  if command -v npm >/dev/null 2>&1; then
    "$@"
  else
    mise -C "$DEV_DIR" exec -- bash -c 'cd "$0" && exec "$@"' "$PWD" "$@"
  fi
}

# --- building ---------------------------------------------------------------

# Every npm tree the application is built from. `install_node_tree` (below,
# with the macOS section that first needed it) runs `npm ci` only when the
# lockfile has moved on: a deploy that changes no dependency should not
# spend a minute proving it.
install_trees() {
  local app
  for app in frontend viewer board; do
    install_node_tree "$DEV_DIR/$app"
  done
  # --legacy-peer-deps because npm's peer resolver crashes on Vitest 5's
  # optional peers while the Workers pool still wants Vitest 4.
  install_node_tree "$DEV_DIR/cloudflare" --legacy-peer-deps
}

# wrangler serves cloudflare/site as the Worker's assets and refuses to
# start without the directory. `prod` assembles the real one; development
# and the checks want the Worker up whether or not a site has been built,
# and the Vite servers stand in front of it anyway.
ensure_site() {
  [ -e "$DEV_DIR/cloudflare/site/index.html" ] && return 0
  mkdir -p "$DEV_DIR/cloudflare/site"
  printf '<!doctype html><title>Papol</title>\n' > "$DEV_DIR/cloudflare/site/index.html"
}

wrangler() {
  (cd "$DEV_DIR/cloudflare" && with_tools npx wrangler "$@")
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
  local requested="${1:-patch}" current version tag branch pr
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
  command -v gh >/dev/null 2>&1 || die "gh is required to open the release pull request"
  command -v node >/dev/null 2>&1 || die "node is required to prepare a macOS release"
  [ "$(git -C "$DEV_DIR" branch --show-current)" = main ] \
    || die "macos releases must be cut from the main branch"
  git -C "$DEV_DIR" diff --cached --quiet \
    || die "stage or unstage existing changes before cutting a release"
  git -C "$DEV_DIR" diff --quiet -- "${version_files[@]}" \
    || die "desktop version files have uncommitted changes"
  # main is protected: nothing reaches it except through a pull request
  # whose checks pass. So the bump travels on a branch of its own, and it
  # starts from exactly what origin has, or a local-only commit would ride
  # along into the release.
  git -C "$DEV_DIR" fetch --quiet origin main
  [ "$(git -C "$DEV_DIR" rev-parse HEAD)" = "$(git -C "$DEV_DIR" rev-parse origin/main)" ] \
    || die "main is not at origin/main; pull, or drop local-only commits, before cutting a release"

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

  # A release only ever moves forwards.
  node - "$version" "$current" <<'NODE' || die "release version refused"
const [version, current] = process.argv.slice(2);
const parts = (text) => text.split('.').map(Number);
const compare = (left, right) => {
  const [a, b] = [parts(left), parts(right)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
if (compare(version, current) < 0) {
  console.error(`deploy: ${version} is older than the current ${current}; a release moves forwards`);
  process.exit(1);
}
NODE

  tag="macos-v$version"
  branch="release/$tag"
  if git -C "$DEV_DIR" rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    die "tag $tag already exists locally"
  fi
  if git -C "$DEV_DIR" ls-remote --exit-code --refs origin "refs/tags/$tag" >/dev/null 2>&1; then
    die "tag $tag already exists on origin"
  fi
  if git -C "$DEV_DIR" rev-parse -q --verify "refs/heads/$branch" >/dev/null \
    || git -C "$DEV_DIR" ls-remote --exit-code --refs origin "refs/heads/$branch" >/dev/null 2>&1; then
    die "branch $branch already exists; an earlier release of $version is unfinished"
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
  git -C "$DEV_DIR" switch --quiet --create "$branch"
  git -C "$DEV_DIR" add -- "${version_files[@]}"
  git -C "$DEV_DIR" commit --quiet -m "Release Papol macOS v$version"
  git -C "$DEV_DIR" push --quiet --set-upstream origin "$branch"
  pr=$(cd "$DEV_DIR" && gh pr create --base main --head "$branch" \
    --title "Release Papol macOS v$version" \
    --body "Version bump only. The pull request merges itself once the checks pass; deploy.sh then tags the merge commit $tag, and that tag builds, notarizes and publishes the DMG.")
  (cd "$DEV_DIR" && gh pr merge --auto --merge "$pr" >/dev/null)
  git -C "$DEV_DIR" switch --quiet main
  say "Opened $pr"

  # Wait for it to merge, then tag the merge commit.
  local state status sha failed
  note "Waiting for the checks; the pull request merges itself when they pass."
  while :; do
    read -r state status sha failed < <(cd "$DEV_DIR" && gh pr view "$pr" \
      --json state,mergeStateStatus,mergeCommit,statusCheckRollup \
      --jq '[.state, .mergeStateStatus, (.mergeCommit.oid // "-"),
             ([.statusCheckRollup[]? | select(.conclusion == "FAILURE" or .conclusion == "TIMED_OUT" or .conclusion == "CANCELLED") | .name] | join(",") | if . == "" then "-" else . end)]
            | join(" ")')
    case "$state" in
      MERGED) break ;;
      CLOSED) die "$pr was closed without merging" ;;
    esac
    [ "$failed" = "-" ] || die "checks failed on $pr: $failed"
    # main is required to be merged in before a branch lands; when main
    # moves under an open release, bring the branch up and let the checks
    # run again on the result.
    if [ "$status" = BEHIND ]; then
      note "main moved; bringing $branch up to date"
      (cd "$DEV_DIR" && gh pr update-branch "$pr" >/dev/null)
    fi
    sleep 30
  done

  git -C "$DEV_DIR" fetch --quiet origin main
  [ "$sha" != "-" ] || die "GitHub reports no merge commit for $pr"
  git -C "$DEV_DIR" merge-base --is-ancestor "$sha" origin/main \
    || die "merge commit $sha of $pr is not on origin/main"
  if git -C "$DEV_DIR" ls-remote --exit-code --refs origin "refs/tags/$tag" >/dev/null 2>&1; then
    say "Papol macOS v$version is already tagged on origin"
    return
  fi
  git -C "$DEV_DIR" rev-parse -q --verify "refs/tags/$tag" >/dev/null \
    || git -C "$DEV_DIR" tag -a "$tag" -m "Papol macOS v$version" "$sha"
  git -C "$DEV_DIR" push origin "$tag"
  git -C "$DEV_DIR" push --quiet origin --delete "$branch" 2>/dev/null || true
  git -C "$DEV_DIR" branch --quiet -D "$branch" 2>/dev/null || true
  if [ "$(git -C "$DEV_DIR" branch --show-current)" = main ]; then
    git -C "$DEV_DIR" merge --quiet --ff-only origin/main
  fi
  say "Tagged Papol macOS v$version"
  # The gate is CI's, not this script's: the tag runs the suites, the
  # browser smokes and the native lints on a macOS runner, and the DMG
  # is built, notarized and published only if they pass.
  note "CI is now testing the tag; the release publishes only if the gate passes:"
  note "https://github.com/hflsmax/papol/actions/workflows/desktop-macos.yml"
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
# Anything after the directory is handed to `npm ci`.
install_node_tree() {
  local dir=$1 marker expected staging backup
  shift
  marker="$dir/node_modules/.papol-package-input.sha256"
  expected=$(shasum -a 256 "$dir/package.json" "$dir/package-lock.json" | shasum -a 256 | cut -d' ' -f1)
  if [ -d "$dir/node_modules" ] && [ "$(cat "$marker" 2>/dev/null || true)" = "$expected" ]; then
    return 0
  fi

  # Adopt an existing valid tree on the first run. This is important on a
  # laptop that is temporarily offline, and `npm ls` still catches missing
  # or incompatible direct dependencies before a build starts.
  if [ -d "$dir/node_modules" ] && [ ! -e "$marker" ] \
     && (cd "$dir" && with_tools npm ls --depth=0 --ignore-scripts >/dev/null 2>&1); then
    printf '%s\n' "$expected" > "$marker"
    return 0
  fi

  say "Installing $(basename "$dir") dependencies"
  staging=$(mktemp -d "$dir/.papol-npm.XXXXXX")
  cp "$dir/package.json" "$dir/package-lock.json" "$staging/"
  if ! (cd "$staging" && with_tools npm ci "$@"); then
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

  install_node_tree "$DEV_DIR/desktop"
  install_node_tree "$DEV_DIR/frontend"
  install_node_tree "$DEV_DIR/viewer"
  install_node_tree "$DEV_DIR/board"
}

# The UI suites do not share outputs, and Rust's test/lint pipeline has its own
# target directory. Run those four lanes together; keeping the Rust commands in
# one lane avoids making two cargo processes contend for the same build lock.
# The native lane is the same two scripts desktop-macos.yml runs.
check_macos() {
  local logs failed=no failed_labels= index
  local -a pids labels
  logs=$(mktemp -d -t papol-macos-checks.XXXXXX)

  (cd "$DEV_DIR/frontend" && npm run test) >"$logs/frontend" 2>&1 &
  pids+=("$!"); labels+=(frontend)
  (cd "$DEV_DIR/viewer" && npm test) >"$logs/viewer" 2>&1 &
  pids+=("$!"); labels+=(viewer)
  (cd "$DEV_DIR/board" && npm test) >"$logs/board" 2>&1 &
  pids+=("$!"); labels+=(board)
  (cd "$DEV_DIR/desktop" && npm run test:native && npm run check:native) \
    >"$logs/native" 2>&1 &
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
  local backend="http://127.0.0.1:$WRANGLER_PORT"
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
    note "start the Worker separately (./deploy.sh dev) when you need fresh server data"
  fi

  say "Papol macOS development"
  note "backend: $backend"
  note "frontend, viewer, and board use Vite live reload"
  note "Rust changes rebuild and relaunch the native app"
  note "Ctrl-C stops the app and all three Vite servers"
  (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" npm run dev)
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
  local backend="https://papol.io" checks=yes skip_notarize=no
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
      --no-check) checks=no ;;
      --skip-notarize) skip_notarize=yes ;;
      *) die "unknown macos prod option: $arg (--backend URL, --no-check, --skip-notarize)" ;;
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
  bundle_root="$DEV_DIR/desktop/src-tauri/target/release/bundle"
  app="$bundle_root/macos/Papol.app"

  macos_timing_begin "Clean up mounted build images"
  unmount_macos_build_images \
    || die "a previous Papol build image is still in use; eject it and try again"
  macos_timing_finish

  marker=$(mktemp -t papol-macos-build.XXXXXX)
  macos_timing_begin "Build application bundles"
  say "Building Papol macOS"
  note "backend: $backend"
  [ "$MACOS_NOTARIZING" = no ] || note "distribution: Developer ID signed and notarized"
  if [ "$skip_notarize" = yes ] && [ "${APPLE_SIGNING_IDENTITY:-}" != - ]; then
    note "distribution: Developer ID signed; notarization skipped"
  fi
  (cd "$DEV_DIR/desktop" && PAPOL_BACKEND_URL="$backend" npm run build -- "${args[@]}") || {
    rm -f "$marker"
    unmount_macos_build_images || true
    die "the macOS application build failed"
  }
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
    (cd "$DEV_DIR/desktop" \
      && APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}" \
        ./node_modules/.bin/tauri bundle "${bundle_args[@]}") || {
      rm -f "$marker"
      unmount_macos_build_images || true
      die "the macOS disk image build failed"
    }
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
    prod) shift; macos_prod "$@" ;;
    credentials) shift; macos_credentials "$@" ;;
    release) shift; macos_release "$@" ;;
    ""|-h|--help)
      cat <<'MSG'
Usage:
  ./deploy.sh macos dev [--backend URL]
  ./deploy.sh macos prod [--backend URL] [--no-check] [--skip-notarize]
  ./deploy.sh macos credentials
  ./deploy.sh macos release [patch|minor|major|VERSION]

`prod` creates an application bundle and DMG, install the
app in /Applications, and launch it. Local builds are ad-hoc signed unless a
.env.macos-notarization file supplies Developer ID and notarization credentials.
Tagged GitHub releases also sign and notarize. Add --skip-notarize to retain
the configured signing mode without submitting the build to Apple's
notarization service.
`credentials` lists the GitHub Actions secrets needed for a signed and
notarized release, checks for a local Developer ID identity, and prints the
values in the local credential file for copying to GitHub.
`release` increments the desktop patch version by default (or accepts a minor,
major, or explicit stable version), commits only its version files on a branch,
opens a pull request that merges itself once the checks pass, waits for that,
and pushes the matching `macos-v*` tag at the merge commit to trigger the
GitHub release build.
MSG
      ;;
    *) die "unknown macos target: $1 (try dev, prod, credentials, or release)" ;;
  esac
}


# --- development -------------------------------------------------------------

# Bound, by anyone. The blunter question is the one that matters before
# binding a port again.
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

DEV_PIDS=()

# Each server is backgrounded as a plain function call, which matters more
# than it looks. Under `set -m` a backgrounded call leads a process group of
# its own, so `kill -TERM -$!` takes it down whole — npm, node and whatever
# workerd or vite spawned beneath them — instead of orphaning a runtime onto
# init to keep answering a port the next run is about to bind. After
# `cmd | sed &`, by contrast, `$!` is the pid of *sed*, the group is led by
# the first command in the pipeline, and the kill names a group that does
# not exist; so the pipe lives inside the function where it cannot confuse
# the bookkeeping.
labelled() {
  local label=$1
  shift
  "$@" 2>&1 | sed -u "s/^/[$label] /"
}

stop_dev() {
  local p
  [ "${#DEV_PIDS[@]}" -eq 0 ] && return 0
  for p in "${DEV_PIDS[@]}"; do
    kill -TERM -"$p" 2>/dev/null || true
  done
  DEV_PIDS=()
}

dev_worker() {
  cd "$DEV_DIR/cloudflare"
  # Not interactive: its keys would read this terminal, which the Vite
  # servers share, and Ctrl-C is the one key that is wanted.
  with_tools npx wrangler dev --ip 127.0.0.1 --port "$WRANGLER_PORT" \
    --show-interactive-dev-session=false
}

dev_app() {
  cd "$DEV_DIR/$1"
  with_tools npm run dev -- --host 127.0.0.1 --port "$2" --strictPort
}

# Development, in the foreground, for as long as this command runs. Nothing
# is installed and nothing survives Ctrl-C — which is the whole difference
# between this and production.
#
# The Worker answers on 8787 from a D1 and an R2 of its own under
# cloudflare/.wrangler, reloading as its source changes. The three apps are
# Vite's development servers: the frontend on 5173 proxies /viewer and
# /boards to the other two and /api and /uploads to the Worker, so one
# origin is the whole application and a saved file is on the next paint.
run_dev() {
  [ $# -eq 0 ] || die "dev takes no options"
  local port
  for port in "$WRANGLER_PORT" 5173 5174 5175; do
    port_busy "$port" && die "something already has port $port; stop it first"
  done

  install_trees
  ensure_site
  say "Preparing the local database"
  wrangler d1 migrations apply papol --local

  say "Development"
  note "http://127.0.0.1:5173             the application, live-reloading"
  note "http://127.0.0.1:$WRANGLER_PORT             the Worker itself: /api, /uploads"
  note "Ctrl-C stops everything."
  echo

  set -m
  labelled worker dev_worker &
  DEV_PIDS+=($!)
  labelled frontend dev_app frontend 5173 &
  DEV_PIDS+=($!)
  labelled viewer dev_app viewer 5174 &
  DEV_PIDS+=($!)
  labelled board dev_app board 5175 &
  DEV_PIDS+=($!)
  set +m
  trap stop_dev EXIT INT TERM
  wait
}

# --- production -------------------------------------------------------------

# Production is the worker workflow's to deploy, from origin/main: it runs
# the Worker's suite, applies D1's migrations, deploys, and smoke-tests
# production read-only. This asks for that run, follows it, and then opens
# production's links, which the workflow does not.
deploy_prod() {
  local started run
  [ $# -eq 0 ] || die "prod takes no options"
  command -v gh >/dev/null 2>&1 || die "gh is required to run the production deploy"

  git -C "$DEV_DIR" fetch --quiet origin main
  say "Deploying origin/main to https://papol.io"
  note "$(git -C "$DEV_DIR" log -1 --oneline origin/main)"
  git -C "$DEV_DIR" merge-base --is-ancestor HEAD origin/main \
    || note "note: HEAD has commits origin/main does not; they are not deployed"
  confirm "Deploy origin/main to production"

  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (cd "$DEV_DIR" && gh workflow run worker.yml --ref main -f environment=production)
  # gh does not say which run it started; the newest dispatch since is it.
  for _ in $(seq 30); do
    run=$(cd "$DEV_DIR" && gh run list --workflow worker.yml --event workflow_dispatch \
      --limit 5 --json databaseId,createdAt \
      --jq "[.[] | select(.createdAt >= \"$started\")][0].databaseId // empty")
    [ -n "$run" ] && break
    sleep 2
  done
  [ -n "$run" ] || die "the production run did not appear; look in the Actions tab"
  (cd "$DEV_DIR" && gh run watch "$run" --exit-status --interval 15 >/dev/null) \
    || die "the production deploy failed: gh run view $run --log-failed"
  say "Deployed"

  link_check
}

# Deployed is not the same as working. The site answers 200 for every path
# it has never heard of, so open the real links in a browser and see which
# page each one rendered.
link_check() {
  local status=0
  say "Opening production's links"
  with_tools bash "$DEV_DIR/health/links.sh" "https://papol.io" || status=$?
  [ "$status" -eq 0 ] && return 0
  # 2 is the check failing to stand up — no browser, or the application never
  # loading at all. That says nothing about this revision's routing, so it is
  # reported and stepped over rather than being blamed on the deployment.
  [ "$status" -eq 2 ] && { note "the link check could not run; open a paper link by hand"; return 0; }
  die "production is serving pages, but some of its links no longer open what
    they name. Deploy the previous revision to put it back."
}

# The NixOS host: the analyzer and the tunnel that carries the Worker to it, as
# module.nix describes them. The host's configuration imports module.nix
# from its checkout, so updating it is fast-forwarding that checkout to
# main and rebuilding — passwordless with services.papol.deploy.
# passwordlessRebuild on. Plain ssh, deliberately: sudo's rule matches the
# bare command, and the host has nothing of Papol's to build but the system.
deploy_host() {
  [ $# -eq 0 ] || die "host takes no options"
  say "Updating $HOST"
  note "$HOST_DIR fast-forwards to origin/main, then nixos-rebuild switch, then the analyzer restarts on the new bundle"
  ssh "$HOST" "cd $HOST_DIR && git fetch origin && git merge --ff-only origin/main && sudo /run/current-system/sw/bin/nixos-rebuild switch"
  # The analyzer's unit does not change with its bundle, so the rebuild
  # leaves the old one running; stopped, it is started again (Restart=always).
  # Matched whole (-x), so the ssh shell's own command line is not.
  ssh "$HOST" "pkill -u \$(id -u) -x -f '\\S+/bin/node $HOST_DIR/host/analyzer/dist/analyzer.js' || true"
}

case "${1:-}" in
  dev)    shift; run_dev "$@" ;;
  prod)   shift; deploy_prod "$@" ;;
  host)   shift; deploy_host "$@" ;;
  macos)  shift; run_macos "$@" ;;
  ""|-h|--help) usage ;;
  *)      die "unknown target: $1 (try dev, prod, host, macos)" ;;
esac
