#!/usr/bin/env bash
# Wrap safari/extension in the macOS app Safari needs to install it, as an
# Xcode project under safari/xcode (not committed: it is generated, and the
# extension's files are referenced where they are, not copied, so editing
# them needs no second run).
#
#   safari/scripts/make-xcode.sh            # then build "Papol for Safari" in Xcode
#
# Needs Xcode (not only the Command Line Tools) on a Mac.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v xcrun >/dev/null || { echo "make-xcode: xcrun not found; install Xcode" >&2; exit 1; }
xcrun safari-web-extension-converter "$here/extension" \
  --project-location "$here/xcode" \
  --app-name "Papol for Safari" \
  --bundle-identifier io.papol.safari \
  --swift --macos-only --no-open --force
echo "Open $here/xcode/Papol for Safari/Papol for Safari.xcodeproj and run the app once;"
echo "then turn the extension on in Safari > Settings > Extensions."
