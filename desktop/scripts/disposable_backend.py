"""A real backend that lives for one test run and leaves nothing behind.

Both native end-to-end checks — the replica driven from Rust, and the app
driven through its window — need the same thing underneath: FastAPI on a
port of its own, an empty SQLite database, an uploads directory holding one
seed PDF, and an account with a paper in it. Stated once here so the two
checks cannot drift into testing against two different services.

The backend's Python is the one from flake.nix; PAPOL_TEST_PYTHON names it
when the interpreter running the check is not that one.
"""

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


ROOT = Path(__file__).parents[2]
PYTHON = os.environ.get("PAPOL_TEST_PYTHON", sys.executable)
SEED_PDF = os.environ.get("PAPOL_TEST_SEED_PDF", "native-e2e.pdf")


def request(url, method="GET", body=None, token=None, timeout=5):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
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
    """Fail early, and say what to set, when this Python cannot run the backend."""
    dependency = subprocess.run(
        [PYTHON, "-c", "import fastapi, uvicorn, sqlalchemy"],
        capture_output=True,
        text=True,
    )
    if dependency.returncode:
        raise SystemExit(
            "This check needs the backend Python environment. "
            "Set PAPOL_TEST_PYTHON=/path/to/that/python, or run it inside "
            "`nix develop`.\n" + dependency.stderr
        )


def start(directory, port):
    """Start the backend on the port, storing everything under the directory.

    Returns the process; `wait_ready` says when it answers.
    """
    directory = Path(directory)
    uploads = directory / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    (uploads / SEED_PDF).write_bytes(b"%PDF-1.4\nnative e2e seed\n%%EOF")
    environment = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{directory / 'server.sqlite3'}",
        "PAPOL_UPLOADS_DIR": str(uploads),
        "PAPOL_BOARD_FILES_DIR": str(directory / "board-files"),
    }
    return subprocess.Popen(
        [
            PYTHON, "-m", "uvicorn", "main:app",
            "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning",
        ],
        cwd=ROOT / "backend",
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def wait_ready(url, process=None, attempts=100, timeout=.2):
    """Block until the service answers its sync endpoint with a 401.

    That status is the one a real backend gives an anonymous caller, so it
    is the whole service answering, not a proxy or a port somebody else has.
    """
    for _ in range(attempts):
        if process is not None and process.poll() is not None:
            stdout, stderr = process.communicate()
            raise RuntimeError(f"backend stopped early\n{stdout}\n{stderr}")
        try:
            urllib.request.urlopen(f"{url}/api/sync/pull", timeout=timeout)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                return
        except OSError:
            time.sleep(.05)
    raise RuntimeError("backend did not become ready")


def stop(process):
    if process is None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


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


def create_paper(url, token, title):
    return request(f"{url}/api/papers", "POST", {
        "title": title,
        "file_path": SEED_PDF,
    }, token)
