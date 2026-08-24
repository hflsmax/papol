#!/usr/bin/env bash
# One health-check probe of a papol URL, appended as a JSON line to a log.
# Run standalone for a manual check, or periodically by module.nix's timer.
#
# Usage: check.sh [URL] [LOGFILE]
set -uo pipefail

URL="${1:-https://mc-pony.com/papol}"
LOG="${2:-$HOME/papol-health/health.jsonl}"
TIMEOUT=10

mkdir -p "$(dirname "$LOG")"

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

out="$(curl -sS -o /dev/null -L --max-time "$TIMEOUT" \
  -w '%{http_code} %{time_total} %{time_connect} %{time_starttransfer} %{num_redirects}' \
  "$URL" 2>&1)"
status=$?

if [ $status -ne 0 ]; then
  # curl's own error text, quote-escaped and flattened to one line so it
  # cannot break the JSON it is embedded in.
  msg="$(printf '%s' "$out" | tr '"\n' "''")"
  printf '{"ts":"%s","ok":false,"curl_exit":%d,"error":"%s"}\n' \
    "$ts" "$status" "$msg" >> "$LOG"
  exit 0
fi

read -r http_code time_total time_connect time_ttfb num_redirects <<< "$out"

ok=false
[[ "$http_code" =~ ^[23][0-9][0-9]$ ]] && ok=true

printf '{"ts":"%s","ok":%s,"http_code":%s,"time_total":%s,"time_connect":%s,"time_ttfb":%s,"redirects":%s}\n' \
  "$ts" "$ok" "$http_code" "$time_total" "$time_connect" "$time_ttfb" "$num_redirects" >> "$LOG"
