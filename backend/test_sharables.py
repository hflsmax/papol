import json
import unittest
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import main
from fastapi import HTTPException
from auth import get_current_user, get_optional_user
from database import Base, get_db
from models import Annotation, Copy, Paper, PaperEdition, Sharable, Shelf, User

SHARED_HASH = "a" * 64
OTHER_HASH = "b" * 64


def _note(paper, user, edition, content, page, x, y, name=None):
    return Annotation(
        kind="note", paper_uuid=paper.uuid, user_uuid=user.uuid,
        edition_uuid=edition.uuid, page=page, content=content, name=name,
        body=json.dumps({"anchor": {"type": "point", "x": x, "y": y}}),
    )


def _ink(paper, user, edition, points):
    return Annotation(
        kind="ink", paper_uuid=paper.uuid, user_uuid=user.uuid,
        edition_uuid=edition.uuid, page=2,
        body=json.dumps({
            "points": points, "color": "#b3923d", "width": 0.004,
            "opacity": 1.0, "shape": "flat",
        }),
    )


def _clip(paper, user, edition):
    return Annotation(
        kind="clip", paper_uuid=paper.uuid, user_uuid=user.uuid,
        edition_uuid=edition.uuid, page=3,
        body=json.dumps({
            "source": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            "frame": {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2},
            "floating": False,
        }),
    )


class SharableTests(unittest.TestCase):
    """A sharable hands one reader's reading of one edition to anyone with
    the link — and hands over nothing else in that reader's nook."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.Session = sessionmaker(bind=cls.engine)
        Base.metadata.create_all(cls.engine)

        def test_db():
            with cls.Session() as db:
                yield db

        def signed_in_user():
            if cls.current_user_uuid is None:
                raise HTTPException(status_code=401, detail="Not authenticated")
            with cls.Session() as db:
                return db.query(User).filter(User.uuid == cls.current_user_uuid).one()

        def whoever_is_here():
            if cls.current_user_uuid is None:
                return None
            with cls.Session() as db:
                return db.query(User).filter(User.uuid == cls.current_user_uuid).one()

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = signed_in_user
        main.app.dependency_overrides[get_optional_user] = whoever_is_here
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        main.app.dependency_overrides.pop(get_db, None)
        main.app.dependency_overrides.pop(get_current_user, None)
        main.app.dependency_overrides.pop(get_optional_user, None)
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        with self.Session() as db:
            reader = User(
                email="reader@example.com", display_name="Ada", password_hash="unused",
            )
            stranger = User(
                email="other@example.com", display_name="Grace", password_hash="unused",
            )
            db.add_all([reader, stranger])
            db.commit()

            paper = Paper(title="On sharing a reading", doi="10.1234/share")
            db.add(paper)
            db.commit()
            shared = PaperEdition(
                paper_uuid=paper.uuid, file_path=f"{SHARED_HASH}.pdf", sha256=SHARED_HASH,
            )
            superseded = PaperEdition(
                paper_uuid=paper.uuid, file_path=f"{OTHER_HASH}.pdf", sha256=OTHER_HASH,
            )
            db.add_all([shared, superseded])
            db.commit()

            shelf = Shelf(user_uuid=reader.uuid, name="Reading", color="#b3923d")
            db.add(shelf)
            db.commit()
            db.add_all([
                Copy(
                    paper_uuid=paper.uuid, user_uuid=reader.uuid, shelf_uuid=shelf.uuid,
                    edition_uuid=shared.uuid, edition_sha256=SHARED_HASH,
                    summary="Kept to myself", marketed=False,
                ),
                # A note on the shared PDF, a note on the paper itself, and a
                # note placed on the edition this reader no longer reads.
                _note(paper, reader, shared, "On the page", 2, 0.25, 0.5, "Lemma 3"),
                Annotation(
                    kind="note", paper_uuid=paper.uuid, user_uuid=reader.uuid,
                    content="About the paper", body="{}",
                ),
                _note(paper, reader, superseded, "On the old PDF", 1, 0.1, 0.1),
                # Another reader's marks on the very same file.
                _note(paper, stranger, shared, "Not yours", 2, 0.9, 0.9),
                _ink(paper, reader, shared, [{"x": 0.1, "y": 0.2}, {"x": 0.3, "y": 0.2}]),
                _ink(paper, stranger, shared, [{"x": 0.5, "y": 0.5}]),
                _clip(paper, reader, shared),
            ])
            db.commit()

            self.reader_uuid = reader.uuid
            self.stranger_uuid = stranger.uuid
            self.paper_uuid = paper.uuid
            self.shared_edition_uuid = shared.uuid
        type(self).current_user_uuid = self.reader_uuid

    def share(self, include_marks=True):
        made = self.client.post(
            f"/api/papers/{self.paper_uuid}/sharable",
            json={"include_marks": include_marks},
        )
        self.assertEqual(made.status_code, 200, made.text)
        return made.json()

    def test_a_link_carries_marks_only_when_its_maker_said_so(self):
        lean = self.share(include_marks=False)
        self.assertEqual(lean["kind"], "lean")

        opened = self.client.get(f"/api/shared/{lean['uuid']}").json()
        self.assertEqual(opened["kind"], "lean")
        self.assertEqual(opened["paper"]["edition_sha256"], SHARED_HASH)
        self.assertEqual(opened["annotations"], [])

    def test_the_quiet_link_is_what_an_unasked_request_gets(self):
        made = self.client.post(f"/api/papers/{self.paper_uuid}/sharable")
        self.assertEqual(made.json()["kind"], "lean")

    def test_a_paper_has_one_link_at_a_time_whatever_it_carries(self):
        self.assertEqual(self.share(include_marks=False)["kind"], "lean")
        clash = self.client.post(
            f"/api/papers/{self.paper_uuid}/sharable", json={"include_marks": True},
        )
        self.assertEqual(clash.status_code, 409)

    def test_a_sharable_names_the_edition_its_maker_reads(self):
        made = self.share()
        self.assertEqual(made["paper_uuid"], self.paper_uuid)
        self.assertEqual(made["edition_uuid"], self.shared_edition_uuid)
        # Its own identity, distinct from the paper's and the edition's.
        self.assertNotIn(made["uuid"], {self.paper_uuid, self.shared_edition_uuid})

    def test_asking_twice_gives_the_same_link_back(self):
        self.assertEqual(self.share()["uuid"], self.share()["uuid"])

    def test_the_paper_page_shows_the_reader_their_own_link(self):
        made = self.share()
        detail = self.client.get(f"/api/papers/{self.paper_uuid}")
        self.assertEqual(detail.json()["sharable_uuid"], made["uuid"])

        # Another reader of the same paper is told nothing about it.
        with self.Session() as db:
            db.add(Copy(paper_uuid=self.paper_uuid, user_uuid=self.stranger_uuid))
            db.commit()
        type(self).current_user_uuid = self.stranger_uuid
        self.assertIsNone(
            self.client.get(f"/api/papers/{self.paper_uuid}").json()["sharable_uuid"],
        )

    def test_a_reader_without_a_copy_has_no_reading_to_share(self):
        type(self).current_user_uuid = self.stranger_uuid
        refused = self.client.post(f"/api/papers/{self.paper_uuid}/sharable")
        self.assertEqual(refused.status_code, 403)

    def test_the_link_opens_this_readers_marks_on_this_edition_and_no_others(self):
        made = self.share()

        opened = self.client.get(f"/api/shared/{made['uuid']}")
        self.assertEqual(opened.status_code, 200, opened.text)
        reading = opened.json()

        self.assertEqual(reading["reader"]["display_name"], "Ada")
        self.assertEqual(reading["paper"]["title"], "On sharing a reading")
        self.assertEqual(reading["paper"]["edition_sha256"], SHARED_HASH)
        self.assertEqual(reading["paper"]["file_path"], f"{SHARED_HASH}.pdf")
        # One list, each saying its own kind, in the order they were made.
        by_kind = {}
        for row in reading["annotations"]:
            by_kind.setdefault(row["kind"], []).append(row)
        self.assertEqual(
            [note["content"] for note in by_kind["note"]],
            ["On the page", "About the paper"],
        )
        self.assertEqual(
            by_kind["note"][0]["body"]["anchor"],
            {"type": "point", "x": 0.25, "y": 0.5},
        )
        self.assertEqual(by_kind["note"][0]["name"], "Lemma 3")
        self.assertEqual(len(by_kind["ink"]), 1)
        self.assertEqual(len(by_kind["clip"]), 1)
        # The reader's private summary is not part of their reading.
        self.assertNotIn("summary", reading["paper"])

    def test_the_link_needs_no_account(self):
        made = self.share()
        type(self).current_user_uuid = None

        opened = self.client.get(f"/api/shared/{made['uuid']}")

        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()["reader"]["display_name"], "Ada")

    def test_a_private_paper_offers_no_link_to_a_page_that_would_not_open(self):
        made = self.share()
        self.assertIsNone(self.client.get(f"/api/shared/{made['uuid']}").json()["paper"]["uuid"])

        with self.Session() as db:
            copy = db.query(Copy).filter(Copy.user_uuid == self.reader_uuid).one()
            copy.marketed = True
            db.commit()

        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").json()["paper"]["uuid"],
            self.paper_uuid,
        )

    def test_revoking_closes_the_link_without_pretending_it_never_existed(self):
        made = self.share()
        revoked = self.client.delete(f"/api/sharables/{made['uuid']}")
        self.assertEqual(revoked.status_code, 204)

        closed = self.client.get(f"/api/shared/{made['uuid']}")
        self.assertEqual(closed.status_code, 404)
        self.assertEqual(closed.json()["detail"], "This reading is no longer shared")

        with self.Session() as db:
            self.assertIsNotNone(
                db.query(Sharable).filter(Sharable.uuid == made["uuid"]).one().revoked_at,
            )

    def test_a_revoked_link_is_not_resurrected_by_sharing_again(self):
        first = self.share()
        self.client.delete(f"/api/sharables/{first['uuid']}")
        second = self.share()

        self.assertNotEqual(first["uuid"], second["uuid"])
        self.assertEqual(self.client.get(f"/api/shared/{first['uuid']}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/shared/{second['uuid']}").status_code, 200)

    def test_leaving_the_nook_turns_a_rich_link_lean(self):
        made = self.share()
        self.assertEqual(made["kind"], "rich")
        removed = self.client.delete(f"/api/papers/{self.paper_uuid}")
        self.assertEqual(removed.status_code, 200, removed.text)

        opened = self.client.get(f"/api/shared/{made['uuid']}")

        # The link still opens the PDF that was shared, under the name of
        # the reader who shared it. What it no longer carries is the reading
        # — including the paint, which removal leaves in place untouched.
        self.assertEqual(opened.status_code, 200, opened.text)
        reading = opened.json()
        self.assertEqual(reading["kind"], "lean")
        self.assertEqual(reading["reader"]["display_name"], "Ada")
        self.assertEqual(reading["paper"]["edition_sha256"], SHARED_HASH)
        self.assertEqual(reading["annotations"], [])

    def test_a_synchronized_delete_demotes_the_link_too(self):
        # Papol Desktop removes a paper by synchronizing a deleted copy, and
        # never calls the endpoint above. Both roads have to end up here.
        made = self.share()
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.reader_uuid, Copy.paper_uuid == self.paper_uuid,
            ).one()
            copy.deleted_at = datetime.utcnow()
            db.commit()

        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").json()["kind"], "lean",
        )

    def test_taking_the_paper_back_does_not_re_enrich_a_demoted_link(self):
        made = self.share()
        self.client.delete(f"/api/papers/{self.paper_uuid}")
        self.client.get(f"/api/shared/{made['uuid']}")
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.reader_uuid, Copy.paper_uuid == self.paper_uuid,
            ).one()
            copy.deleted_at = None
            db.commit()

        # The demotion is written down, so whoever is still holding this
        # link does not silently get the marks back.
        reading = self.client.get(f"/api/shared/{made['uuid']}").json()
        self.assertEqual(reading["kind"], "lean")
        self.assertEqual(reading["annotations"], [])

    def test_a_rich_link_can_drop_its_marks_instead_of_closing(self):
        made = self.share()
        self.assertEqual(made["kind"], "rich")

        leaned = self.client.post(f"/api/sharables/{made['uuid']}/lean")

        self.assertEqual(leaned.status_code, 200, leaned.text)
        self.assertEqual(leaned.json()["kind"], "lean")
        self.assertEqual(leaned.json()["uuid"], made["uuid"])
        # The same link, still opening, carrying the paper and nothing else.
        reading = self.client.get(f"/api/shared/{made['uuid']}").json()
        self.assertEqual(reading["kind"], "lean")
        self.assertEqual(reading["annotations"], [])

    def test_dropping_marks_is_one_way(self):
        made = self.share()
        self.client.post(f"/api/sharables/{made['uuid']}/lean")
        # Nothing offers to put them back; asking again is simply a no-op.
        again = self.client.post(f"/api/sharables/{made['uuid']}/lean")
        self.assertEqual(again.json()["kind"], "lean")

        detail = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        self.assertEqual(detail["sharable_kind"], "lean")
        self.assertEqual(detail["sharable_uuid"], made["uuid"])

    def test_only_its_maker_may_drop_the_marks_from_a_link(self):
        made = self.share()
        type(self).current_user_uuid = self.stranger_uuid
        refused = self.client.post(f"/api/sharables/{made['uuid']}/lean")
        self.assertEqual(refused.status_code, 404)

    def test_only_its_maker_may_take_a_link_back(self):
        made = self.share()
        type(self).current_user_uuid = self.stranger_uuid
        refused = self.client.delete(f"/api/sharables/{made['uuid']}")
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.client.get(f"/api/shared/{made['uuid']}").status_code, 200)

    def test_a_link_authorizes_the_bibliography_of_the_file_it_opens(self):
        made = self.share()
        query = f"edition_uuid={self.shared_edition_uuid}&share={made['uuid']}"

        allowed = self.client.get(f"/api/viewer-references/{SHARED_HASH}?{query}")
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(allowed.json()["edition_uuid"], self.shared_edition_uuid)

        # The link opens one file. It is not a key to every other PDF.
        elsewhere = self.client.get(f"/api/viewer-references/{OTHER_HASH}?{query}")
        self.assertEqual(elsewhere.status_code, 404)

        # And without one, a visitor is simply not someone who may ask.
        type(self).current_user_uuid = None
        unshared = self.client.get(
            f"/api/viewer-references/{SHARED_HASH}?edition_uuid={self.shared_edition_uuid}"
        )
        self.assertEqual(unshared.status_code, 401)


if __name__ == "__main__":
    unittest.main()
