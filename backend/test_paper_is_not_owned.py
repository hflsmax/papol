"""A paper belongs to nobody.

What a user owns is their copy: the shelf it sits on, their ratings, their
summary, their annotations. The paper itself, and the PDFs under it, are
things that exist. So no user's shelf decides whether anyone else may find
a paper or read it — a paper nobody displays is a paper like any other.

What display still governs is each user's own business: whether they are
shown standing against the paper, and whether they may take part in its
seminar. These tests hold that line from both sides.
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
from models import Copy, Paper, PaperEdition, Shelf, User

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

            paper = Paper(title="On a paper nobody owns", doi="10.1234/unowned")
            db.add(paper)
            db.commit()
            edition = PaperEdition(
                paper_uuid=paper.uuid,
                file_path=f"{HIDDEN_HASH}.pdf",
                sha256=HIDDEN_HASH,
            )
            db.add(edition)
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
                paper_uuid=paper.uuid, user_uuid=keeper.uuid, shelf_uuid=shelf.uuid,
                edition_uuid=edition.uuid, edition_sha256=HIDDEN_HASH,
                summary="Mine alone",
            ))
            db.commit()

            self.keeper_uuid = keeper.uuid
            self.other_uuid = other.uuid
            self.paper_uuid = paper.uuid
        type(self).current_user_uuid = self.other_uuid

    def as_visitor(self):
        type(self).current_user_uuid = None

    # --- What being unowned means -------------------------------------

    def test_the_library_lists_a_paper_nobody_displays(self):
        """Displaying a copy is not what puts a paper in the Library."""
        listing = self.client.get("/api/papers")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertIn(self.paper_uuid, [p["uuid"] for p in listing.json()])

    def test_any_signed_in_user_opens_it(self):
        page = self.client.get(f"/api/papers/{self.paper_uuid}")
        self.assertEqual(page.status_code, 200, page.text)
        self.assertEqual(page.json()["title"], "On a paper nobody owns")

    def test_any_signed_in_user_may_take_a_copy(self):
        added = self.client.post(f"/api/papers/{self.paper_uuid}/add-to-nook")
        self.assertEqual(added.status_code, 200, added.text)

    # --- What stays the keeper's own business -------------------------

    def test_the_keeper_is_not_named_on_a_paper_they_do_not_display(self):
        """The paper is everyone's; that this user reads it is theirs."""
        page = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        named = [entry["user"]["uuid"] for entry in page.get("also_read_by", [])]
        self.assertNotIn(self.keeper_uuid, named)

    def test_the_keepers_summary_stays_theirs(self):
        page = self.client.get(f"/api/papers/{self.paper_uuid}").json()
        self.assertIsNone(page.get("summary"))

    # --- The account boundary is not ownership ------------------------

    def test_a_visitor_with_no_account_still_gets_nothing(self):
        """Removing ownership widened the Library, not the open web: a
        visitor is outside it altogether (US-1.4), and a paper no user
        displays is the one case where that is visible."""
        self.as_visitor()
        page = self.client.get(f"/api/papers/{self.paper_uuid}")
        self.assertEqual(page.status_code, 404, page.text)


if __name__ == "__main__":
    unittest.main()
