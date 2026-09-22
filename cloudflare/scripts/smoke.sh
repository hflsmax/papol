#!/usr/bin/env bash
# What a person does, done against a deployed Papol: the doors, a sign-up,
# a sign-in, a stroke, and the refusals. Exits non-zero on the first
# answer that is not the expected one.
#
#   scripts/smoke.sh https://dev.papol.io
#
# With --read-only it asks and writes nothing: the doors and the refusals.
# Otherwise it registers an account, uploads a paper, paints and lets go,
# and closes the account. The paper it uploaded stays in the Library, since
# a paper is nobody's — so the full run is for dev, never for production.
set -euo pipefail
read_only=no
[ "${1:-}" = --read-only ] && { read_only=yes; shift; }
base=${1:?usage: smoke.sh [--read-only] <https://host>}
host=${base#https://}
fail() { echo "smoke: $*" >&2; exit 1; }
expect() { # expect <label> <wanted status> <curl args...>
  local label=$1 wanted=$2; shift 2
  local got; got=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$@")
  [ "$got" = "$wanted" ] || fail "$label: expected $wanted, got $got"
  echo "ok  $label ($got)"
}

expect "plain HTTP redirects" 301 "http://$host/"
expect "the site" 200 "$base/"
expect "a clean route is the site" 200 "$base/library"
expect "the viewer" 200 "$base/viewer/"
expect "a board document" 200 "$base/boards/00000000-0000-0000-0000-000000000000"
expect "the API refuses a stranger" 401 "$base/api/papers"
expect "an unknown API path is not a page" 404 "$base/api/no-such-route"
[ "$read_only" = yes ] && { echo "smoke: all good at $base (read-only)"; exit 0; }

email="smoke-$(date +%s)-$RANDOM@example.test"
token=$(curl -s -m 30 -X POST "$base/api/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"display_name\":\"Smoke\",\"affiliation\":null,\"password\":\"smoke-password\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
[ -n "$token" ] || fail "sign-up returned no token"
echo "ok  sign-up"
auth=(-H "Authorization: Bearer $token")
expect "sign-in with the password" 200 -X POST "$base/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"smoke-password\"}"
expect "sign-in without it" 401 -X POST "$base/api/auth/login" -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"wrong\"}"
expect "who am I" 200 "${auth[@]}" "$base/api/auth/me"
expect "the nook's papers" 200 "${auth[@]}" "$base/api/papers"

# A paper: a tiny PDF put in the bucket by the address the Worker gives,
# its metadata job read, the paper saved, a stroke painted on it and taken
# back, the paper let go.
pdf=$(mktemp); printf '%%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' > "$pdf"
digest=$(python3 -c 'import sys,hashlib; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$pdf")
size=$(wc -c < "$pdf" | tr -d ' ')
address=$(curl -s -m 30 "${auth[@]}" -X POST "$base/api/files/upload-address" -H 'content-type: application/json' \
  -d "{\"kind\":\"paper\",\"sha256\":\"$digest\",\"size\":$size,\"name\":\"smoke.pdf\"}")
file_path=$(printf '%s' "$address" | python3 -c 'import sys,json; print(json.load(sys.stdin)["file_path"])') || fail "address: $address"
# The PUT as the address says: to its URL, with its headers, no credential of ours.
put=$(printf '%s' "$address" | python3 -c '
import sys, json, urllib.request, urllib.error
address, pdf, base = json.load(sys.stdin), sys.argv[1], sys.argv[2]
if address["stored"]: print("held already"); sys.exit()
url = address["url"] if address["url"].startswith("http") else base + address["url"]
try:
    with urllib.request.urlopen(urllib.request.Request(url, data=open(pdf, "rb").read(), headers=address["headers"], method="PUT"), timeout=60) as r: print(r.status)
except urllib.error.HTTPError as e: print(e.code)
' "$pdf" "$base")
rm -f "$pdf"
case "$put" in "held already"|200|204) echo "ok  the PDF is in the bucket ($put)";; *) fail "the PUT to the bucket answered $put";; esac
upload=$(curl -s -m 30 "${auth[@]}" -X POST "$base/api/papers/uploaded" -H 'content-type: application/json' \
  -d "{\"file_path\":\"$file_path\",\"uploaded_name\":\"smoke.pdf\"}")
printf '%s' "$upload" | python3 -c 'import sys,json; json.load(sys.stdin)["job"]' || fail "uploaded: $upload"
echo "ok  upload"
saved=$(curl -s -m 30 "${auth[@]}" -X POST "$base/api/papers" -H 'content-type: application/json' \
  -d "{\"file_path\":\"$file_path\",\"title\":\"Smoke test paper\",\"authors\":null,\"journal\":null,\"year\":null,\"doi\":null}")
sha=$(printf '%s' "$saved" | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha256"])') || fail "save: $saved"
name=${sha:0:32}
echo "ok  save"
stroke=$(curl -s -m 30 "${auth[@]}" -X POST "$base/api/papers/$name/annotations" -H 'content-type: application/json' \
  -d '{"kind":"ink","page":1,"body":{"points":[{"x":0.1,"y":0.2},{"x":0.3,"y":0.2}],"color":"#112233","width":0.005,"opacity":0.9,"shape":"round"}}')
stroke_uuid=$(printf '%s' "$stroke" | python3 -c 'import sys,json; print(json.load(sys.stdin)["uuid"])') || fail "stroke: $stroke"
echo "ok  a stroke"
expect "the stroke is listed" 200 "${auth[@]}" "$base/api/papers/$name/annotations?kind=ink"
expect "the stroke taken back" 200 "${auth[@]}" -X DELETE "$base/api/annotations/$stroke_uuid"
# A deployed Papol sends a file on to its bucket's own address (FILES_URL);
# one without a bucket address serves it itself. Either way the PDF has to
# arrive, as a PDF.
served=$(curl -s -o /dev/null -m 30 -w '%{http_code} %{redirect_url}' "$base/uploads/$file_path")
case "${served%% *}" in
  200) echo "ok  the PDF is served (200)" ;;
  301)
    bucket_url=${served#* }
    [[ "$bucket_url" == https://*/uploads/"$file_path" ]] || fail "the PDF is sent to the bucket: to '$bucket_url'"
    echo "ok  the PDF is sent to the bucket (301)"
    type=$(curl -s -o /dev/null -m 30 -w '%{http_code} %{content_type}' "$bucket_url")
    [ "$type" = "200 application/pdf" ] || fail "the bucket serves the PDF: expected '200 application/pdf', got '$type'"
    echo "ok  the bucket serves the PDF (200)"
    ;;
  *) fail "the PDF is served: expected 200 or 301, got ${served%% *}" ;;
esac
expect "the paper let go" 200 "${auth[@]}" -X DELETE "$base/api/papers/$name"
expect "the account closed behind it" 200 "${auth[@]}" -X DELETE "$base/api/auth/account" -H 'content-type: application/json' -d "{\"confirm_email\":\"$email\"}"
expect "and the session is over" 401 "${auth[@]}" "$base/api/auth/me"
echo "smoke: all good at $base"
