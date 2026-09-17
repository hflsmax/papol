"""Where each sign-in came from, kept on the session it created.

Run in the repository's development environment with:
    cd backend && python -m unittest test_session_platform.py
"""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from auth import MACOS, PLATFORM_HEADER, WEB, hash_password
from database import Base, get_db
from models import AuthToken, User


class SigningInRecordsThePlatform(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)

        with self.Session() as db:
            db.add(User(
                email="reader@example.com", display_name="Reader",
                password_hash=hash_password("open sesame"),
            ))
            db.commit()

        def test_db():
            with self.Session() as db:
                yield db

        main.app.dependency_overrides[get_db] = test_db
        self.addCleanup(main.app.dependency_overrides.pop, get_db, None)
        self.client = TestClient(main.app)

    def sign_in(self, headers=None):
        answer = self.client.post(
            "/api/auth/login",
            json={"email": "reader@example.com", "password": "open sesame"},
            headers=headers or {},
        )
        self.assertEqual(answer.status_code, 200, answer.text)
        return answer.json()["token"]

    def platform_of(self, token):
        with self.Session() as db:
            return db.query(AuthToken).filter(AuthToken.token == token).one().platform

    def test_the_installed_application_signs_in_as_macos(self):
        token = self.sign_in({PLATFORM_HEADER: "macos"})
        self.assertEqual(self.platform_of(token), MACOS)

    def test_the_browser_signs_in_as_web(self):
        token = self.sign_in({PLATFORM_HEADER: "web"})
        self.assertEqual(self.platform_of(token), WEB)

    def test_a_caller_that_says_nothing_is_the_web(self):
        self.assertEqual(self.platform_of(self.sign_in()), WEB)

    def test_an_unknown_announcement_is_not_taken_as_a_platform(self):
        token = self.sign_in({PLATFORM_HEADER: "toaster"})
        self.assertEqual(self.platform_of(token), WEB)

    def test_the_application_is_recognised_by_its_agent_alone(self):
        # An older build sends no platform header; it still announces itself
        # in the User-Agent, and that is enough to know which Papol it is.
        token = self.sign_in({"User-Agent": "Papol macOS/0.2.0"})
        self.assertEqual(self.platform_of(token), MACOS)

    def test_registering_records_the_platform_too(self):
        answer = self.client.post(
            "/api/auth/register",
            json={
                "email": "new@example.com", "display_name": "New",
                "affiliation": None, "password": "open sesame",
            },
            headers={PLATFORM_HEADER: "macos"},
        )
        self.assertEqual(answer.status_code, 200, answer.text)
        self.assertEqual(self.platform_of(answer.json()["token"]), MACOS)

    def test_each_session_keeps_the_platform_it_was_made_on(self):
        desktop = self.sign_in({PLATFORM_HEADER: "macos"})
        web = self.sign_in({PLATFORM_HEADER: "web"})
        self.assertNotEqual(desktop, web)
        self.assertEqual(self.platform_of(desktop), MACOS)
        self.assertEqual(self.platform_of(web), WEB)


if __name__ == "__main__":
    unittest.main()
