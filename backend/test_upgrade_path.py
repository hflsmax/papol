"""What happens to a database that already exists.

Every other suite builds its schema with `create_all`, which produces today's
shape from today's models. That answers "does the code work against the schema
it expects" and never "does a reader's existing database survive the upgrade" —
so a migration that drops every annotation on the floor passes all of them.

These tests start from the shape the last release actually wrote and run
`migrate()` over it, which is the only way that question gets asked.
"""
import os
import sqlite3
import tempfile
import unittest
import uuid

# The schema as it stood before notes, ink and clips were unified and before
# visibility moved onto the shelf. Trimmed to the tables these tests touch.
PREVIOUS_RELEASE = """
CREATE TABLE papers (
  uuid TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE paper_editions (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL,
  file_path TEXT NOT NULL, sha256 TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE TABLE shelves (
  uuid TEXT PRIMARY KEY NOT NULL, user_uuid TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE copies (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  shelf_uuid TEXT, edition_uuid TEXT, edition_sha256 TEXT,
  ignored_edition_uuid TEXT, summary TEXT, thought TEXT,
  marketed INTEGER NOT NULL DEFAULT 0, is_author INTEGER NOT NULL DEFAULT 0,
  rating_expertise INTEGER, rating_reading INTEGER, rating_liking INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE comments (
  uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL, edition_uuid TEXT,
  user_uuid TEXT NOT NULL, page INTEGER, content TEXT NOT NULL DEFAULT '',
  anchor_type TEXT, anchor TEXT, name TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE ink_strokes (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL, group_uuid TEXT, points TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#b3923d', width REAL NOT NULL DEFAULT 0.004,
  opacity REAL NOT NULL DEFAULT 1.0, shape TEXT NOT NULL DEFAULT 'flat',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE paper_clips (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL, user_uuid TEXT NOT NULL,
  page INTEGER NOT NULL, source TEXT NOT NULL, frame TEXT NOT NULL,
  floating INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
"""

NOW = "2026-09-15T12:00:00"


def _uuid():
    return str(uuid.uuid4())


class UpgradeFromPreviousReleaseTests(unittest.TestCase):
    """Run the real `migrate()` against the real previous schema."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "papol.db")
        self.seed()

    def seed(self):
        """One reader, a public shelf and a private one, and a mark of each kind."""
        db = sqlite3.connect(self.path)
        db.executescript(PREVIOUS_RELEASE)
        self.user = _uuid()
        self.paper = _uuid()
        self.edition = _uuid()
        self.public_shelf, self.private_shelf = _uuid(), _uuid()
        self.note, self.ink, self.clip = _uuid(), _uuid(), _uuid()
        self.shown_copy, self.hidden_copy = _uuid(), _uuid()
        other_paper = _uuid()

        db.execute("INSERT INTO papers VALUES (?,?,?,?,1,NULL)",
                   (self.paper, "Shown", NOW, NOW))
        db.execute("INSERT INTO papers VALUES (?,?,?,?,1,NULL)",
                   (other_paper, "Hidden", NOW, NOW))
        db.execute("INSERT INTO paper_editions VALUES (?,?,?,?,?,?,1,NULL)",
                   (self.edition, self.paper, "a.pdf", "a" * 64, NOW, NOW))
        db.execute("INSERT INTO shelves VALUES (?,?,?,?,1,1,0,?,?,0,NULL)",
                   (self.public_shelf, self.user, "Display", "#7ba26c", NOW, NOW))
        db.execute("INSERT INTO shelves VALUES (?,?,?,?,0,0,1,?,?,0,NULL)",
                   (self.private_shelf, self.user, "Personal", "#2b4a6f", NOW, NOW))
        db.execute(
            "INSERT INTO copies VALUES (?,?,?,?,?,?,NULL,NULL,NULL,1,0,"
            "NULL,NULL,NULL,?,?,0,NULL)",
            (self.shown_copy, self.paper, self.user, self.public_shelf,
             self.edition, "a" * 64, NOW, NOW))
        db.execute(
            "INSERT INTO copies VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,0,0,"
            "NULL,NULL,NULL,?,?,0,NULL)",
            (self.hidden_copy, other_paper, self.user, self.private_shelf, NOW, NOW))

        db.execute(
            "INSERT INTO comments VALUES (?,?,?,?,2,?,'point',?,?,?,?,0,NULL)",
            (self.note, self.paper, self.edition, self.user, "On the page",
             '{"x":0.25,"y":0.5}', "Lemma 3", NOW, NOW))
        db.execute(
            "INSERT INTO ink_strokes VALUES (?,?,?,3,NULL,?,'#b3923d',0.004,1.0,"
            "'flat',?,?,0,NULL)",
            (self.ink, self.edition, self.user, '[[0.1,0.1],[0.2,0.2]]', NOW, NOW))
        db.execute(
            "INSERT INTO paper_clips VALUES (?,?,?,4,?,?,0,?,?,0,NULL)",
            (self.clip, self.edition, self.user,
             '{"page":4}', '{"x":0,"y":0,"w":1,"h":1}', NOW, NOW))
        db.commit()
        db.close()

    def upgrade(self):
        """Exactly what a server start does to an existing database."""
        os.environ["DATABASE_URL"] = f"sqlite:///{self.path}"
        for name in ("database", "models"):
            import sys
            sys.modules.pop(name, None)
        import database
        import models  # noqa: F401  (registers the models on the metadata)
        database.migrate()
        database.Base.metadata.create_all(bind=database.engine)
        database.engine.dispose()

    def rows(self, query, *args):
        db = sqlite3.connect(self.path)
        try:
            return db.execute(query, args).fetchall()
        finally:
            db.close()

    # --- annotations -------------------------------------------------------

    def test_every_mark_survives_the_move_into_one_table(self):
        self.upgrade()
        carried = {row[0]: row[1] for row in self.rows("SELECT uuid, kind FROM annotations")}
        self.assertEqual(
            carried,
            {self.note: "note", self.ink: "ink", self.clip: "clip"},
            "a reader's notes, ink and clips must all arrive, under their own uuids",
        )

    def test_a_mark_keeps_what_makes_it_readable(self):
        self.upgrade()
        note, ink, clip = (
            self.rows(
                "SELECT page, content, name, body FROM annotations WHERE uuid=?", which,
            )[0]
            for which in (self.note, self.ink, self.clip)
        )
        self.assertEqual((note[0], note[1], note[2]), (2, "On the page", "Lemma 3"))
        # The anchor's kind moves inside the anchor, where it belongs.
        self.assertIn('"type":"point"', note[3].replace(" ", ""))
        self.assertIn('"points"', ink[3])
        self.assertIn('"frame"', clip[3])

    def test_the_tables_it_replaced_are_gone(self):
        self.upgrade()
        left = self.rows(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name IN ('comments','ink_strokes','paper_clips')"
        )
        self.assertEqual(left, [], "nothing should still read the old tables")

    def test_upgrading_twice_changes_nothing(self):
        self.upgrade()
        once = self.rows("SELECT uuid, kind, body FROM annotations ORDER BY uuid")
        self.upgrade()
        self.assertEqual(self.rows("SELECT uuid, kind, body FROM annotations ORDER BY uuid"), once)

    # --- visibility --------------------------------------------------------

    def test_a_copy_stops_carrying_its_own_visibility(self):
        self.upgrade()
        columns = {row[1] for row in self.rows("PRAGMA table_info(copies)")}
        self.assertNotIn("marketed", columns)
        self.assertNotIn("is_public", columns)

    def test_who_can_see_what_does_not_move(self):
        """The shelf has to give back the answer the column used to hold."""
        before = dict(self.rows("SELECT uuid, marketed FROM copies"))
        self.upgrade()
        after = dict(self.rows(
            "SELECT c.uuid, COALESCE(s.is_public, 0) FROM copies c "
            "LEFT JOIN shelves s ON s.uuid = c.shelf_uuid"
        ))
        self.assertEqual(after, before)
        self.assertEqual(after[self.shown_copy], 1)
        self.assertEqual(after[self.hidden_copy], 0)


class FreshInstallTests(unittest.TestCase):
    def test_a_database_that_never_had_the_old_tables_upgrades_quietly(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "papol.db")
        os.environ["DATABASE_URL"] = f"sqlite:///{path}"
        import sys
        for name in ("database", "models"):
            sys.modules.pop(name, None)
        import database
        import models  # noqa: F401
        database.migrate()
        database.Base.metadata.create_all(bind=database.engine)
        database.migrate()  # and again, on a database it has already seen
        database.engine.dispose()

        db = sqlite3.connect(path)
        try:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM annotations").fetchone()[0], 0)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
