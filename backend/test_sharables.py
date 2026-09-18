import json
import unittest
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import main
from fastapi import Depends, HTTPException
from auth import get_current_user, get_optional_user
from database import Base, get_db
from models import Annotation, Copy, Paper, Sharable, Shelf, User
from services.papers import paper_name

SHARED_HASH = "a" * 64
OTHER_HASH = "b" * 64


def _note(paper, user, content, page, x, y, name=None):
    return Annotation(
        kind="note", paper_sha256=paper.sha256, user_uuid=user.uuid,
        page=page, content=content, name=name,
        body=json.dumps({"anchor": {"type": "point", "x": x, "y": y}}),
    )


def _ink(paper, user, points):
    return Annotation(
        kind="ink", paper_sha256=paper.sha256, user_uuid=user.uuid,
        page=2,
        body=json.dumps({
            "points": points, "color": "#b3923d", "width": 0.004,
            "opacity": 1.0, "shape": "flat",
        }),
    )


def _clip(paper, user):
    return Annotation(
        kind="clip", paper_sha256=paper.sha256, user_uuid=user.uuid,
        page=3,
        body=json.dumps({
            "source": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2},
            "frame": {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2},
            "floating": False,
        }),
    )


class SharableTests(unittest.TestCase):
    """A sharable hands one user's reading of one paper to anyone with
    the link — and hands over nothing else in that user's nook."""

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

        # Bound to the request's own session, as the real dependency is
        # (auth.get_current_user takes Depends(get_db)). Reading the user
        # out of a session that has already closed leaves it detached, and
        # the first lazy load on it — user.shelves, say — raises rather
        # than answering.
        def signed_in_user(db: Session = Depends(get_db)):
            if cls.current_user_uuid is None:
                raise HTTPException(status_code=401, detail="Not authenticated")
            return db.query(User).filter(User.uuid == cls.current_user_uuid).one()

        def whoever_is_here(db: Session = Depends(get_db)):
            if cls.current_user_uuid is None:
                return None
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
            user = User(
                email="user@example.com", display_name="Ada", password_hash="unused",
            )
            stranger = User(
                email="other@example.com", display_name="Grace", password_hash="unused",
            )
            db.add_all([user, stranger])
            db.commit()

            paper = Paper(
                title="On sharing a reading", doi="10.1234/share",
                file_path=f"{SHARED_HASH}.pdf", sha256=SHARED_HASH,
            )
            # Another PDF of the same work. A paper is its file, so this is a
            # paper of its own — and what this user wrote on it is no part of
            # the reading they shared.
            elsewhere = Paper(
                title="On sharing a reading", doi="10.1234/share",
                file_path=f"{OTHER_HASH}.pdf", sha256=OTHER_HASH,
            )
            db.add_all([paper, elsewhere])
            db.commit()

            shelf = Shelf(user_uuid=user.uuid, name="Reading", color="#b3923d")
            db.add(shelf)
            db.commit()
            db.add_all([
                Copy(
                    paper_sha256=paper.sha256, user_uuid=user.uuid, shelf_uuid=shelf.uuid,
                    summary="Kept to myself",
                ),
                Copy(
                    paper_sha256=elsewhere.sha256, user_uuid=user.uuid,
                    shelf_uuid=shelf.uuid,
                ),
                # A note on the page, and a note about the paper placed nowhere.
                _note(paper, user, "On the page", 2, 0.25, 0.5, "Lemma 3"),
                Annotation(
                    kind="note", paper_sha256=paper.sha256, user_uuid=user.uuid,
                    content="About the paper", body="{}",
                ),
                # And a note on the other PDF, which is another paper.
                _note(elsewhere, user, "On the old PDF", 1, 0.1, 0.1),
                # Another user's annotations on the very same file.
                _note(paper, stranger, "Not yours", 2, 0.9, 0.9),
                _ink(paper, user, [{"x": 0.1, "y": 0.2}, {"x": 0.3, "y": 0.2}]),
                _ink(paper, stranger, [{"x": 0.5, "y": 0.5}]),
                _clip(paper, user),
            ])
            db.commit()

            self.user_uuid = user.uuid
            self.stranger_uuid = stranger.uuid
            self.paper_sha256 = paper.sha256
            self.other_paper_sha256 = elsewhere.sha256
        type(self).current_user_uuid = self.user_uuid

    def share(self, include_annotations=True):
        made = self.client.post(
            f"/api/papers/{paper_name(self.paper_sha256)}/sharable",
            json={"include_annotations": include_annotations},
        )
        self.assertEqual(made.status_code, 200, made.text)
        return made.json()

    def test_a_link_carries_annotations_only_when_its_maker_said_so(self):
        lean = self.share(include_annotations=False)
        self.assertEqual(lean["kind"], "lean")

        opened = self.client.get(f"/api/shared/{lean['uuid']}").json()
        self.assertEqual(opened["kind"], "lean")
        self.assertEqual(opened["paper"]["sha256"], SHARED_HASH)
        self.assertEqual(opened["annotations"], [])

    def test_the_quiet_link_is_what_an_unasked_request_gets(self):
        made = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/sharable")
        self.assertEqual(made.json()["kind"], "lean")

    def test_the_paper_s_link_and_a_reading_of_it_are_different_links(self):
        """One carries the PDF, the other carries a reading of it. Having
        handed over the first is no reason to be refused the second."""
        paper_link = self.share(include_annotations=False)
        reading_link = self.share(include_annotations=True)

        self.assertEqual(paper_link["kind"], "lean")
        self.assertEqual(reading_link["kind"], "rich")
        self.assertNotEqual(paper_link["uuid"], reading_link["uuid"])
        for link in (paper_link, reading_link):
            self.assertEqual(
                self.client.get(f"/api/shared/{link['uuid']}").status_code, 200,
            )

    def test_the_paper_s_link_is_the_same_link_for_everyone(self):
        """It is the PDF's own address, not anyone's. Two users handing the
        same paper on hand on the same link."""
        mine = self.share(include_annotations=False)

        with self.Session() as db:
            db.add(Copy(
                paper_sha256=self.paper_sha256, user_uuid=self.stranger_uuid,
            ))
            db.commit()
        type(self).current_user_uuid = self.stranger_uuid
        theirs = self.share(include_annotations=False)

        self.assertEqual(theirs["uuid"], mine["uuid"])

    def test_the_paper_s_link_names_nobody(self):
        """Whoever asked for it first is not part of what it says, and
        nothing reports it back to them afterwards."""
        made = self.share(include_annotations=False)

        self.assertIsNone(self.client.get(f"/api/shared/{made['uuid']}").json()["user"])
        detail = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}").json()
        self.assertIsNone(detail["sharable_uuid"])

    def test_the_paper_s_link_is_nobody_s_to_take_back(self):
        """Not theirs to be told about, and not theirs to revoke either."""
        made = self.share(include_annotations=False)

        refused = self.client.delete(f"/api/sharables/{made['uuid']}")
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.client.get(f"/api/shared/{made['uuid']}").status_code, 200)

    def test_a_sharable_names_the_paper_its_maker_reads(self):
        made = self.share()
        self.assertEqual(made["paper_sha256"], self.paper_sha256)
        # Its own identity, distinct from the paper's.
        self.assertNotEqual(made["uuid"], self.paper_sha256)

    def test_asking_twice_gives_the_same_link_back(self):
        self.assertEqual(self.share()["uuid"], self.share()["uuid"])

    def test_the_paper_page_shows_the_user_their_own_link(self):
        made = self.share()
        detail = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual(detail.json()["sharable_uuid"], made["uuid"])

        # Another user of the same paper is told nothing about it.
        with self.Session() as db:
            db.add(Copy(paper_sha256=self.paper_sha256, user_uuid=self.stranger_uuid))
            db.commit()
        type(self).current_user_uuid = self.stranger_uuid
        self.assertIsNone(
            self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}").json()["sharable_uuid"],
        )

    def test_a_user_without_a_copy_has_no_reading_to_share(self):
        type(self).current_user_uuid = self.stranger_uuid
        refused = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/sharable")
        self.assertEqual(refused.status_code, 403)

    def test_the_link_opens_this_users_annotations_on_this_paper_and_no_others(self):
        made = self.share()

        opened = self.client.get(f"/api/shared/{made['uuid']}")
        self.assertEqual(opened.status_code, 200, opened.text)
        reading = opened.json()

        self.assertEqual(reading["user"]["display_name"], "Ada")
        self.assertEqual(reading["paper"]["title"], "On sharing a reading")
        self.assertEqual(reading["paper"]["sha256"], SHARED_HASH)
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
        # The user's private summary is not part of their reading.
        self.assertNotIn("summary", reading["paper"])

    def test_the_link_needs_no_account(self):
        made = self.share()
        type(self).current_user_uuid = None

        opened = self.client.get(f"/api/shared/{made['uuid']}")

        self.assertEqual(opened.status_code, 200, opened.text)
        self.assertEqual(opened.json()["user"]["display_name"], "Ada")

    def test_a_shared_reading_names_no_paper_page(self):
        """A link hands over one reading of one PDF. The page behind it is
        the Library's, which asks for an account and is not what was
        shared — so the way out is the home button, not a paper."""
        made = self.share()
        shared = self.client.get(f"/api/shared/{made['uuid']}").json()
        self.assertNotIn("uuid", shared["paper"])

        # Displaying the copy does not add one either: it was never about
        # whether the page would open.
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid,
                Copy.paper_sha256 == self.paper_sha256,
            ).one()
            copy.shelf.is_public = True
            db.commit()

        shared = self.client.get(f"/api/shared/{made['uuid']}").json()
        self.assertNotIn("uuid", shared["paper"])

    def test_a_link_does_not_care_which_shelf_the_paper_sits_on(self):
        """Sharing is not displaying. A shelf says who may find the paper in
        the Library; a link says who may read this PDF, and the link is the
        whole of that permission. Moving the paper between a public and a
        private shelf leaves a link out in the open exactly as it was."""
        made = self.share()
        self.assertEqual(made["kind"], "rich")

        for displayed in (True, False, True):
            with self.Session() as db:
                copy = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid,
                Copy.paper_sha256 == self.paper_sha256,
            ).one()
                copy.shelf.is_public = displayed
                db.commit()

            opened = self.client.get(f"/api/shared/{made['uuid']}")
            self.assertEqual(opened.status_code, 200, opened.text)
            reading = opened.json()
            self.assertEqual(reading["uuid"], made["uuid"])
            self.assertEqual(reading["kind"], "rich")
            self.assertEqual(reading["paper"]["sha256"], SHARED_HASH)
            self.assertTrue(reading["annotations"])

    def test_a_private_paper_can_still_be_shared_from_scratch(self):
        """The user's copy sits on a private shelf throughout these tests,
        which is what makes every link made here one made from a paper
        nobody else can find."""
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid,
                Copy.paper_sha256 == self.paper_sha256,
            ).one()
            self.assertFalse(copy.is_public)

        made = self.share(include_annotations=False)
        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").status_code, 200,
        )

    def test_revoking_the_link_without_pretending_it_never_existed(self):
        made = self.share()
        revoked = self.client.delete(f"/api/sharables/{made['uuid']}")
        self.assertEqual(revoked.status_code, 204)

        revoked = self.client.get(f"/api/shared/{made['uuid']}")
        self.assertEqual(revoked.status_code, 404)
        self.assertEqual(revoked.json()["detail"], "This reading is no longer shared")

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
        removed = self.client.delete(f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual(removed.status_code, 200, removed.text)

        opened = self.client.get(f"/api/shared/{made['uuid']}")

        # The link still opens the PDF that was shared. What it no longer
        # carries is the reading — including the paint, which removal leaves
        # in place untouched — nor the user: what is left is the paper,
        # and the paper is nobody's.
        self.assertEqual(opened.status_code, 200, opened.text)
        reading = opened.json()
        self.assertEqual(reading["kind"], "lean")
        self.assertIsNone(reading["user"])
        self.assertEqual(reading["paper"]["sha256"], SHARED_HASH)
        self.assertEqual(reading["annotations"], [])

    def test_a_synchronized_delete_demotes_the_link_too(self):
        # Papol Desktop removes a paper by synchronizing a deleted copy, and
        # never calls the endpoint above. Both roads have to end up here.
        made = self.share()
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid, Copy.paper_sha256 == self.paper_sha256,
            ).one()
            copy.deleted_at = datetime.utcnow()
            db.commit()

        self.assertEqual(
            self.client.get(f"/api/shared/{made['uuid']}").json()["kind"], "lean",
        )

    def test_taking_the_paper_back_does_not_re_enrich_a_demoted_link(self):
        made = self.share()
        self.client.delete(f"/api/papers/{paper_name(self.paper_sha256)}")
        self.client.get(f"/api/shared/{made['uuid']}")
        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.user_uuid, Copy.paper_sha256 == self.paper_sha256,
            ).one()
            copy.deleted_at = None
            db.commit()

        # The demotion is written down, so whoever is still holding this
        # link does not silently get the annotations back.
        reading = self.client.get(f"/api/shared/{made['uuid']}").json()
        self.assertEqual(reading["kind"], "lean")
        self.assertEqual(reading["annotations"], [])

    def test_a_rich_link_can_drop_its_annotations_instead_of_closing(self):
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

    def test_dropping_annotations_hands_the_link_away(self):
        """Taking the annotations out is also letting go. What is left carries the
        paper alone, which is nobody's — so it leaves the user's page, and
        there is nothing further for them to do to it."""
        made = self.share()
        self.client.post(f"/api/sharables/{made['uuid']}/lean")

        detail = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}").json()
        self.assertIsNone(detail["sharable_uuid"])
        # Not theirs to enrich again, and not theirs to revoke.
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

    def test_only_its_maker_may_drop_the_annotations_from_a_link(self):
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
        query = f"paper_sha256={self.paper_sha256}&share={made['uuid']}"

        allowed = self.client.get(f"/api/viewer-references/{SHARED_HASH}?{query}")
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(allowed.json()["paper_sha256"], self.paper_sha256)

        # The link opens one file. It is not a key to every other PDF.
        elsewhere = self.client.get(f"/api/viewer-references/{OTHER_HASH}?{query}")
        self.assertEqual(elsewhere.status_code, 404)

        # And without one, a visitor is simply not someone who may ask.
        type(self).current_user_uuid = None
        unshared = self.client.get(
            f"/api/viewer-references/{SHARED_HASH}?paper_sha256={self.paper_sha256}"
        )
        self.assertEqual(unshared.status_code, 401)

    def test_a_user_can_ask_for_their_own_link_without_the_paper(self):
        """The desktop reads the paper from its replica, where no link can
        live, so it asks for this beside it. The answer has to be the same
        one the whole paper would have carried, or a shared paper there
        would show as unshared and its link could not be stopped."""
        self.assertIsNone(
            self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}/sharable").json(),
        )

        mine = self.share(include_annotations=True)
        asked = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}/sharable")
        self.assertEqual(asked.status_code, 200, asked.text)
        self.assertEqual(asked.json()["uuid"], mine["uuid"])

        self.client.delete(f"/api/sharables/{mine['uuid']}")
        self.assertIsNone(
            self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}/sharable").json(),
        )

    def test_the_paper_s_own_link_is_nobody_s_to_be_reported(self):
        """A lean link belongs to no one, so asking what this user has
        out answers nothing — the same rule the paper itself follows."""
        self.share(include_annotations=False)
        self.assertIsNone(
            self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}/sharable").json(),
        )

    def test_nobody_learns_of_a_link_from_someone_else_s_reading(self):
        self.share(include_annotations=True)
        type(self).current_user_uuid = self.stranger_uuid
        asked = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}/sharable")
        self.assertEqual(asked.status_code, 200, asked.text)
        self.assertIsNone(asked.json())

    def test_a_paper_that_is_not_there_is_not_found(self):
        missing = self.client.get("/api/papers/no-such-paper/sharable")
        self.assertEqual(missing.status_code, 404)


if __name__ == "__main__":
    unittest.main()


class TakingASharedPaperIntoYourNook(SharableTests):
    """What a link lets its holder keep: the paper it opened, with none of
    the sharer's annotations on it."""

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

    def test_the_paper_comes_across_and_the_annotations_stay_with_their_author(self):
        link = self.share(include_annotations=True)
        self.as_stranger()
        added = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json()["sha256"], self.paper_sha256)

        with self.Session() as db:
            copy = db.query(Copy).filter(
                Copy.user_uuid == self.stranger_uuid,
                Copy.paper_sha256 == self.paper_sha256,
            ).one()
            # Nothing of the sharer's was duplicated under this user's name.
            self.assertEqual(
                db.query(Annotation).filter(
                    Annotation.user_uuid == self.stranger_uuid,
                    Annotation.paper_sha256 == self.paper_sha256,
                    Annotation.deleted_at.is_(None),
                ).count(),
                2,  # the two they already had; none of the sharer's
            )
            # And the sharer still has every one of theirs.
            self.assertEqual(
                db.query(Annotation).filter(
                    Annotation.user_uuid == self.user_uuid,
                    Annotation.deleted_at.is_(None),
                ).count(),
                5,
            )

    def test_a_paper_nobody_displays_can_be_kept_either_way(self):
        """Nobody owns a paper, so no display stands between a signed-in
        user and a copy of their own. The ordinary add works on a paper
        nobody shows, and the link is still its own permission — it has to
        be, because whoever holds one may have no account at all."""
        link = self.share(include_annotations=False)
        self.as_stranger()
        ordinary = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/add-to-nook")
        self.assertEqual(ordinary.status_code, 200, ordinary.text)
        # Already kept, so the link says so rather than making a second copy.
        by_link = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(by_link.status_code, 400, by_link.text)
        self.assertIn("already in your nook", by_link.json()["detail"])

    def test_a_lean_link_hands_over_the_paper_just_the_same(self):
        link = self.share(include_annotations=False)
        self.as_stranger()
        added = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json()["sha256"], SHARED_HASH)

    def test_the_paper_cannot_be_kept_twice(self):
        link = self.share()
        self.as_stranger()
        self.assertEqual(
            self.client.post(f"/api/shared/{link['uuid']}/add-to-nook").status_code, 200,
        )
        again = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(again.status_code, 400)
        self.assertIn("already in your nook", again.json()["detail"])

    def test_a_revoked_link_hands_over_nothing(self):
        link = self.share()
        self.client.delete(f"/api/sharables/{link['uuid']}")
        self.as_stranger()
        refused = self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        self.assertEqual(refused.status_code, 404)

    def test_the_link_says_whether_the_user_already_keeps_the_paper(self):
        link = self.share()
        self.as_stranger()
        before = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(before.status_code, 200)
        self.assertIsNone(before.json())

        self.client.post(f"/api/shared/{link['uuid']}/add-to-nook")
        after = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(after.status_code, 200)
        self.assertEqual(after.json()["sha256"], self.paper_sha256)

    def test_its_own_maker_is_told_they_have_it_already(self):
        """The sharer follows their own link: it is their paper, and the
        offer must be their copy rather than a second one."""
        link = self.share()
        mine = self.client.get(f"/api/shared/{link['uuid']}/nook")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(mine.json()["sha256"], self.paper_sha256)
