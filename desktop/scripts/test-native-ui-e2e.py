#!/usr/bin/env python3
"""The native shell against a real backend, driven through its own window.

Every other check of Papol macOS stops short of the shell. The browser
smokes open the bundled pages with a mocked bridge; `cargo test` and the
sync end-to-end drive the replica from Rust with no window anywhere. What
none of them can say is whether the application a person opens comes up,
takes a sign-in, and shows the paper the service holds — the gap
docs/release-checks.md names, and the reason the installed app used to be
opened by hand before a tag.

This asks the window for three things first, all by the names a user
sees: the sign-in form, then the desk, then one seeded paper listed in it.
Then two things a user does, each a press or two of a named button and
nothing typed:

  * with the service stopped, a shelf is added — the change waits in the
    replica's outbox — and once the service is back on the same port, the
    Sync button carries it there;
  * the app is started again on a PDF, as Finder starts it, and "Add to
    nook" in the viewer window puts the paper in the replica and, by the
    next sync, on the service.

Everything past the presses is read from the replica and the service as a
value, because a suite that drives a whole feature through the
accessibility API spends its failures on itself (see the head of
papol-ui.swift). The service is the Worker on a port of its own, the app is
the real binary compiled against that port, and the replica is a fresh one
under a throwaway HOME.

    npm run test:e2e:native-ui          # from desktop/, with mise.toml's tools

It needs Accessibility permission for whatever runs it. On a Mac that is
System Settings → Privacy & Security → Accessibility for the terminal; on
the CI runner the workflow grants it to the job before this starts.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import uuid

import disposable_backend as backend_service
from disposable_backend import ROOT, request


DESKTOP = ROOT / "desktop"
DRIVER = DESKTOP / "scripts" / "papol-ui.swift"
DEV_CONFIG = DESKTOP / "src-tauri" / "tauri.dev.conf.json"
BINARY = DESKTOP / "src-tauri" / "target" / "debug" / "papol-desktop"
# The address is compiled into the web payload, so it is fixed rather than
# chosen per run: a payload built for it once is reused until the pages
# change, and the compiled app with it.
PORT = int(os.environ.get("PAPOL_E2E_PORT", "8765"))
PAPER_TITLE = "Native interface end-to-end paper"
# Where a screenshot and the logs go when the check fails; CI keeps them.
ARTIFACTS = Path(os.environ.get("PAPOL_E2E_ARTIFACTS", tempfile.gettempdir())) / "native-ui"


def say(message):
    print(f"==> {message}", flush=True)


def ui(*arguments):
    """One driver command; its exit status is part of the answer."""
    completed = subprocess.run(
        ["xcrun", "swift", str(DRIVER), *arguments],
        capture_output=True,
        text=True,
    )
    return completed.returncode, (completed.stdout + completed.stderr).strip()


def press(pid, name, role="AXButton"):
    status, output = ui("press", str(pid), name, role)
    if status:
        raise RuntimeError(output)


def require_driver():
    if sys.platform != "darwin":
        raise SystemExit("the native interface check runs on macOS only")
    status, output = ui("windows")
    if status == 3:
        raise SystemExit(output)
    if status != 0:
        raise SystemExit(f"papol-ui could not run\n{output}")


def build_app():
    """The real binary, compiled against this run's backend address.

    `tauri build` runs the web build first, and the address is part of that
    payload's cache key, so a second run against the same port compiles
    nothing it does not have to. No bundle: a bare binary opens its window
    like any other process, and the accessibility API does not care.
    """
    environment = {**os.environ, "PAPOL_BACKEND_URL": f"http://127.0.0.1:{PORT}"}
    subprocess.run(
        ["node", "scripts/write-info-plist.mjs", "src-tauri/tauri.dev.conf.json"],
        cwd=DESKTOP, env=environment, check=True,
    )
    subprocess.run(
        ["npx", "tauri", "build", "--debug", "--no-bundle", "--config", str(DEV_CONFIG)],
        cwd=DESKTOP, env=environment, check=True,
    )
    if not BINARY.exists():
        raise RuntimeError(f"the build finished but left no binary at {BINARY}")


def launch(home, *arguments):
    """The app on this run's replica. HOME is where Tauri's application data
    directory hangs, so the replica is this run's own and gone afterwards;
    a second launch appends to the same log."""
    with open(home / "app.log", "a") as log:
        return subprocess.Popen(
            [str(BINARY), *arguments],
            env={**os.environ, "HOME": str(home)},
            stdout=log, stderr=subprocess.STDOUT,
        )


def quit_app(app):
    if app is None or app.poll() is not None:
        return
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
        app.wait()


def wait_for(pid, *fragments, seconds=60):
    """Poll the window until every fragment is named somewhere in it.

    Returns the listing that satisfied it, or raises with the last listing
    so a failure shows what the page was showing instead.
    """
    deadline = time.monotonic() + seconds
    listing = ""
    while time.monotonic() < deadline:
        _, listing = ui("dump", str(pid))
        if all(fragment in listing for fragment in fragments):
            return listing
        time.sleep(1)
    wanted = ", ".join(repr(fragment) for fragment in fragments)
    raise RuntimeError(f"the window never showed {wanted}; it shows:\n{listing}")


def eventually(what, probe, seconds=60, every=1, between=None):
    """Poll `probe` until it answers something truthy, and answer that.

    `between` runs before each wait, for a check that needs nudging — a
    Sync pressed again — rather than only watching.
    """
    deadline = time.monotonic() + seconds
    while True:
        found = probe()
        if found:
            return found
        if time.monotonic() >= deadline:
            raise RuntimeError(f"{what} did not happen within {seconds} s")
        if between is not None:
            between()
        time.sleep(every)


def replica_path(home, identifier):
    return home / "Library" / "Application Support" / identifier / "papol.sqlite3"


def replica(home, identifier, query, *parameters):
    database = replica_path(home, identifier)
    if not database.exists():
        raise RuntimeError(f"the app left no replica at {database}")
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        return connection.execute(query, parameters).fetchall()
    finally:
        connection.close()


def service_rows(backend, token, table):
    """The rows the service holds for this account in one table, keyed as
    the snapshot keys them: a paper by its file, anything else by UUID."""
    snapshot = request(f"{backend}/api/sync/snapshot", token=token, timeout=10)
    key = "sha256" if table == "papers" else "uuid"
    return {row[key]: row for row in snapshot["rows"] if row["table"] == table}


def a_pdf(path, marker):
    """A one-page PDF of its own: the marker makes its bytes, and so its
    digest, new to the service each run. The cross-reference offsets are
    counted rather than written in, so PDF.js reads it without repair."""
    text = f"Opened from disk {marker}"
    stream = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))
    return path


def keep_evidence(pid, app, home, identifier):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    if pid is not None:
        status, listing = ui("dump", str(pid))
        (ARTIFACTS / "window.txt").write_text(f"dump exited {status}\n{listing}\n")
        ui("shot", str(pid), str(ARTIFACTS / "window.png"))
    if app is not None and (home / "app.log").exists():
        shutil.copy(home / "app.log", ARTIFACTS / "app.log")
    for log in home.parent.glob("service/wrangler*.log"):
        shutil.copy(log, ARTIFACTS / log.name.replace("wrangler", "backend"))
    # The replica as the app left it: what the outbox still held, and what
    # had arrived, is usually the whole answer to a sync that did not.
    database = replica_path(home, identifier)
    for suffix in ("", "-wal", "-shm"):
        source = database.with_name(database.name + suffix)
        if source.exists():
            shutil.copy(source, ARTIFACTS / source.name)
    say(f"kept the window listing, screenshot, logs and replica in {ARTIFACTS}")


class Backend:
    """The Worker on the port the app is compiled against, stoppable and
    startable again on its own state, as a service that went away and came
    back is."""

    def __init__(self, directory):
        self.directory = directory
        self.process = None
        self.url = f"http://127.0.0.1:{PORT}"
        self.starts = 0

    def start(self):
        if self.starts:
            # start() writes a fresh log; the first one is evidence too.
            first = self.directory / "wrangler.log"
            if first.exists():
                first.rename(self.directory / f"wrangler-{self.starts}.log")
        self.process = backend_service.start(self.directory, PORT)
        self.starts += 1
        backend_service.wait_ready(self.url, self.process)

    def stop(self):
        backend_service.stop(self.process)
        self.process = None
        # wrangler's runtime lets go of the port a moment after it exits.
        eventually("the backend's port coming free", lambda: backend_service.port_is_free(PORT), 30)


def offline_then_online(pid, backend, auth, home, identifier):
    """A change made while the service is down waits, and then arrives."""
    shelves = lambda: {row[0] for row in replica(home, identifier, "SELECT uuid FROM shelves")}
    before = eventually("the first pull of the nook's shelves", shelves)

    say("Stopping the backend")
    backend.stop()

    # The one change the desk makes with presses alone: the nook manager's
    # "Add another shelf" names the shelf itself.
    press(pid, "Manage nook")
    wait_for(pid, "Add another shelf")
    press(pid, "Add another shelf")
    added = eventually("the new shelf reaching the replica", lambda: shelves() - before, 30)
    (shelf,) = added
    # The dialog is modal: while it is open, WebKit publishes nothing
    # outside it, and the Sync button below would not be found.
    press(pid, "Close nook manager")

    waiting = replica(
        home, identifier,
        "SELECT state, attempts FROM _local_outbox WHERE changes_json LIKE ?", f"%{shelf}%",
    )
    if not waiting or any(state != "pending" for state, _ in waiting):
        raise RuntimeError(f"the offline shelf is not pending in the outbox: {waiting!r}")
    say(f"Added a shelf with the backend down; it waits in the outbox ({waiting!r})")

    say("Starting the backend again on the same port")
    backend.start()
    if shelf in service_rows(backend.url, auth["token"], "shelves"):
        raise RuntimeError("the service held the offline shelf before any sync")

    # Nothing tells the app the service is back: the browser still says it
    # is online, and the window's visibility has not changed. The Sync
    # button is what a user presses then, and it is labelled with the
    # state it reports ("Sync now — Offline · 1 pending"), hence a prefix.
    press(pid, "Sync now*")
    eventually(
        "the offline shelf arriving at the service",
        lambda: shelf in service_rows(backend.url, auth["token"], "shelves"),
        seconds=90, every=10, between=lambda: ui("press", str(pid), "Sync now*", "AXButton"),
    )
    eventually(
        "the outbox emptying of the shelf",
        lambda: not replica(
            home, identifier, "SELECT 1 FROM _local_outbox WHERE changes_json LIKE ?", f"%{shelf}%",
        ),
        30,
    )
    say("Synced once the backend was back: the service holds the shelf, the outbox is empty")


def add_opened_pdf(pid, backend, auth, home, identifier, sha256):
    """"Add to nook" on a file the app was opened with."""
    wait_for(pid, "Add to nook")
    say("The PDF opened in a viewer window offering Add to nook")
    press(pid, "Add to nook")

    def copy_in_replica():
        rows = replica(
            home, identifier,
            "SELECT c.uuid FROM copies c JOIN papers p ON p.sha256 = c.paper_sha256 "
            "WHERE p.sha256 = ? AND c.deleted_at IS NULL", sha256,
        )
        return rows[0][0] if rows else None

    # The paper waits on the service's reading of the file, which gives up
    # after nook_add_reading (15 s) when there is nothing to read it with.
    copy = eventually("the opened PDF reaching the replica", copy_in_replica, 60)
    say("The replica holds the opened paper and its copy")

    def on_service():
        try:
            return (
                sha256 in service_rows(backend.url, auth["token"], "papers")
                and copy in service_rows(backend.url, auth["token"], "copies")
            )
        except (OSError, urllib.error.HTTPError):
            return False

    # The viewer asks for a sync as the rows are written; the snapshot
    # lists a paper only through a copy of it, so both arriving is the
    # push, not only the upload of the file.
    eventually("the opened paper arriving at the service", on_service, 90, every=3)
    say("and so does the service, after sync")


def main():
    require_driver()
    backend_service.require_backend_python()
    if not backend_service.port_is_free(PORT):
        raise SystemExit(
            f"port {PORT} is taken; the app is compiled against it, so stop "
            "whatever holds it or set PAPOL_E2E_PORT"
        )
    identifier = json.loads(DEV_CONFIG.read_text())["identifier"]

    say("Compiling the app against the disposable backend")
    build_app()

    with tempfile.TemporaryDirectory(prefix="papol-native-ui-") as directory:
        temporary = Path(directory)
        home = temporary / "home"
        home.mkdir()
        backend = Backend(temporary / "service")
        app = pid = None
        try:
            say(f"Starting the backend at {backend.url}")
            backend.start()
            auth = backend_service.register(backend.url, "Native UI E2E")
            backend_service.create_paper(backend.url, auth["token"], PAPER_TITLE)

            say("Opening the app on a fresh replica")
            app = launch(home)
            pid = app.pid
            wait_for(pid, "AXTextField: Email", "AXButton: Sign in")
            say("The desk opened on its sign-in form")

            for field, text in (("Email", auth["email"]), ("Password", auth["password"])):
                status, output = ui("type", str(pid), field, text)
                if status:
                    raise RuntimeError(output)
            press(pid, "Sign in")
            wait_for(pid, "My nook")
            say("Signed in; the nook is showing")

            wait_for(pid, PAPER_TITLE)
            say("The paper the service holds is listed in the window")

            titles = [row[0] for row in replica(home, identifier, "SELECT title FROM papers")]
            if PAPER_TITLE not in titles:
                raise RuntimeError(f"the replica holds {titles!r}, not the seeded paper")
            say("and the replica underneath holds it too")

            offline_then_online(pid, backend, auth, home, identifier)

            # Opened as Finder opens a file with an app that is not running:
            # the path is the launch's argument, and the app comes up in a
            # viewer window for it. A second process on the same replica
            # would be two writers, so the first one goes first.
            say("Starting the app again, on a PDF")
            quit_app(app)
            pdf = a_pdf(temporary / "Opened end-to-end.pdf", uuid.uuid4().hex)
            sha256 = hashlib.sha256(pdf.read_bytes()).hexdigest()
            app = launch(home, str(pdf))
            pid = app.pid
            add_opened_pdf(pid, backend, auth, home, identifier, sha256)

            if app.poll() is not None:
                raise RuntimeError(f"the app exited with {app.returncode} during the check")
            print("native shell, sign-in, offline change, opened PDF, and synchronization: ok")
        except Exception:
            keep_evidence(pid, app, home, identifier)
            raise
        finally:
            quit_app(app)
            backend_service.stop(backend.process)


if __name__ == "__main__":
    main()
