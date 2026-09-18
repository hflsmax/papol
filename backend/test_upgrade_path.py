"""What happens to a database that already exists.

Every other suite builds its schema with `create_all`, which produces today's
shape from today's models. That answers "does the code work against the schema
it expects" and never "does a user's existing database survive the upgrade" —
so a migration that drops every annotation on the floor passes all of them.

These tests start from the shape the last release actually wrote and run
`migrate()` over it, which is the only way that question gets asked.
"""
import json
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
        # What the shown paper is keyed by once the migration has run.
        self.shown_file, self.newer_file = "a" * 64, "b" * 64
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
        papers = self.rows("SELECT sha256 FROM papers ORDER BY sha256")
        self.upgrade()
        self.assertEqual(self.rows("SELECT uuid, kind, body FROM annotations ORDER BY uuid"), once)
        self.assertEqual(self.rows("SELECT sha256 FROM papers ORDER BY sha256"), papers)

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
            self.rows("SELECT file_path FROM papers WHERE sha256=?", self.shown_file),
            [("a.pdf",)],
            "the paper is keyed by the first file it had",
        )

    def test_each_edition_becomes_a_paper_of_its_own(self):
        self.upgrade()
        made = self.rows(
            "SELECT sha256, title, doi, authors, journal, year FROM papers "
            "WHERE sha256=?", self.newer_file,
        )
        self.assertEqual(len(made), 1, "the newer PDF must become a paper")
        self.assertNotEqual(made[0][0], self.shown_file, "and a different one")
        self.assertEqual(
            made[0][1:],
            ("Shown", "10.1/shown", '["Ada"]', "A journal", 2026),
            "cloning the metadata it shared",
        )

    def test_a_copy_stays_on_the_file_it_was_reading(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT paper_sha256 FROM copies WHERE uuid=?", self.shown_copy),
            [(self.shown_file,)],
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(copies)")}
        for gone in ("edition_uuid", "edition_sha256", "ignored_edition_uuid"):
            self.assertNotIn(gone, columns)

    def test_every_mark_stays_on_the_file_it_was_made_on(self):
        self.upgrade()
        self.assertEqual(
            sorted(row[0] for row in self.rows(
                "SELECT uuid FROM annotations WHERE paper_sha256=?", self.shown_file,
            )),
            sorted([self.note, self.ink, self.clip]),
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(annotations)")}
        self.assertNotIn("edition_uuid", columns)

    def test_a_link_opens_the_paper_the_file_became(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT paper_sha256 FROM sharables WHERE uuid=?", self.sharable),
            [(self.shown_file,)],
        )
        columns = {row[1] for row in self.rows("PRAGMA table_info(sharables)")}
        self.assertNotIn("edition_uuid", columns)

    # --- one paper per file ------------------------------------------------

    def test_two_papers_on_one_file_become_one(self):
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT COUNT(*) FROM papers WHERE sha256=?", self.shown_file),
            [(1,)],
            "the two rows on that file are one",
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
            "WHERE paper_sha256=? AND user_uuid=?", self.shown_file, self.user,
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

    def test_the_digest_becomes_the_key(self):
        """The rule stops being the writer's to remember: one file, one row,
        because the file is what names the row."""
        self.upgrade()
        columns = {row[1]: row for row in self.rows("PRAGMA table_info(papers)")}
        self.assertNotIn("uuid", columns, "a paper has one name, not two")
        self.assertEqual(columns["sha256"][5], 1, "and it is the digest")

        db = sqlite3.connect(self.path)
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    "INSERT INTO papers (sha256, title, file_path, created_at,"
                    " updated_at, revision) VALUES (?,?,?,?,?,1)",
                    (self.shown_file, "A third try at the same file",
                     "a.pdf", NOW, NOW),
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
                    "INSERT INTO papers (sha256, title, created_at, updated_at,"
                    " revision) VALUES (?,?,?,?,1)",
                    ("f" * 64, "No file at all", NOW, NOW),
                )
        finally:
            db.close()

    def test_a_paper_with_no_file_stops_the_upgrade_and_says_which(self):
        """A paper is its PDF and is keyed by it, so a row with no digest has
        no name under the new schema — and nothing here can give it one.

        Better to say so while someone can still fix it than to start and
        fail every request afterwards."""
        stranded = _uuid()
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT INTO papers VALUES (?,NULL,?,NULL,NULL,NULL,?,?,1,NULL)",
                (stranded, "Stored before a file was required", NOW, NOW),
            )
        with self.assertRaises(RuntimeError) as refused:
            self.upgrade()
        self.assertIn(stranded, str(refused.exception), "it has to name the row")
        self.assertIn("sha256", str(refused.exception), "and say what is missing")
        # The database is left as it was, for the fixing.
        columns = {row[1] for row in self.rows("PRAGMA table_info(papers)")}
        self.assertIn("uuid", columns)

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

    def test_a_change_written_under_the_old_shape_is_not_replayed(self):
        """A replica applies a pulled change by name, and refuses a page that
        names a column its table has not got — without advancing its cursor.

        So a change written before this migration is one no upgraded
        installation could ever get past: it would stop synchronizing for
        good on its first pull. Those entries go, and the snapshot that
        precedes every pull carries the same state instead."""
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE _server_change_log ("
                "  sequence INTEGER PRIMARY KEY AUTOINCREMENT, user_uuid TEXT NOT NULL,"
                "  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL,"
                "  revision INTEGER NOT NULL, operation TEXT NOT NULL,"
                "  row_json TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            written = {
                # A copy and a note as the previous release wrote them down:
                # naming their paper by its UUID, and pinned to an edition.
                "copies": {
                    "uuid": self.shown_copy, "paper_uuid": self.paper,
                    "user_uuid": self.user, "shelf_uuid": self.public_shelf,
                    "edition_uuid": self.edition, "edition_sha256": self.shown_file,
                    "ignored_edition_uuid": None, "summary": None, "thought": None,
                    "is_author": False, "rating_expertise": None,
                    "rating_reading": None, "rating_liking": None,
                    "created_at": NOW, "updated_at": NOW, "revision": 1,
                    "deleted_at": None,
                },
                "annotations": {
                    "uuid": self.note, "kind": "note", "user_uuid": self.user,
                    "paper_uuid": self.paper, "edition_uuid": self.edition,
                    "page": 2, "group_uuid": None, "content": "On the page",
                    "name": "Lemma 3", "body": "{}", "created_at": NOW,
                    "updated_at": NOW, "revision": 1, "deleted_at": None,
                },
                # A table that stopped existing two migrations ago. A replica
                # refuses this one even sooner: it is not a table it knows.
                "comments": {
                    "uuid": self.note, "paper_uuid": self.paper,
                    "user_uuid": self.user, "page": 2, "content": "On the page",
                    "created_at": NOW, "updated_at": NOW, "revision": 1,
                    "deleted_at": None,
                },
                # And one that survives every rename between then and now.
                "shelves": {
                    "uuid": self.public_shelf, "user_uuid": self.user,
                    "name": "Display", "color": "#7ba26c", "is_public": True,
                    "is_default": True, "position": 0, "created_at": NOW,
                    "updated_at": NOW, "revision": 1, "deleted_at": None,
                },
            }
            for table_name, row in written.items():
                db.execute(
                    "INSERT INTO _server_change_log"
                    "  (user_uuid, table_name, row_uuid, revision, operation,"
                    "   row_json, created_at) VALUES (?,?,?,1,'upsert',?,?)",
                    (self.user, table_name, row["uuid"], json.dumps(row), NOW),
                )
        self.upgrade()

        import models  # the shape every surviving entry is judged against
        columns = {
            name: {column.name for column in table.columns}
            for name, table in models.Base.metadata.tables.items()
        }
        left = self.rows("SELECT table_name, row_json FROM _server_change_log")
        self.assertEqual(
            [table_name for table_name, _ in left], ["shelves"],
            "only a change the upgraded replica can still read may stay",
        )
        for table_name, row_json in left:
            self.assertLessEqual(
                set(json.loads(row_json)), columns[table_name],
                f"a {table_name} change still names a column that is gone",
            )

    def test_the_bibliography_follows_its_file(self):
        self.upgrade()
        for table, row_uuid in (
            ("paper_references", self.reference),
            ("paper_citations", self.citation),
            ("paper_links", self.link),
        ):
            self.assertEqual(
                self.rows(f"SELECT paper_sha256 FROM {table} WHERE uuid=?", row_uuid),
                [(self.shown_file,)],
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

    # --- seminars ----------------------------------------------------------

    def seed_seminars(self):
        """Three seminars under the keys a seminar used to be filed by.

        The shown paper carries a DOI, so its key was the DOI; the hidden
        one has none, so its key was its title. Both spellings have to find
        their paper. The third names nothing at all."""
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE rooms ("
                "  uuid TEXT PRIMARY KEY NOT NULL, paper_key TEXT NOT NULL,"
                "  paper_title TEXT NOT NULL, created_by TEXT NOT NULL,"
                "  leader_uuid TEXT, status TEXT NOT NULL, scheduled_time TEXT,"
                "  platform TEXT, style TEXT, style_desc TEXT, created_at TEXT)"
            )
            db.execute(
                "CREATE TABLE room_messages ("
                "  uuid TEXT PRIMARY KEY NOT NULL, room_uuid TEXT NOT NULL,"
                "  user_uuid TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT)"
            )
            self.by_title, self.by_doi, self.stranded = _uuid(), _uuid(), _uuid()
            for room_uuid, key in (
                (self.by_title, "title:hidden"),
                (self.by_doi, "doi:10.1/shown"),
                (self.stranded, "title:a paper nobody has"),
            ):
                db.execute(
                    "INSERT INTO rooms (uuid, paper_key, paper_title, created_by,"
                    "  status, created_at) VALUES (?,?,'Whatever',?,'open',?)",
                    (room_uuid, key, self.user, NOW),
                )
                db.execute(
                    "INSERT INTO room_messages VALUES (?,?,?,'hello',?)",
                    (_uuid(), room_uuid, self.user, NOW),
                )

    def test_a_seminar_comes_out_naming_the_paper_it_was_called_on(self):
        """The key a seminar was filed under becomes the paper's own name.

        Both spellings of that key have to find their paper: the shown
        paper is reached by its title, and the one carrying a DOI by the
        DOI, which is what the old key preferred."""
        self.seed_seminars()
        self.upgrade()

        rooms = dict(self.rows("SELECT uuid, paper_sha256 FROM rooms"))
        titles = dict(self.rows("SELECT sha256, title FROM papers"))
        # A key spelled as a title found the paper with no DOI.
        self.assertEqual(titles[rooms[self.by_title]], "Hidden")
        # A key spelled as a DOI found the paper that prints it.
        self.assertEqual(
            self.rows("SELECT doi FROM papers WHERE sha256 = ?",
                      rooms[self.by_doi]),
            [("10.1/shown",)],
        )
        self.assertNotIn("paper_key", {
            row[1] for row in self.rows("PRAGMA table_info(rooms)")
        })
        self.assertNotIn("paper_title", {
            row[1] for row in self.rows("PRAGMA table_info(rooms)")
        })

    def test_a_seminar_naming_no_paper_goes_rather_than_naming_nothing(self):
        """There is no digest to give it, and a seminar about no paper is
        not a seminar. It goes, and what was said in it goes with it."""
        self.seed_seminars()
        self.upgrade()

        self.assertEqual(
            self.rows("SELECT uuid FROM rooms WHERE uuid = ?", self.stranded), [],
        )
        self.assertEqual(
            self.rows("SELECT uuid FROM room_messages WHERE room_uuid = ?",
                      self.stranded),
            [],
        )
        # The seminars that found their paper kept theirs.
        self.assertEqual(
            len(self.rows("SELECT uuid FROM room_messages")), 2,
        )

    # --- the pull cursor ---------------------------------------------------

    def test_a_change_log_written_without_a_growing_sequence_is_rebuilt(self):
        """An ordinary integer key is the row id, and a row id is reused.

        The log has always had entries removed from it, so an existing one
        could hand the next change a sequence some replica had already gone
        past — and that replica would pull nothing from then on, silently.
        """
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE _server_change_log ("
                "  sequence INTEGER PRIMARY KEY, user_uuid TEXT NOT NULL,"
                "  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL,"
                "  revision INTEGER NOT NULL, operation TEXT NOT NULL,"
                "  row_json TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            for sequence in (1, 2, 3):
                db.execute(
                    "INSERT INTO _server_change_log"
                    "  (sequence, user_uuid, table_name, row_uuid, revision,"
                    "   operation, row_json, created_at)"
                    "  VALUES (?,?,'shelves',?,1,'upsert','{}',?)",
                    (sequence, self.user, _uuid(), NOW),
                )
        self.upgrade()

        # The entries it was holding are still there, with the sequences
        # they had: the cursor a replica is carrying still means the same.
        self.assertEqual(
            [row[0] for row in self.rows("SELECT sequence FROM _server_change_log")],
            [1, 2, 3],
        )
        with sqlite3.connect(self.path) as db:
            db.execute("DELETE FROM _server_change_log")
            db.execute(
                "INSERT INTO _server_change_log"
                "  (user_uuid, table_name, row_uuid, revision, operation,"
                "   row_json, created_at) VALUES (?,'shelves',?,1,'upsert','{}',?)",
                (self.user, _uuid(), NOW),
            )
        # Emptied and written to again, the next change comes after the
        # last one written rather than after the last one kept.
        self.assertEqual(
            [row[0] for row in self.rows("SELECT sequence FROM _server_change_log")],
            [4],
        )

    # --- indexes -----------------------------------------------------------

    def test_every_index_the_models_declare_is_on_the_upgraded_database(self):
        """An index is part of the schema, and arrives with the upgrade.

        `create_all` skips a table it can already find, and with it every
        index that table declares — so an index added to a model after its
        table existed used to reach fresh databases and no other. The one
        database it was written for, the one with the rows in it, kept
        scanning.

        The change log is here too, in the shape that makes the upgrade
        rebuild it: a rebuild drops the table it is replacing, and the pass
        that adds indexes has already run by then."""
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE _server_change_log ("
                "  sequence INTEGER PRIMARY KEY, user_uuid TEXT NOT NULL,"
                "  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL,"
                "  revision INTEGER NOT NULL, operation TEXT NOT NULL,"
                "  row_json TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
        self.upgrade()
        import database

        have = {
            row[0] for row in self.rows(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND name NOT LIKE 'sqlite_%'"
            )
        }
        want = {
            index.name: table.name
            for table in database.Base.metadata.sorted_tables
            for index in table.indexes
        }
        self.assertEqual(
            sorted(name for name in want if name not in have), [],
        )


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
