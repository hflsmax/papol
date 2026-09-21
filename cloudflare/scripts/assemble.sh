#!/usr/bin/env bash
# Build the three Vite apps and lay them out as the Worker serves them:
#   site/            the main frontend (index.html, assets/)
#   site/viewer/     the PDF viewer, at /viewer/
#   site/boards/     the board workspace, at /boards/<uuid> and /boards/assets/
# Run inside `nix develop` (or any shell with the repository's Node).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
site="$root/cloudflare/site"
for app in frontend viewer board; do
  echo "Building $app"
  (cd "$root/$app" && npm run build >/dev/null)
done
rm -rf "$site"
mkdir -p "$site"
cp -R "$root/frontend/dist/." "$site/"
mkdir -p "$site/viewer" "$site/boards"
cp -R "$root/viewer/dist/." "$site/viewer/"
cp -R "$root/board/dist/." "$site/boards/"
echo "Assembled $site"
