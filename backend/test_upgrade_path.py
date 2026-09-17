"""What happens to a database that already exists.

Every other suite builds its schema with `create_all`, which produces today's
shape from today's models. That answers "does the code work against the schema
it expects" and never "does a user's existing database survive the upgrade" —
so a migration that drops every annotation on the floor passes all of them.

These tests start from the shape the last release actually wrote and run
`migrate()` over it, which is the only way that question gets asked.
"""
import os
import sqlite3
import tempfile
import unittest
import uuid

# The schema as it stood before notes, ink and clips were unified, before
# visibility moved onto the shelf, and while a paper could have several
# editions. Trimmed to the tables these tests touch.
PREVIOUS_RELEASE = """
CREATE TABLE papers (
  uuid TEXT PRIMARY KEY NOT NULL, doi TEXT, title TEXT NOT NULL,
  authors TEXT, journal TEXT, year INTEGER,
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
CREATE TABLE tags (
  uuid TEXT PRIMARY KEY NOT NULL, user_uuid TEXT NOT NULL, name TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
);
CREATE TABLE copy_tags (
  uuid TEXT PRIMARY KEY NOT NULL, copy_uuid TEXT NOT NULL, tag_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT,
  UNIQUE(copy_uuid, tag_uuid)
);
CREATE TABLE sharables (
  uuid TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL DEFAULT 'lean',
  user_uuid TEXT, paper_uuid TEXT NOT NULL, edition_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE edition_references (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL,
  key TEXT NOT NULL, "index" INTEGER NOT NULL, raw TEXT, title TEXT,
  authors TEXT, year INTEGER, journal TEXT, doi TEXT, arxiv_id TEXT,
  page INTEGER, y REAL, resolved_status TEXT, resolved_at TEXT, resolution TEXT
);
CREATE TABLE edition_citations (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL,
  reference_uuid TEXT, label TEXT, page INTEGER NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  inferred INTEGER DEFAULT 0
);
CREATE TABLE edition_links (
  uuid TEXT PRIMARY KEY NOT NULL, edition_uuid TEXT NOT NULL, kind TEXT NOT NULL,
  label TEXT, page INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
  w REAL NOT NULL, h REAL NOT NULL,
  target_page INTEGER NOT NULL, target_y REAL NOT NULL
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
        """One user, a public shelf and a private one, and an annotation of each kind.

        The shown paper has two editions: the one the user reads, and a newer
        one nobody took. Folding editions away has to make two papers of them
        and leave the copy on the file it was reading.

        A third paper holds the very file the shown one does — the pair the
        old DOI-keyed upload path could leave behind — with a copy of its own,
        so the merge has something to close.
        """
        db = sqlite3.connect(self.path)
        db.executescript(PREVIOUS_RELEASE)
        self.user = _uuid()
        self.paper = _uuid()
        self.edition = _uuid()
        self.newer_edition = _uuid()
        self.public_shelf, self.private_shelf = _uuid(), _uuid()
        self.note, self.ink, self.clip = _uuid(), _uuid(), _uuid()
        self.shown_copy, self.hidden_copy = _uuid(), _uuid()
        self.sharable, self.reference, self.citation, self.link = (
            _uuid(), _uuid(), _uuid(), _uuid(),
        )
        self.twin_paper, self.twin_edition, self.twin_copy = _uuid(), _uuid(), _uuid()
        self.tag, self.copy_tag = _uuid(), _uuid()
        other_paper = _uuid()

        db.execute("INSERT INTO papers VALUES (?,?,?,?,?,?,?,?,1,NULL)",
                   (self.paper, "10.1/shown", "Shown", '["Ada"]', "A journal",
                    2026, NOW, NOW))
        db.execute("INSERT INTO papers VALUES (?,NULL,?,NULL,NULL,NULL,?,?,1,NULL)",
                   (other_paper, "Hidden", NOW, NOW))
        db.execute("INSERT INTO paper_editions VALUES (?,?,?,?,?,?,1,NULL)",
                   (self.edition, self.paper, "a.pdf", "a" * 64, NOW, NOW))
        # Every paper had a PDF under it; the hidden one is no exception.
        db.execute("INSERT INTO paper_editions VALUES (?,?,?,?,?,?,1,NULL)",
                   (_uuid(), other_paper, "c.pdf", "c" * 64, NOW, NOW))
        db.execute("INSERT INTO paper_editions VALUES (?,?,?,?,?,?,1,NULL)",
                   (self.newer_edition, self.paper, "b.pdf", "b" * 64,
                    "2026-09-16T12:00:00", "2026-09-16T12:00:00"))
        db.execute("INSERT INTO sharables VALUES (?,'rich',?,?,?,?,NULL)",
                   (self.sharable, self.user, self.paper, self.edition, NOW))
        db.execute(
            "INSERT INTO edition_references VALUES "
            "(?,?,'b0',0,'Printed line',NULL,NULL,NULL,NULL,NULL,NULL,"
            "NULL,NULL,NULL,NULL,NULL)",
            (self.reference, self.edition))
        db.execute(
            "INSERT INTO edition_citations VALUES (?,?,?,'[1]',2,0.1,0.2,0.05,0.02,0)",
            (self.citation, self.edition, self.reference))
        db.execute(
            "INSERT INTO edition_links VALUES (?,?,'figure','Fig 1',2,0.1,0.2,"
            "0.05,0.02,7,0.4)",
            (self.link, self.edition))
        # The same bytes, written down a second time under another title.
        db.execute("INSERT INTO papers VALUES (?,?,?,?,?,?,?,?,1,NULL)",
                   (self.twin_paper, "10.1/shown", "Shown, again", '["Ada"]',
                    "A journal", 2026, "2026-09-17T12:00:00", "2026-09-17T12:00:00"))
        db.execute("INSERT INTO paper_editions VALUES (?,?,?,?,?,?,1,NULL)",
                   (self.twin_edition, self.twin_paper, "a.pdf", "a" * 64,
                    "2026-09-17T12:00:00", "2026-09-17T12:00:00"))
        db.execute("INSERT INTO tags VALUES (?,?,?,?,?,0,NULL)",
                   (self.tag, self.user, "Consensus", NOW, NOW))
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
        # The same user's copy of the twin, carrying what their other copy of
        # that file does not: a summary, a rating, and a tag.
        db.execute(
            "INSERT INTO copies VALUES (?,?,?,?,?,?,NULL,?,NULL,1,1,?,"
            "NULL,NULL,?,?,0,NULL)",
            (self.twin_copy, self.twin_paper, self.user, self.private_shelf,
             self.twin_edition, "a" * 64, "Worth rereading", 4,
             "2026-09-17T12:00:00", "2026-09-17T12:00:00"))
        db.execute("INSERT INTO copy_tags VALUES (?,?,?,?,?,?,0,NULL)",
                   (self.copy_tag, self.twin_copy, self.tag, self.user, NOW, NOW))

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
            "a user's notes, ink and clips must all arrive, under their own uuids",
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
        papers = self.rows("SELECT uuid, sha256 FROM papers ORDER BY uuid")
        self.upgrade()
        self.assertEqual(self.rows("SELECT uuid, kind, body FROM annotations ORDER BY uuid"), once)
        self.assertEqual(self.rows("SELECT uuid, sha256 FROM papers ORDER BY uuid"), papers)

    # --- editions ----------------------------------------------------------

    def test_the_editions_table_is_gone(self):
        self.upgrade()
        self.assertEqual(
            self.rows(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name='paper_editions'"
            ),
            [],
        )

    def test_a_paper_carries_its_own_file(self):
        self.upgrade()
        columns = {row[1] for row in self.rows("PRAGMA table_info(papers)")}
        self.assertIn("file_path", columns)
        self.assertIn("sha256", columns)
        self.assertEqual(
            self.rows("SELECT file_path, sha256 FROM papers WHERE uuid=?", self.paper),
            [("a.pdf", "a" * 64)],
            "the paper keeps its uuid and takes on its first file",
        )

    def test_each_edition_becomes_a_paper_of_its_own(self):
        self.upgrade()
        made = self.rows(
            "SELECT uuid, title, doi, authors, journal, year FROM papers "
            "WHERE sha256=?", "b" * 64,
        )
        self.assertEqual(len(made), 1, "the newer PDF must become a paper")
        self.assertNotEqual(made[0][0], self.paper, "and a different one")
        self.assertEqual(
            made[0][1:],
            ("Shown", "10.1/shown", '["Ada"]', "A journal", 2026),
            "cloning the metadata it shared",
        )

    def test_a_copy_stays_on_the_file_it_was_reading(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT paper_uuid FROM copies WHERE uuid=?", self.shown_copy),
            [(self.paper,)],
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(copies)")}
        for gone in ("edition_uuid", "edition_sha256", "ignored_edition_uuid"):
            self.assertNotIn(gone, columns)

    def test_every_mark_stays_on_the_file_it_was_made_on(self):
        self.upgrade()
        self.assertEqual(
            sorted(row[0] for row in self.rows(
                "SELECT uuid FROM annotations WHERE paper_uuid=?", self.paper,
            )),
            sorted([self.note, self.ink, self.clip]),
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(annotations)")}
        self.assertNotIn("edition_uuid", columns)

    def test_a_link_opens_the_paper_the_file_became(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT paper_uuid FROM sharables WHERE uuid=?", self.sharable),
            [(self.paper,)],
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(sharables)")}
        self.assertNotIn("edition_uuid", columns)

    # --- one paper per file ------------------------------------------------

    def test_two_papers_on_one_file_become_one(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT uuid FROM papers WHERE sha256=?", "a" * 64),
            [(self.paper,)],
            "the earlier row survives and the later one is gone",
        )
        self.assertEqual(
            self.rows("SELECT sha256 FROM papers GROUP BY sha256 HAVING COUNT(*) > 1"),
            [],
            "no two papers may hold the same bytes",
        )

    def test_a_user_holding_both_rows_keeps_one_copy_and_loses_nothing(self):
        self.upgrade()
        kept = self.rows(
            "SELECT uuid, summary, is_author, rating_expertise FROM copies "
            "WHERE paper_uuid=? AND user_uuid=?", self.paper, self.user,
        )
        self.assertEqual(len(kept), 1, "one paper, one copy")
        uuid, summary, is_author, expertise = kept[0]
        self.assertEqual(uuid, self.shown_copy, "the copy on the survivor is kept")
        # What only the other copy carried came across rather than being lost.
        self.assertEqual(summary, "Worth rereading")
        self.assertEqual(is_author, 1)
        self.assertEqual(expertise, 4)
        self.assertEqual(
            self.rows("SELECT uuid FROM copies WHERE uuid=?", self.twin_copy), [],
        )

    def test_the_digest_becomes_unique(self):
        """The rule stops being the writer's to remember."""
        self.upgrade()
        unique = {
            row[1]: row[2]
            for row in self.rows("PRAGMA index_list(papers)")
        }
        self.assertEqual(unique.get("ix_papers_sha256"), 1)

        import sqlite3 as _sqlite3
        db = _sqlite3.connect(self.path)
        try:
            with self.assertRaises(_sqlite3.IntegrityError):
                db.execute(
                    "INSERT INTO papers (uuid, title, sha256, created_at, updated_at,"
                    " revision) VALUES (?,?,?,?,?,1)",
                    (_uuid(), "A third try at the same file", "a" * 64, NOW, NOW),
                )
        finally:
            db.close()

    def test_a_paper_must_have_a_file(self):
        """A paper is its PDF, so the columns that say which stop being
        optional once every row has answered."""
        self.upgrade()
        required = {
            row[1]: row[3] for row in self.rows("PRAGMA table_info(papers)")
        }
        self.assertEqual(required["file_path"], 1)
        self.assertEqual(required["sha256"], 1)

        db = sqlite3.connect(self.path)
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    "INSERT INTO papers (uuid, title, created_at, updated_at,"
                    " revision) VALUES (?,?,?,?,1)",
                    (_uuid(), "No file at all", NOW, NOW),
                )
        finally:
            db.close()

    def test_a_paper_with_no_file_leaves_the_columns_alone(self):
        """The bytes are what would say what the digest is, and they may be
        long gone. Such a row is reported rather than guessed at, and the
        service starts rather than refusing to."""
        with sqlite3.connect(self.path) as db:
            for title in ("Stored before a file was required", "So was this one"):
                db.execute(
                    "INSERT INTO papers VALUES (?,NULL,?,NULL,NULL,NULL,?,?,1,NULL)",
                    (_uuid(), title, NOW, NOW),
                )
        self.upgrade()
        optional = {
            row[1]: row[3] for row in self.rows("PRAGMA table_info(papers)")
        }
        self.assertEqual(optional["sha256"], 0, "the column has to wait")
        # Nothing was dropped to make the constraint fit, and the two of them
        # sit together: NULL is not a digest, so they are not duplicates.
        self.assertEqual(
            self.rows("SELECT COUNT(*) FROM papers WHERE sha256 IS NULL")[0][0], 2,
        )

    def test_a_tag_follows_the_copy_it_was_on(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT copy_uuid FROM copy_tags WHERE uuid=?", self.copy_tag),
            [(self.shown_copy,)],
        )

    def test_a_merged_copy_is_not_replayed_to_a_replica(self):
        """A desktop still behind the cursor must not put back a copy of a
        paper that no longer exists, so the log entries go with the rows."""
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE _server_change_log ("
                "  sequence INTEGER PRIMARY KEY AUTOINCREMENT, user_uuid TEXT NOT NULL,"
                "  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL,"
                "  revision INTEGER NOT NULL, operation TEXT NOT NULL,"
                "  row_json TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            for table, row_uuid in (
                ("copies", self.twin_copy),
                ("copy_tags", self.copy_tag),
                ("copies", self.shown_copy),
            ):
                db.execute(
                    "INSERT INTO _server_change_log"
                    "  (user_uuid, table_name, row_uuid, revision, operation,"
                    "   row_json, created_at) VALUES (?,?,?,1,'upsert','{}',?)",
                    (self.user, table, row_uuid, NOW),
                )
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT row_uuid FROM _server_change_log WHERE row_uuid=?",
                      self.twin_copy),
            [],
        )
        self.assertEqual(
            self.rows("SELECT row_uuid FROM _server_change_log WHERE row_uuid=?",
                      self.copy_tag),
            [],
        )
        # The surviving copy's own history is untouched.
        self.assertEqual(
            len(self.rows("SELECT row_uuid FROM _server_change_log WHERE row_uuid=?",
                          self.shown_copy)),
            1,
        )

    def test_the_bibliography_follows_its_file(self):
        self.upgrade()
        for table, row_uuid in (
            ("paper_references", self.reference),
            ("paper_citations", self.citation),
            ("paper_links", self.link),
        ):
            self.assertEqual(
                self.rows(f"SELECT paper_uuid FROM {table} WHERE uuid=?", row_uuid),
                [(self.paper,)],
                f"{table} did not come across",
            )
        self.assertEqual(
            self.rows(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN "
                "('edition_references','edition_citations','edition_links')"
            ),
            [],
        )
        # A citation still leads to the entry it points at.
        self.assertEqual(
            self.rows(
                "SELECT reference_uuid FROM paper_citations WHERE uuid=?", self.citation,
            ),
            [(self.reference,)],
        )

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
        # A copy merged into another has no "after" of its own; the question
        # is whether the copies that survive answer as they did.
        self.assertEqual(after, {uuid: was for uuid, was in before.items() if uuid in after})
        self.assertNotIn(self.twin_copy, after)
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
