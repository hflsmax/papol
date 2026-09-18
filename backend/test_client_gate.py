"""The floor under the installed clients this server will talk to.

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
from models import Setting, SyncClient, User
from services.client_requirements import (
    DEPRECATED, INCOMPATIBLE, PROTOCOL_MINIMUM_VERSION, SUPPORTED,
    client_version, minimum_version, parse_version, verdict,
)

AGENT = "Papol macOS/{}".format


class VersionReadingTests(unittest.TestCase):
    def test_a_dotted_release_reads_as_numbers(self):
        self.assertEqual(parse_version("1.2.3"), (1, 2, 3))

    def test_anything_that_is_not_one_reads_as_nothing(self):
        for text in [None, "", "1.2", "1.2.3.4", "1.2.x", "next", "-1.0.0"]:
            self.assertIsNone(parse_version(text), text)

    def test_the_version_is_taken_from_the_agent_papol_sends(self):
        self.assertEqual(client_version("Papol macOS/0.1.2"), "0.1.2")

    def test_another_caller_announces_no_version(self):
        for agent in [None, "", "curl/8.4.0", "Mozilla/5.0", "Papol/0.1.2"]:
            self.assertIsNone(client_version(agent), agent)


class VerdictTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.addCleanup(self.engine.dispose)

    def floor(self, minimum=None, recommended=None):
        with self.Session() as db:
            if minimum is not None:
                db.add(Setting(key="desktop_minimum_version", value=minimum))
            if recommended is not None:
                db.add(Setting(key="desktop_recommended_version", value=recommended))
            db.commit()

    def verdict_for(self, agent):
        with self.Session() as db:
            return verdict(db, agent)

    def test_a_build_below_the_floor_is_incompatible(self):
        self.floor(minimum="0.3.0")
        self.assertEqual(self.verdict_for(AGENT("0.1.9")), INCOMPATIBLE)

    def test_the_floor_itself_is_supported(self):
        self.floor(minimum="0.3.0")
        self.assertEqual(self.verdict_for(AGENT("0.3.0")), SUPPORTED)

    def test_below_the_recommended_version_is_only_deprecated(self):
        self.floor(minimum="0.2.0", recommended="0.4.0")
        self.assertEqual(self.verdict_for(AGENT("0.3.0")), DEPRECATED)

    def test_the_wire_has_a_floor_of_its_own(self):
        """Nobody has to remember to set one. A build that cannot be talked
        to is refused because of what it is, not because of a setting."""
        self.assertEqual(self.verdict_for(AGENT("0.0.1")), INCOMPATIBLE)
        with self.Session() as db:
            self.assertEqual(minimum_version(db), PROTOCOL_MINIMUM_VERSION)

    def test_the_floor_cannot_be_set_lower_than_the_wire(self):
        """A setting is a way to ask for something newer. It is not a way to
        let in a build this server has nothing to say to."""
        self.floor(minimum="0.0.1")
        with self.Session() as db:
            self.assertEqual(minimum_version(db), PROTOCOL_MINIMUM_VERSION)
        self.assertEqual(self.verdict_for(AGENT("0.1.9")), INCOMPATIBLE)

    def test_the_floor_can_be_set_higher(self):
        self.floor(minimum="9.9.9")
        with self.Session() as db:
            self.assertEqual(minimum_version(db), "9.9.9")
        self.assertEqual(self.verdict_for(AGENT(PROTOCOL_MINIMUM_VERSION)), INCOMPATIBLE)

    def test_a_caller_that_is_not_papol_is_never_gated(self):
        # The web app ships with this server and cannot be out of step with
        # it, so a browser must never be told to go and reinstall anything.
        self.floor(minimum="99.0.0")
        for agent in [None, "Mozilla/5.0", "curl/8.4.0"]:
            self.assertEqual(self.verdict_for(agent), SUPPORTED, agent)

    def test_a_version_nobody_can_read_is_not_treated_as_old(self):
        self.floor(minimum="0.3.0")
        self.assertEqual(self.verdict_for(AGENT("nightly")), SUPPORTED)


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
            db.add(Setting(key="desktop_minimum_version", value="0.3.0"))
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

    def pull(self, agent, client_uuid=None):
        params = {"cursor": 0}
        if client_uuid:
            params["client_uuid"] = client_uuid
        return self.client.get(
            "/api/sync/pull", params=params, headers={"User-Agent": agent},
        )

    def test_an_old_build_is_refused_with_426(self):
        refused = self.pull(AGENT("0.2.0"))
        self.assertEqual(refused.status_code, 426, refused.text)
        detail = refused.json()["detail"]
        self.assertEqual(detail["error"], "client_incompatible")
        self.assertEqual(detail["minimum_version"], "0.3.0")
        # Somewhere to go, not just a refusal.
        self.assertTrue(detail["download_url"])

    def test_a_current_build_pulls_normally(self):
        allowed = self.pull(AGENT("0.3.0"))
        self.assertEqual(allowed.status_code, 200, allowed.text)

    def test_the_snapshot_is_refused_too(self):
        """The plainest reason of the three: a snapshot names each paper by
        the digest of its file, and an older build reading that expecting a
        UUID would not fail — it would store the wrong thing."""
        refused = self.client.get(
            "/api/sync/snapshot", headers={"User-Agent": AGENT("0.2.0")},
        )
        self.assertEqual(refused.status_code, 426, refused.text)
        self.assertEqual(refused.json()["detail"]["error"], "client_incompatible")

        allowed = self.client.get(
            "/api/sync/snapshot", headers={"User-Agent": AGENT("0.3.0")},
        )
        self.assertEqual(allowed.status_code, 200, allowed.text)

    def test_pushing_from_an_old_build_is_refused_too(self):
        # A push the server would otherwise have accepted: the refusal has
        # to be about the build, not about anything wrong with the work.
        refused = self.client.post(
            "/api/sync/push",
            json={
                "protocol_version": 1,
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
            headers={"User-Agent": AGENT("0.2.0")},
        )
        self.assertEqual(refused.status_code, 426, refused.text)

    def test_pulling_records_the_version_this_installation_runs(self):
        client_uuid = str(uuid.uuid4())
        self.assertEqual(self.pull(AGENT("0.3.1"), client_uuid).status_code, 200)
        with self.Session() as db:
            row = db.query(SyncClient).filter(
                SyncClient.client_uuid == client_uuid,
            ).one()
            self.assertEqual(row.app_version, "0.3.1")

    def test_an_unreadable_version_leaves_the_last_known_one_alone(self):
        client_uuid = str(uuid.uuid4())
        self.assertEqual(self.pull(AGENT("0.3.1"), client_uuid).status_code, 200)
        self.assertEqual(self.pull("curl/8.4.0", client_uuid).status_code, 200)
        with self.Session() as db:
            row = db.query(SyncClient).filter(
                SyncClient.client_uuid == client_uuid,
            ).one()
            self.assertEqual(row.app_version, "0.3.1")


if __name__ == "__main__":
    unittest.main()
