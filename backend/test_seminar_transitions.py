"""Seminar lifecycle contract shared by the web and macOS clients."""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, PapolSession, get_db
from models import Copy, Paper, Room, Shelf


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
        called = self.request("POST", f"/api/papers/{self.paper_sha256}/room")
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

        paper = self.request("GET", f"/api/papers/{self.paper_sha256}")
        self.assertEqual(paper["rooms"][0]["status"], "finished")

    def test_host_can_return_planning_seminar_to_called_state(self):
        called = self.request("POST", f"/api/papers/{self.paper_sha256}/room")
        self.request("POST", f"/api/rooms/{called['uuid']}/lead")

        reopened = self.request("POST", f"/api/rooms/{called['uuid']}/unhost")
        self.assertEqual(reopened["status"], "open")
        self.assertIsNone(reopened["leader"])

        premature = self.client.post(
            f"/api/rooms/{called['uuid']}/finish", headers=self.headers
        )
        self.assertEqual(premature.status_code, 403)

    def test_caller_can_uncall_when_alone(self):
        called = self.request("POST", f"/api/papers/{self.paper_sha256}/room")

        removed = self.request("POST", f"/api/rooms/{called['uuid']}/uncall")
        self.assertEqual(removed["message"], "Seminar uncalled")

        missing = self.client.get(f"/api/rooms/{called['uuid']}", headers=self.headers)
        self.assertEqual(missing.status_code, 404)
        with self.sessions() as db:
            self.assertIsNone(db.query(Room).filter(Room.uuid == called["uuid"]).first())

    def test_caller_can_uncall_an_empty_cohort(self):
        called = self.request("POST", f"/api/papers/{self.paper_sha256}/room")
        self.request("POST", f"/api/rooms/{called['uuid']}/leave")

        removed = self.request("POST", f"/api/rooms/{called['uuid']}/uncall")
        self.assertEqual(removed["message"], "Seminar uncalled")

    def test_caller_cannot_uncall_after_someone_else_joins(self):
        called = self.request("POST", f"/api/papers/{self.paper_sha256}/room")
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


if __name__ == "__main__":
    unittest.main()
