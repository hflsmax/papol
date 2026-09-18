"""Seminar lifecycle contract shared by the web and macOS clients."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, PapolSession, get_db
from models import Copy, Paper, Room, Shelf
from services.papers import paper_name


class SeminarTransitionTests(unittest.TestCase):
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
            db = cls.sessions()
            try:
                yield db
            finally:
                db.close()

        main.app.dependency_overrides[get_db] = test_db
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        main.app.dependency_overrides.pop(get_db, None)
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        response = self.client.post("/api/auth/register", json={
            "email": "seminar@example.test",
            "display_name": "Seminar Host",
            "affiliation": None,
            "password": "testing-password",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.user_uuid = response.json()["user"]["uuid"]
        self.headers = {"Authorization": f"Bearer {response.json()['token']}"}

        with self.sessions() as db:
            shelf = Shelf(
                user_uuid=self.user_uuid,
                name="Displayed",
                color="#123456",
                is_public=True,
            )
            paper = Paper(
                title="State Machines for Seminars",
                file_path="seminar.pdf", sha256="5" * 64,
            )
            db.add_all([shelf, paper])
            db.flush()
            db.add(Copy(paper=paper, shelf=shelf, user_uuid=self.user_uuid))
            db.commit()
            self.paper_sha256 = paper.sha256

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, headers=self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        return response.json()

    def test_complete_seminar_state_transition(self):
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        self.assertEqual(called["status"], "open")
        self.assertEqual(called["participant_count"], 1)

        planning = self.request("POST", f"/api/rooms/{called['uuid']}/lead")
        self.assertEqual(planning["status"], "planning")
        self.assertEqual(planning["leader"]["uuid"], self.user_uuid)

        scheduled = self.request(
            "PUT",
            f"/api/rooms/{called['uuid']}/announce",
            json={
                "scheduled_time": "Friday at 16:00",
                "platform": "Seminar room 2.13",
                "style": "discussion",
                "style_desc": None,
            },
        )
        self.assertEqual(scheduled["status"], "scheduled")
        self.assertEqual(scheduled["scheduled_time"], "Friday at 16:00")

        finished = self.request("POST", f"/api/rooms/{called['uuid']}/finish")
        self.assertEqual(finished["status"], "finished")

        paper = self.request("GET", f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual(paper["rooms"][0]["status"], "finished")

    def test_host_can_return_planning_seminar_to_called_state(self):
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        self.request("POST", f"/api/rooms/{called['uuid']}/lead")

        reopened = self.request("POST", f"/api/rooms/{called['uuid']}/unhost")
        self.assertEqual(reopened["status"], "open")
        self.assertIsNone(reopened["leader"])

        premature = self.client.post(
            f"/api/rooms/{called['uuid']}/finish", headers=self.headers
        )
        self.assertEqual(premature.status_code, 403)

    def test_caller_can_uncall_when_alone(self):
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")

        removed = self.request("POST", f"/api/rooms/{called['uuid']}/uncall")
        self.assertEqual(removed["message"], "Seminar uncalled")

        missing = self.client.get(f"/api/rooms/{called['uuid']}", headers=self.headers)
        self.assertEqual(missing.status_code, 404)
        with self.sessions() as db:
            self.assertIsNone(db.query(Room).filter(Room.uuid == called["uuid"]).first())

    def test_caller_can_uncall_an_empty_cohort(self):
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        self.request("POST", f"/api/rooms/{called['uuid']}/leave")

        removed = self.request("POST", f"/api/rooms/{called['uuid']}/uncall")
        self.assertEqual(removed["message"], "Seminar uncalled")

    def test_caller_cannot_uncall_after_someone_else_joins(self):
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        response = self.client.post("/api/auth/register", json={
            "email": "user@example.test",
            "display_name": "Another User",
            "affiliation": None,
            "password": "testing-password",
        })
        self.assertEqual(response.status_code, 200, response.text)
        user_uuid = response.json()["user"]["uuid"]
        user_headers = {"Authorization": f"Bearer {response.json()['token']}"}
        with self.sessions() as db:
            paper = db.query(Paper).filter(Paper.sha256 == self.paper_sha256).one()
            shelf = Shelf(
                user_uuid=user_uuid,
                name="Displayed",
                color="#654321",
                is_public=True,
            )
            db.add(shelf)
            db.flush()
            db.add(Copy(paper=paper, shelf=shelf, user_uuid=user_uuid))
            db.commit()

        joined = self.client.post(
            f"/api/rooms/{called['uuid']}/join", headers=user_headers
        )
        self.assertEqual(joined.status_code, 200, joined.text)
        refused = self.client.post(
            f"/api/rooms/{called['uuid']}/uncall", headers=self.headers
        )
        self.assertEqual(refused.status_code, 400)
        self.assertIn("no one else", refused.json()["detail"])

    # --- a seminar names its paper, and that name does not move ----------

    def test_correcting_a_paper_leaves_its_seminar_exactly_where_it_is(self):
        """Any user may fix a paper's metadata, for everyone.

        A seminar used to be filed under a key made out of that metadata, so
        a correction moved the paper out from under its own seminars: the
        paper's page stopped listing them, the cohort came out empty so
        nobody could be handed the hosting, and the paper could be called to
        a second seminar while the first was still open. It names the
        paper's digest now, which is not a thing anyone can edit."""
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")

        self.request("PUT", f"/api/papers/{paper_name(self.paper_sha256)}", json={
            "title": "State Machines for Seminars (Corrected)",
            "doi": "10.1234/corrected",
        })

        page = self.request("GET", f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual([room["uuid"] for room in page["rooms"]], [called["uuid"]])
        detail = self.request("GET", f"/api/rooms/{called['uuid']}")
        self.assertEqual(detail["paper_sha256"], self.paper_sha256)
        self.assertTrue(detail["viewer_has_copy"])
        # The seminar is named after the paper, and reads back the paper's
        # title rather than a copy of it taken when it was called.
        self.assertEqual(detail["paper_title"], "State Machines for Seminars (Corrected)")

        again = self.client.post(
            f"/api/papers/{paper_name(self.paper_sha256)}/room", headers=self.headers,
        )
        self.assertEqual(again.status_code, 400, again.text)
        self.assertIn("already being organized", again.json()["detail"])

    def test_two_papers_printing_one_title_have_a_seminar_each(self):
        """A paper is its PDF, so a preprint and what it became are two.

        They were one seminar while a seminar was keyed by title: calling
        one answered for both, and neither could be called again. Two
        papers, two conversations."""
        with self.sessions() as db:
            shelf = db.query(Shelf).filter(Shelf.user_uuid == self.user_uuid).first()
            twin = Paper(
                title="State Machines for Seminars",
                file_path="preprint.pdf", sha256="6" * 64,
            )
            db.add(twin)
            db.flush()
            db.add(Copy(paper=twin, shelf=shelf, user_uuid=self.user_uuid))
            db.commit()
            twin_sha256 = twin.sha256

        published = self.request(
            "POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        preprint = self.request("POST", f"/api/papers/{paper_name(twin_sha256)}/room")
        self.assertNotEqual(published["uuid"], preprint["uuid"])

        self.assertEqual(
            [room["uuid"] for room
             in self.request("GET", f"/api/papers/{paper_name(self.paper_sha256)}")["rooms"]],
            [published["uuid"]],
        )
        self.assertEqual(
            [room["uuid"] for room
             in self.request("GET", f"/api/papers/{paper_name(twin_sha256)}")["rooms"]],
            [preprint["uuid"]],
        )

    def test_a_seminar_names_its_paper_by_the_papers_own_name(self):
        with self.sessions() as db:
            room = db.query(Room).one_or_none()
            self.assertIsNone(room)
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        with self.sessions() as db:
            room = db.query(Room).filter(Room.uuid == called["uuid"]).one()
            self.assertEqual(room.paper_sha256, self.paper_sha256)
            self.assertEqual(room.paper.sha256, room.paper_sha256)

    def test_a_cohort_reads_a_hidden_copy_by_the_paper_s_own_name(self):
        """A viewer in the cohort who does not display the paper.

        The room used to answer with the paper's `.uuid`, from when a paper
        had one beside its digest, so this was a 500."""
        called = self.request("POST", f"/api/papers/{paper_name(self.paper_sha256)}/room")
        with self.sessions() as db:
            private = Shelf(
                user_uuid=self.user_uuid, name="Private", color="#222222",
                is_public=False,
            )
            db.add(private)
            db.flush()
            copy = db.query(Copy).filter(Copy.user_uuid == self.user_uuid).one()
            copy.shelf = private
            db.commit()

        detail = self.request("GET", f"/api/rooms/{called['uuid']}")
        self.assertEqual(detail["viewer_hidden_entry_sha256"], self.paper_sha256)


if __name__ == "__main__":
    unittest.main()
