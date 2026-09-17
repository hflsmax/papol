import unittest
from unittest.mock import AsyncMock, patch

import main
from auth import get_current_user, get_optional_user
from database import Base, get_db
from fastapi import HTTPException
from fastapi.testclient import TestClient
from models import Copy, Paper, PaperReference, Shelf, User
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from services.papers import paper_name

HASH = "c" * 64


class ReferencePreviewTests(unittest.TestCase):
    """Registering a citation read off the page must not give a paper a
    second row for a reference the analyzer already read."""

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

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = signed_in_user
        main.app.dependency_overrides[get_optional_user] = signed_in_user
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
            db.add(user)
            db.commit()
            type(self).current_user_uuid = user.uuid

            paper = Paper(
                title="KinetiX", doi="10.1234/kinetix",
                file_path=f"{HASH}.pdf", sha256=HASH, references_status="ready",
            )
            db.add(paper)
            db.commit()
            shelf = Shelf(user_uuid=user.uuid, name="Reading", color="#b3923d")
            db.add(shelf)
            db.commit()
            db.add(Copy(
                paper_sha256=paper.sha256, user_uuid=user.uuid, shelf_uuid=shelf.uuid,
            ))
            # GROBID's own reading: entry 27 is printed as "[27]" and named
            # "b26", because its rows count from zero.
            db.add_all([
                PaperReference(
                    paper_sha256=paper.sha256, key=f"b{index}", index=index,
                    raw=f"Entry {index + 1} as the analyzer read it.",
                )
                for index in range(27)
            ])
            db.commit()
            type(self).paper_sha256 = paper.sha256

    def preview(self, key, raw):
        with patch.object(
            main, "resolve_reference", AsyncMock(side_effect=lambda ref: main.reference_out(ref)),
        ):
            return self.client.post(
                f"/api/papers/{paper_name(self.paper_sha256)}/references/preview",
                json={"key": key, "raw": raw},
            )

    def test_numbered_key_finds_the_entry_the_analyzer_already_read(self):
        response = self.preview("27", "Coumans E. Bullet physics simulation.")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["key"], "b26")
        with self.Session() as db:
            rows = db.query(PaperReference).filter(
                PaperReference.paper_sha256 == self.paper_sha256,
            ).count()
        self.assertEqual(rows, 27, "no second row for an entry already held")
        self.assertEqual(
            response.json()["raw"], "Entry 27 as the analyzer read it.",
            "the analyzer's reading is the better one and stands",
        )

    def test_an_unnumbered_key_is_still_registered(self):
        response = self.preview("knuth74", "Knuth D. The art of computer programming.")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["key"], "knuth74")
        with self.Session() as db:
            rows = db.query(PaperReference).filter(
                PaperReference.paper_sha256 == self.paper_sha256,
            ).count()
        self.assertEqual(rows, 28)


if __name__ == "__main__":
    unittest.main()
