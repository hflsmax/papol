"""The one number a client is held to: the schema it was built for.

Run in the repository's development environment with:
    cd backend && python -m unittest test_client_gate.py
"""

import unittest
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from auth import get_current_user
from database import Base, get_db
from models import SyncClient, User
from services.client_requirements import SCHEMA_HEADER
from sync.registry import schema_version

CURRENT = str(schema_version())
OLDER = str(schema_version() - 1)


class SyncGateTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)

        with self.Session() as db:
            user = User(
                uuid=str(uuid.uuid4()), email="user@example.com",
                display_name="User", password_hash="x",
            )
            db.add(user)
            db.commit()
            self.user_uuid = user.uuid

        def test_db():
            with self.Session() as db:
                yield db

        def test_user():
            with self.Session() as db:
                return db.query(User).filter(User.uuid == self.user_uuid).one()

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = test_user
        self.addCleanup(main.app.dependency_overrides.pop, get_db, None)
        self.addCleanup(main.app.dependency_overrides.pop, get_current_user, None)
        self.client = TestClient(main.app)

    def pull(self, headers, client_uuid=None):
        params = {"cursor": 0}
        if client_uuid:
            params["client_uuid"] = client_uuid
        return self.client.get("/api/sync/pull", params=params, headers=headers)

    def test_a_build_for_another_schema_is_refused_with_426(self):
        refused = self.pull({SCHEMA_HEADER: OLDER})
        self.assertEqual(refused.status_code, 426, refused.text)
        detail = refused.json()["detail"]
        self.assertEqual(detail["error"], "client_incompatible")
        self.assertEqual(detail["schema_version"], schema_version())
        # Somewhere to go, not just a refusal.
        self.assertTrue(detail["download_url"])

    def test_a_build_for_this_schema_pulls_normally(self):
        self.assertEqual(self.pull({SCHEMA_HEADER: CURRENT}).status_code, 200)

    def test_a_number_nobody_can_read_is_refused(self):
        self.assertEqual(self.pull({SCHEMA_HEADER: "nightly"}).status_code, 426)

    def test_a_caller_that_names_no_schema_is_not_gated(self):
        # The website ships with this server and cannot be out of step with
        # it; curl is nobody's business to refuse.
        self.assertEqual(self.pull({"User-Agent": "curl/8.4.0"}).status_code, 200)

    def test_a_papol_build_from_before_the_header_is_refused(self):
        # 0.2.0 sends no schema header because none existed when it was
        # compiled — which is exactly what dates it. Naming itself Papol
        # is enough to be held to the gate.
        refused = self.pull({"User-Agent": "Papol macOS/0.2.0"})
        self.assertEqual(refused.status_code, 426, refused.text)
        self.assertEqual(refused.json()["detail"]["error"], "client_incompatible")

    def test_the_verdict_names_a_pre_header_build_incompatible(self):
        main.app.dependency_overrides.pop(get_current_user, None)
        asked = self.client.get(
            "/api/client-requirements", headers={"User-Agent": "Papol macOS/0.2.0"},
        ).json()
        self.assertEqual(asked["verdict"], "incompatible")

    def test_the_snapshot_and_the_push_are_refused_too(self):
        refused = self.client.get("/api/sync/snapshot", headers={SCHEMA_HEADER: OLDER})
        self.assertEqual(refused.status_code, 426, refused.text)
        # A push the server would otherwise have accepted: the refusal has
        # to be about the build, not about anything wrong with the work.
        refused = self.client.post(
            "/api/sync/push",
            json={
                "client_uuid": str(uuid.uuid4()),
                "mutation_uuid": str(uuid.uuid4()),
                "local_sequence": 1,
                "changes": [{
                    "table": "shelves",
                    "uuid": str(uuid.uuid4()),
                    "operation": "upsert",
                    "values": {"name": "Reading", "color": "#b3923d"},
                }],
            },
            headers={SCHEMA_HEADER: OLDER},
        )
        self.assertEqual(refused.status_code, 426, refused.text)

    def test_the_requirements_endpoint_gives_the_verdict_unauthenticated(self):
        main.app.dependency_overrides.pop(get_current_user, None)
        asked = self.client.get("/api/client-requirements", headers={SCHEMA_HEADER: OLDER}).json()
        self.assertEqual(asked["verdict"], "incompatible")
        self.assertEqual(asked["schema_version"], schema_version())
        asked = self.client.get("/api/client-requirements", headers={SCHEMA_HEADER: CURRENT}).json()
        self.assertEqual(asked["verdict"], "supported")

    def test_pulling_records_the_version_this_installation_runs(self):
        client_uuid = str(uuid.uuid4())
        headers = {SCHEMA_HEADER: CURRENT, "User-Agent": "Papol macOS/0.3.1"}
        self.assertEqual(self.pull(headers, client_uuid).status_code, 200)
        self.assertEqual(self.pull({"User-Agent": "curl/8.4.0"}, client_uuid).status_code, 200)
        with self.Session() as db:
            row = db.query(SyncClient).filter(SyncClient.client_uuid == client_uuid).one()
            # The last build that announced one; a caller naming none leaves it.
            self.assertEqual(row.app_version, "0.3.1")


if __name__ == "__main__":
    unittest.main()
