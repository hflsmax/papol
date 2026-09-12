"""Backend contract exercised by the macOS offline replay queue.

Run in the repository's development environment with:
    cd backend && python -m unittest test_desktop_sync.py
"""

import unittest
import uuid
import tempfile
import hashlib
import shutil
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import sync.api as sync_api
from sync.changes import commit_sync
from database import Base, PapolSession, current_request_session, get_db
from models import (
    AppliedMutation, Board, BoardItem, Comment, Copy, CopyTagLink, InkStroke, Paper,
    PaperClip, PaperEdition, ServerChange, Shelf, SyncClient, Tag,
)


class DesktopSyncContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.sessions = sessionmaker(
            bind=cls.engine, autoflush=False, autocommit=False, class_=PapolSession
        )

        def test_db():
            request_db = current_request_session()
            if request_db is not None:
                yield request_db
                return
            db = cls.sessions()
            try:
                yield db
            finally:
                db.close()

        main.app.dependency_overrides[get_db] = test_db
        cls.original_session_factory = main.app.state.session_factory
        main.app.state.session_factory = cls.sessions
        cls.board_files = tempfile.TemporaryDirectory(prefix="papol-sync-board-files-")
        cls.original_boards_dir = main.BOARDS_DIR
        main.BOARDS_DIR = Path(cls.board_files.name)
        cls.original_sync_board_files_dir = sync_api.BOARD_FILES_DIR
        cls.original_sync_blobs_dir = sync_api.BLOBS_DIR
        cls.original_sync_pdfs_dir = sync_api.PDF_FILES_DIR
        sync_api.BOARD_FILES_DIR = Path(cls.board_files.name)
        sync_api.BLOBS_DIR = Path(cls.board_files.name) / "blobs"
        sync_api.PDF_FILES_DIR = Path(cls.board_files.name) / "pdfs"
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        main.BOARDS_DIR = cls.original_boards_dir
        sync_api.BOARD_FILES_DIR = cls.original_sync_board_files_dir
        sync_api.BLOBS_DIR = cls.original_sync_blobs_dir
        sync_api.PDF_FILES_DIR = cls.original_sync_pdfs_dir
        cls.board_files.cleanup()
        main.app.state.session_factory = cls.original_session_factory
        main.app.dependency_overrides.pop(get_db, None)
        cls.engine.dispose()

    def setUp(self):
        for path in Path(self.board_files.name).iterdir():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        response = self.client.post("/api/auth/register", json={
            "email": "desktop@example.test",
            "display_name": "Desktop Test",
            "affiliation": None,
            "password": "testing-password",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.headers = {"Authorization": f"Bearer {response.json()['token']}"}

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, headers=self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        return response

    def test_dependent_board_replay_contract(self):
        """Every ID-bearing response supports the client's ordered remapping."""
        board = self.request("POST", "/api/boards", json={"name": "Offline board"}).json()
        first = self.request(
            "POST", f"/api/boards/{board['guid']}/comments",
            json={"content": "first", "x": 1, "y": 2},
        ).json()
        second = self.request(
            "POST", f"/api/boards/{board['guid']}/comments",
            json={"content": "second", "x": 10, "y": 20},
        ).json()
        moved = self.request(
            "PUT", f"/api/board-items/{first['id']}", json={"x": 30, "y": 40},
        ).json()
        group = self.request(
            "POST", f"/api/boards/{board['guid']}/groups",
            json={"kind": "collection", "title": "Synced", "item_ids": [first["id"], second["id"]]},
        ).json()

        self.assertEqual((moved["x"], moved["y"]), (30, 40))
        self.assertIsInstance(board["guid"], str)
        self.assertIsInstance(first["id"], int)
        self.assertEqual(group["item_ids"], [first["id"], second["id"]])

        fetched = self.request("GET", f"/api/boards/{board['guid']}").json()
        self.assertEqual({item["id"] for item in fetched["items"]}, {first["id"], second["id"]})
        self.assertEqual(fetched["groups"][0]["id"], group["id"])

    def test_replay_requires_a_live_account_token(self):
        response = self.client.post("/api/boards", json={"name": "No credentials"})
        self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/api/boards", headers={"Authorization": "Bearer expired"}, json={"name": "Expired"},
        )
        self.assertEqual(response.status_code, 401)

    def test_identified_mutation_is_applied_once_and_replays_its_response(self):
        sync_headers = {
            **self.headers,
            "X-Papol-Client-ID": str(uuid.uuid4()),
            "X-Papol-Mutation-ID": str(uuid.uuid4()),
        }
        first = self.client.post(
            "/api/boards", headers=sync_headers, json={"name": "Exactly once"},
        )
        self.assertEqual(first.status_code, 200, first.text)
        replay = self.client.post(
            "/api/boards", headers=sync_headers, json={"name": "Exactly once"},
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(replay.headers["X-Papol-Idempotent-Replay"], "true")

        with self.sessions() as db:
            self.assertEqual(db.query(Board).count(), 1)
            self.assertEqual(db.query(AppliedMutation).count(), 1)

    def test_reusing_a_mutation_id_for_different_content_is_rejected(self):
        sync_headers = {
            **self.headers,
            "X-Papol-Client-ID": str(uuid.uuid4()),
            "X-Papol-Mutation-ID": str(uuid.uuid4()),
        }
        first = self.client.post(
            "/api/boards", headers=sync_headers, json={"name": "Original"},
        )
        self.assertEqual(first.status_code, 200, first.text)
        conflict = self.client.post(
            "/api/boards", headers=sync_headers, json={"name": "Different"},
        )
        self.assertEqual(conflict.status_code, 409, conflict.text)

        with self.sessions() as db:
            self.assertEqual(db.query(Board).count(), 1)

    def test_multipart_replay_ignores_random_transport_boundaries(self):
        board = self.request("POST", "/api/boards", json={"name": "Files"}).json()
        sync_headers = {
            **self.headers,
            "X-Papol-Client-ID": str(uuid.uuid4()),
            "X-Papol-Mutation-ID": str(uuid.uuid4()),
        }
        def upload():
            return self.client.post(
                f"/api/boards/{board['guid']}/files",
                headers=sync_headers,
                files={"file": ("diagram.png", b"same bytes", "image/png")},
                data={"caption": "same caption", "x": "1", "y": "2"},
            )
        first = upload()
        self.assertEqual(first.status_code, 200, first.text)
        replay = upload()
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(replay.headers["X-Papol-Idempotent-Replay"], "true")

        with self.sessions() as db:
            self.assertEqual(db.query(BoardItem).count(), 1)
        self.assertEqual(len(list(Path(self.board_files.name).rglob("diagram.png"))), 0)
        self.assertEqual(len([p for p in Path(self.board_files.name).rglob("*") if p.is_file()]), 1)

    def test_identified_mutation_requires_uuid_headers(self):
        response = self.client.post(
            "/api/boards",
            headers={**self.headers, "X-Papol-Client-ID": "not-a-uuid"},
            json={"name": "Invalid identity"},
        )
        self.assertEqual(response.status_code, 400, response.text)

    def test_uuid_push_pull_retry_and_delete_round_trip(self):
        client_id = str(uuid.uuid4())
        board_id = str(uuid.uuid4())
        item_id = str(uuid.uuid4())
        mutation_id = str(uuid.uuid4())
        create = {
            "protocol_version": 1,
            "client_id": client_id,
            "mutation_id": mutation_id,
            "local_sequence": 1,
            "changes": [
                {
                    "table": "boards", "id": board_id,
                    "base_revision": 0, "operation": "upsert",
                    "values": {"name": "Native board", "description": "offline"},
                },
                {
                    "table": "board_items", "id": item_id,
                    "base_revision": 0, "operation": "upsert",
                    "values": {
                        "board_id": board_id, "kind": "comment",
                        "content": "written offline", "x": 12, "y": 34,
                    },
                },
            ],
        }
        first = self.request("POST", "/api/sync/push", json=create).json()
        replay = self.request("POST", "/api/sync/push", json=create).json()
        self.assertEqual(replay, first)
        self.assertEqual({row["id"] for row in first["rows"]}, {board_id, item_id})

        pulled = self.request(
            "GET", f"/api/sync/pull?cursor=0&limit=10&client_id={client_id}",
        ).json()
        self.assertFalse(pulled["has_more"])
        self.assertEqual(
            {(change["table"], change["id"]) for change in pulled["changes"]},
            {("boards", board_id), ("board_items", item_id)},
        )
        cursor = pulled["cursor"]

        delete = {
            "protocol_version": 1,
            "client_id": client_id,
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{
                "table": "board_items", "id": item_id,
                "base_revision": 1, "operation": "delete", "values": {},
            }],
        }
        deleted = self.request("POST", "/api/sync/push", json=delete).json()
        self.assertEqual(deleted["rows"][0]["revision"], 2)
        tail = self.request(
            "GET", f"/api/sync/pull?cursor={cursor}&client_id={client_id}",
        ).json()
        item_delete = [
            change for change in tail["changes"]
            if change["table"] == "board_items"
        ]
        self.assertEqual(len(item_delete), 1)
        self.assertEqual(item_delete[0]["operation"], "delete")
        self.assertEqual(item_delete[0]["id"], item_id)

        with self.sessions() as db:
            self.assertEqual(db.query(Board).count(), 1)
            self.assertEqual(db.query(BoardItem).count(), 1)
            self.assertEqual(db.query(ServerChange).count(), 4)
            self.assertEqual(db.query(AppliedMutation).count(), 2)
            sync_client = db.query(SyncClient).one()
            self.assertEqual(sync_client.client_id, client_id)
            self.assertEqual(sync_client.acknowledged_cursor, cursor)

    def test_sync_pull_is_account_isolated(self):
        board = self.request("POST", "/api/boards", json={"name": "Private"}).json()
        other = self.client.post("/api/auth/register", json={
            "email": "other@example.test",
            "display_name": "Other",
            "affiliation": None,
            "password": "testing-password",
        })
        self.assertEqual(other.status_code, 200, other.text)
        other_headers = {"Authorization": f"Bearer {other.json()['token']}"}
        pulled = self.client.get("/api/sync/pull", headers=other_headers)
        self.assertEqual(pulled.status_code, 200, pulled.text)
        self.assertEqual(pulled.json()["changes"], [])
        own = self.request("GET", "/api/sync/pull").json()
        self.assertEqual(own["changes"][0]["id"], board["guid"])

    def test_closing_an_account_removes_its_private_sync_bookkeeping(self):
        board_id = str(uuid.uuid4())
        client_id = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_id": client_id, "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "id": board_id, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Before closing"},
            }],
        })
        self.request("GET", f"/api/sync/pull?cursor=0&client_id={client_id}")
        closed = self.client.request(
            "DELETE", "/api/auth/account", headers=self.headers,
            json={"confirm_email": "desktop@example.test"},
        )
        self.assertEqual(closed.status_code, 200, closed.text)
        with self.sessions() as db:
            self.assertEqual(db.query(ServerChange).count(), 0)
            self.assertEqual(db.query(AppliedMutation).count(), 0)
            self.assertEqual(db.query(SyncClient).count(), 0)

    def test_sync_rejects_foreign_parent_and_unregistered_fields(self):
        other = self.client.post("/api/auth/register", json={
            "email": "foreign@example.test",
            "display_name": "Foreign",
            "affiliation": None,
            "password": "testing-password",
        }).json()
        foreign_headers = {"Authorization": f"Bearer {other['token']}"}
        foreign_board = self.client.post(
            "/api/boards", headers=foreign_headers, json={"name": "Foreign"},
        ).json()
        payload = {
            "client_id": str(uuid.uuid4()),
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "board_items", "id": str(uuid.uuid4()),
                "operation": "upsert",
                "values": {
                    "board_id": foreign_board["guid"], "kind": "comment",
                    "content": "not mine", "user_id": 1,
                },
            }],
        }
        rejected = self.client.post("/api/sync/push", headers=self.headers, json=payload)
        self.assertEqual(rejected.status_code, 422, rejected.text)

    def test_content_addressed_blob_upload_and_owned_download(self):
        content = b"offline clipped image bytes"
        digest = hashlib.sha256(content).hexdigest()
        missing = self.client.head(f"/api/sync/blobs/{digest}", headers=self.headers)
        self.assertEqual(missing.status_code, 404)
        mismatch = self.client.put(
            f"/api/sync/blobs/{'0' * 64}", headers=self.headers, content=content,
        )
        self.assertEqual(mismatch.status_code, 422, mismatch.text)
        uploaded = self.client.put(
            f"/api/sync/blobs/{digest}", headers=self.headers, content=content,
        )
        self.assertEqual(uploaded.status_code, 204, uploaded.text)
        self.assertEqual(
            self.client.head(f"/api/sync/blobs/{digest}", headers=self.headers).status_code,
            200,
        )

        board_id = str(uuid.uuid4())
        item_id = str(uuid.uuid4())
        payload = {
            "client_id": str(uuid.uuid4()),
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "boards", "id": board_id, "operation": "upsert",
                    "values": {"name": "Blob board"},
                },
                {
                    "table": "board_items", "id": item_id, "operation": "upsert",
                    "values": {
                        "board_id": board_id, "kind": "image",
                        "blob_sha256": digest, "mime_type": "image/png",
                        "original_filename": "clip.png",
                    },
                },
            ],
        }
        pushed = self.client.post("/api/sync/push", headers=self.headers, json=payload)
        self.assertEqual(pushed.status_code, 200, pushed.text)
        downloaded = self.client.get(f"/api/sync/blobs/{digest}", headers=self.headers)
        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertEqual(downloaded.content, content)

    def test_offline_pdf_import_uploads_once_and_creates_the_owned_graph(self):
        content = b"%PDF-1.4\noffline paper\n%%EOF"
        digest = hashlib.sha256(content).hexdigest()
        with self.sessions() as db:
            canonical_paper = Paper(title="Imported while offline")
            db.add(canonical_paper)
            db.flush()
            canonical_edition = PaperEdition(
                paper=canonical_paper, paper_sync_id=canonical_paper.sync_id,
                file_path=f"{digest}.pdf", sha256=digest, uploaded_by=1,
            )
            db.add(canonical_edition)
            db.commit()
            canonical_paper_db_id = canonical_paper.id
            canonical_paper_id = canonical_paper.sync_id
            canonical_edition_id = canonical_edition.sync_id
        upload = self.client.put(
            f"/api/sync/blobs/{digest}", headers=self.headers, content=content,
        )
        self.assertEqual(upload.status_code, 204, upload.text)
        paper_id, edition_id, copy_id = (str(uuid.uuid4()) for _ in range(3))
        payload = {
            "client_id": str(uuid.uuid4()), "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "papers", "id": paper_id, "operation": "upsert",
                    "values": {"title": "Imported while offline", "doi": None},
                },
                {
                    "table": "paper_editions", "id": edition_id, "operation": "upsert",
                    "values": {
                        "paper_id": paper_id, "file_path": f"{digest}.pdf", "sha256": digest,
                    },
                },
                {
                    "table": "copies", "id": copy_id, "operation": "upsert",
                    "values": {
                        "paper_id": paper_id, "edition_id": edition_id,
                        "edition_sha256": digest, "summary": "Local first",
                    },
                },
            ],
        }
        result = self.request("POST", "/api/sync/push", json=payload).json()
        self.assertEqual([row["table"] for row in result["rows"]], [
            "papers", "paper_editions", "copies",
        ])
        self.assertEqual(result["aliases"], {
            paper_id: canonical_paper_id, edition_id: canonical_edition_id,
        })
        self.assertEqual(result["rows"][0]["id"], canonical_paper_id)
        self.assertEqual(result["rows"][1]["id"], canonical_edition_id)
        self.assertEqual(result["rows"][1]["sha256"], digest)
        downloaded = self.client.get(f"/api/sync/blobs/{digest}", headers=self.headers)
        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertEqual(downloaded.content, content)

        duplicate_paper, duplicate_edition, duplicate_copy = (
            str(uuid.uuid4()) for _ in range(3)
        )
        duplicate = self.request("POST", "/api/sync/push", json={
            "client_id": str(uuid.uuid4()), "mutation_id": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [
                {
                    "table": "papers", "id": duplicate_paper, "operation": "upsert",
                    "values": {"title": "Imported while offline", "doi": None},
                },
                {
                    "table": "paper_editions", "id": duplicate_edition,
                    "operation": "upsert", "values": {
                        "paper_id": duplicate_paper, "file_path": f"{digest}.pdf",
                        "sha256": digest,
                    },
                },
                {
                    "table": "copies", "id": duplicate_copy, "operation": "upsert",
                    "values": {
                        "paper_id": duplicate_paper, "edition_id": duplicate_edition,
                        "edition_sha256": digest, "summary": "Updated offline",
                    },
                },
            ],
        }).json()
        self.assertEqual(duplicate["aliases"], {
            duplicate_paper: canonical_paper_id,
            duplicate_edition: canonical_edition_id,
            duplicate_copy: copy_id,
        })
        with self.sessions() as db:
            copies = db.query(Copy).filter(Copy.paper_id == canonical_paper_db_id).all()
            self.assertEqual(len(copies), 1)
            self.assertEqual(copies[0].summary, "Updated offline")

    def test_sync_rejects_active_or_credentialed_board_links(self):
        board_id = str(uuid.uuid4())
        for source_url in ("javascript:alert(1)", "https://user:secret@example.test/page"):
            payload = {
                "client_id": str(uuid.uuid4()),
                "mutation_id": str(uuid.uuid4()),
                "local_sequence": 1,
                "changes": [
                    {
                        "table": "boards", "id": board_id, "operation": "upsert",
                        "values": {"name": "Safe links"},
                    },
                    {
                        "table": "board_items", "id": str(uuid.uuid4()),
                        "operation": "upsert",
                        "values": {
                            "board_id": board_id, "kind": "webpage",
                            "source_url": source_url,
                        },
                    },
                ],
            }
            response = self.client.post("/api/sync/push", headers=self.headers, json=payload)
            self.assertEqual(response.status_code, 422, response.text)

    def test_stale_field_patch_reports_a_recoverable_conflict(self):
        board_id = str(uuid.uuid4())
        first_client = str(uuid.uuid4())
        create = {
            "client_id": first_client,
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards", "id": board_id, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Original"},
            }],
        }
        self.request("POST", "/api/sync/push", json=create)
        winning = {
            "client_id": first_client,
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{
                "table": "boards", "id": board_id, "base_revision": 1,
                "operation": "patch", "values": {"name": "First edit"},
            }],
        }
        self.request("POST", "/api/sync/push", json=winning)
        stale = {
            "client_id": str(uuid.uuid4()),
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards", "id": board_id, "base_revision": 1,
                "operation": "patch", "values": {"name": "Later edit"},
            }],
        }
        result = self.request("POST", "/api/sync/push", json=stale).json()
        self.assertEqual(result["rows"][0]["revision"], 3)
        self.assertEqual(result["rows"][0]["name"], "Later edit")
        self.assertEqual(result["conflicts"][0]["previous"]["name"], "First edit")
        self.assertEqual(result["conflicts"][0]["strategy"], "field_patch")
        self.assertEqual(result["conflicts"][0]["resolution"], "client_won")

    def test_delete_wins_over_a_stale_update_and_preserves_recovery_values(self):
        board_id = str(uuid.uuid4())
        client = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "id": board_id, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Original"},
            }],
        })
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()),
            "local_sequence": 2, "changes": [{
                "table": "boards", "id": board_id, "base_revision": 1,
                "operation": "delete", "values": {},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_id": str(uuid.uuid4()), "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "id": board_id, "base_revision": 1,
                "operation": "patch", "values": {"name": "Unsynced edit"},
            }],
        }).json()
        self.assertIsNotNone(stale["rows"][0]["deleted_at"])
        self.assertEqual(stale["rows"][0]["name"], "Original")
        self.assertEqual(stale["conflicts"][0]["resolution"], "server_won")
        self.assertEqual(stale["conflicts"][0]["reason"], "row_deleted")
        self.assertEqual(
            stale["conflicts"][0]["rejected_values"], {"name": "Unsynced edit"}
        )

    def test_stale_compound_membership_uses_the_declared_client_wins_policy(self):
        board_id, group_id = str(uuid.uuid4()), str(uuid.uuid4())
        client = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()), "local_sequence": 1,
            "changes": [
                {"table": "boards", "id": board_id, "base_revision": 0,
                 "operation": "upsert", "values": {"name": "Board"}},
                {"table": "board_groups", "id": group_id, "base_revision": 0,
                 "operation": "upsert", "values": {
                     "board_id": board_id, "kind": "booklet", "title": "Original",
                 }},
            ],
        })
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()), "local_sequence": 2,
            "changes": [{
                "table": "board_groups", "id": group_id, "base_revision": 1,
                "operation": "patch", "values": {"title": "Device one"},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_id": str(uuid.uuid4()), "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "board_groups", "id": group_id, "base_revision": 1,
                "operation": "patch", "values": {"title": "Device two"},
            }],
        }).json()
        self.assertEqual(stale["rows"][0]["title"], "Device two")
        self.assertEqual(stale["conflicts"][0]["strategy"], "compound_membership")
        self.assertEqual(stale["conflicts"][0]["resolution"], "client_won")

    def test_stale_whole_row_ink_uses_the_declared_client_wins_policy(self):
        with self.sessions() as db:
            paper = Paper(title="Conflict paper")
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper, paper_sync_id=paper.sync_id,
                file_path="conflict.pdf", sha256="2" * 64, uploaded_by=1,
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper=paper, paper_sync_id=paper.sync_id, user_id=1,
                edition=edition, edition_sync_id=edition.sync_id,
                edition_sha256=edition.sha256,
            ))
            db.commit()
            edition_id = edition.sync_id
        ink_id, client = str(uuid.uuid4()), str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()), "local_sequence": 1,
            "changes": [{
                "table": "ink_strokes", "id": ink_id, "base_revision": 0,
                "operation": "upsert", "values": {
                    "edition_id": edition_id, "page": 1,
                    "points": '[{"x":0.1,"y":0.2}]', "color": "#111111",
                    "width": 0.004, "opacity": 1, "shape": "flat",
                },
            }],
        })
        self.request("POST", "/api/sync/push", json={
            "client_id": client, "mutation_id": str(uuid.uuid4()), "local_sequence": 2,
            "changes": [{
                "table": "ink_strokes", "id": ink_id, "base_revision": 1,
                "operation": "patch", "values": {"color": "#222222"},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_id": str(uuid.uuid4()), "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "ink_strokes", "id": ink_id, "base_revision": 1,
                "operation": "patch", "values": {"color": "#333333"},
            }],
        }).json()
        self.assertEqual(stale["rows"][0]["color"], "#333333")
        self.assertEqual(stale["conflicts"][0]["previous"]["color"], "#222222")
        self.assertEqual(stale["conflicts"][0]["strategy"], "whole_row")
        self.assertEqual(stale["conflicts"][0]["resolution"], "client_won")

    def test_annotation_snapshot_and_offline_mutations_use_uuid_relationships(self):
        with self.sessions() as db:
            paper = Paper(title="Offline annotations")
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper, paper_sync_id=paper.sync_id,
                file_path="offline.pdf", sha256="1" * 64, uploaded_by=1,
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper_id=paper.id, user_id=1, edition_id=edition.id,
                edition_sha256=edition.sha256,
            ))
            db.commit()
            paper_id, edition_id = paper.sync_id, edition.sync_id

        initial = self.request("GET", "/api/sync/snapshot").json()
        identities = {(row["table"], row["id"]) for row in initial["rows"]}
        self.assertIn(("papers", paper_id), identities)
        self.assertIn(("paper_editions", edition_id), identities)
        self.assertTrue(any(table == "copies" for table, _ in identities))
        self.assertTrue(any(table == "shelves" for table, _ in identities))
        ids = [str(uuid.uuid4()) for _ in range(3)]
        payload = {
            "client_id": str(uuid.uuid4()),
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "comments", "id": ids[0], "operation": "upsert",
                    "values": {
                        "paper_id": paper_id, "edition_id": edition_id,
                        "content": "offline note", "page": 1,
                        "anchor_type": "point", "anchor": '{"x":0.2,"y":0.3}',
                    },
                },
                {
                    "table": "ink_strokes", "id": ids[1], "operation": "upsert",
                    "values": {
                        "edition_id": edition_id, "page": 1,
                        "points": '[{"x":0.1,"y":0.2}]', "color": "#b3923d",
                        "width": 0.004, "opacity": 1, "shape": "flat",
                    },
                },
                {
                    "table": "paper_clips", "id": ids[2], "operation": "upsert",
                    "values": {
                        "edition_id": edition_id, "page": 1,
                        "source": '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
                        "frame": '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
                        "floating": False,
                    },
                },
            ],
        }
        pushed = self.request("POST", "/api/sync/push", json=payload).json()
        self.assertEqual({row["id"] for row in pushed["rows"]}, set(ids))
        refreshed = self.request("GET", "/api/sync/snapshot").json()
        self.assertTrue({
            "papers", "paper_editions", "comments", "ink_strokes", "paper_clips",
        }.issubset({row["table"] for row in refreshed["rows"]}))
        with self.sessions() as db:
            self.assertEqual(db.query(Comment).count(), 1)
            self.assertEqual(db.query(InkStroke).count(), 1)
            self.assertEqual(db.query(PaperClip).count(), 1)

    def test_nook_rows_sync_together_with_uuid_relationships(self):
        with self.sessions() as db:
            default_shelf = db.query(Shelf).filter(Shelf.user_id == 1).first()
            paper = Paper(title="Offline nook")
            db.add(paper)
            db.flush()
            copy = Copy(paper=paper, shelf=default_shelf, user_id=1, marketed=False)
            db.add(copy)
            commit_sync(db)
            paper_id, copy_id = paper.sync_id, copy.sync_id

        shelf_id, tag_id, link_id = (str(uuid.uuid4()) for _ in range(3))
        payload = {
            "client_id": str(uuid.uuid4()),
            "mutation_id": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "shelves", "id": shelf_id, "operation": "upsert",
                    "values": {"name": "Methods", "color": "#123456", "position": 2},
                },
                {
                    "table": "tags", "id": tag_id, "operation": "upsert",
                    "values": {"name": "distributed"},
                },
                {
                    "table": "copies", "id": copy_id, "operation": "patch",
                    "base_revision": 1,
                    "values": {"shelf_id": shelf_id, "summary": "Saved without a network"},
                },
                {
                    "table": "copy_tags", "id": link_id, "operation": "upsert",
                    "values": {"copy_id": copy_id, "tag_id": tag_id},
                },
            ],
        }
        result = self.request("POST", "/api/sync/push", json=payload).json()
        self.assertEqual([row["table"] for row in result["rows"]], [
            "shelves", "tags", "copies", "copy_tags",
        ])
        self.assertEqual(result["rows"][2]["paper_id"], paper_id)
        self.assertEqual(result["rows"][2]["shelf_id"], shelf_id)
        with self.sessions() as db:
            saved = db.query(Copy).filter(Copy.sync_id == copy_id).one()
            self.assertEqual(saved.summary, "Saved without a network")
            self.assertEqual(saved.shelf.sync_id, shelf_id)
            self.assertEqual(db.query(Tag).filter(Tag.sync_id == tag_id).one().name, "distributed")
            self.assertEqual(
                db.query(CopyTagLink).filter(CopyTagLink.sync_id == link_id).one().copy_id,
                saved.id,
            )


if __name__ == "__main__":
    unittest.main()
