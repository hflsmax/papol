"""Background jobs: what a request queues, what a worker does with it, and
what the client learns in between.

The queue is a table, so the tests are on the table: a key holds one live
job, a claim is a claim, an abandoned job is taken up once and then
failed. Then each thing that became a job — reading an upload, analyzing
a paper, capturing a card, sending mail — from the request that queues it
to the row the worker leaves behind, with the outside world (GROBID, a
browser, an SMTP server) stubbed at the service's edge.
"""
import asyncio
import hashlib
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import grobid
import main
import metadata_lookup
import storage
import testdb
import worker
from auth import get_current_user, get_optional_user
from database import get_db
from models import (
    Board, BoardItem, Copy, Feedback, Job, Notification, Paper, PaperCitation,
    PaperLink, PaperReference, Shelf, User,
)
from services import analysis, capture, extraction, jobs, notifications


class JobTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = testdb.fresh_engine()
        cls.Session = sessionmaker(bind=cls.engine)
        cls.scratch = TemporaryDirectory()
        cls.original_stores = (storage.uploads, storage.board_files)
        storage.uploads = storage.FilesystemFiles(Path(cls.scratch.name) / "uploads")
        storage.board_files = storage.FilesystemFiles(Path(cls.scratch.name) / "board_uploads")
        with cls.Session() as db:
            user = User(email="reader@example.test", display_name="Reader", password_hash="x")
            admin = User(email="admin@example.test", display_name="Admin", password_hash="x", is_admin=True)
            db.add_all([user, admin])
            db.flush()
            db.add(Shelf(user_uuid=user.uuid, name="Reading", color="#000", is_public=True,
                         is_default=True, position=0))
            db.commit()
            cls.user_uuid, cls.admin_uuid = user.uuid, admin.uuid

        def test_db():
            db = cls.Session()
            try:
                yield db
            finally:
                db.close()

        def test_user(db: Session = Depends(get_db)):
            return db.get(User, cls.user_uuid)

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = test_user
        main.app.dependency_overrides[get_optional_user] = test_user
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        main.app.dependency_overrides.clear()
        storage.uploads, storage.board_files = cls.original_stores
        cls.scratch.cleanup()
        cls.engine.dispose()

    def setUp(self):
        with self.Session() as db:
            for model in (Job, Notification, Feedback, BoardItem, Board,
                          PaperCitation, PaperLink, PaperReference, Copy, Paper):
                db.query(model).delete()
            db.commit()

    # ------------------------------------------------------------ helpers

    def drain(self) -> int:
        return asyncio.run(worker.drain(self.Session, worker="test"))

    def live_jobs(self, kind=None):
        with self.Session() as db:
            query = db.query(Job).filter(Job.status.in_(jobs.LIVE))
            if kind:
                query = query.filter(Job.kind == kind)
            return query.all()

    def job(self, uuid) -> Job:
        with self.Session() as db:
            return db.get(Job, uuid)

    def poll(self, uuid):
        response = self.client.get(f"/api/jobs/{uuid}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def board(self) -> str:
        with self.Session() as db:
            board = Board(user_uuid=self.user_uuid, name="Ideas")
            db.add(board)
            db.commit()
            return board.uuid

    # ---------------------------------------------------------- the queue

    def test_a_key_holds_one_live_job_at_a_time(self):
        with self.Session() as db:
            first = jobs.enqueue(db, "noop", {}, key="once")
            again = jobs.enqueue(db, "noop", {}, key="once")
            db.commit()
            self.assertIsNotNone(first)
            self.assertIsNone(again)

            jobs.finish(db, db.get(Job, first), {"ok": True})
            after = jobs.enqueue(db, "noop", {}, key="once")
            db.commit()
            self.assertIsNotNone(after)
            self.assertNotEqual(after, first)

    def test_a_job_is_not_due_before_its_time(self):
        with self.Session() as db:
            jobs.enqueue(db, "noop", {}, run_at=datetime.utcnow() + timedelta(hours=1))
            db.commit()
            self.assertIsNone(jobs.claim(db, "test"))

    def test_an_abandoned_job_is_taken_up_once_more_and_then_failed(self):
        with self.Session() as db:
            uuid = jobs.enqueue(db, "noop", {})
            db.commit()
            claimed = jobs.claim(db, "first")
            self.assertEqual((claimed.uuid, claimed.status, claimed.attempts), (uuid, "running", 1))
            # Its worker died; the lease runs out.
            claimed.started_at = datetime.utcnow() - jobs.LEASE - timedelta(minutes=1)
            db.commit()
            taken_again = jobs.claim(db, "second")
            self.assertEqual((taken_again.uuid, taken_again.worker, taken_again.attempts), (uuid, "second", 2))
            taken_again.started_at = datetime.utcnow() - jobs.LEASE - timedelta(minutes=1)
            db.commit()
            self.assertIsNone(jobs.claim(db, "third"))
            db.expire_all()
            failed = db.get(Job, uuid)
            self.assertEqual(failed.status, "failed")
            self.assertIn("Abandoned", failed.error)

    def test_a_kind_no_worker_knows_is_failed_rather_than_left(self):
        with self.Session() as db:
            uuid = jobs.enqueue(db, "carrier_pigeon", {})
            db.commit()
        self.assertEqual(self.drain(), 1)
        self.assertEqual(self.job(uuid).status, "failed")
        self.assertIn("carrier_pigeon", self.job(uuid).error)

    def test_a_handler_that_crashes_fails_its_job_with_the_reason(self):
        async def boom(db, payload):
            raise RuntimeError("the disk is on fire")
        with self.Session() as db:
            uuid = jobs.enqueue(db, "burn", {})
            db.commit()
        with patch.dict(worker.HANDLERS, {"burn": boom}):
            self.drain()
        self.assertEqual((self.job(uuid).status, self.job(uuid).error), ("failed", "the disk is on fire"))

    # ------------------------------------------------------- the upload

    def test_an_upload_is_stored_now_and_read_by_a_job_the_uploader_polls(self):
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        response = self.client.post(
            "/api/papers/extract", files={"file": ("Some-Paper.pdf", pdf, "application/pdf")},
        )
        self.assertEqual(response.status_code, 202, response.text)
        ticket = response.json()
        digest = hashlib.sha256(pdf).hexdigest()
        self.assertEqual(ticket["file_path"], f"{digest}.pdf")
        self.assertEqual(ticket["sha256"], digest)
        self.assertEqual(storage.uploads.get(f"{digest}.pdf"), pdf)
        self.assertEqual(self.poll(ticket["job"])["status"], "queued")

        with patch.object(extraction, "extract_doi_from_pdf", return_value=(None, "")), \
                patch.object(extraction, "printed_header", AsyncMock(return_value=None)):
            self.drain()
        done = self.poll(ticket["job"])
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["result"]["title"], "Some Paper")
        self.assertEqual(done["result"]["file_path"], f"{digest}.pdf")

    def test_a_reading_the_apis_cannot_answer_fails_with_a_sentence(self):
        response = self.client.post(
            "/api/papers/extract", files={"file": ("p.pdf", b"%PDF-1.4 x", "application/pdf")},
        )
        job = response.json()["job"]
        with patch.object(extraction, "extract_doi_from_pdf", return_value=("10.1/x", "")), \
                patch.object(metadata_lookup, "by_doi", AsyncMock(side_effect=metadata_lookup.Unavailable("down"))):
            self.drain()
        failed = self.poll(job)
        self.assertEqual((failed["status"], failed["detail"]), ("failed", "Metadata lookup failed"))

    def test_a_job_is_only_its_owners_to_ask_after(self):
        with self.Session() as db:
            theirs = jobs.enqueue(db, "noop", {}, user_uuid=self.admin_uuid)
            nobodys = jobs.enqueue(db, "noop", {})
            db.commit()
        self.assertEqual(self.client.get(f"/api/jobs/{theirs}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/jobs/{nobodys}").status_code, 404)
        self.assertEqual(self.client.get("/api/jobs/not-a-job").status_code, 404)

    # ------------------------------------------------------ the analysis

    def save_paper(self) -> str:
        pdf = b"%PDF-1.4 a paper"
        digest = hashlib.sha256(pdf).hexdigest()
        storage.uploads.put(f"{digest}.pdf", pdf, "application/pdf")
        response = self.client.post("/api/papers", json={
            "title": "A paper", "file_path": f"{digest}.pdf",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return digest

    def test_saving_a_paper_queues_one_analysis_and_the_viewer_waits_on_it(self):
        with patch.object(grobid, "configured", return_value=True):
            digest = self.save_paper()
            self.assertEqual(len(self.live_jobs(analysis.KIND)), 1)
            with self.Session() as db:
                self.assertEqual(db.get(Paper, digest).references_status, "pending")

            # The viewer asking does not queue a second pass.
            asked = self.client.get(f"/api/viewer-references/{digest}?paper_sha256={digest}").json()
            self.assertEqual(asked["status"], "pending")
            self.assertEqual(len(self.live_jobs(analysis.KIND)), 1)

            found = grobid.Analysis(
                references=[grobid.Reference(key="b0", index=0, raw="Doe 2020", title="Found")],
                citations=[grobid.Citation(key="b0", label="[1]", page=1)],
            )
            with patch.object(grobid, "analyze", AsyncMock(return_value=found)):
                self.assertEqual(self.drain(), 1)

            ready = self.client.get(f"/api/viewer-references/{digest}?paper_sha256={digest}").json()
        self.assertEqual(ready["status"], "ready")
        self.assertEqual([r["title"] for r in ready["references"]], ["Found"])
        self.assertEqual(len(ready["citations"]), 1)
        self.assertEqual(self.live_jobs(), [])

    def test_a_pass_that_fails_is_recorded_on_the_paper_and_not_retried(self):
        with patch.object(grobid, "configured", return_value=True):
            digest = self.save_paper()
            with patch.object(grobid, "analyze", AsyncMock(side_effect=RuntimeError("GROBID returned 503"))):
                self.drain()
            with self.Session() as db:
                paper = db.get(Paper, digest)
                self.assertEqual((paper.references_status, paper.references_error), ("failed", "GROBID returned 503"))
                job = db.query(Job).filter(Job.kind == analysis.KIND).one()
                self.assertEqual((job.status, job.error), ("failed", "GROBID returned 503"))
            failed = self.client.get(f"/api/viewer-references/{digest}?paper_sha256={digest}").json()
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(self.live_jobs(), [])

    def test_a_stale_pending_paper_is_queued_again_when_asked_for(self):
        with patch.object(grobid, "configured", return_value=True):
            digest = self.save_paper()
            with self.Session() as db:
                # The job vanished (a database restored around it, say) and
                # the paper has said pending for longer than a pass takes.
                db.query(Job).delete()
                paper = db.get(Paper, digest)
                paper.references_at = datetime.utcnow() - analysis.ANALYSIS_STALE - timedelta(minutes=1)
                db.commit()
            self.client.get(f"/api/viewer-references/{digest}?paper_sha256={digest}")
        self.assertEqual(len(self.live_jobs(analysis.KIND)), 1)

    def test_without_an_analyzer_nothing_is_queued(self):
        with patch.object(grobid, "configured", return_value=False):
            digest = self.save_paper()
            asked = self.client.get(f"/api/viewer-references/{digest}?paper_sha256={digest}").json()
        self.assertEqual(asked["status"], "unavailable")
        self.assertEqual(self.live_jobs(), [])

    # ------------------------------------------------------- the capture

    def test_a_webpage_card_is_on_the_board_before_its_picture_is(self):
        board = self.board()
        with patch.object(capture, "public_web_url", side_effect=lambda url: url.strip()):
            response = self.client.post(f"/api/boards/{board}/webpage", json={
                "url": "https://example.test/article", "x": 10, "y": 20,
            })
        self.assertEqual(response.status_code, 202, response.text)
        queued = response.json()
        item = queued["item"]
        self.assertEqual((item["kind"], item["content"], item["file_path"]), ("webpage", "example.test", None))
        self.assertEqual(self.poll(queued["job"])["status"], "queued")

        with patch.object(capture, "capture_webpage", return_value=b"a png"):
            self.drain()
        self.assertEqual(self.poll(queued["job"])["status"], "done")
        with self.Session() as db:
            card = db.get(BoardItem, item["uuid"])
            self.assertEqual(card.sha256, hashlib.sha256(b"a png").hexdigest())
            self.assertEqual(storage.board_files.get(card.file_path), b"a png")
            self.assertEqual(card.mime_type, "image/png")

    def test_a_capture_that_fails_leaves_the_link_and_says_why(self):
        board = self.board()
        with patch.object(capture, "public_web_url", side_effect=lambda url: url.strip()):
            queued = self.client.post(f"/api/boards/{board}/webpage", json={
                "url": "https://example.test/", "x": 0, "y": 0,
            }).json()
        with patch.object(capture, "capture_webpage", side_effect=ValueError("The website could not be rendered")):
            self.drain()
        failed = self.poll(queued["job"])
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(failed["detail"], "Could not capture the webpage: The website could not be rendered")
        with self.Session() as db:
            card = db.get(BoardItem, queued["item"]["uuid"])
            self.assertIsNone(card.file_path)
            self.assertEqual(card.source_url, "https://example.test/")

    def test_a_bad_link_is_refused_now_not_by_the_worker(self):
        board = self.board()
        response = self.client.post(f"/api/boards/{board}/webpage", json={
            "url": "ftp://example.test/", "x": 0, "y": 0,
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.post(f"/api/boards/{board}/youtube", json={
            "url": "https://example.test/watch", "x": 0, "y": 0,
        }).status_code, 422)
        self.assertEqual(self.live_jobs(), [])

    def test_a_video_card_gets_its_thumbnail_and_title_from_the_worker(self):
        board = self.board()
        queued = self.client.post(f"/api/boards/{board}/youtube", json={
            "url": "https://youtu.be/dQw4w9WgXcQ", "x": 0, "y": 0,
        }).json()
        self.assertEqual(queued["item"]["kind"], "youtube")
        with patch.object(capture, "fetch_youtube_thumbnail", return_value=(b"jpg", "Never Gonna")):
            self.drain()
        self.assertEqual(self.poll(queued["job"])["status"], "done")
        with self.Session() as db:
            card = db.get(BoardItem, queued["item"]["uuid"])
            self.assertEqual((card.content, card.mime_type), ("Never Gonna", "image/jpeg"))
            self.assertEqual(storage.board_files.get(card.file_path), b"jpg")

    # ---------------------------------------------------------- the mail

    def test_feedback_is_mailed_by_one_job_per_admin(self):
        response = self.client.post("/api/feedback", json={"content": "The cow is upside down"})
        self.assertEqual(response.status_code, 200, response.text)
        queued = self.live_jobs(notifications.SEND_EMAIL)
        self.assertEqual([jobs.payload_of(j)["to"] for j in queued], ["admin@example.test"])
        self.assertEqual(jobs.payload_of(queued[0])["subject"], "Papol feedback: The cow is upside down")

        sent = []
        with patch.dict(os.environ, {"SMTP_HOST": "mail.example.test"}), \
                patch.object(notifications, "send_email", side_effect=lambda cfg, to, subject, body: sent.append(to)):
            self.drain()
        self.assertEqual(sent, ["admin@example.test"])
        with self.Session() as db:
            notification = db.query(Notification).filter(Notification.user_uuid == self.admin_uuid).one()
            self.assertTrue(notification.emailed)

    def test_mail_that_cannot_be_sent_leaves_the_notification_for_the_digest(self):
        self.client.post("/api/feedback", json={"content": "Still upside down"})
        with patch.dict(os.environ, {"SMTP_HOST": "mail.example.test"}), \
                patch.object(notifications, "send_email", side_effect=OSError("connection refused")):
            self.drain()
        with self.Session() as db:
            job = db.query(Job).filter(Job.kind == notifications.SEND_EMAIL).one()
            self.assertEqual(job.status, "failed")
            self.assertIn("connection refused", job.error)
            self.assertFalse(db.query(Notification).one().emailed)

    def test_without_smtp_the_mail_is_skipped_not_failed(self):
        self.client.post("/api/feedback", json={"content": "Hello"})
        with patch.dict(os.environ, {"SMTP_HOST": ""}):
            self.drain()
        with self.Session() as db:
            job = db.query(Job).filter(Job.kind == notifications.SEND_EMAIL).one()
            self.assertEqual(job.status, "done")
            self.assertEqual(jobs.result_of(job)["skipped"], "SMTP not configured")

    def test_the_digest_queues_the_days_mail_and_itself_for_tomorrow(self):
        with self.Session() as db:
            db.add(Notification(user_uuid=self.user_uuid, content="A seminar was called"))
            db.commit()
            first = notifications.schedule_daily_digest(db)
            self.assertIsNotNone(first)
            self.assertIsNone(notifications.schedule_daily_digest(db))  # one at a time
            digest = db.get(Job, first)
            self.assertGreater(digest.run_at, datetime.utcnow())
            digest.run_at = datetime.utcnow() - timedelta(seconds=1)  # its hour comes
            db.commit()

        sent = []
        with patch.dict(os.environ, {"SMTP_HOST": "mail.example.test"}), \
                patch.object(notifications, "send_email", side_effect=lambda cfg, to, subject, body: sent.append((to, subject))):
            self.assertEqual(self.drain(), 2)  # the digest, then the one email it queued
        self.assertEqual(sent, [("reader@example.test", "Papol: 1 new message today")])
        with self.Session() as db:
            self.assertTrue(db.query(Notification).one().emailed)
            self.assertEqual(db.get(Job, first).status, "done")
            tomorrow = db.query(Job).filter(Job.kind == notifications.DAILY_DIGEST, Job.status == "queued").one()
            self.assertGreater(tomorrow.run_at, datetime.utcnow())
            self.assertLess(tomorrow.run_at, datetime.utcnow() + timedelta(days=1, minutes=1))

    def test_the_digest_hour_is_read_off_the_hosts_clock(self):
        noon = datetime(2026, 9, 21, 12, 0)  # local time
        def utc(local):
            return local.astimezone(timezone.utc).replace(tzinfo=None)
        self.assertEqual(notifications.next_digest_at(21, now=noon), utc(noon.replace(hour=21)))
        # An hour already past today is tomorrow's.
        self.assertEqual(notifications.next_digest_at(9, now=noon), utc(noon.replace(hour=9) + timedelta(days=1)))


if __name__ == "__main__":
    unittest.main()
