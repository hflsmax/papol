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
# BASE_URL is where a reader meets the application: production, or a
# `wrangler dev` serving an assembled site. PAPER_DIGEST should name a paper
# the service really has. Set CHROME to pick the browser.
set -uo pipefail

BASE="${1:-https://papol.io}"
BASE="${BASE%/}"
DIGEST="${2:-}"
# A UUID that names nobody. These pages are reached as a guest and asked only
# to route: whether the account exists is the service's business, not the
# router's.
NOBODY=2f1c6f60-3f5b-4a19-9c2a-7d0e1b8c4a53

browser() {
  local candidate
  for candidate in "${CHROME:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      google-chrome google-chrome-stable chromium chromium-browser; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 && { command -v "$candidate"; return 0; }
  done
  return 1
}

CHROMIUM="$(browser)" || {
  printf 'links: no Chromium-based browser found; set CHROME to one\n' >&2
  exit 2
}

# Which page the router built for this URL. Three answers, and the difference
# between them is the whole diagnosis:
#   <name>  the application rendered, and this is the page it chose
#   shell   the page was served but its scripts never ran — an empty root
#   -       nothing came back at all
rendered_page() {
  local dom
  dom="$("$CHROMIUM" --headless --no-sandbox --disable-gpu \
    --virtual-time-budget=20000 --dump-dom "$1" 2>/dev/null)"
  case "$dom" in
    *data-page=*)
      printf '%s' "$dom" | grep -o 'data-page="[a-z]*"' | head -1 | sed 's/.*"\(.*\)"/\1/'
      ;;
    *'id="root"'*) printf 'shell' ;;
    *) printf -- '-' ;;
  esac
}

failed=0
check() {
  local path="$1" expected="$2" actual
  actual="$(rendered_page "$BASE$path")"
  case "$actual" in
    "$expected") printf '    ok    %s → %s\n' "$path" "$expected" ;;
    shell) printf '    DEAD  %s was served but never ran\n' "$path"; failed=1 ;;
    -)     printf '    DEAD  %s answered nothing\n' "$path"; failed=1 ;;
    *)     printf '    DEAD  %s opened the %s page, not the %s page\n' \
             "$path" "$actual" "$expected"; failed=1 ;;
  esac
}

printf '\nOpening Papol'\''s links at %s\n' "$BASE"

# The home page first, and on its own. Every unknown path renders it, so if it
# does not render, nothing below means anything: the browser is not reaching a
# working application, and saying "every link is dead" would be this check
# describing its own footing rather than Papol's.
home="$(rendered_page "$BASE/")"
if [ "$home" != home ]; then
  case "$home" in
    shell) printf '\n    The home page was served but never ran.\n' >&2 ;;
    -)     printf '\n    The home page answered nothing.\n' >&2 ;;
    *)     printf '\n    The home page opened the %s page.\n' "$home" >&2 ;;
  esac
  printf '    That is this check losing its footing, not a routing failure.\n' >&2
  printf '    %s has to be the public URL: on the service'\''s own port the\n' "$BASE" >&2
  printf '    application cannot load the scripts it asks for.\n\n' >&2
  exit 2
fi
printf '    ok    / → home\n'
check "/learn" learn
check "/signin" signin
check "/library" papers
check "/u/$NOBODY" nook
check "/room/$NOBODY" room
# A paper is not a guest's to read: every page of the real community needs a
# session (US-1.4), and the service says so with a 401 the moment the page
# asks for the paper. What the router owes a visitor holding a paper link is
# the sign-in page, carrying the link as `next` so they land on the paper once
# they have signed in — not a paper page drawn around a refusal, which is what
# this check used to accept. So a guest's paper link is expected to open
# sign-in; a paper link that renders `paper` for a guest is the regression.
if [ -n "$DIGEST" ]; then
  check "/paper/${DIGEST:0:32}" signin
else
  printf '    skip  /paper/<digest> — no paper named; pass one as the second argument\n'
fi

if [ "$failed" -ne 0 ]; then
  printf '\nSome links no longer reach what they name.\n' >&2
  exit 1
fi
printf '\nEvery link opened the page it names.\n'
