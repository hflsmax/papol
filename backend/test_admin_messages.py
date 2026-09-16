import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from auth import get_current_user
from database import Base, get_db
from models import User


class AdminMessageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.Session = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(cls.engine)

        with cls.Session() as db:
            cls.admin = User(
                email="admin@example.com",
                display_name="Admin",
                password_hash="unused",
                is_admin=True,
            )
            cls.user = User(
                email="user@example.com",
                display_name="User",
                password_hash="unused",
            )
            db.add_all([cls.admin, cls.user])
            db.commit()
            db.refresh(cls.admin)
            db.refresh(cls.user)
            cls.admin_uuid = cls.admin.uuid
            cls.user_uuid = cls.user.uuid

        cls.current_user_uuid = cls.admin_uuid

        def test_db():
            with cls.Session() as db:
                yield db

        def test_user():
            with cls.Session() as db:
                return db.query(User).filter(User.uuid == cls.current_user_uuid).one()

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = test_user
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        main.app.dependency_overrides.pop(get_db, None)
        main.app.dependency_overrides.pop(get_current_user, None)
        cls.engine.dispose()

    def test_admin_broadcast_is_delivered_once_to_current_users(self):
        type(self).current_user_uuid = self.user_uuid
        forbidden = self.client.post("/api/admin/messages", json={"content": "Nope"})
        self.assertEqual(forbidden.status_code, 403)

        type(self).current_user_uuid = self.admin_uuid
        sent = self.client.post(
            "/api/admin/messages",
            json={"content": "  Papol will be read-only tonight.  "},
        )
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(sent.json()["content"], "Papol will be read-only tonight.")
        self.assertEqual(sent.json()["recipient_count"], 2)
        message_uuid = sent.json()["uuid"]

        type(self).current_user_uuid = self.user_uuid
        pending = self.client.get("/api/admin-messages/pending")
        self.assertEqual([message["uuid"] for message in pending.json()], [message_uuid])

        dismissed = self.client.post(f"/api/admin-messages/{message_uuid}/dismiss")
        self.assertEqual(dismissed.status_code, 200)
        self.assertEqual(self.client.get("/api/admin-messages/pending").json(), [])
        # Dismissal is idempotent, so retries cannot make the message return.
        self.assertEqual(
            self.client.post(f"/api/admin-messages/{message_uuid}/dismiss").status_code,
            200,
        )

        with self.Session() as db:
            late_user = User(
                email="late@example.com",
                display_name="Late user",
                password_hash="unused",
            )
            db.add(late_user)
            db.commit()
            db.refresh(late_user)
            type(self).current_user_uuid = late_user.uuid

        self.assertEqual(self.client.get("/api/admin-messages/pending").json(), [])
        self.assertEqual(
            self.client.post(f"/api/admin-messages/{message_uuid}/dismiss").status_code,
            404,
        )

        type(self).current_user_uuid = self.admin_uuid
        recipients = self.client.get("/api/admin/message-recipients")
        self.assertEqual(recipients.status_code, 200)
        self.assertEqual(
            {user["email"] for user in recipients.json()},
            {"admin@example.com", "user@example.com", "late@example.com"},
        )
        invalid = self.client.post(
            "/api/admin/messages",
            json={"content": "Targeted", "user_uuids": ["not-a-user"]},
        )
        self.assertEqual(invalid.status_code, 400)

        targeted = self.client.post(
            "/api/admin/messages",
            json={"content": "For one user", "user_uuids": [self.user_uuid]},
        )
        self.assertEqual(targeted.status_code, 200)
        self.assertEqual(targeted.json()["recipient_count"], 1)

        type(self).current_user_uuid = self.user_uuid
        self.assertEqual(
            [message["content"] for message in self.client.get("/api/admin-messages/pending").json()],
            ["For one user"],
        )
        type(self).current_user_uuid = late_user.uuid
        self.assertEqual(self.client.get("/api/admin-messages/pending").json(), [])


if __name__ == "__main__":
    unittest.main()
