"""What a removed row still counts for, which is nothing.

Removing something in Papol stamps `deleted_at` rather than deleting the
row: every replica has to hear that it went, and a row that is simply not
there any more says nothing to anybody. The cost is that the row is still
in the table, and a relationship hands it back with the rest.

Every path that asks the database filters them. The paths that walk a
loaded row's relationships — counts, mostly, and two guards — did not, so a
shelf said it held papers the user had taken out, a nook listed tags its
owner had deleted, and the Library counted papers nobody keeps any more.
"""

import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from sync.registry import registry
from database import Base, PapolSession, get_db
from models import Copy, Paper, Shelf
from services.papers import paper_name


class RemovedRowsAreNotCountedTests(unittest.TestCase):
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
            "email": "keeper@example.test",
            "display_name": "Keeper",
            "affiliation": None,
            "password": "testing-password",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.user_uuid = response.json()["user"]["uuid"]
        self.headers = {"Authorization": f"Bearer {response.json()['token']}"}

        # Registration makes the nook's own shelves; the papers go on the
        # displayed one, which is where an added paper lands anyway.
        with self.sessions() as db:
            shelf = db.query(Shelf).filter(
                Shelf.user_uuid == self.user_uuid, Shelf.is_default.is_(True),
            ).one()
            kept = Paper(title="Kept", file_path="kept.pdf", sha256="a" * 64)
            dropped = Paper(title="Dropped", file_path="dropped.pdf", sha256="b" * 64)
            db.add_all([kept, dropped])
            db.flush()
            db.add_all([
                Copy(paper=kept, shelf=shelf, user_uuid=self.user_uuid),
                Copy(paper=dropped, shelf=shelf, user_uuid=self.user_uuid),
            ])
            db.commit()
            self.shelf_uuid = shelf.uuid
            self.dropped_sha256 = dropped.sha256

    def request(self, method, path, **kwargs):
        response = self.client.request(method, path, headers=self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        return None if response.status_code == 204 else response.json()

    def shelf(self) -> dict:
        listed = self.request("GET", "/api/shelves")
        return next(row for row in listed if row["uuid"] == self.shelf_uuid)

    def test_a_shelf_stops_counting_a_paper_taken_out_of_the_nook(self):
        self.assertEqual(self.shelf()["paper_count"], 2)
        self.request("DELETE", f"/api/papers/{paper_name(self.dropped_sha256)}")
        self.assertEqual(self.shelf()["paper_count"], 1)

        nook = self.request("GET", f"/api/users/{self.user_uuid}/nook")
        self.assertEqual(len(nook["papers"]), 1)
        self.assertEqual(nook["shelves"][0]["paper_count"], 1)

    def test_a_shelf_stops_counting_a_deleted_board(self):
        board = self.request("POST", "/api/boards", json={"name": "Thinking"})
        self.assertEqual(self.shelf()["board_count"], 1)
        self.request("DELETE", f"/api/boards/{board['uuid']}")
        self.assertEqual(self.shelf()["board_count"], 0)

    def test_a_nook_stops_listing_a_deleted_tag(self):
        tag = self.request("POST", "/api/tags", json={"name": "to-read"})
        nook = self.request("GET", f"/api/users/{self.user_uuid}/nook")
        self.assertIn("to-read", [row["name"] for row in nook["tags"]])

        self.request("DELETE", f"/api/tags/{tag['uuid']}")
        nook = self.request("GET", f"/api/users/{self.user_uuid}/nook")
        self.assertNotIn("to-read", [row["name"] for row in nook["tags"]])
        # And it agrees with the list the tag picker is filled from.
        self.assertEqual(
            [row["name"] for row in nook["tags"]],
            [row["name"] for row in self.request("GET", "/api/tags")],
        )

    def test_a_shelf_holding_a_board_cannot_be_deleted_from_a_replica(self):
        """A shelf's contents are its boards as well as its papers.

        Only the papers were counted, so a replica could delete a shelf out
        from under its boards, which then named a shelf that was not there.
        The website moves both onto another shelf; here the answer is the
        message's own."""
        shelf = self.request("POST", "/api/shelves", json={
            "name": "Ideas", "color": "#445566", "is_public": False,
        })
        board = self.request("POST", "/api/boards", json={
            "name": "Thinking", "shelf_uuid": shelf["uuid"],
        })
        refused = self.client.post(
            "/api/sync/push", headers=self.headers, json={
                "protocol_version": registry()["protocol_version"],
                "client_uuid": str(uuid.uuid4()),
                "mutation_uuid": str(uuid.uuid4()),
                "local_sequence": 1,
                "changes": [{
                    "table": "shelves", "uuid": shelf["uuid"],
                    "operation": "delete", "values": {},
                }],
            },
        )
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertIn("Move shelf contents", refused.json()["detail"])

        # Moved off it, the shelf goes.
        self.request("PUT", f"/api/boards/{board['uuid']}", json={
            "shelf_uuid": self.shelf_uuid,
        })
        self.request("DELETE", f"/api/shelves/{shelf['uuid']}")
        self.assertNotIn(
            shelf["uuid"],
            [row["uuid"] for row in self.request("GET", "/api/shelves")],
        )

    def test_the_library_stops_counting_a_paper_nobody_keeps(self):
        listed = self.request("GET", "/api/users")
        self.assertEqual(
            [row["paper_count"] for row in listed if row["uuid"] == self.user_uuid],
            [2],
        )
        self.request("DELETE", f"/api/papers/{paper_name(self.dropped_sha256)}")
        listed = self.request("GET", "/api/users")
        self.assertEqual(
            [row["paper_count"] for row in listed if row["uuid"] == self.user_uuid],
            [1],
        )


if __name__ == "__main__":
    unittest.main()
