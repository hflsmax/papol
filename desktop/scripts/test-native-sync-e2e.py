#!/usr/bin/env python3
"""Run native SQLite -> HTTP sync -> backend as one disposable system test."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

import disposable_backend as backend_service
from disposable_backend import ROOT, request


def main():
    external_backend = os.environ.get("PAPOL_TEST_BACKEND_URL")
    if not external_backend:
        backend_service.require_backend_python()
    with tempfile.TemporaryDirectory(prefix="papol-native-e2e-") as directory:
        temporary = Path(directory)
        server = None
        if external_backend:
            backend = external_backend.rstrip("/")
        else:
            port = backend_service.free_port()
            backend = f"http://127.0.0.1:{port}"
            server = backend_service.start(temporary, port)
        try:
            backend_service.wait_ready(
                backend, server, timeout=3 if external_backend else .2,
            )
            auth = backend_service.register(backend, "Native E2E")
            paper = backend_service.create_paper(backend, auth["token"], "Native annotation E2E")
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
            backend_service.stop(server)


if __name__ == "__main__":
    main()
