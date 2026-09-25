"""A real backend that lives for one test run and leaves nothing behind.

Both native end-to-end checks — the replica driven from Rust, and the app
driven through its window — need the same thing underneath: the Worker on a
port of its own, an empty database, and an account with a paper in it.
Stated once here so the two checks cannot drift into testing against two
different services.

The Worker is `wrangler dev`, run from cloudflare/ with its state — the D1,
the R2 — persisted under the run's temporary directory rather than the
checkout's .wrangler. Its Node is the one mise.toml pins; this file wants
nothing of Python's but the standard library, so the Mac's own interpreter
is enough to run the checks.
"""

import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid


ROOT = Path(__file__).parents[2]
CLOUDFLARE = ROOT / "cloudflare"
SEED_PDF = b"%PDF-1.4\nnative e2e seed\n%%EOF"


def request(url, method="GET", body=None, token=None, timeout=5, data=None, headers=None):
    if body is not None:
        data = json.dumps(body).encode()
    headers = dict(headers or {})
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(
        urllib.request.Request(url, data=data, headers=headers, method=method),
        timeout=timeout,
    ) as response:
        return json.loads(response.read() or b"null")


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def port_is_free(port):
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            return False
        return True


def require_backend_python():
    """Fail early, and say what to do, when the Worker cannot be started.

    Kept under its old name for the two checks that call it: what it
    requires now is wrangler, in cloudflare/node_modules.
    """
    if shutil.which("npx") is None:
        raise SystemExit(
            "This check needs Node: run `mise install` and `mise activate` (mise.toml)."
        )
    if not (CLOUDFLARE / "node_modules" / ".bin" / "wrangler").exists():
        raise SystemExit(
            "This check needs wrangler: "
            "(cd cloudflare && npm ci --legacy-peer-deps) first."
        )


def _wrangler(arguments, state, **popen):
    return subprocess.Popen(
        ["npx", "wrangler", *arguments, "--persist-to", str(state)],
        cwd=CLOUDFLARE,
        stdin=subprocess.DEVNULL,
        # Its own process group: wrangler runs the Workers runtime as a
        # child, and stopping the run must take that down too.
        start_new_session=True,
        **popen,
    )


def _ensure_site():
    """wrangler refuses to start without the assets directory. The app
    under test carries its own pages, so a one-line stand-in is enough."""
    index = CLOUDFLARE / "site" / "index.html"
    if not index.exists():
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text("<!doctype html><title>Papol</title>\n")


def start(directory, port):
    """Start the Worker on the port, storing everything under the directory.

    Returns the process; `wait_ready` says when it answers.
    """
    directory = Path(directory)
    state = directory / "wrangler"
    state.mkdir(parents=True, exist_ok=True)
    _ensure_site()
    migrate = _wrangler(
        ["d1", "migrations", "apply", "papol", "--local"], state,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    output, _ = migrate.communicate(timeout=120)
    if migrate.returncode:
        raise RuntimeError(f"could not migrate the local database\n{output}")
    log = open(directory / "wrangler.log", "w")
    process = _wrangler(
        ["dev", "--ip", "127.0.0.1", "--port", str(port), "--show-interactive-dev-session=false"],
        state, stdout=log, stderr=subprocess.STDOUT,
    )
    process.papol_log = directory / "wrangler.log"
    return process


def wait_ready(url, process=None, attempts=300, timeout=.2):
    """Block until the service answers its sync endpoint with a 401.

    That status is the one a real backend gives an anonymous caller, so it
    is the whole service answering, not a proxy or a port somebody else has.
    """
    for _ in range(attempts):
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"backend stopped early\n{_log_of(process)}")
        try:
            urllib.request.urlopen(f"{url}/api/sync/pull", timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                return
        except OSError:
            time.sleep(.2)
    raise RuntimeError(f"backend did not become ready\n{_log_of(process)}")


def _log_of(process):
    log = getattr(process, "papol_log", None)
    return log.read_text() if log and log.exists() else ""


def stop(process):
    if process is None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)


def register(url, display_name, password="testing-password"):
    """An account of its own for this run; the response carries its token."""
    email = f"native-e2e-{uuid.uuid4()}@example.test"
    auth = request(f"{url}/api/auth/register", "POST", {
        "email": email,
        "display_name": display_name,
        "affiliation": None,
        "password": password,
    })
    return {**auth, "email": email, "password": password}


def upload_pdf(url, token, bytes_=SEED_PDF, name="native-e2e.pdf"):
    """The bytes first, into the bucket under their digest by the address the
    Worker gives — its own door, on a local one — then the word that they
    are in; the paper names them."""
    digest = hashlib.sha256(bytes_).hexdigest()
    address = request(f"{url}/api/files/upload-address", "POST", {
        "kind": "paper", "sha256": digest, "size": len(bytes_), "name": name,
    }, token)
    if not address["stored"]:
        target = address["url"] if address["url"].startswith("http") else f"{url}{address['url']}"
        with urllib.request.urlopen(
            urllib.request.Request(target, data=bytes_, headers=address["headers"], method="PUT"), timeout=5,
        ):
            pass
    return request(f"{url}/api/papers/uploaded", "POST", {
        "file_path": address["file_path"], "uploaded_name": name,
    }, token)


def create_paper(url, token, title):
    uploaded = upload_pdf(url, token)
    return request(f"{url}/api/papers", "POST", {
        "title": title,
        "file_path": uploaded["file_path"],
    }, token)
