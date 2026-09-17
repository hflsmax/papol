#!/usr/bin/env python3
"""Run native SQLite -> HTTP sync -> backend as one disposable system test."""

import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


ROOT = Path(__file__).parents[2]
PYTHON = os.environ.get("PAPOL_TEST_PYTHON", os.sys.executable)


def request(url, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(
        urllib.request.Request(url, data=data, headers=headers, method=method),
        timeout=5,
    ) as response:
        return json.loads(response.read() or b"null")


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def main():
    external_backend = os.environ.get("PAPOL_TEST_BACKEND_URL")
    if not external_backend:
        dependency = subprocess.run(
            [PYTHON, "-c", "import fastapi, uvicorn, sqlalchemy"],
            capture_output=True,
            text=True,
        )
        if dependency.returncode:
            raise SystemExit(
                "Native sync E2E needs the backend Python environment. "
                "Set PAPOL_TEST_PYTHON=/path/to/that/python, or point "
                "PAPOL_TEST_BACKEND_URL at a disposable backend.\n" + dependency.stderr
            )
    with tempfile.TemporaryDirectory(prefix="papol-native-e2e-") as directory:
        temporary = Path(directory)
        server = None
        pdf_name = os.environ.get("PAPOL_TEST_SEED_PDF", "native-e2e.pdf")
        if external_backend:
            backend = external_backend.rstrip("/")
        else:
            port = free_port()
            backend = f"http://127.0.0.1:{port}"
            environment = {
                **os.environ,
                "DATABASE_URL": f"sqlite:///{temporary / 'server.sqlite3'}",
                "PAPOL_UPLOADS_DIR": str(temporary / "uploads"),
                "PAPOL_BOARD_FILES_DIR": str(temporary / "board-files"),
            }
            uploads = temporary / "uploads"
            uploads.mkdir()
            (uploads / pdf_name).write_bytes(b"%PDF-1.4\nnative e2e seed\n%%EOF")
            server = subprocess.Popen(
                [PYTHON, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                cwd=ROOT / "backend",
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        try:
            for _ in range(100):
                if server is not None and server.poll() is not None:
                    stdout, stderr = server.communicate()
                    raise RuntimeError(f"backend stopped early\n{stdout}\n{stderr}")
                try:
                    urllib.request.urlopen(
                        f"{backend}/api/sync/pull",
                        timeout=3 if external_backend else .2,
                    )
                except urllib.error.HTTPError as error:
                    if error.code == 401:
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise RuntimeError("backend did not become ready")

            auth = request(f"{backend}/api/auth/register", "POST", {
                "email": f"native-e2e-{uuid.uuid4()}@example.test",
                "display_name": "Native E2E",
                "affiliation": None,
                "password": "testing-password",
            })
            paper = request(f"{backend}/api/papers", "POST", {
                "title": "Native annotation E2E",
                "file_path": pdf_name,
            }, auth["token"])
            completed = subprocess.run(
                [
                    "cargo", "run", "--quiet", "--locked",
                    "--manifest-path", str(ROOT / "desktop/src-tauri/Cargo.toml"),
                    "--example", "native_sync_harness", "--",
                    str(temporary / "local.sqlite3"), backend,
                    auth["token"], auth["user"]["uuid"],
                    paper["sha256"],
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            if completed.returncode:
                raise RuntimeError(
                    f"native harness failed\n{completed.stdout}\n{completed.stderr}"
                )
            result = json.loads(completed.stdout.strip().splitlines()[-1])
            assert result["before"]["name"] == "End-to-end offline"
            assert result["status"]["pending"] == 0
            assert result["initial_sync"]["pushed"] == 1
            assert result["sync"]["pushed"] == 2
            assert result["offline_notes"][0]["content"] == "Native offline note"
            assert result["offline_import"]["summary"] == "Imported entirely offline"
            board = request(
                f"{backend}/api/boards/{result['board_uuid']}", token=auth["token"],
            )
            assert board["name"] == "End-to-end offline"
            assert [item["content"] for item in board["items"]] == ["Survived restart and sync"]
            assert [item["content"] for item in board["staged_items"]] == ["Clipped offline"]
            clip_request = urllib.request.Request(
                f"{backend}/api/sync/blobs/{result['sha256']}",
                headers={"Authorization": f"Bearer {auth['token']}"},
            )
            with urllib.request.urlopen(clip_request, timeout=5) as response:
                assert response.read() == b"native viewer clip bytes"
            snapshot = request(f"{backend}/api/sync/snapshot", token=auth["token"])
            # A paper is named by its file; everything else by a UUID.
            rows = {
                (row["table"], row["sha256"] if row["table"] == "papers" else row["uuid"]): row
                for row in snapshot["rows"]
            }
            # Notes, ink and clips share one table; each is told apart by
            # its kind and carries its geometry in its body.
            note = rows[("annotations", result["note_uuid"])]
            assert note["content"] == "Native offline note"
            assert note["kind"] == "note"
            ink = rows[("annotations", result["ink_uuid"])]
            assert (ink["kind"], ink["page"]) == ("ink", 1)
            assert '"points"' in ink["body"]
            clip = rows[("annotations", result["paper_clip_uuid"])]
            assert clip["kind"] == "clip"
            assert '"floating":false' in clip["body"].replace(" ", "")
            assert rows[("papers", result["imported_paper_sha256"])]["title"] == "Native imported PDF"
            assert rows[("papers", result["imported_paper_sha256"])]["sha256"] == result["imported_pdf_sha256"]
            imported_pdf = urllib.request.Request(
                f"{backend}/api/sync/blobs/{result['imported_pdf_sha256']}",
                headers={"Authorization": f"Bearer {auth['token']}"},
            )
            with urllib.request.urlopen(imported_pdf, timeout=5) as response:
                assert response.read().startswith(b"%PDF-1.4")
            print("native board, annotation, and PDF offline restart/synchronization: ok")
        finally:
            if server is not None:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()


if __name__ == "__main__":
    main()
