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
from services.editions import latest_edition

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
                    summary="Kept to myself",
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
            self.superseded_edition_uuid = superseded.uuid
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

    def test_the_paper_s_link_and_a_reading_of_it_are_different_links(self):
        """One carries the PDF, the other carries a reading of it. Having
        handed over the first is no reason to be refused the second."""
        paper_link = self.share(include_marks=False)
        reading_link = self.share(include_marks=True)

        self.assertEqual(paper_link["kind"], "lean")
        self.assertEqual(reading_link["kind"], "rich")
        self.assertNotEqual(paper_link["uuid"], reading_link["uuid"])
        for link in (paper_link, reading_link):
            self.assertEqual(
                self.client.get(f"/api/shared/{link['uuid']}").status_code, 200,
            )

    def test_the_paper_s_link_is_the_same_link_for_everyone(self):
        """It is the PDF's own address, not anyone's. Two readers handing the
        same paper on hand on the same link."""
        mine = self.share(include_marks=False)

        with self.Session() as db:
            db.add(Copy(
                paper_uuid=self.paper_uuid, user_uuid=self.stranger_uuid,
                edition_uuid=self.shared_edition_uuid, edition_sha256=SHARED_HASH,
            ))
            db.commit()
        type(self).current_user_uuid = self.stranger_uuid
        theirs = self.share(include_marks=False)

        self.assertEqual(theirs["uuid"], mine["uuid"])

    def test_the_paper_s_link_names_nobody(self):
        """Whoever asked for it first is not part of what it says, and
        nothing reports it back to them afterwards."""
        made = self.share(include_marks=False)

        self.assertIsNone(self.client.get(f"/api/shared/{made['uuid']}").json()["reader"])
        detail = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        self.assertIsNone(detail["sharable_uuid"])

    def test_the_paper_s_link_is_nobody_s_to_take_back(self):
        """Not theirs to be told about, and not theirs to close either."""
        made = self.share(include_marks=False)

        refused = self.client.delete(f"/api/sharables/{made['uuid']}")
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.client.get(f"/api/shared/{made['uuid']}").status_code, 200)

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
            copy.shelf.is_public = True
            db.commit()

        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").json()["paper"]["uuid"],
            self.paper_uuid,
        )

    def test_a_link_does_not_care_which_shelf_the_paper_sits_on(self):
        """Sharing is not displaying. A shelf says who may find the paper in
        the Library; a link says who may read this PDF, and the link is the
        whole of that permission. Moving the paper between a public and a
        private shelf leaves a link out in the open exactly as it was."""
        made = self.share()
        self.assertEqual(made["kind"], "rich")

        for displayed in (True, False, True):
            with self.Session() as db:
                copy = db.query(Copy).filter(Copy.user_uuid == self.reader_uuid).one()
                copy.shelf.is_public = displayed
                db.commit()

            opened = self.client.get(f"/api/shared/{made['uuid']}")
            self.assertEqual(opened.status_code, 200, opened.text)
            reading = opened.json()
            self.assertEqual(reading["uuid"], made["uuid"])
            self.assertEqual(reading["kind"], "rich")
            self.assertEqual(reading["paper"]["edition_sha256"], SHARED_HASH)
            self.assertTrue(reading["annotations"])

    def test_a_private_paper_can_still_be_shared_from_scratch(self):
        """The reader's copy sits on a private shelf throughout these tests,
        which is what makes every link made here one made from a paper
        nobody else can find."""
        with self.Session() as db:
            copy = db.query(Copy).filter(Copy.user_uuid == self.reader_uuid).one()
            self.assertFalse(copy.is_public)

        made = self.share(include_marks=False)
        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").status_code, 200,
        )

    def adopt(self, edition_uuid):
        return self.client.post(
            f"/api/papers/{self.paper_uuid}/adopt-edition",
            json={"edition_uuid": edition_uuid},
        )

    def test_a_shared_pdf_cannot_be_left_until_the_link_is_closed(self):
        """A link names the PDF its maker is reading. Moving the copy to
        another edition would leave that link opening a file the paper page
        no longer shows, so the reader is asked to settle it first."""
        made = self.share()

        refused = self.adopt(self.superseded_edition_uuid)
        self.assertEqual(refused.status_code, 409)
        self.assertIn("Stop sharing", refused.json()["detail"])

        detail = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        self.assertEqual(detail["edition_uuid"], self.shared_edition_uuid)
        self.assertEqual(detail["sharable_uuid"], made["uuid"])

    def test_a_link_to_the_paper_alone_does_not_stand_in_the_way(self):
        """It is the marks that are in the way, not the link. A link
        carrying the paper alone says "here is this PDF", which stays true
        wherever its maker moves."""
        self.share(include_marks=False)
        moved = self.adopt(self.superseded_edition_uuid)
        self.assertEqual(moved.status_code, 200, moved.text)

    def test_closing_the_link_frees_the_reader_to_move(self):
        made = self.share()
        self.client.delete(f"/api/sharables/{made['uuid']}")

        moved = self.adopt(self.superseded_edition_uuid)
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual(moved.json()["edition_uuid"], self.superseded_edition_uuid)

    def test_staying_where_they_are_is_not_a_move(self):
        """Adopting the edition already read changes nothing, so a link out
        is no reason to refuse it."""
        self.share()
        self.assertEqual(self.adopt(self.shared_edition_uuid).status_code, 200)

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

        # The link still opens the PDF that was shared. What it no longer
        # carries is the reading — including the paint, which removal leaves
        # in place untouched — nor the reader: what is left is the paper,
        # and the paper is nobody's.
        self.assertEqual(opened.status_code, 200, opened.text)
        reading = opened.json()
        self.assertEqual(reading["kind"], "lean")
        self.assertIsNone(reading["reader"])
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

    def test_dropping_marks_hands_the_link_away(self):
        """Taking the marks out is also letting go. What is left carries the
        paper alone, which is nobody's — so it leaves the reader's page, and
        there is nothing further for them to do to it."""
        made = self.share()
        self.client.post(f"/api/sharables/{made['uuid']}/lean")

        detail = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        self.assertIsNone(detail["sharable_uuid"])
        # Not theirs to enrich again, and not theirs to close.
        self.assertEqual(
            self.client.post(f"/api/sharables/{made['uuid']}/lean").status_code, 404,
        )
        self.assertEqual(
            self.client.delete(f"/api/sharables/{made['uuid']}").status_code, 404,
        )
        # And still opening, for whoever was given it.
        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").json()["kind"], "lean",
        )

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

    def test_a_reader_can_ask_for_their_own_link_without_the_paper(self):
        """The desktop reads the paper from its replica, where no link can
        live, so it asks for this beside it. The answer has to be the same
        one the whole paper would have carried, or a shared paper there
        would show as unshared and its link could not be stopped."""
        self.assertIsNone(
            self.client.get(f"/api/papers/{self.paper_uuid}/sharable").json(),
        )

        mine = self.share(include_marks=True)
        asked = self.client.get(f"/api/papers/{self.paper_uuid}/sharable")
        self.assertEqual(asked.status_code, 200, asked.text)
        self.assertEqual(asked.json()["uuid"], mine["uuid"])

        self.client.delete(f"/api/sharables/{mine['uuid']}")
        self.assertIsNone(
            self.client.get(f"/api/papers/{self.paper_uuid}/sharable").json(),
        )

    def test_the_paper_s_own_link_is_nobody_s_to_be_reported(self):
        """A lean link belongs to no one, so asking what this reader has
        out answers nothing — the same rule the paper itself follows."""
        self.share(include_marks=False)
        self.assertIsNone(
            self.client.get(f"/api/papers/{self.paper_uuid}/sharable").json(),
        )

    def test_nobody_learns_of_a_link_from_someone_else_s_reading(self):
        self.share(include_marks=True)
        type(self).current_user_uuid = self.stranger_uuid
        asked = self.client.get(f"/api/papers/{self.paper_uuid}/sharable")
        self.assertEqual(asked.status_code, 200, asked.text)
        self.assertIsNone(asked.json())

    def test_a_paper_that_is_not_there_is_not_found(self):
        missing = self.client.get("/api/papers/no-such-paper/sharable")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()


class TakingASharedPaperIntoYourNook(SharableTests):
    """What a link lets its holder keep: the paper, on the PDF it opened,
    with none of the sharer's marks on it."""

    def setUp(self):
        super().setUp()
        with self.Session() as db:
            db.add(Shelf(
                user_uuid=self.stranger_uuid, name="Mine", color="#b3923d",
                is_default=True,
            ))
            db.commit()

    def as_stranger(self):
        type(self).current_user_uuid = self.stranger_uuid

    def test_the_paper_comes_across_and_the_marks_stay_with_their_author(self):
        link = self.share(include_marks=True)
        self.as_stranger()
        added = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json()["paper_uuid"], self.paper_uuid)

        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.stranger_uuid,
                Copy.paper_uuid == self.paper_uuid,
            ).one()
            # The PDF the link opened, not the paper's newest.
            self.assertEqual(copy.edition_uuid, self.shared_edition_uuid)
            self.assertEqual(copy.edition_sha256, SHARED_HASH)
            # Nothing of the sharer's was duplicated under this reader's name.
            self.assertEqual(
                db.query(Annotation).filter(
                    Annotation.user_uuid == self.stranger_uuid,
                    Annotation.paper_uuid == self.paper_uuid,
                    Annotation.deleted_at.is_(None),
                ).count(),
                2,  # the two they already had; none of the sharer's
            )
            # And the sharer still has every one of theirs.
            self.assertEqual(
                db.query(Annotation).filter(
                    Annotation.user_uuid == self.reader_uuid,
                    Annotation.deleted_at.is_(None),
                ).count(),
                5,
            )

    def test_a_paper_nobody_displays_can_still_be_kept_from_a_link(self):
        """The ordinary add refuses it; holding the link is the permission."""
        link = self.share(include_marks=False)
        self.as_stranger()
        ordinary = self.client.post(f"/api/papers/{self.paper_uuid}/add-to-nook")
        self.assertEqual(ordinary.status_code, 404)
        by_link = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(by_link.status_code, 200, by_link.text)

    def test_a_lean_link_hands_over_the_paper_just_the_same(self):
        link = self.share(include_marks=False)
        self.as_stranger()
        added = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json()["edition_sha256"], SHARED_HASH)

    def test_the_paper_cannot_be_kept_twice(self):
        link = self.share()
        self.as_stranger()
        self.assertEqual(
            self.client.post(f"/api/shared/{link['uuid']}/add-to-nook").status_code, 200,
        )
        again = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(again.status_code, 400)
        self.assertIn("already in your nook", again.json()["detail"])

    def test_a_closed_link_hands_over_nothing(self):
        link = self.share()
        self.client.delete(f"/api/sharables/{link['uuid']}")
        self.as_stranger()
        refused = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(refused.status_code, 404)

    def test_the_link_says_whether_the_reader_already_keeps_the_paper(self):
        link = self.share()
        self.as_stranger()
        before = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(before.status_code, 200)
        self.assertIsNone(before.json())

        self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        after = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(after.status_code, 200)
        self.assertEqual(after.json()["paper_uuid"], self.paper_uuid)
        self.assertEqual(after.json()["edition_sha256"], SHARED_HASH)

    def test_its_own_maker_is_told_they_have_it_already(self):
        """The sharer follows their own link: it is their paper, and the
        offer must be their copy rather than a second one."""
        link = self.share()
        mine = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.json()["paper_uuid"], self.paper_uuid)

    def test_a_reader_on_another_pdf_of_it_still_has_the_paper(self):
        """Keeping a different edition is still keeping the paper, so the
        answer is their copy — not an offer to add a second one."""
        link = self.share()
        self.as_stranger()
        with self.Session() as db:
            shelf = db.query(Shelf).filter(
                Shelf.user_uuid == self.stranger_uuid,
            ).one()
            db.add(Copy(
                paper_uuid=self.paper_uuid, user_uuid=self.stranger_uuid,
                shelf_uuid=shelf.uuid, edition_uuid=self.superseded_edition_uuid,
                edition_sha256=OTHER_HASH,
            ))
            db.commit()
        theirs = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(theirs.json()["edition_sha256"], OTHER_HASH)
        refused = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(refused.status_code, 400)

    def test_the_pdf_that_was_shared_is_the_pdf_that_is_kept(self):
        """A newer edition arriving after the link went out must not
        redirect it. The holder read a particular file, and that file is
        what they are keeping."""
        link = self.share()
        newest_hash = "c" * 64
        with self.Session() as db:
            paper = db.query(Paper).filter(Paper.uuid == self.paper_uuid).one()
            db.add(PaperEdition(
                paper_uuid=paper.uuid, file_path=f"{newest_hash}.pdf",
                sha256=newest_hash,
            ))
            db.commit()
            paper = db.query(Paper).filter(Paper.uuid == self.paper_uuid).one()
            self.assertEqual(latest_edition(paper).sha256, newest_hash)

        self.as_stranger()
        added = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)
        # The PDF the link opened, not the one that has since arrived.
        self.assertEqual(added.json()["edition_sha256"], SHARED_HASH)
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.stranger_uuid,
                Copy.paper_uuid == self.paper_uuid,
            ).one()
            self.assertEqual(copy.edition_uuid, self.shared_edition_uuid)
