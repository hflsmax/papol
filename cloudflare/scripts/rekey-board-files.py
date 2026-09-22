#!/usr/bin/env python3
"""Rekey the board files stored under a minted name, so every board file
is named by its digest as the desktop's always were
(docs/cloud-migration.md, phase 5, step 15).

For every board_items row whose file_path is not under blobs/ and whose
object is in the bucket: copy the object to board_uploads/blobs/<sha256>
in the same bucket (a server-side S3 CopyObject; nothing is downloaded
unless the row has no sha256 yet, in which case the bytes are read once
to compute it), verify the copy's size and ETag, point the row at the new
key, and only then delete the old key. Rows and objects it cannot account
for are reported and left alone. Run twice, it finds nothing to do.

    python3 scripts/rekey-board-files.py dev [--dry-run]
    python3 scripts/rekey-board-files.py prod [--dry-run]

Run from anywhere with a logged-in wrangler, after the Worker that writes
new files by digest is deployed to that environment. The R2 token pair is
read from the host at run time (the AWS_* lines of /srv/papol/prod/.env)
and never printed. Standard library only: the signer is AWS SigV4 by
hand, and the database is reached through `npx wrangler d1 execute`.
"""
import datetime
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = "9315a859bb8887b2a0ca2cc576f57ae2"
HOST = f"{ACCOUNT}.r2.cloudflarestorage.com"
ENVIRONMENTS = {
    "dev": {"bucket": "papol-files-dev", "database": "papol-dev"},
    "prod": {"bucket": "papol-files", "database": "papol"},
}
# Where board files live in the bucket, and what a file_path may look like
# (BOARD_FILES in src/files.ts, the KEY rule in src/account/close.ts).
BOARD_FILES = "board_uploads/"
KEY = re.compile(r"^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
CLOUDFLARE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def secret(name):
    out = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "congm@nixos", f"grep '^{name}=' /srv/papol/prod/.env | cut -d= -f2-"],
        capture_output=True, text=True, check=True,
    ).stdout.strip().strip('"').strip("'")
    if not out:
        sys.exit(f"{name} not found on the host")
    return out


class Bucket:
    def __init__(self, name, key_id, key):
        self.name, self.key_id, self.key = name, key_id, key

    def _sign(self, method, path, extra_headers, body=b""):
        now = datetime.datetime.now(datetime.UTC)
        amz_date, date = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(body).hexdigest()
        canonical_uri = "/" + self.name + "/" + urllib.parse.quote(path, safe="/~-_.")
        headers = {"host": HOST, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date, **extra_headers}
        ordered = sorted(headers.items())
        signed = ";".join(k for k, _ in ordered)
        canonical = "\n".join([method, canonical_uri, "", "".join(f"{k}:{v}\n" for k, v in ordered), signed, payload_hash])
        scope = f"{date}/auto/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
        k = hmac.new(("AWS4" + self.key).encode(), date.encode(), hashlib.sha256).digest()
        for part in ("auto", "s3", "aws4_request"):
            k = hmac.new(k, part.encode(), hashlib.sha256).digest()
        signature = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, SignedHeaders={signed}, Signature={signature}"
        return f"https://{HOST}{canonical_uri}", headers

    def call(self, method, path, extra_headers=None, body=b"", want_body=False):
        """(status, headers, body); a 404 is an answer, anything else that fails is fatal."""
        url, headers = self._sign(method, path, extra_headers or {}, body)
        req = urllib.request.Request(url, data=body if method == "PUT" else None, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, dict(r.headers), (r.read() if want_body else b"")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, dict(e.headers), b""
            sys.exit(f"{method} {path}: {e.code} {e.read().decode(errors='replace')[:300]}")

    def head(self, key):
        status, headers, _ = self.call("HEAD", key)
        if status == 404:
            return None
        return {"size": int(headers.get("Content-Length", "0")), "etag": headers.get("ETag", ""), "type": headers.get("Content-Type", "")}

    def get(self, key):
        status, _, body = self.call("GET", key, want_body=True)
        return None if status == 404 else body

    def copy(self, source, dest):
        # CopyObject: a PUT whose bytes come from another key. The content
        # type travels with them (metadata directive COPY).
        src = "/" + self.name + "/" + urllib.parse.quote(source, safe="/~-_.")
        status, _, _ = self.call("PUT", dest, {"x-amz-copy-source": src, "x-amz-metadata-directive": "COPY"})
        if status == 404:
            sys.exit(f"copy {source} -> {dest}: the source vanished")

    def retype(self, key, mime):
        # A copy onto itself with the metadata replaced: the one way S3
        # changes what an object says it is without moving its bytes.
        src = "/" + self.name + "/" + urllib.parse.quote(key, safe="/~-_.")
        status, _, _ = self.call("PUT", key, {"x-amz-copy-source": src, "x-amz-metadata-directive": "REPLACE", "content-type": mime})
        if status == 404:
            sys.exit(f"retype {key}: the object vanished")

    def delete(self, key):
        self.call("DELETE", key)


def d1(database, *args):
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", database, "--remote", "--json", *args],
        capture_output=True, text=True, cwd=CLOUDFLARE,
    )
    if out.returncode != 0:
        sys.exit(f"wrangler d1 execute failed:\n{out.stderr[-2000:]}")
    # The JSON follows a banner (with colour codes, whose escapes hold a
    # "[" of their own); it is the first line that is a bare "[".
    text = re.sub(r"\x1b\[[0-9;]*m", "", out.stdout)
    start = text.find("\n[\n")
    if start < 0 and text.startswith("[\n"):
        start = -1
    if start < 0 and not text.startswith("[\n"):
        sys.exit(f"wrangler gave no JSON:\n{text[-2000:]}")
    return json.loads(text[start + 1:])


def d1_rows(database, sql):
    return d1(database, "--command", sql)[0]["results"]


def d1_file(database, sql):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", dir=CLOUDFLARE, delete=False) as f:
        f.write(sql)
        path = f.name
    try:
        return d1(database, "--file", path)
    finally:
        os.unlink(path)


def quoted(value):
    return "'" + value.replace("'", "''") + "'"


def iso_now():
    now = datetime.datetime.now(datetime.UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# The bucket serves a file with the type its object carries, and a file
# from the Python era was stored with none: give every typeless board
# file the type its card records, since the card is what knew it.
def retype(bucket, database, dry_run):
    rows = d1_rows(database,
        "SELECT DISTINCT file_path, mime_type FROM board_items WHERE file_path LIKE 'blobs/%' AND mime_type IS NOT NULL AND mime_type != '' AND mime_type != 'application/octet-stream'")
    retyped = 0
    for row in rows:
        if not KEY.match(row["file_path"]):
            continue
        object = bucket.head(BOARD_FILES + row["file_path"])
        if object is None or object["type"] not in ("", "application/octet-stream", "binary/octet-stream"):
            continue
        mime = row["mime_type"].split(";")[0].strip()
        print(f"  {row['file_path'][:18]}…: {object['type'] or 'no type'} -> {mime}")
        if not dry_run:
            bucket.retype(BOARD_FILES + row["file_path"], mime)
        retyped += 1
    return retyped


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    if len(args) != 1 or args[0] not in ENVIRONMENTS:
        sys.exit(__doc__)
    target = ENVIRONMENTS[args[0]]
    bucket_name, database = target["bucket"], target["database"]
    print(f"{args[0]}: bucket {bucket_name}, database {database}{' (dry run)' if dry_run else ''}")
    bucket = Bucket(bucket_name, secret("AWS_ACCESS_KEY_ID"), secret("AWS_SECRET_ACCESS_KEY"))

    rows = d1_rows(database,
        "SELECT uuid, file_path, sha256, revision FROM board_items WHERE file_path IS NOT NULL AND file_path != '' AND file_path NOT LIKE 'blobs/%' ORDER BY created_at, uuid")
    print(f"{len(rows)} rows carry a file not keyed by its hash")
    counts = {"rows": len(rows), "missing_object": 0, "bad_key": 0, "digest_computed": 0,
              "already_present": 0, "copied": 0, "verified": 0, "rows_rekeyed": 0, "deleted": 0, "retyped": 0}
    if not rows:
        counts["retyped"] = retype(bucket, database, dry_run)
        print(json.dumps(counts))
        return

    plan = []  # (row, old key within the area, sha256, the source object, whether the digest was computed)
    for row in rows:
        old = row["file_path"]
        if not KEY.match(old):
            print(f"  skip {row['uuid']}: file_path {old!r} is not a key")
            counts["bad_key"] += 1
            continue
        source = bucket.head(BOARD_FILES + old)
        if source is None:
            print(f"  skip {row['uuid']}: {old} is not in the bucket")
            counts["missing_object"] += 1
            continue
        sha = row["sha256"]
        computed = not sha or not DIGEST.match(sha)
        if computed:
            body = bucket.get(BOARD_FILES + old)
            if body is None:
                counts["missing_object"] += 1
                continue
            if len(body) != source["size"]:
                sys.exit(f"{old}: read {len(body)} bytes, HEAD said {source['size']}")
            sha = hashlib.sha256(body).hexdigest()
            counts["digest_computed"] += 1
        plan.append((row, old, sha, source, computed))
        print(f"  {row['uuid']}: {old} ({source['size']} bytes, {source['type'] or 'no type'}) -> blobs/{sha[:12]}…{' (digest computed)' if computed else ''}")

    if dry_run:
        print(f"dry run: {len(plan)} rows would be rekeyed; {json.dumps(counts)}")
        return

    # Copy, then verify, before any row changes. Two rows with the same
    # bytes share one destination: the second finds it there.
    verified = []
    for row, old, sha, source, computed in plan:
        new = f"blobs/{sha}"
        dest = bucket.head(BOARD_FILES + new)
        if dest is not None and dest["size"] == source["size"]:
            counts["already_present"] += 1
        else:
            bucket.copy(BOARD_FILES + old, BOARD_FILES + new)
            counts["copied"] += 1
            dest = bucket.head(BOARD_FILES + new)
        if dest is None or dest["size"] != source["size"]:
            print(f"  NOT verified {old} -> {new}: {dest}")
            continue
        # R2's ETag is the MD5 of a single-part object; a multipart one
        # carries a "-N" and is compared by size alone.
        if "-" not in source["etag"] and "-" not in dest["etag"] and source["etag"] != dest["etag"]:
            print(f"  NOT verified {old} -> {new}: etag {source['etag']} vs {dest['etag']}")
            continue
        counts["verified"] += 1
        verified.append((row, old, new, sha))

    if not verified:
        print(f"nothing verified; {json.dumps(counts)}")
        return

    # The rows, in one file. file_path is server-owned and travels to the
    # replicas, so the revision and updated_at move with it, as writeSynced
    # moves them; the snapshot half of a pull carries it (the desktop reads
    # a file by its sha256 and never by this column). Guarded by the old
    # value, so a row changed meanwhile is left alone.
    at = iso_now()
    statements = [
        f"UPDATE board_items SET file_path = {quoted(new)}, sha256 = {quoted(sha)}, revision = revision + 1, updated_at = {quoted(at)} "
        f"WHERE uuid = {quoted(row['uuid'])} AND file_path = {quoted(old)};"
        for row, old, new, sha in verified
    ]
    d1_file(database, "\n".join(statements))

    # Read back before deleting anything (a file's execution answers with
    # one summary, not a count per statement): only a row that now names
    # the new key has its old key removed.
    uuids = ",".join(quoted(row["uuid"]) for row, *_ in verified)
    now_keyed = {r["uuid"]: r["file_path"] for r in d1_rows(database, f"SELECT uuid, file_path FROM board_items WHERE uuid IN ({uuids})")}
    for row, old, new, sha in verified:
        if now_keyed.get(row["uuid"]) != new:
            print(f"  kept {old}: row {row['uuid']} was not rekeyed")
            continue
        counts["rows_rekeyed"] += 1
        bucket.delete(BOARD_FILES + old)
        counts["deleted"] += 1
    print(f"{counts['rows_rekeyed']} rows rekeyed of {len(verified)}")
    counts["retyped"] = retype(bucket, database, dry_run)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
