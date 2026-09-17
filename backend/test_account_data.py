"""Leaving with your annotations, and leaving them behind.

Both paths walk every annotation a user has, and both were rewritten when
notes, ink and clips became one table. Neither had a test, which is the worst
combination for the two operations a user cannot retry: an export that
raises hands back nothing, and a deletion that misses rows leaves them.
"""

import json
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import account
from database import Base
from models import Annotation, Copy, Paper, Shelf, User
from services.papers import paper_name

PDF_HASH = "c" * 64


class AccountDataTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.Session = sessionmaker(bind=self.engine)
        Base.metadata.create_all(self.engine)
        with self.Session() as db:
            user = User(
                email="leaver@example.com", display_name="Ada", password_hash="unused",
            )
            other = User(
                email="stays@example.com", display_name="Grace", password_hash="unused",
            )
            db.add_all([user, other])
            db.commit()
            paper = Paper(
                title="On leaving", doi="10.1234/leave",
                file_path=f"{PDF_HASH}.pdf", sha256=PDF_HASH,
            )
            db.add(paper)
            db.commit()
            shelf = Shelf(user_uuid=user.uuid, name="Reading", color="#b3923d")
            db.add(shelf)
            db.commit()
            db.add_all([
                Copy(
                    paper_sha256=paper.sha256, user_uuid=user.uuid, shelf_uuid=shelf.uuid,
                ),
                Annotation(
                    kind="note", paper_sha256=paper.sha256, user_uuid=user.uuid,
                    page=4, content="Placed here",
                    name="Lemma 2",
                    body=json.dumps({"anchor": {"type": "point", "x": 0.2, "y": 0.8}}),
                ),
                Annotation(
                    kind="note", paper_sha256=paper.sha256, user_uuid=user.uuid,
                    content="About the paper", body="{}",
                ),
                Annotation(
                    kind="ink", paper_sha256=paper.sha256, user_uuid=user.uuid,
                    page=4,
                    body=json.dumps({
                        "points": [{"x": 0.1, "y": 0.2}, {"x": 0.4, "y": 0.2}],
                        "color": "#d92b1f", "width": 0.006,
                        "opacity": 0.8, "shape": "round",
                    }),
                ),
                Annotation(
                    kind="clip", paper_sha256=paper.sha256, user_uuid=user.uuid,
                    page=5,
                    body=json.dumps({
                        "source": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.2},
                        "frame": {"x": 0.5, "y": 0.5, "w": 0.3, "h": 0.2},
                        "floating": True,
                    }),
                ),
                # Another user's annotation on the same PDF, which must survive.
                Annotation(
                    kind="ink", paper_sha256=paper.sha256, user_uuid=other.uuid,
                    page=4,
                    body=json.dumps({
                        "points": [{"x": 0.9, "y": 0.9}], "color": "#b3923d",
                        "width": 0.004, "opacity": 1.0, "shape": "flat",
                    }),
                ),
            ])
            db.commit()
            self.user_uuid = user.uuid
            self.other_uuid = other.uuid

    def tearDown(self):
        self.engine.dispose()

    def user(self, db):
        return db.query(User).filter(User.uuid == self.user_uuid).one()

    def test_the_export_carries_every_kind_with_its_geometry(self):
        with self.Session() as db:
            data = account.gather(db, self.user(db))

        self.assertEqual(
            sorted(note["content"] for note in data["notes"]),
            ["About the paper", "Placed here"],
        )
        placed = next(n for n in data["notes"] if n["content"] == "Placed here")
        self.assertEqual(placed["page"], 4)
        self.assertEqual(placed["anchor"], {"type": "point", "x": 0.2, "y": 0.8})
        self.assertEqual(placed["name"], "Lemma 2")
        # A note never placed on a page says so rather than inventing a spot.
        unplaced = next(n for n in data["notes"] if n["content"] == "About the paper")
        self.assertIsNone(unplaced["anchor"])

        self.assertEqual(len(data["ink"]), 1)
        stroke = data["ink"][0]
        self.assertEqual(stroke["color"], "#d92b1f")
        self.assertEqual(stroke["shape"], "round")
        self.assertEqual(len(stroke["points"]), 2)

    def test_the_export_writes_a_readable_archive(self):
        with TemporaryDirectory() as workspace:
            root = Path(workspace)
            uploads = root / "uploads"
            uploads.mkdir()
            (uploads / f"{PDF_HASH}.pdf").write_bytes(b"%PDF-1.4\n%%EOF")
            boards = root / "boards"
            boards.mkdir()
            out = root / "export.zip"
            with self.Session() as db:
                account.write_zip(db, self.user(db), uploads, boards, out)

            with zipfile.ZipFile(out) as archive:
                names = {Path(name).name for name in archive.namelist()}
                self.assertIn("notes.json", names)
                self.assertIn("notes.md", names)
                self.assertIn("ink.json", names)
                body = next(
                    archive.read(name) for name in archive.namelist()
                    if name.endswith("notes.json")
                )
        self.assertEqual(len(json.loads(body)), 2)

    def test_closing_an_account_takes_every_annotation_and_no_one_elses(self):
        with TemporaryDirectory() as workspace, self.Session() as db:
            removed = account.tombstone(
                db, self.user(db), Path(workspace),
                eligible_hosts=lambda *_: [], notify=lambda *_: None,
            )
            db.commit()

        self.assertEqual(removed["annotations"], 4)
        with self.Session() as db:
            survivors = db.query(Annotation).all()
            self.assertEqual([row.user_uuid for row in survivors], [self.other_uuid])


if __name__ == "__main__":
    unittest.main()


class AnnotationChangeTests(unittest.TestCase):
    """A change names a few fields, so its shape is only known to be good
    once it has been merged with what is already stored."""

    def setUp(self):
        from fastapi.testclient import TestClient
        from auth import get_current_user
        from database import get_db
        import main

        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.Session = sessionmaker(bind=self.engine)
        Base.metadata.create_all(self.engine)
        with self.Session() as db:
            user = User(email="a@b.c", display_name="Ada", password_hash="unused")
            db.add(user)
            db.commit()
            paper = Paper(
                title="On changing an annotation",
                file_path=f"{PDF_HASH}.pdf", sha256=PDF_HASH,
            )
            db.add(paper)
            db.commit()
            shelf = Shelf(user_uuid=user.uuid, name="Reading", color="#b3923d")
            db.add(shelf)
            db.commit()
            db.add(Copy(
                paper_sha256=paper.sha256, user_uuid=user.uuid, shelf_uuid=shelf.uuid,
            ))
            db.commit()
            self.user_uuid, self.paper_sha256 = user.uuid, paper.sha256

        def test_db():
            with self.Session() as db:
                yield db

        def test_user():
            with self.Session() as db:
                return db.query(User).filter(User.uuid == self.user_uuid).one()

        self.main = main
        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = test_user
        self.client = TestClient(main.app)
        self._overrides = (get_db, get_current_user)

    def tearDown(self):
        for key in self._overrides:
            self.main.app.dependency_overrides.pop(key, None)
        self.engine.dispose()

    def stroke(self):
        made = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/annotations", json={
            "kind": "ink", "page": 1,
            "body": {
                "points": [{"x": 0.1, "y": 0.2}], "color": "#112233",
                "width": 0.005, "opacity": 0.9, "shape": "round",
            },
        })
        self.assertEqual(made.status_code, 200, made.text)
        return made.json()

    def test_a_move_carries_the_points_and_leaves_the_nib(self):
        moved = self.client.put(f"/api/annotations/{self.stroke()['uuid']}", json={
            "body": {"points": [{"x": 0.8, "y": 0.8}]},
        })

        self.assertEqual(moved.status_code, 200, moved.text)
        body = moved.json()["body"]
        self.assertEqual(body["points"], [{"x": 0.8, "y": 0.8}])
        self.assertEqual(body["color"], "#112233")
        self.assertEqual(body["shape"], "round")

    def test_a_change_that_would_break_the_shape_is_refused(self):
        refused = self.client.put(f"/api/annotations/{self.stroke()['uuid']}", json={
            "body": {"points": []},
        })

        # Not a 500: the client asked for something impossible, and is told so.
        self.assertEqual(refused.status_code, 422, refused.text)

    def test_a_refusal_is_reported_rather_than_thrown(self):
        # Pydantic puts the raised exception itself in a validation error's
        # context. Handing that to a JSON response turns a 422 into a 500
        # while it is being written out, so the context is left behind.
        refused = self.client.post(f"/api/papers/{paper_name(self.paper_sha256)}/annotations", json={
            "kind": "ink", "page": 1,
            "body": {"anchor": {"type": "point", "x": 0.1, "y": 0.1}},
        })
        self.assertEqual(refused.status_code, 422, refused.text)
        self.assertIsInstance(refused.json()["detail"], list)

        moved = self.client.put(f"/api/annotations/{self.stroke()['uuid']}", json={
            "body": {"points": [{"x": 9, "y": 9}]},
        })
        self.assertEqual(moved.status_code, 422, moved.text)
        # Readable, and free of anything a JSON encoder would choke on.
        self.assertTrue(all(isinstance(item, dict) for item in moved.json()["detail"]))
