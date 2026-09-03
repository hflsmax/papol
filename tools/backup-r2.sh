#!/usr/bin/env bash
set -Eeuo pipefail

readonly PAPOL_PARENT=${PAPOL_PARENT:-/srv/papol}
readonly PAPOL_DIR=${PAPOL_DIR:-$PAPOL_PARENT/prod}
readonly R2_BUCKET=${R2_BUCKET:-papol-backups}
readonly R2_PREFIX=${R2_PREFIX:-daily}

tmp_dir=$(mktemp -d /var/tmp/papol-r2-backup.XXXXXX)
archive="$tmp_dir/papol-$(date +%Y-%m-%dT%H%M%S%z).zip"
backup_name=$(basename "$archive" .zip)

cleanup() {
  status=$?
  rm -rf -- "$tmp_dir"
  exit "$status"
}
trap cleanup EXIT INT TERM

test -d "$PAPOL_DIR"

# Archive the live production tree without interrupting the service.
(
  cd "$PAPOL_PARENT"
  zip -1 -q -r "$archive" prod
)

# Wrangler's object command accepts at most 300 MiB. Keep one ordinary ZIP,
# but split it into transport parts below that ceiling. The checksum is
# uploaded last, so its presence also marks a complete backup.
sha256sum "$archive" | sed "s|$archive|$(basename "$archive")|" \
  > "$tmp_dir/$backup_name.sha256"
split -b 250M -d -a 3 "$archive" "$tmp_dir/$backup_name.zip.part-"

for part in "$tmp_dir/$backup_name.zip.part-"*; do
  wrangler r2 object put \
    "$R2_BUCKET/$R2_PREFIX/$backup_name/$(basename "$part")" \
    --remote \
    --file "$part" \
    --content-type application/octet-stream
done
wrangler r2 object put \
  "$R2_BUCKET/$R2_PREFIX/$backup_name/$backup_name.sha256" \
  --remote \
  --file "$tmp_dir/$backup_name.sha256" \
  --content-type text/plain

printf 'Uploaded %s (%s bytes)\n' \
  "$R2_BUCKET/$R2_PREFIX/$backup_name/" \
  "$(stat -c %s "$archive")"
