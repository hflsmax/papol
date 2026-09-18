"""A paper belongs to nobody.

What a user owns is their copy: the shelf it sits on, their ratings, their
summary, their annotations. The paper itself, and the PDFs under it, are
things that exist, so no user's shelf decides whether anyone else may find a
paper or read it.

What display governs is each user's own business: whether they are shown
standing against the paper, and whether they may take part in its seminar.
These tests hold that line from both sides.
"""

import unittest

from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import main
from auth import get_current_user, get_optional_user
from database import Base, get_db
from models import Copy, Paper, Shelf, User
from services.papers import paper_name

NOBODYS_HASH = "d" * 64

HIDDEN_HASH = "c" * 64


class PaperIsNotOwned(unittest.TestCase):
    """One paper, kept by one user on a shelf nobody else can see."""

    current_user_uuid = None

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

        # Bound to the request's session, as the real dependency is.
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
        for dependency in (get_db, get_current_user, get_optional_user):
            main.app.dependency_overrides.pop(dependency, None)
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        with self.Session() as db:
            keeper = User(
                email="keeper@example.com", display_name="Ada", password_hash="unused",
            )
            other = User(
                email="other@example.com", display_name="Grace", password_hash="unused",
            )
            db.add_all([keeper, other])
            db.commit()

            paper = Paper(
                title="On a paper nobody owns", doi="10.1234/unowned",
                file_path=f"{HIDDEN_HASH}.pdf", sha256=HIDDEN_HASH,
            )
            db.add(paper)
            db.commit()

            # A private shelf: this copy is shown to nobody.
            shelf = Shelf(
                user_uuid=keeper.uuid, name="Unread", color="#b3923d", is_public=False,
            )
            # The other user keeps a shelf too, so they can take a copy.
            their_shelf = Shelf(
                user_uuid=other.uuid, name="Reading", color="#7ba26c",
                is_public=True, is_default=True,
            )
            db.add_all([shelf, their_shelf])
            db.commit()
            db.add(Copy(
                paper_sha256=paper.sha256, user_uuid=keeper.uuid, shelf_uuid=shelf.uuid,
                summary="Mine alone",
            ))
            db.commit()

            self.keeper_uuid = keeper.uuid
            self.other_uuid = other.uuid
            self.paper_sha256 = paper.sha256
        type(self).current_user_uuid = self.other_uuid

    def as_visitor(self):
        type(self).current_user_uuid = None

    # --- What being unowned means -------------------------------------

    def test_the_library_lists_a_paper_nobody_displays(self):
        """Displaying a copy is not what puts a paper in the Library."""
        listing = self.client.get("/api/papers")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertIn(self.paper_sha256, [p["sha256"] for p in listing.json()])

    def test_two_uploads_of_one_file_at_once_land_on_the_same_paper(self):
        """The digest is unique, so one of two racing uploads loses the
        insert. Losing means the paper is already there, which is the answer
        the request wanted: it takes the row that won rather than being
        refused an upload that was never wrong."""
        from unittest.mock import patch

        raced = f"{'e' * 64}.pdf"
        (main.UPLOADS_DIR / raced).write_bytes(b"%PDF-1.4 raced\n%%EOF")
        self.addCleanup((main.UPLOADS_DIR / raced).unlink, True)
        digest = main._sha256_of(main.UPLOADS_DIR / raced)

        with self.Session() as db:
            db.add(Paper(
                title="Stored by whoever got there first",
                file_path=raced, sha256=digest,
            ))
            db.commit()
            winner = db.query(Paper).filter(Paper.sha256 == digest).one().sha256

        # The look-up misses, as it does for the request that loses the race;
        # the insert then collides with the row that won.
        real = main._paper_with_digest
        misses = [True]

        def _first_look_finds_nothing(db, wanted):
            if misses:
                misses.pop()
                return None
            return real(db, wanted)

        with patch.object(main, "_paper_with_digest", _first_look_finds_nothing):
            made = self.client.post("/api/papers", json={
                "title": "Uploaded at the same moment",
                "file_path": raced,
            })

        self.assertEqual(made.status_code, 200, made.text)
        self.assertEqual(made.json()["sha256"], winner, "it must take the row that won")
        with self.Session() as db:
            self.assertEqual(
                db.query(Paper).filter(Paper.sha256 == digest).count(), 1,
            )

    def test_the_library_lists_a_paper_nobody_holds(self):
        """A paper with no copies at all is still a paper the Library holds.

        Leaving a paper is not a deletion, and a file that arrived without
        anyone taking it is still a file Papol has: either way the row is
        there to be found and added, with no readers shown against it."""
        with self.Session() as db:
            nobodys = Paper(
                title="Held by nobody", doi="10.1234/unheld",
                file_path=f"{NOBODYS_HASH}.pdf", sha256=NOBODYS_HASH,
            )
            db.add(nobodys)
            db.commit()
            nobodys_file = nobodys.sha256

        listing = self.client.get("/api/papers")
        self.assertEqual(listing.status_code, 200, listing.text)
        row = next(
            (p for p in listing.json() if p["sha256"] == nobodys_file), None,
        )
        self.assertIsNotNone(row, "a paper nobody holds must still be listed")
        self.assertEqual(row["users"], [], "and be shown with no readers")
        self.assertEqual(row["file_path"], f"{NOBODYS_HASH}.pdf")

        # And it opens, so the row is one a user can act on rather than a
        # line they cannot follow.
        page = self.client.get(f"/api/papers/{paper_name(nobodys_file)}")
        self.assertEqual(page.status_code, 200, page.text)
        self.assertFalse(page.json()["viewer_has_entry"])

    def test_leaving_a_paper_does_not_take_it_out_of_the_library(self):
        """The last reader walking away is not a deletion."""
        self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/add-to-nook")
        self.client.delete(f"/api/papers/{paper_name(self.paper_sha256)}")
        listing = self.client.get("/api/papers")
        self.assertIn(self.paper_sha256, [p["sha256"] for p in listing.json()])

    def test_any_signed_in_user_opens_it(self):
        page = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(page.json()["title"], "On a paper nobody owns")

    def test_any_signed_in_user_may_take_a_copy(self):
        added = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)

    # --- What stays the keeper's own business -------------------------

    def test_the_keeper_is_not_named_on_a_paper_they_do_not_display(self):
        """The paper is everyone's; that this user reads it is theirs."""
        page = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}").json()
        named = [entry["user"]["uuid"] for entry in page.get("also_read_by", [])]
        self.assertNotIn(self.keeper_uuid, named)

    def test_the_keepers_summary_stays_theirs(self):
        page = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}").json()
        self.assertIsNone(page.get("summary"))

    # --- The account boundary is not ownership ------------------------

    def test_a_paper_page_is_never_built_for_a_visitor(self):
        """Removing ownership widened the Library, not the open web. The
        Library is for people with accounts (US-1.4), so the paper page
        asks for one — whoever displays the paper, and whatever it is."""
        self.as_visitor()
        page = self.client.get(f"/api/papers/{paper_name(self.paper_sha256)}")
        self.assertEqual(page.status_code, 401, page.text)


if __name__ == "__main__":
    unittest.main()
