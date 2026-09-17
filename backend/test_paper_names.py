"""What a paper is called in a link.

A paper is its file, and the file is named by the SHA-256 of its bytes. That
name is 64 characters, twice what every other name in Papol costs, so a link
carries the first half of it — the same 32 hex digits a UUID holds.

The distinction these tests hold is between a *name* and an *identity*. The
name is one shape and no other: 32 characters, in a URL and on the wire. The
identity is unchanged and always the full digest — it is what rows are keyed
by, what blobs are stored under, and what bytes are checked against. Shortening
the one must not shorten the other, and the last test here is the one that
matters: the integrity check still demands the whole digest, because a name
half as long would be a check half as strong.

The full digest is not a name and is not answered as one. Papol has no readers
holding links written before this, and two accepted shapes cost more to hold in
the head than the links they would have saved.
"""

import unittest

from fastapi import Depends, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import main
from auth import get_current_user
from database import Base, get_db
from models import Copy, Paper, Shelf, User
from services.papers import AmbiguousPaperName, paper_by_name

A_PAPER = "a1b2c3d4" + "0" * 24 + "f" * 32
# Agrees with A_PAPER for the whole of its short name and differs after it.
ITS_TWIN = A_PAPER[:32] + "e" * 32
ANOTHER = "b" * 64


class PaperNames(unittest.TestCase):
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

        def signed_in_user(db: Session = Depends(get_db)):
            if cls.current_user_uuid is None:
                raise HTTPException(status_code=401, detail="Not authenticated")
            return db.query(User).filter(User.uuid == cls.current_user_uuid).one()

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = signed_in_user
        cls.client = TestClient(main.app)

    @classmethod
    def tearDownClass(cls):
        for dependency in (get_db, get_current_user):
            main.app.dependency_overrides.pop(dependency, None)
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(self.engine)
        Base.metadata.create_all(self.engine)
        with self.Session() as db:
            reader = User(
                email="reader@example.com", display_name="Ada", password_hash="unused",
            )
            db.add(reader)
            db.commit()
            shelf = Shelf(
                user_uuid=reader.uuid, name="Reading", color="#7ba26c",
                is_public=True, is_default=True,
            )
            db.add(shelf)
            db.add_all([
                Paper(
                    title="The paper a link names", file_path=f"{A_PAPER}.pdf",
                    sha256=A_PAPER,
                ),
                Paper(
                    title="Another paper entirely", file_path=f"{ANOTHER}.pdf",
                    sha256=ANOTHER,
                ),
            ])
            db.commit()
            db.add(Copy(
                paper_sha256=A_PAPER, user_uuid=reader.uuid, shelf_uuid=shelf.uuid,
            ))
            db.commit()
            type(self).current_user_uuid = reader.uuid

    # ---------- the name a link carries ----------

    def test_a_paper_opens_by_the_name_a_link_carries(self):
        response = self.client.get(f"/api/papers/{A_PAPER[:32]}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sha256"], A_PAPER)

    def test_a_paper_answers_with_its_whole_digest(self):
        """The name goes no further than the lookup: what comes back is the
        paper's stored identity, which is what the rest of the service uses."""
        body = self.client.get(f"/api/papers/{A_PAPER[:32]}").json()
        self.assertEqual(body["sha256"], A_PAPER)
        self.assertEqual(body["uuid"], A_PAPER)

    def test_the_whole_digest_is_not_a_name(self):
        """One shape is read, not two. The digest is the identity; asking for a
        paper by it is asking with something that is not a name."""
        self.assertEqual(
            self.client.get(f"/api/papers/{A_PAPER}").status_code, 404,
        )

    def test_the_name_is_read_without_regard_to_case(self):
        response = self.client.get(f"/api/papers/{A_PAPER[:32].upper()}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sha256"], A_PAPER)

    # ---------- names that are not names ----------

    def test_a_name_of_the_wrong_length_is_not_a_paper(self):
        """One length is written and one is read. Anything else is refused
        rather than resolved to whichever paper happens to start that way: a
        name that means 'the nearest match' is not a name."""
        for wrong in (A_PAPER[:31], A_PAPER[:33], A_PAPER[:48], A_PAPER[:63], A_PAPER):
            with self.subTest(name=wrong):
                self.assertEqual(
                    self.client.get(f"/api/papers/{wrong}").status_code, 404,
                )

    def test_a_name_that_is_not_hexadecimal_is_not_a_paper(self):
        for wrong in ("z" * 32, "-" * 32, "%" * 32, f"{A_PAPER[:31]}!"):
            with self.subTest(name=wrong):
                self.assertEqual(
                    self.client.get(f"/api/papers/{wrong}").status_code, 404,
                )

    def test_a_wildcard_is_matched_as_itself_and_finds_nothing(self):
        """The lookup is a range over the key, not a pattern: a name full of
        SQL wildcards is a name no paper has, not a name every paper has."""
        response = self.client.get(f"/api/papers/{'_' * 32}")
        self.assertEqual(response.status_code, 404)
        response = self.client.get(f"/api/papers/{'%' * 32}")
        self.assertEqual(response.status_code, 404)

    def test_a_name_no_paper_answers_to_is_not_found(self):
        self.assertEqual(
            self.client.get(f"/api/papers/{'c' * 32}").status_code, 404,
        )

    # ---------- one name, two papers ----------

    def test_two_papers_sharing_a_name_are_refused_not_guessed(self):
        """It takes crafted rows to reach this at 128 bits, which is the point:
        if it ever happens it is a bug, and answering with whichever row came
        back first would bury it under a page that looks fine."""
        with self.Session() as db:
            db.add(Paper(
                title="A paper whose name collides", file_path=f"{ITS_TWIN}.pdf",
                sha256=ITS_TWIN,
            ))
            db.commit()

        response = self.client.get(f"/api/papers/{A_PAPER[:32]}")
        self.assertEqual(response.status_code, 409)
        self.assertIn("more than one", response.json()["detail"])

        # Neither is reachable while they share a name: there is no longer
        # name to ask with, which is the cost of having only one shape, and
        # the crafted rows that would cause it are not a thing to design for.

    def test_the_resolver_says_so_rather_than_choosing(self):
        with self.Session() as db:
            db.add(Paper(
                title="A paper whose name collides", file_path=f"{ITS_TWIN}.pdf",
                sha256=ITS_TWIN,
            ))
            db.commit()
            with self.assertRaises(AmbiguousPaperName):
                paper_by_name(A_PAPER[:32], db)

    # ---------- the identity, which did not move ----------

    def test_a_blob_is_still_checked_against_the_whole_digest(self):
        """The line this change must not cross.

        A blob's name is not a name, it is a checksum of the bytes being
        handed over. Accepting half of one would halve the work of passing the
        check with a file that is not the file, so the short form stops at the
        door of anything that verifies content."""
        response = self.client.put(
            f"/api/sync/blobs/{A_PAPER[:32]}", content=b"not this paper's bytes",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("SHA-256", response.json()["detail"])

        # And the whole digest is checked against the bytes, not merely counted.
        response = self.client.put(
            f"/api/sync/blobs/{A_PAPER}", content=b"not this paper's bytes",
        )
        self.assertEqual(response.status_code, 422)
        self.assertIn("does not match", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
