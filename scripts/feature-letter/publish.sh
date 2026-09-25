#!/bin/sh
# Put a letter's pictures where an email can show them: the production
# bucket's admin/ prefix, apart from what users upload, each named by its
# content hash, so a picture is uploaded once however often it is used.
# Prints the address to put in letter.md for each file.
#
#   scripts/feature-letter/publish.sh <file.gif> [...]
#
# Needs wrangler signed in to the account (npx wrangler whoami).
set -e
[ $# -gt 0 ] || { echo "usage: scripts/feature-letter/publish.sh <file> [...]" >&2; exit 2; }
cd "$(dirname "$0")/../../cloudflare"
for file in "$@"; do
  case "$file" in /*) path="$file" ;; *) path="$OLDPWD/$file" ;; esac
  sha=$(shasum -a 256 "$path" | cut -d' ' -f1)
  ext="${path##*.}"
  case "$ext" in gif) type=image/gif ;; png) type=image/png ;; jpg|jpeg) type=image/jpeg ;; webp) type=image/webp ;; *) echo "not a picture: $file" >&2; exit 2 ;; esac
  npx wrangler r2 object put "papol-files/admin/$sha.$ext" --file "$path" --content-type "$type" --remote > /dev/null
  echo "$file https://files.papol.io/admin/$sha.$ext"
done
