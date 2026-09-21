#!/usr/bin/env python3
"""The native shell against a real backend, driven through its own window.

Every other check of Papol macOS stops short of the shell. The browser
smokes open the bundled pages with a mocked bridge; `cargo test` and the
sync end-to-end drive the replica from Rust with no window anywhere. What
none of them can say is whether the application a person opens comes up,
takes a sign-in, and shows the paper the service holds — the gap
docs/release-checks.md names, and the reason the installed app used to be
opened by hand before a tag.

This asks the window for exactly three things, all by the names a user
sees: the sign-in form, then the desk, then one seeded paper listed in it.
Everything past that is read from the replica as a value, because a suite
that drives a whole feature through the accessibility API spends its
failures on itself (see the head of papol-ui.swift). The service is a real
FastAPI on a port of its own, the app is the real binary compiled against
that port, and the replica is a fresh one under a throwaway HOME.

    npm run test:e2e:native-ui          # from desktop/, inside `nix develop`

It needs Accessibility permission for whatever runs it. On a Mac that is
System Settings → Privacy & Security → Accessibility for the terminal; on
the CI runner the workflow grants it to the job before this starts.
"""

import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

import disposable_backend as backend_service
from disposable_backend import ROOT


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


def replica_titles(home, identifier):
    database = home / "Library" / "Application Support" / identifier / "papol.sqlite3"
    if not database.exists():
        raise RuntimeError(f"the app left no replica at {database}")
    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    try:
        return [row[0] for row in connection.execute("SELECT title FROM papers")]
    finally:
        connection.close()


def keep_evidence(pid, app, server, home):
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    if pid is not None:
        status, listing = ui("dump", str(pid))
        (ARTIFACTS / "window.txt").write_text(f"dump exited {status}\n{listing}\n")
        ui("shot", str(pid), str(ARTIFACTS / "window.png"))
    if app is not None and (home / "app.log").exists():
        shutil.copy(home / "app.log", ARTIFACTS / "app.log")
    if server is not None and server.poll() is not None:
        stdout, stderr = server.communicate()
        (ARTIFACTS / "backend.log").write_text(stdout + stderr)
    say(f"kept the window listing, screenshot and logs in {ARTIFACTS}")


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
        backend = f"http://127.0.0.1:{PORT}"
        server = app = pid = None
        try:
            say(f"Starting the backend at {backend}")
            server = backend_service.start(temporary / "service", PORT)
            backend_service.wait_ready(backend, server)
            auth = backend_service.register(backend, "Native UI E2E")
            backend_service.create_paper(backend, auth["token"], PAPER_TITLE)

            say("Opening the app on a fresh replica")
            with open(home / "app.log", "w") as log:
                # HOME is where Tauri's application data directory hangs, so
                # this run's replica is its own and gone afterwards.
                app = subprocess.Popen(
                    [str(BINARY)],
                    env={**os.environ, "HOME": str(home)},
                    stdout=log, stderr=subprocess.STDOUT,
                )
            pid = app.pid
            wait_for(pid, "AXTextField: Email", "AXButton: Sign in")
            say("The desk opened on its sign-in form")

            for field, text in (("Email", auth["email"]), ("Password", auth["password"])):
                status, output = ui("type", str(pid), field, text)
                if status:
                    raise RuntimeError(output)
            status, output = ui("press", str(pid), "Sign in", "AXButton")
            if status:
                raise RuntimeError(output)
            wait_for(pid, "My nook")
            say("Signed in; the nook is showing")

            wait_for(pid, PAPER_TITLE)
            say("The paper the service holds is listed in the window")

            titles = replica_titles(home, identifier)
            if PAPER_TITLE not in titles:
                raise RuntimeError(f"the replica holds {titles!r}, not the seeded paper")
            say("and the replica underneath holds it too")
            if app.poll() is not None:
                raise RuntimeError(f"the app exited with {app.returncode} during the check")
            print("native shell, sign-in, and first synchronization: ok")
        except Exception:
            keep_evidence(pid, app, server, home)
            raise
        finally:
            if app is not None:
                app.terminate()
                try:
                    app.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    app.kill()
            backend_service.stop(server)


if __name__ == "__main__":
    main()
