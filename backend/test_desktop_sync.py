"""Backend contract exercised by the macOS offline replay queue.

Run in the repository's development environment with:
    cd backend && python -m unittest test_desktop_sync.py
"""

import asyncio
import hashlib
import json
import shutil
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
import sync.api as sync_api
from sync.changes import commit_sync
from database import Base, PapolSession, current_request_session, get_db
from models import (
    Annotation, AppliedMutation, Board, BoardItem, Copy, CopyTagLink, Paper,
    PaperEdition, Room, RoomParticipant, ServerChange, Shelf, SyncClient, Tag,
    User,
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
        self.user_uuid = response.json()["user"]["uuid"]

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, headers=self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        return response

    def test_mutating_requests_share_one_cooperative_sqlite_writer(self):
        async def exercise_gate():
            test_app = FastAPI()
            test_app.state.sqlite_write_lock = asyncio.Lock()
            test_app.middleware("http")(main.serialize_sqlite_writes)
            active = 0
            maximum_active = 0

            @test_app.put("/write")
            async def write():
                nonlocal active, maximum_active
                active += 1
                maximum_active = max(maximum_active, active)
                await asyncio.sleep(0.02)
                active -= 1
                return {"ok": True}

            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as client:
                responses = await asyncio.gather(
                    client.put("/write"), client.put("/write")
                )
            return maximum_active, responses

        maximum_active, responses = asyncio.run(exercise_gate())
        self.assertEqual(maximum_active, 1)
        self.assertTrue(all(response.status_code == 200 for response in responses))

    def test_dependent_board_replay_contract(self):
        """Every ID-bearing response supports the client's ordered remapping."""
        board = self.request("POST", "/api/boards", json={"name": "Offline board"}).json()
        first = self.request(
            "POST", f"/api/boards/{board['uuid']}/comments",
            json={"content": "first", "x": 1, "y": 2},
        ).json()
        second = self.request(
            "POST", f"/api/boards/{board['uuid']}/comments",
            json={"content": "second", "x": 10, "y": 20},
        ).json()
        moved = self.request(
            "PUT", f"/api/board-items/{first['uuid']}", json={"x": 30, "y": 40},
        ).json()
        group = self.request(
            "POST", f"/api/boards/{board['uuid']}/groups",
            json={"kind": "collection", "title": "Synced", "item_uuids": [first["uuid"], second["uuid"]]},
        ).json()

        self.assertEqual((moved["x"], moved["y"]), (30, 40))
        uuid.UUID(board["uuid"])
        uuid.UUID(first["uuid"])
        self.assertEqual(group["item_uuids"], [first["uuid"], second["uuid"]])

        fetched = self.request("GET", f"/api/boards/{board['uuid']}").json()
        self.assertEqual({item["uuid"] for item in fetched["items"]}, {first["uuid"], second["uuid"]})
        self.assertEqual(fetched["groups"][0]["uuid"], group["uuid"])

    def test_board_files_are_private_immutable_resources(self):
        board = self.request("POST", "/api/boards", json={"name": "Image cache"}).json()
        item = self.request(
            "POST",
            f"/api/boards/{board['uuid']}/files",
            files={"file": ("diagram.png", b"image bytes", "image/png")},
        ).json()

        response = self.request("GET", f"/api/board-items/{item['uuid']}/file")

        self.assertEqual(response.content, b"image bytes")
        self.assertEqual(
            response.headers.get("cache-control"),
            "private, max-age=31536000, immutable",
        )

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
            "X-Papol-Client-UUID": str(uuid.uuid4()),
            "X-Papol-Mutation-UUID": str(uuid.uuid4()),
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
            "X-Papol-Client-UUID": str(uuid.uuid4()),
            "X-Papol-Mutation-UUID": str(uuid.uuid4()),
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
            "X-Papol-Client-UUID": str(uuid.uuid4()),
            "X-Papol-Mutation-UUID": str(uuid.uuid4()),
        }
        def upload():
            return self.client.post(
                f"/api/boards/{board['uuid']}/files",
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
            headers={**self.headers, "X-Papol-Client-UUID": "not-a-uuid"},
            json={"name": "Invalid identity"},
        )
        self.assertEqual(response.status_code, 400, response.text)

    def test_uuid_push_pull_retry_and_delete_round_trip(self):
        client_uuid = str(uuid.uuid4())
        board_uuid = str(uuid.uuid4())
        item_uuid = str(uuid.uuid4())
        mutation_uuid = str(uuid.uuid4())
        create = {
            "protocol_version": 1,
            "client_uuid": client_uuid,
            "mutation_uuid": mutation_uuid,
            "local_sequence": 1,
            "changes": [
                {
                    "table": "boards", "uuid": board_uuid,
                    "base_revision": 0, "operation": "upsert",
                    "values": {"name": "Native board", "description": "offline"},
                },
                {
                    "table": "board_items", "uuid": item_uuid,
                    "base_revision": 0, "operation": "upsert",
                    "values": {
                        "board_uuid": board_uuid, "kind": "comment",
                        "content": "written offline", "x": 12, "y": 34,
                    },
                },
            ],
        }
        first = self.request("POST", "/api/sync/push", json=create).json()
        replay = self.request("POST", "/api/sync/push", json=create).json()
        self.assertEqual(replay, first)
        self.assertEqual({row["uuid"] for row in first["rows"]}, {board_uuid, item_uuid})

        pulled = self.request(
            "GET", f"/api/sync/pull?cursor=0&limit=10&client_uuid={client_uuid}",
        ).json()
        self.assertFalse(pulled["has_more"])
        self.assertEqual(
            {(change["table"], change["uuid"]) for change in pulled["changes"]},
            {("boards", board_uuid), ("board_items", item_uuid)},
        )
        cursor = pulled["cursor"]

        delete = {
            "protocol_version": 1,
            "client_uuid": client_uuid,
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{
                "table": "board_items", "uuid": item_uuid,
                "base_revision": 1, "operation": "delete", "values": {},
            }],
        }
        deleted = self.request("POST", "/api/sync/push", json=delete).json()
        self.assertEqual(deleted["rows"][0]["revision"], 2)
        tail = self.request(
            "GET", f"/api/sync/pull?cursor={cursor}&client_uuid={client_uuid}",
        ).json()
        item_delete = [
            change for change in tail["changes"]
            if change["table"] == "board_items"
        ]
        self.assertEqual(len(item_delete), 1)
        self.assertEqual(item_delete[0]["operation"], "delete")
        self.assertEqual(item_delete[0]["uuid"], item_uuid)

        with self.sessions() as db:
            self.assertEqual(db.query(Board).count(), 1)
            self.assertEqual(db.query(BoardItem).count(), 1)
            self.assertEqual(db.query(ServerChange).count(), 4)
            self.assertEqual(db.query(AppliedMutation).count(), 2)
            sync_client = db.query(SyncClient).one()
            self.assertEqual(sync_client.client_uuid, client_uuid)
            self.assertEqual(sync_client.acknowledged_cursor, cursor)

    def test_deleting_a_row_missing_after_server_restore_is_idempotent(self):
        payload = {
            "protocol_version": 1,
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards", "uuid": str(uuid.uuid4()),
                "base_revision": 4, "operation": "delete", "values": {},
            }],
        }

        first = self.request("POST", "/api/sync/push", json=payload)
        replay = self.request("POST", "/api/sync/push", json=payload)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["rows"], [])
        self.assertEqual(replay.json(), first.json())

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
        self.assertEqual(own["changes"][0]["uuid"], board["uuid"])

    def test_closing_an_account_removes_its_private_sync_bookkeeping(self):
        board_uuid = str(uuid.uuid4())
        client_uuid = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client_uuid, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Before closing"},
            }],
        })
        self.request("GET", f"/api/sync/pull?cursor=0&client_uuid={client_uuid}")
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
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "board_items", "uuid": str(uuid.uuid4()),
                "operation": "upsert",
                "values": {
                    "board_uuid": foreign_board["uuid"], "kind": "comment",
                    "content": "not mine", "user_uuid": 1,
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

        board_uuid = str(uuid.uuid4())
        item_uuid = str(uuid.uuid4())
        payload = {
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "boards", "uuid": board_uuid, "operation": "upsert",
                    "values": {"name": "Blob board"},
                },
                {
                    "table": "board_items", "uuid": item_uuid, "operation": "upsert",
                    "values": {
                        "board_uuid": board_uuid, "kind": "image",
                        "sha256": digest, "mime_type": "image/png",
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
                paper=canonical_paper, paper_uuid=canonical_paper.uuid,
                file_path=f"{digest}.pdf", sha256=digest, uploaded_by=self.user_uuid,
            )
            db.add(canonical_edition)
            db.commit()
            canonical_paper_db_uuid = canonical_paper.uuid
            canonical_paper_uuid = canonical_paper.uuid
            canonical_edition_uuid = canonical_edition.uuid
        upload = self.client.put(
            f"/api/sync/blobs/{digest}", headers=self.headers, content=content,
        )
        self.assertEqual(upload.status_code, 204, upload.text)
        paper_uuid, edition_uuid, copy_uuid = (str(uuid.uuid4()) for _ in range(3))
        payload = {
            "client_uuid": str(uuid.uuid4()), "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "papers", "uuid": paper_uuid, "operation": "upsert",
                    "values": {"title": "Imported while offline", "doi": None},
                },
                {
                    "table": "paper_editions", "uuid": edition_uuid, "operation": "upsert",
                    "values": {
                        "paper_uuid": paper_uuid, "file_path": f"{digest}.pdf", "sha256": digest,
                    },
                },
                {
                    "table": "copies", "uuid": copy_uuid, "operation": "upsert",
                    "values": {
                        "paper_uuid": paper_uuid, "edition_uuid": edition_uuid,
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
            paper_uuid: canonical_paper_uuid, edition_uuid: canonical_edition_uuid,
        })
        self.assertEqual(result["rows"][0]["uuid"], canonical_paper_uuid)
        self.assertEqual(result["rows"][1]["uuid"], canonical_edition_uuid)
        self.assertEqual(result["rows"][1]["sha256"], digest)
        downloaded = self.client.get(f"/api/sync/blobs/{digest}", headers=self.headers)
        self.assertEqual(downloaded.status_code, 200, downloaded.text)
        self.assertEqual(downloaded.content, content)

        duplicate_paper, duplicate_edition, duplicate_copy = (
            str(uuid.uuid4()) for _ in range(3)
        )
        duplicate = self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()), "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [
                {
                    "table": "papers", "uuid": duplicate_paper, "operation": "upsert",
                    # The byte identity must win even when filename-derived
                    # metadata differs between repeated desktop imports.
                    "values": {"title": "A different filename", "doi": None},
                },
                {
                    "table": "paper_editions", "uuid": duplicate_edition,
                    "operation": "upsert", "values": {
                        "paper_uuid": duplicate_paper, "file_path": f"{digest}.pdf",
                        "sha256": digest,
                    },
                },
                {
                    "table": "copies", "uuid": duplicate_copy, "operation": "upsert",
                    "values": {
                        "paper_uuid": duplicate_paper, "edition_uuid": duplicate_edition,
                        "edition_sha256": digest, "summary": "Updated offline",
                    },
                },
            ],
        }).json()
        self.assertEqual(duplicate["aliases"], {
            duplicate_paper: canonical_paper_uuid,
            duplicate_edition: canonical_edition_uuid,
            duplicate_copy: copy_uuid,
        })
        with self.sessions() as db:
            copies = db.query(Copy).filter(Copy.paper_uuid == canonical_paper_db_uuid).all()
            self.assertEqual(len(copies), 1)
            self.assertEqual(copies[0].summary, "Updated offline")

    def test_offline_add_to_nook_reuses_a_visible_paper_and_edition(self):
        with self.sessions() as db:
            other = User(
                email="other@example.test", display_name="Other user",
                password_hash="unused",
            )
            paper = Paper(title="Visible before adding")
            db.add_all([other, paper])
            db.flush()
            shelf = Shelf(
                user_uuid=other.uuid, name="Public", color="#123456",
                is_public=True, is_default=True,
            )
            edition = PaperEdition(
                paper=paper, paper_uuid=paper.uuid, file_path="visible.pdf",
                sha256="a" * 64, uploaded_by=other.uuid,
            )
            db.add_all([shelf, edition])
            db.flush()
            db.add(Copy(
                paper=paper, user_uuid=other.uuid, shelf=shelf,
                edition=edition, edition_sha256=edition.sha256,
            ))
            db.commit()
            paper_uuid, edition_uuid = paper.uuid, edition.uuid
            own_shelf_uuid = db.query(Shelf).filter(
                Shelf.user_uuid == self.user_uuid, Shelf.is_default.is_(True),
            ).one().uuid

        copy_uuid = str(uuid.uuid4())
        result = self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "copies", "uuid": copy_uuid, "operation": "upsert",
                "base_revision": 0,
                "values": {
                    "paper_uuid": paper_uuid, "shelf_uuid": own_shelf_uuid,
                    "edition_uuid": edition_uuid, "edition_sha256": "a" * 64,
                },
            }],
        }).json()
        self.assertEqual(result["rows"][0]["uuid"], copy_uuid)
        self.assertEqual(result["rows"][0]["paper_uuid"], paper_uuid)
        self.assertEqual(result["rows"][0]["edition_uuid"], edition_uuid)

    def test_opening_a_removed_paper_again_revives_the_users_copy(self):
        """A file removed from the nook and opened again returns to it.

        The desktop mints a fresh copy UUID each time, which is aliased onto
        the user's tombstone; reviving it is the only way the addition can
        take effect, and without it the paper leaves the library on the next
        snapshot and the viewer asks to add it once more.
        """
        content = b"%PDF-1.4\nremoved and opened again\n%%EOF"
        digest = hashlib.sha256(content).hexdigest()
        upload = self.client.put(
            f"/api/sync/blobs/{digest}", headers=self.headers, content=content,
        )
        self.assertEqual(upload.status_code, 204, upload.text)
        client = str(uuid.uuid4())
        paper_uuid, edition_uuid, copy_uuid = (str(uuid.uuid4()) for _ in range(3))
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {"table": "papers", "uuid": paper_uuid, "operation": "upsert",
                 "values": {"title": "Removed and opened again", "doi": None}},
                {"table": "paper_editions", "uuid": edition_uuid, "operation": "upsert",
                 "values": {"paper_uuid": paper_uuid, "file_path": f"{digest}.pdf",
                            "sha256": digest}},
                {"table": "copies", "uuid": copy_uuid, "operation": "upsert",
                 "values": {"paper_uuid": paper_uuid, "edition_uuid": edition_uuid,
                            "edition_sha256": digest}},
            ],
        })
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{"table": "copies", "uuid": copy_uuid, "base_revision": 1,
                         "operation": "delete", "values": {}}],
        })

        again_paper, again_edition, again_copy = (str(uuid.uuid4()) for _ in range(3))
        revived = self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 3,
            "changes": [
                {"table": "papers", "uuid": again_paper, "operation": "upsert",
                 "values": {"title": "Removed and opened again", "doi": None}},
                {"table": "paper_editions", "uuid": again_edition, "operation": "upsert",
                 "values": {"paper_uuid": again_paper, "file_path": f"{digest}.pdf",
                            "sha256": digest}},
                {"table": "copies", "uuid": again_copy, "base_revision": 0,
                 "operation": "upsert",
                 "values": {"paper_uuid": again_paper, "edition_uuid": again_edition,
                            "edition_sha256": digest}},
            ],
        }).json()

        self.assertEqual(revived["aliases"][again_copy], copy_uuid)
        # The fresh addition wins the ordinary revision conflict; what must
        # never happen again is the removal rejecting it outright.
        resolutions = [conflict["resolution"] for conflict in revived["conflicts"]]
        reasons = [conflict.get("reason") for conflict in revived["conflicts"]]
        self.assertNotIn("server_won", resolutions)
        self.assertNotIn("row_deleted", reasons)
        copy_row = next(row for row in revived["rows"] if row["table"] == "copies")
        self.assertIsNone(copy_row["deleted_at"])
        self.assertEqual(copy_row["edition_sha256"], digest)
        with self.sessions() as db:
            copies = db.query(Copy).filter(Copy.user_uuid == self.user_uuid).all()
            self.assertEqual(len(copies), 1)
            self.assertIsNone(copies[0].deleted_at)

    def test_online_add_to_nook_revives_a_removed_copy(self):
        with self.sessions() as db:
            other = User(
                email="reviver@example.test", display_name="Other user",
                password_hash="unused",
            )
            paper = Paper(title="Removed on the web")
            db.add_all([other, paper])
            db.flush()
            shelf = Shelf(
                user_uuid=other.uuid, name="Public", color="#123456",
                is_public=True, is_default=True,
            )
            edition = PaperEdition(
                paper=paper, paper_uuid=paper.uuid, file_path="removed.pdf",
                sha256="b" * 64, uploaded_by=other.uuid,
            )
            db.add_all([shelf, edition])
            db.flush()
            db.add(Copy(
                paper=paper, user_uuid=other.uuid, shelf=shelf,
                edition=edition, edition_sha256=edition.sha256,
            ))
            db.commit()
            paper_uuid = paper.uuid

        self.request("POST", f"/api/papers/{paper_uuid}/add-to-nook")
        self.request("DELETE", f"/api/papers/{paper_uuid}")
        self.request("POST", f"/api/papers/{paper_uuid}/add-to-nook")

        with self.sessions() as db:
            copies = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid, Copy.paper_uuid == paper_uuid,
            ).all()
            self.assertEqual(len(copies), 1)
            self.assertIsNone(copies[0].deleted_at)

    def test_sync_rejects_active_or_credentialed_board_links(self):
        board_uuid = str(uuid.uuid4())
        for source_url in ("javascript:alert(1)", "https://user:secret@example.test/page"):
            payload = {
                "client_uuid": str(uuid.uuid4()),
                "mutation_uuid": str(uuid.uuid4()),
                "local_sequence": 1,
                "changes": [
                    {
                        "table": "boards", "uuid": board_uuid, "operation": "upsert",
                        "values": {"name": "Safe links"},
                    },
                    {
                        "table": "board_items", "uuid": str(uuid.uuid4()),
                        "operation": "upsert",
                        "values": {
                            "board_uuid": board_uuid, "kind": "webpage",
                            "source_url": source_url,
                        },
                    },
                ],
            }
            response = self.client.post("/api/sync/push", headers=self.headers, json=payload)
            self.assertEqual(response.status_code, 422, response.text)

    def test_a_stale_board_edit_wins_and_reports_a_recoverable_conflict(self):
        board_uuid = str(uuid.uuid4())
        first_client = str(uuid.uuid4())
        create = {
            "client_uuid": first_client,
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Original"},
            }],
        }
        self.request("POST", "/api/sync/push", json=create)
        winning = {
            "client_uuid": first_client,
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 1,
                "operation": "patch", "values": {"name": "First edit"},
            }],
        }
        self.request("POST", "/api/sync/push", json=winning)
        stale = {
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 1,
                "operation": "patch", "values": {"name": "Later edit"},
            }],
        }
        result = self.request("POST", "/api/sync/push", json=stale).json()
        self.assertEqual(result["rows"][0]["revision"], 3)
        self.assertEqual(result["rows"][0]["name"], "Later edit")
        self.assertEqual(result["conflicts"][0]["previous"]["name"], "First edit")
        self.assertEqual(result["conflicts"][0]["resolution"], "client_won")

    def test_delete_wins_over_a_stale_update_and_preserves_recovery_values(self):
        board_uuid = str(uuid.uuid4())
        client = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 0,
                "operation": "upsert", "values": {"name": "Original"},
            }],
        })
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2, "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 1,
                "operation": "delete", "values": {},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()), "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "boards", "uuid": board_uuid, "base_revision": 1,
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

    def test_a_stale_board_group_edit_wins_and_reports_a_recoverable_conflict(self):
        board_uuid, group_uuid = str(uuid.uuid4()), str(uuid.uuid4())
        client = str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()), "local_sequence": 1,
            "changes": [
                {"table": "boards", "uuid": board_uuid, "base_revision": 0,
                 "operation": "upsert", "values": {"name": "Board"}},
                {"table": "board_groups", "uuid": group_uuid, "base_revision": 0,
                 "operation": "upsert", "values": {
                     "board_uuid": board_uuid, "kind": "booklet", "title": "Original",
                 }},
            ],
        })
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()), "local_sequence": 2,
            "changes": [{
                "table": "board_groups", "uuid": group_uuid, "base_revision": 1,
                "operation": "patch", "values": {"title": "Device one"},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()), "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "board_groups", "uuid": group_uuid, "base_revision": 1,
                "operation": "patch", "values": {"title": "Device two"},
            }],
        }).json()
        self.assertEqual(stale["rows"][0]["title"], "Device two")
        self.assertEqual(stale["conflicts"][0]["resolution"], "client_won")

    def test_a_stale_ink_edit_wins_and_reports_a_recoverable_conflict(self):
        with self.sessions() as db:
            paper = Paper(title="Conflict paper")
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper, paper_uuid=paper.uuid,
                file_path="conflict.pdf", sha256="2" * 64, uploaded_by=self.user_uuid,
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper=paper, paper_uuid=paper.uuid, user_uuid=self.user_uuid,
                edition=edition, edition_uuid=edition.uuid,
                edition_sha256=edition.sha256,
            ))
            db.commit()
            edition_uuid, paper_uuid = edition.uuid, paper.uuid
        ink_uuid, client = str(uuid.uuid4()), str(uuid.uuid4())
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()), "local_sequence": 1,
            "changes": [{
                "table": "annotations", "uuid": ink_uuid, "base_revision": 0,
                "operation": "upsert", "values": {
                    "kind": "ink", "paper_uuid": paper_uuid,
                    "edition_uuid": edition_uuid, "page": 1,
                    "body": json.dumps({
                        "points": [{"x": 0.1, "y": 0.2}], "color": "#111111",
                        "width": 0.004, "opacity": 1, "shape": "flat",
                    }),
                },
            }],
        })
        self.request("POST", "/api/sync/push", json={
            "client_uuid": client, "mutation_uuid": str(uuid.uuid4()), "local_sequence": 2,
            "changes": [{
                "table": "annotations", "uuid": ink_uuid, "base_revision": 1,
                "operation": "patch", "values": {"body": json.dumps({
                    "points": [{"x": 0.1, "y": 0.2}], "color": "#222222",
                    "width": 0.004, "opacity": 1, "shape": "flat",
                })},
            }],
        })
        stale = self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()), "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1, "changes": [{
                "table": "annotations", "uuid": ink_uuid, "base_revision": 1,
                "operation": "patch", "values": {"body": json.dumps({
                    "points": [{"x": 0.1, "y": 0.2}], "color": "#333333",
                    "width": 0.004, "opacity": 1, "shape": "flat",
                })},
            }],
        }).json()
        self.assertEqual(json.loads(stale["rows"][0]["body"])["color"], "#333333")
        self.assertEqual(
            json.loads(stale["conflicts"][0]["previous"]["body"])["color"], "#222222",
        )
        self.assertEqual(stale["conflicts"][0]["resolution"], "client_won")

    def test_annotation_snapshot_and_offline_mutations_use_uuid_relationships(self):
        with self.sessions() as db:
            paper = Paper(title="Offline annotations")
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper, paper_uuid=paper.uuid,
                file_path="offline.pdf", sha256="1" * 64, uploaded_by=self.user_uuid,
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper_uuid=paper.uuid, user_uuid=self.user_uuid, edition_uuid=edition.uuid,
                edition_sha256=edition.sha256,
            ))
            db.commit()
            paper_uuid, edition_uuid = paper.uuid, edition.uuid

        initial = self.request("GET", "/api/sync/snapshot").json()
        identities = {(row["table"], row["uuid"]) for row in initial["rows"]}
        self.assertIn(("papers", paper_uuid), identities)
        self.assertIn(("paper_editions", edition_uuid), identities)
        self.assertTrue(any(table == "copies" for table, _ in identities))
        self.assertTrue(any(table == "shelves" for table, _ in identities))
        ids = [str(uuid.uuid4()) for _ in range(3)]
        payload = {
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "annotations", "uuid": ids[0], "operation": "upsert",
                    "values": {
                        "kind": "note", "paper_uuid": paper_uuid,
                        "edition_uuid": edition_uuid,
                        "content": "offline note", "page": 1,
                        "body": json.dumps({
                            "anchor": {"type": "point", "x": 0.2, "y": 0.3},
                        }),
                    },
                },
                {
                    "table": "annotations", "uuid": ids[1], "operation": "upsert",
                    "values": {
                        "kind": "ink", "paper_uuid": paper_uuid,
                        "edition_uuid": edition_uuid, "page": 1,
                        "body": json.dumps({
                            "points": [{"x": 0.1, "y": 0.2}], "color": "#b3923d",
                            "width": 0.004, "opacity": 1, "shape": "flat",
                        }),
                    },
                },
                {
                    "table": "annotations", "uuid": ids[2], "operation": "upsert",
                    "values": {
                        "kind": "clip", "paper_uuid": paper_uuid,
                        "edition_uuid": edition_uuid, "page": 1,
                        "body": json.dumps({
                            "source": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                            "frame": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
                            "floating": False,
                        }),
                    },
                },
            ],
        }
        pushed = self.request("POST", "/api/sync/push", json=payload).json()
        self.assertEqual({row["uuid"] for row in pushed["rows"]}, set(ids))
        refreshed = self.request("GET", "/api/sync/snapshot").json()
        self.assertTrue({
            "papers", "paper_editions", "annotations",
        }.issubset({row["table"] for row in refreshed["rows"]}))
        with self.sessions() as db:
            self.assertEqual(
                sorted(row.kind for row in db.query(Annotation).all()),
                ["clip", "ink", "note"],
            )

    def test_snapshot_contains_the_complete_board_hierarchy(self):
        board = self.request("POST", "/api/boards", json={"name": "Snapshot board"}).json()
        item = self.request(
            "POST", f"/api/boards/{board['uuid']}/comments",
            json={"content": "On the board", "x": 12, "y": 34},
        ).json()
        second_item = self.request(
            "POST", f"/api/boards/{board['uuid']}/comments",
            json={"content": "Also on the board", "x": 56, "y": 78},
        ).json()
        group = self.request(
            "POST", f"/api/boards/{board['uuid']}/groups",
            json={
                "kind": "collection", "title": "Snapshot group",
                "item_uuids": [item["uuid"], second_item["uuid"]],
            },
        ).json()

        snapshot = self.request("GET", "/api/sync/snapshot").json()
        identities = {(row["table"], row["uuid"]) for row in snapshot["rows"]}

        self.assertIn(("boards", board["uuid"]), identities)
        self.assertIn(("board_groups", group["uuid"]), identities)
        self.assertIn(("board_items", item["uuid"]), identities)
        self.assertIn(("board_items", second_item["uuid"]), identities)

    def test_viewer_reference_boundary_accepts_a_synced_edition_uuid(self):
        digest = "3" * 64
        with self.sessions() as db:
            paper = Paper(title="Desktop viewer references")
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper,
                paper_uuid=paper.uuid,
                file_path="viewer.pdf",
                sha256=digest,
                uploaded_by=self.user_uuid,
                references_status="unavailable",
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper=paper,
                paper_uuid=paper.uuid,
                user_uuid=self.user_uuid,
                edition=edition,
                edition_uuid=edition.uuid,
                edition_sha256=digest,
            ))
            db.commit()
            edition_uuid = edition.uuid

        response = self.request(
            "GET", f"/api/viewer-references/{digest}?edition_uuid={edition_uuid}",
        )
        self.assertEqual(response.json()["edition_uuid"], edition_uuid)

    def test_metadata_reextraction_prefers_pdf_doi_over_stale_saved_doi(self):
        digest = "4" * 64
        with self.sessions() as db:
            paper = Paper(
                title="Incorrect imported title",
                doi="10.0000/stale-doi",
            )
            db.add(paper)
            db.flush()
            edition = PaperEdition(
                paper=paper,
                paper_uuid=paper.uuid,
                file_path="countersnapping.pdf",
                sha256=digest,
                uploaded_by=self.user_uuid,
            )
            db.add(edition)
            db.flush()
            db.add(Copy(
                paper=paper,
                paper_uuid=paper.uuid,
                user_uuid=self.user_uuid,
                edition=edition,
                edition_uuid=edition.uuid,
                edition_sha256=digest,
            ))
            db.commit()
            paper_uuid = paper.uuid

        metadata = {
            "doi": "10.1073/pnas.2423301122",
            "title": "Exotic mechanical properties enabled by countersnapping instabilities",
            "authors": [
                "Paul Ducarme", "Bart Weber", "Martin van Hecke",
                "Johannes T. B. Overvelde",
            ],
            "venue": "Proceedings of the National Academy of Sciences",
            "year": 2025,
        }
        lookup = AsyncMock(return_value=metadata)
        with (
            patch.object(main, "_edition_pdf_path", return_value=Path("paper.pdf")),
            patch.object(
                main,
                "extract_doi_from_pdf",
                return_value=("10.1073/pnas.2423301122", "PDF text"),
            ),
            patch.object(main.metadata_lookup, "by_doi", lookup),
        ):
            response = self.client.post(
                f"/api/papers/{paper_uuid}/extract-metadata",
                headers=self.headers,
            )

        self.assertEqual(response.status_code, 200, response.text)
        lookup.assert_awaited_once_with("10.1073/pnas.2423301122")
        self.assertEqual(response.json(), {
            "doi": metadata["doi"],
            "title": metadata["title"],
            "authors": json.dumps(metadata["authors"]),
            "journal": metadata["venue"],
            "year": metadata["year"],
        })

    def test_edition_choices_are_published_to_cursor_sync(self):
        with self.sessions() as db:
            paper = Paper(title="Edition sync")
            db.add(paper)
            db.flush()
            first = PaperEdition(
                paper=paper, paper_uuid=paper.uuid,
                file_path="first.pdf", sha256="1" * 64, uploaded_by=self.user_uuid,
            )
            second = PaperEdition(
                paper=paper, paper_uuid=paper.uuid,
                file_path="second.pdf", sha256="2" * 64, uploaded_by=self.user_uuid,
            )
            db.add_all([first, second])
            db.flush()
            copy = Copy(
                paper=paper, user_uuid=self.user_uuid, edition=first,
                edition_sha256=first.sha256,
            )
            db.add(copy)
            db.commit()
            paper_uuid = paper.uuid
            second_uuid = second.uuid
            copy_uuid = copy.uuid

        self.request(
            "POST", f"/api/papers/{paper_uuid}/ignore-edition",
            json={"edition_uuid": second_uuid},
        )
        with self.sessions() as db:
            change = db.query(ServerChange).one()
            self.assertEqual(change.table_name, "copies")
            self.assertEqual(change.row_uuid, copy_uuid)
            db.query(ServerChange).delete()
            db.commit()

        self.request(
            "POST", f"/api/papers/{paper_uuid}/adopt-edition",
            json={"edition_uuid": second_uuid},
        )
        with self.sessions() as db:
            change = db.query(ServerChange).one()
            self.assertEqual(change.table_name, "copies")
            self.assertEqual(change.row_uuid, copy_uuid)

    def test_nook_rows_sync_together_with_uuid_relationships(self):
        with self.sessions() as db:
            default_shelf = db.query(Shelf).filter(Shelf.user_uuid == self.user_uuid).first()
            paper = Paper(title="Offline nook")
            db.add(paper)
            db.flush()
            copy = Copy(paper=paper, shelf=default_shelf, user_uuid=self.user_uuid)
            db.add(copy)
            commit_sync(db)
            paper_uuid, copy_uuid = paper.uuid, copy.uuid

        shelf_uuid, tag_uuid, link_uuid = (str(uuid.uuid4()) for _ in range(3))
        payload = {
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [
                {
                    "table": "shelves", "uuid": shelf_uuid, "operation": "upsert",
                    "values": {"name": "Methods", "color": "#123456", "position": 2},
                },
                {
                    "table": "tags", "uuid": tag_uuid, "operation": "upsert",
                    "values": {"name": "distributed"},
                },
                {
                    "table": "copies", "uuid": copy_uuid, "operation": "patch",
                    "base_revision": 1,
                    "values": {
                        "shelf_uuid": shelf_uuid, "summary": "Saved without a network",
                        "rating_reading": 4,
                    },
                },
                {
                    "table": "copy_tags", "uuid": link_uuid, "operation": "upsert",
                    "values": {"copy_uuid": copy_uuid, "tag_uuid": tag_uuid},
                },
            ],
        }
        result = self.request("POST", "/api/sync/push", json=payload).json()
        self.assertEqual([row["table"] for row in result["rows"]], [
            "shelves", "tags", "copies", "copy_tags",
        ])
        self.assertEqual(result["rows"][2]["paper_uuid"], paper_uuid)
        self.assertEqual(result["rows"][2]["shelf_uuid"], shelf_uuid)
        with self.sessions() as db:
            saved = db.query(Copy).filter(Copy.uuid == copy_uuid).one()
            self.assertEqual(saved.summary, "Saved without a network")
            self.assertEqual(saved.rating_reading, 4)
            self.assertEqual(saved.shelf.uuid, shelf_uuid)
            self.assertEqual(db.query(Tag).filter(Tag.uuid == tag_uuid).one().name, "distributed")
            self.assertEqual(
                db.query(CopyTagLink).filter(CopyTagLink.uuid == link_uuid).one().copy_uuid,
                saved.uuid,
            )

        rejected = self.client.request("POST", "/api/sync/push", headers=self.headers, json={
            "client_uuid": payload["client_uuid"],
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 2,
            "changes": [{
                "table": "copies", "uuid": copy_uuid, "operation": "patch",
                "base_revision": 2,
                "values": {"rating_liking": 6},
            }],
        })
        self.assertEqual(rejected.status_code, 422, rejected.text)

    def test_desktop_board_deletion_disappears_from_the_web_nook(self):
        board = self.request("POST", "/api/boards", json={"name": "Delete offline"}).json()
        before = self.request("GET", f"/api/users/{self.user_uuid}/space").json()
        self.assertEqual([row["uuid"] for row in before["boards"]], [board["uuid"]])

        self.request("POST", "/api/sync/push", json={
            "client_uuid": str(uuid.uuid4()),
            "mutation_uuid": str(uuid.uuid4()),
            "local_sequence": 1,
            "changes": [{
                "table": "boards",
                "uuid": board["uuid"],
                "base_revision": board["revision"],
                "operation": "delete",
                "values": {},
            }],
        })

        after = self.request("GET", f"/api/users/{self.user_uuid}/space").json()
        self.assertEqual(after["boards"], [])

    def test_desktop_shelf_moves_publish_and_hide_like_online_moves(self):
        with self.sessions() as db:
            public = Shelf(user_uuid=self.user_uuid, name="Offline public", color="#123456", is_public=True)
            private = Shelf(user_uuid=self.user_uuid, name="Offline private", color="#654321", is_public=False)
            paper = Paper(title="Shelved offline")
            db.add_all([public, private, paper])
            db.flush()
            copy = Copy(paper=paper, shelf=public, user_uuid=self.user_uuid)
            db.add(copy)
            commit_sync(db)
            public_uuid, private_uuid, copy_uuid = public.uuid, private.uuid, copy.uuid
            revision = copy.revision

        client_uuid = str(uuid.uuid4())

        def move(shelf_uuid, sequence):
            return self.client.request("POST", "/api/sync/push", headers=self.headers, json={
                "client_uuid": client_uuid,
                "mutation_uuid": str(uuid.uuid4()),
                "local_sequence": sequence,
                "changes": [{
                    "table": "copies", "uuid": copy_uuid, "operation": "patch",
                    "base_revision": revision, "values": {"shelf_uuid": shelf_uuid},
                }],
            })

        def is_public():
            with self.sessions() as db:
                return db.query(Copy).filter(Copy.uuid == copy_uuid).one().is_public

        self.assertLess(move(private_uuid, 1).status_code, 400)
        self.assertFalse(is_public())
        self.assertLess(move(public_uuid, 2).status_code, 400)
        self.assertTrue(is_public())

        with self.sessions() as db:
            room = Room(paper_key="title:shelved offline", paper_title="Shelved offline", created_by=self.user_uuid)
            db.add(room)
            db.flush()
            db.add(RoomParticipant(room_uuid=room.uuid, user_uuid=self.user_uuid))
            db.commit()
        refused = move(private_uuid, 3)
        self.assertEqual(refused.status_code, 422, refused.text)
        self.assertTrue(is_public())

    def assert_no_id_fields(self, value):
        """Rows are named by `uuid` and refer to each other by `<name>_uuid`."""
        if isinstance(value, dict):
            for key, child in value.items():
                self.assertFalse(key == "id" or key.endswith(("_id", "_ids")), key)
                self.assert_no_id_fields(child)
        elif isinstance(value, list):
            for child in value:
                self.assert_no_id_fields(child)

    def test_every_identity_is_a_uuid(self):
        me = self.request("GET", "/api/auth/me").json()
        uuid.UUID(me["uuid"])
        space = self.request("GET", f"/api/users/{me['uuid']}/space").json()
        self.assertEqual(space["user"]["uuid"], me["uuid"])
        for shelf in space["shelves"]:
            uuid.UUID(shelf["uuid"])
        for tag in self.request("GET", "/api/tags").json():
            uuid.UUID(tag["uuid"])
        self.assert_no_id_fields(space)

        welcome = self.request("GET", "/api/notifications").json()["notifications"][0]
        uuid.UUID(welcome["uuid"])
        self.request("POST", f"/api/notifications/{welcome['uuid']}/read")

        snapshot = self.request("GET", "/api/sync/snapshot").json()
        owners = {row["user_uuid"] for row in snapshot["rows"] if row.get("user_uuid")}
        self.assertEqual(owners, {me["uuid"]})

    def test_server_only_actions_accept_desktop_sync_uuids(self):
        with self.sessions() as db:
            shelf = Shelf(user_uuid=self.user_uuid, name="Desktop shelf", color="#123456", is_public=False)
            paper = Paper(title="Desktop paper")
            db.add_all([shelf, paper])
            db.flush()
            db.add(Copy(paper=paper, shelf=shelf, user_uuid=self.user_uuid))
            commit_sync(db)
            shelf_uuid, paper_uuid = shelf.uuid, paper.uuid

        self.request("PUT", f"/api/papers/{paper_uuid}", json={"thought": "Read on the train"})
        self.request("PUT", f"/api/shelves/{shelf_uuid}", json={"is_public": True})
        with self.sessions() as db:
            copy = db.query(Copy).join(Paper).filter(Paper.uuid == paper_uuid).one()
            self.assertEqual(copy.thought, "Read on the train")
            self.assertTrue(copy.is_public)
        self.request("DELETE", f"/api/shelves/{shelf_uuid}")
        with self.sessions() as db:
            self.assertIsNotNone(db.query(Shelf).filter(Shelf.uuid == shelf_uuid).one().deleted_at)
        missing = self.client.request(
            "PUT", f"/api/shelves/{uuid.uuid4()}", headers=self.headers, json={"is_public": True},
        )
        self.assertEqual(missing.status_code, 404, missing.text)
        paper = self.request("GET", f"/api/papers/{paper_uuid}").json()
        self.assertEqual(paper["uuid"], paper_uuid)
        self.assert_no_id_fields(paper)


if __name__ == "__main__":
    unittest.main()
