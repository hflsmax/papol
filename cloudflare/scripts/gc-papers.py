#!/usr/bin/env python3
"""Papers nobody holds: list them, and, asked to, let them go.

A paper is nobody's. A copy let go of leaves the paper's row and its PDF in
the Library, and nothing removes them by itself: that is a decision, and
this is the hand that carries it out (docs/cloud-migration.md, phase 5,
step 13). An orphan is a paper with no live copy by anyone, no annotation
by anyone (a soft-deleted one still counts: a replica may still hold it),
no seminar, no link out and no board card carrying its file.

    python3 cloudflare/scripts/gc-papers.py --list              # production
    python3 cloudflare/scripts/gc-papers.py --list --env dev
    python3 cloudflare/scripts/gc-papers.py --delete --env dev

--list prints every orphan with its title, DOI, hash prefix, age and file
size. --delete removes those rows, the tombstoned copies that still point
at them (the database enforces its foreign keys), their paper_links, paper_floats,
paper_references and paper_citations rows, and their bucket objects,
printing what went. Never --delete on production without a --list first,
and the day's D1 point-in-time restore behind you.

Standard library only. The database is reached through `npx wrangler d1
execute` and the bucket through `npx wrangler r2 object delete`, both run
from cloudflare/, so the login `wrangler deploy` needs is all it needs;
sizes are read with a HEAD on the site's own /uploads route, which the
bucket answers.
"""

import argparse
import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CLOUDFLARE = Path(__file__).resolve().parent.parent

ENVIRONMENTS = {
    "production": {"database": "papol", "bucket": "papol-files", "site": "https://papol.io", "flags": []},
    "dev": {"database": "papol-dev", "bucket": "papol-files-dev", "site": "https://dev.papol.io", "flags": ["--env", "dev"]},
}

DIGEST = re.compile(r"^[0-9a-f]{64}$")
FILE = re.compile(r"^[A-Za-z0-9._-]+$")

ORPHANS = """
SELECT p.sha256, p.doi, p.title, p.file_path, p.created_at,
       (SELECT count(*) FROM copies c WHERE c.paper_sha256 = p.sha256) AS tombstones,
       (SELECT count(*) FROM paper_links l WHERE l.paper_sha256 = p.sha256) AS links,
       (SELECT count(*) FROM paper_references r WHERE r.paper_sha256 = p.sha256) AS refs,
       (SELECT count(*) FROM paper_citations t WHERE t.paper_sha256 = p.sha256) AS citations
FROM papers p
WHERE p.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM copies c WHERE c.paper_sha256 = p.sha256 AND c.deleted_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.paper_sha256 = p.sha256)
  AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.paper_sha256 = p.sha256)
  AND NOT EXISTS (SELECT 1 FROM sharables s WHERE s.paper_sha256 = p.sha256)
  AND NOT EXISTS (SELECT 1 FROM board_items b WHERE b.sha256 = p.sha256)
ORDER BY p.created_at, p.sha256
"""


def wrangler(*args):
    completed = subprocess.run(["npx", "wrangler", *args], cwd=CLOUDFLARE, capture_output=True, text=True)
    if completed.returncode != 0:
        sys.exit(f"wrangler {' '.join(args)} failed:\n{completed.stdout}{completed.stderr}")
    return completed.stdout


# Delete a bucket object: true when it went, false when it was not there
# (a row whose file is already gone is still a row to remove).
def delete_object(env, key):
    completed = subprocess.run(["npx", "wrangler", "r2", "object", "delete", f"{env['bucket']}/{key}", "--remote"], cwd=CLOUDFLARE, capture_output=True, text=True)
    if completed.returncode == 0:
        return True
    if "not found" in f"{completed.stdout}{completed.stderr}".lower():
        return False
    sys.exit(f"wrangler r2 object delete {key} failed:\n{completed.stdout}{completed.stderr}")


def query(env, sql):
    out = wrangler("d1", "execute", env["database"], "--remote", "--json", *env["flags"], "--command", sql)
    # --json answers with one result per statement; anything before the
    # array is wrangler talking, and is skipped.
    start = out.index("[")
    return json.loads(out[start:])[0]["results"]


def execute_file(env, statements):
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as handle:
        handle.write("\n".join(statements) + "\n")
        path = handle.name
    wrangler("d1", "execute", env["database"], "--remote", *env["flags"], "--file", path)


class Head(urllib.request.HTTPRedirectHandler):
    # A redirect to the bucket's own address is followed as a HEAD, not
    # turned into a GET of the whole PDF, which is what urllib does alone.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return urllib.request.Request(newurl, headers=req.headers, method="HEAD")


def file_size(env, file_path):
    # Named: the edge answers urllib's own User-Agent with a 403.
    request = urllib.request.Request(f"{env['site']}/uploads/{file_path}", method="HEAD", headers={"User-Agent": "papol-gc-papers"})
    try:
        with urllib.request.build_opener(Head).open(request, timeout=30) as answer:
            length = answer.headers.get("content-length")
            return int(length) if length else None
    except (urllib.error.URLError, ValueError):
        return None


def age(created_at):
    if not created_at:
        return "?"
    when = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    days = (datetime.now(timezone.utc) - when).days
    return f"{days}d"


def size_text(size):
    if size is None:
        return "missing"
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.1f} MB"
    return f"{size / 1024:.0f} KB"


def listed(env):
    papers = query(env, ORPHANS)
    for paper in papers:
        paper["size"] = file_size(env, paper["file_path"]) if FILE.match(paper["file_path"] or "") else None
    return papers


def print_list(papers):
    if not papers:
        print("No orphan papers.")
        return
    print(f"{'hash':<10} {'age':>5} {'size':>9}  {'DOI':<28} title")
    for paper in papers:
        print(f"{paper['sha256'][:8]}…  {age(paper['created_at']):>5} {size_text(paper['size']):>9}  {(paper['doi'] or '—'):<28} {paper['title']}")
    total = sum(paper["size"] or 0 for paper in papers)
    print(f"{len(papers)} orphan paper(s), {size_text(total)} of PDF.")


def delete(env, papers):
    for paper in papers:
        sha256 = paper["sha256"]
        if not DIGEST.match(sha256):
            sys.exit(f"refusing to touch a paper not named by a digest: {sha256!r}")
        execute_file(env, [
            f"DELETE FROM copy_tags WHERE copy_uuid IN (SELECT uuid FROM copies WHERE paper_sha256 = '{sha256}');",
            f"DELETE FROM copies WHERE paper_sha256 = '{sha256}' AND deleted_at IS NOT NULL;",
            f"DELETE FROM paper_citations WHERE paper_sha256 = '{sha256}';",
            f"DELETE FROM paper_references WHERE paper_sha256 = '{sha256}';",
            f"DELETE FROM paper_links WHERE paper_sha256 = '{sha256}';",
            f"DELETE FROM paper_floats WHERE paper_sha256 = '{sha256}';",
            f"DELETE FROM papers WHERE sha256 = '{sha256}' AND deleted_at IS NULL"
            f"  AND NOT EXISTS (SELECT 1 FROM copies WHERE paper_sha256 = '{sha256}')"
            f"  AND NOT EXISTS (SELECT 1 FROM annotations WHERE paper_sha256 = '{sha256}');",
        ])
        if query(env, f"SELECT 1 AS n FROM papers WHERE sha256 = '{sha256}'"):
            print(f"{sha256[:8]}…  kept: something took it up while this ran")
            continue
        rows = f"{paper['tombstones']} copy tombstone(s), {paper['links']} link(s), {paper['refs']} reference(s), {paper['citations']} citation(s)"
        file_path = paper["file_path"] or ""
        shared = query(env, f"SELECT 1 AS n FROM papers WHERE file_path = '{file_path}'") if FILE.match(file_path) else []
        if FILE.match(file_path) and not shared:
            went = delete_object(env, f"uploads/{file_path}") and paper["size"] is not None
            print(f"{sha256[:8]}…  row gone with {rows}; uploads/{file_path} " + (f"({size_text(paper['size'])}) gone" if went else "was not in the bucket"))
        else:
            print(f"{sha256[:8]}…  row gone with {rows}; file {file_path!r} left (another paper's, or not a bucket key)")


def main():
    parser = argparse.ArgumentParser(description="List, or delete, the papers nobody holds.")
    parser.add_argument("--env", choices=sorted(ENVIRONMENTS), default="production", help="which Papol (default: production)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list", action="store_true", help="print the orphans and stop")
    mode.add_argument("--delete", action="store_true", help="remove the orphans, their rows and their files")
    parser.add_argument("--only", metavar="HASH,...", help="only the orphans whose sha256 starts with one of these")
    args = parser.parse_args()
    env = ENVIRONMENTS[args.env]
    print(f"{args.env}: database {env['database']}, bucket {env['bucket']}")
    papers = listed(env)
    if args.only:
        prefixes = [prefix.strip().lower() for prefix in args.only.split(",") if prefix.strip()]
        papers = [paper for paper in papers if any(paper["sha256"].startswith(prefix) for prefix in prefixes)]
    print_list(papers)
    if args.delete and papers:
        print()
        delete(env, papers)


if __name__ == "__main__":
    main()
