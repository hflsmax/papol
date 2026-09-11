"""Backend contract exercised by the macOS offline replay queue.

Run in the repository's development environment with:
    cd backend && python -m unittest test_desktop_sync.py
"""

import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from database import Base, get_db


class DesktopSyncContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.sessions = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)

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


if __name__ == "__main__":
    unittest.main()
