#!/usr/bin/env python3
"""Make dev.papol.io a fresh copy of production.

Run by .github/workflows/refresh-dev.yml, by hand from the Actions tab. Dev
is where a build meets real data before people do (the beta), so it takes
production's data whole and keeps its own configuration: its own database,
its own bucket, its own queue, and no mail.

    python3 cloudflare/scripts/refresh-dev.py

What it does, in order:

1. Refuses to run if dev has mail credentials. Mail is off on dev because
   those secrets are absent, and a copy of production's users is exactly
   the list that must never be mailed from a beta.
2. Notes dev's sign-in sessions.
3. Exports production's database. The only thing ever done to production.
4. Empties dev's database and imports the export into it.
5. Puts back dev's own sessions for users production also has, beside
   production's sessions, which came across with the rest: whoever is
   signed in on either stays signed in on dev.
6. Clears the jobs, so nothing production has done or queued is done
   again, and drops the Python-era mail settings.
7. Applies the migrations dev's code has that production's has not yet.
8. Copies into dev's bucket every file the data names that dev lacks —
   papers' PDFs, avatars, board files — checking each against its name
   where the name is its digest.

Standard library only, as gc-papers.py; the database and bucket are
reached through `npx wrangler`, from cloudflare/, and files are read from
the two buckets' public domains.
"""

import hashlib
import json
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

CLOUDFLARE = Path(__file__).resolve().parent.parent

SOURCE_DATABASE = "papol"
TARGET = ["--env", "dev"]
TARGET_DATABASE = "papol-dev"
TARGET_BUCKET = "papol-files-dev"
SOURCE_FILES = "https://files.papol.io"
TARGET_FILES = "https://files-dev.papol.io"
# The edge refuses Python's own User-Agent.
AGENT = "Papol-refresh-dev/1.0"

ANSI = re.compile(r"\x1b\[[0-9;]*m")
# Every key a row can name. Anything else is reported and left alone.
KEY = re.compile(r"^(uploads/[0-9a-f]{64}\.pdf|uploads/avatars/[A-Za-z0-9._-]+|board_uploads/blobs/[0-9a-f]{64})$")
DIGEST = re.compile(r"([0-9a-f]{64})(\.pdf)?$")

FILES = """
SELECT 'uploads/' || file_path AS key FROM papers WHERE file_path IS NOT NULL
UNION SELECT 'uploads/' || avatar_path FROM users WHERE avatar_path IS NOT NULL
UNION SELECT 'board_uploads/' || file_path FROM board_items WHERE file_path IS NOT NULL
ORDER BY key
"""


def say(text):
    print(f"==> {text}", flush=True)


def wrangler(*args):
    completed = subprocess.run(["npx", "wrangler", *args], cwd=CLOUDFLARE, capture_output=True, text=True)
    if completed.returncode != 0:
        sys.exit(f"wrangler {' '.join(args)} failed:\n{completed.stdout}{completed.stderr}")
    return completed.stdout


# The JSON after wrangler's banner: the first line that is a bare "[" once
# the colour escapes are gone (the escapes contain "[" themselves).
def json_out(text):
    lines = ANSI.sub("", text).splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "[")
    return json.loads("\n".join(lines[start:]))


def query_dev(sql):
    return json_out(wrangler("d1", "execute", TARGET_DATABASE, "--remote", *TARGET, "--json", "--command", sql))[0]["results"]


def run_dev_file(path):
    wrangler("d1", "execute", TARGET_DATABASE, "--remote", *TARGET, "--file", str(path))


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


# Every table, each after every table that points at it.
def drop_order(links):
    parents = {}
    for link in links:
        parents.setdefault(link["child"], set())
        if link["parent"] and link["parent"] != link["child"]:
            parents[link["child"]].add(link["parent"])
    children = {name: {child for child, above in parents.items() if name in above} for name in parents}
    order, placed = [], set()
    while len(order) < len(parents):
        ready = sorted(name for name in parents if name not in placed and children[name] <= placed)
        if not ready:
            sys.exit(f"the foreign keys among {sorted(set(parents) - placed)} form a cycle; cannot order the drops")
        order += ready
        placed.update(ready)
    return order


def fetch(url, method="GET"):
    request = urllib.request.Request(url, method=method, headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, response.headers.get("content-type"), response.read() if method == "GET" else b""
    except urllib.error.HTTPError as error:
        return error.code, None, b""


def main():
    say("Dev must not be able to send mail")
    secrets = {s["name"] for s in json_out(wrangler("secret", "list", *TARGET, "--format", "json"))}
    mail = sorted(name for name in secrets if name.startswith("EMAIL_"))
    if mail:
        sys.exit(f"dev has mail credentials ({', '.join(mail)}); remove them before copying production's users there")

    say("Noting dev's sessions")
    dev_sessions = query_dev("SELECT * FROM auth_tokens")
    print(f"    {len(dev_sessions)}")

    with tempfile.TemporaryDirectory() as work:
        work = Path(work)
        say("Exporting production's database")
        export = work / "production.sql"
        wrangler("d1", "export", SOURCE_DATABASE, "--remote", "--output", str(export))
        print(f"    {export.stat().st_size / 1e6:.1f} MB")

        # The export creates every table, so it goes into an empty database.
        # Children go before their parents: dropping a parent deletes its
        # rows one by one, and each deletion looks for children pointing at
        # it, so a parent dropped first scans its children once per row —
        # paper_references before paper_citations read 9.6 million rows a
        # refresh, twice the free tier's day, on 2026-09-23.
        say("Emptying dev's database")
        tables = drop_order(query_dev(
            "SELECT m.name AS child, p.\"table\" AS parent FROM sqlite_master m LEFT JOIN pragma_foreign_key_list(m.name) p "
            "WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\'"))
        drop = work / "drop.sql"
        drop.write_text("PRAGMA defer_foreign_keys=TRUE;\n" + "".join(f'DROP TABLE IF EXISTS "{name}";\n' for name in tables))
        run_dev_file(drop)
        print(f"    {len(tables)} tables dropped")

        say("Importing production into dev")
        run_dev_file(export)

        say("Keeping dev's sessions, clearing the jobs and the old mail settings")
        statements = ["DELETE FROM jobs;", "DELETE FROM settings WHERE key LIKE 'smtp\\_%' ESCAPE '\\';"]
        for session in dev_sessions:
            columns = ", ".join(session)
            values = ", ".join(literal(v) for v in session.values())
            statements.append(f"INSERT OR IGNORE INTO auth_tokens ({columns}) SELECT {values} "
                              f"WHERE EXISTS (SELECT 1 FROM users WHERE uuid = {literal(session['user_uuid'])});")
        scrub = work / "scrub.sql"
        scrub.write_text("\n".join(statements) + "\n")
        run_dev_file(scrub)

    say("Applying dev's migrations")
    print(ANSI.sub("", wrangler("d1", "migrations", "apply", TARGET_DATABASE, "--remote", *TARGET)).strip().splitlines()[-1])

    say("Copying the files dev lacks")
    copied = present = 0
    problems = []
    for row in query_dev(FILES):
        key = row["key"]
        if not KEY.match(key):
            problems.append(f"{key}: not a key this build writes; left alone")
            continue
        if fetch(f"{TARGET_FILES}/{key}", "HEAD")[0] == 200:
            present += 1
            continue
        status, content_type, body = fetch(f"{SOURCE_FILES}/{key}")
        if status != 200:
            problems.append(f"{key}: production answered {status}")
            continue
        named = DIGEST.search(key)
        if named and not key.startswith("uploads/avatars/") and hashlib.sha256(body).hexdigest() != named.group(1):
            problems.append(f"{key}: production's bytes do not hash to their name; not copied")
            continue
        with tempfile.NamedTemporaryFile() as held:
            held.write(body)
            held.flush()
            wrangler("r2", "object", "put", f"{TARGET_BUCKET}/{key}", "--remote", "--file", held.name,
                     "--content-type", content_type or "application/octet-stream")
        copied += 1
        print(f"    {key} ({len(body) / 1e6:.1f} MB)", flush=True)
    print(f"    {copied} copied, {present} already there")

    counts = query_dev("SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM papers) AS papers, "
                       "(SELECT count(*) FROM auth_tokens) AS sessions, (SELECT count(*) FROM jobs) AS jobs")[0]
    say(f"Dev now holds production's data: {counts['users']} users, {counts['papers']} papers, "
        f"{counts['sessions']} sessions, {counts['jobs']} jobs")
    for problem in problems:
        print(f"    ! {problem}")
    if any("hash" in p for p in problems):
        sys.exit(1)


if __name__ == "__main__":
    main()
