#!/bin/bash
#
# The browser half of a handoff, checked against a real browser and a real
# Launch Services (USER_STORIES.md §7d). The native half is unit-tested and
# can be driven from a shell; this half cannot, because what is being checked
# is precisely what a browser will and will not do with an address.
#
#   desktop/scripts/handoff-browser-check.sh              papol-dev, a dev build
#   desktop/scripts/handoff-browser-check.sh papol        the installed release
#   desktop/scripts/handoff-browser-check.sh papol-nope   a scheme nobody claims
#
# Three things this exists to get right, all of them learned the hard way:
#
#   * The page must be on the space you are looking at. A window on another
#     space reports visibilityState "hidden", and no browser will open an
#     application from a hidden page. A run that reports vis=hidden has
#     tested nothing; move to that space and run it again.
#
#   * It drives a Chrome of its own, with its own profile, so nothing here
#     touches the browser you use. `--force-renderer-accessibility` is why:
#     Chrome does not publish page content to the accessibility API until
#     something asks, and without it the only pressable buttons are Chrome's
#     own toolbar.
#
#   * A press through the accessibility API carries real user activation —
#     measured, not assumed: the page reports `act=`, and a browser that
#     refuses to open an application from a synthetic click would say
#     act=false. Frontmost is not needed and is not asked for.
#
# The Control button navigates to a scheme that is certainly registered, so a
# run that opens nothing can be told apart from a browser that will not open
# anything from where it is standing.
set -euo pipefail

scheme="${1:-papol-dev}"
port="${PORT:-8731}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"; kill %1 2>/dev/null || true' EXIT

cp "$here/handoff-harness/index.html" "$work/"
cp "$here/../../shared/macHandoff.js" "$work/"

( cd "$work" && python3 -m http.server "$port" >/dev/null 2>&1 ) &
sleep 1

profile="$work/chrome"
open -na "Google Chrome" --args --user-data-dir="$profile" \
  --force-renderer-accessibility --no-first-run --no-default-browser-check \
  --new-window "http://127.0.0.1:$port/index.html?scheme=$scheme"
sleep 8

# Chrome is many processes; the one with a window is the one without "Helper".
browser=""
for pid in $(pgrep -f "user-data-dir=$profile"); do
  ps -o command= -p "$pid" | grep -q Helper || { browser="$pid"; break; }
done
[ -n "$browser" ] || { echo "the sandboxed Chrome did not start"; exit 1; }

# papol-ui refuses to press anything that is not the development build, so
# that it can never be pointed at a user's own Papol. This is a browser.
ui() { PAPOL_UI_ALLOW_INSTALLED=1 xcrun swift "$here/papol-ui.swift" "$@"; }

ui press "$browser" "Open in Papol"
sleep 5

echo "--- what the page saw ---"
ui dump "$browser" | grep -iE "RESULT|wants to open" | head -2 || echo "(nothing — is the window on this space?)"
echo "--- did anything launch? ---"
pgrep -fl "Papol( Dev)?\.app/Contents/MacOS" | cut -c1-70 || echo "nothing launched"
