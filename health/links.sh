#!/usr/bin/env bash
# Do the links Papol hands out still open what they name?
#
#   links.sh [BASE_URL] [PAPER_DIGEST]
#
# A single-page app answers 200 for every path it has never heard of: an
# unknown URL renders the home page, and a probe that only checks the status
# code — health/check.sh, and deploy.sh's own post-deploy curl — sees a
# perfectly healthy deployment while every paper link in the world is dead.
# That is how the /paper/<digest> route shipped broken.
#
# So this opens each link in a real browser and reads `data-page` off the
# application root, which says which page the router actually built. It is the
# last check of a production deployment, and the one to run by hand whenever a
# URL shape changes.
#
# PAPER_DIGEST should name a paper production really has; deploy.sh reads one
# out of the production database. Set CHROME to pick the browser.
set -uo pipefail

BASE="${1:-https://mc-pony.com/papol}"
BASE="${BASE%/}"
DIGEST="${2:-}"
# A UUID that names nobody. These pages are reached as a guest and asked only
# to route: whether the account exists is the service's business, not the
# router's.
NOBODY=2f1c6f60-3f5b-4a19-9c2a-7d0e1b8c4a53

browser() {
  local candidate
  for candidate in "${CHROME:-}" chromium chromium-browser google-chrome google-chrome-stable; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 && { command -v "$candidate"; return 0; }
  done
  return 1
}

CHROMIUM="$(browser)" || {
  printf 'links: no Chromium-based browser found; set CHROME to one\n' >&2
  exit 2
}

# Which page the router built for this URL, or nothing if it never rendered.
rendered_page() {
  "$CHROMIUM" --headless --no-sandbox --disable-gpu \
    --virtual-time-budget=20000 --dump-dom "$1" 2>/dev/null \
    | grep -o 'data-page="[a-z]*"' | head -1 | sed 's/.*"\(.*\)"/\1/'
}

failed=0
check() {
  local path="$1" expected="$2" actual
  actual="$(rendered_page "$BASE$path")"
  if [ "$actual" = "$expected" ]; then
    printf '    ok    %s → %s\n' "$path" "$expected"
  elif [ -z "$actual" ]; then
    printf '    DEAD  %s rendered nothing at all\n' "$path"
    failed=1
  else
    printf '    DEAD  %s opened the %s page, not the %s page\n' "$path" "$actual" "$expected"
    failed=1
  fi
}

printf '\nOpening Papol'\''s links at %s\n' "$BASE"
check "/" home
check "/learn" learn
check "/signin" signin
check "/library" papers
check "/u/$NOBODY" space
check "/room/$NOBODY" room
if [ -n "$DIGEST" ]; then
  check "/paper/$DIGEST" paper
else
  printf '    skip  /paper/<digest> — no paper named; pass one as the second argument\n'
fi

if [ "$failed" -ne 0 ]; then
  printf '\nSome links no longer reach what they name.\n' >&2
  exit 1
fi
printf '\nEvery link opened the page it names.\n'
