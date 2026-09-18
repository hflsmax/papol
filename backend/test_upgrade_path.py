"""What happens to a database that already exists.

Every other suite builds its schema with `create_all`, which produces today's
shape from today's models. That answers "does the code work against the schema
it expects" and never "does a user's existing database survive the upgrade" —
so a migration that drops every seminar on the floor passes all of them.

These tests start from the shape the running service actually holds and run
`migrate()` over it, which is the only way that question gets asked.

The starting shape is *today's* models for every table a migration does not
touch, and a hand-written old shape for the two it does. Deriving the rest
keeps the fixture from quietly rotting; writing the two by hand is the whole
point, because what is under test is the move from one to the other.
"""
import os
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid

NOW = "2026-09-15T12:00:00"

# What `rooms` looked like while a seminar carried a key of its own — the
# paper's DOI, or its title when it had none — and a copy of the title
# beside it.
ROOMS_BEFORE = """
CREATE TABLE rooms (
  uuid TEXT PRIMARY KEY NOT NULL, paper_key TEXT NOT NULL,
  paper_title TEXT NOT NULL, created_by TEXT NOT NULL, leader_uuid TEXT,
  status TEXT NOT NULL, scheduled_time TEXT, platform TEXT,
  style TEXT, style_desc TEXT, created_at TEXT
);
CREATE TABLE room_messages (
  uuid TEXT PRIMARY KEY NOT NULL, room_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT
);
CREATE TABLE room_participants (
  uuid TEXT PRIMARY KEY NOT NULL, room_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL, created_at TEXT
);
"""

# The change log while its sequence was an ordinary integer key — which is
# the row id, and a row id is reused.
CHANGE_LOG_BEFORE = """
CREATE TABLE _server_change_log (
  sequence INTEGER PRIMARY KEY, user_uuid TEXT NOT NULL,
  table_name TEXT NOT NULL, row_uuid TEXT NOT NULL, revision INTEGER NOT NULL,
  operation TEXT NOT NULL, row_json TEXT NOT NULL, created_at TEXT NOT NULL
);
"""

WRITTEN_BY_HAND = {"rooms", "room_messages", "room_participants",
                   "_server_change_log"}


def _uuid():
    return str(uuid.uuid4())


def _fresh_database_module(path):
    """Import `database` and `models` against this file, from scratch."""
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    for name in ("database", "models"):
        sys.modules.pop(name, None)
    import database
    import models  # noqa: F401  (registers the models on the metadata)
    return database


class UpgradeFromTheRunningShapeTests(unittest.TestCase):
    """Run the real `migrate()` against the shape the service is on."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "papol.db")
        self.seed()

    def seed(self):
        """Every table as the models declare it, bar the two under test.

        No indexes: an existing database gets them from the upgrade, and
        that is one of the things being asked here.
        """
        from sqlalchemy.schema import CreateTable

        database = _fresh_database_module(self.path)
        db = sqlite3.connect(self.path)
        try:
            for table in database.Base.metadata.sorted_tables:
                if table.name in WRITTEN_BY_HAND:
                    continue
                db.executescript(
                    str(CreateTable(table).compile(dialect=database.engine.dialect))
                )
            db.executescript(ROOMS_BEFORE)
            db.executescript(CHANGE_LOG_BEFORE)
            # This is the shape the service is on, written down by hand — so
            # it says which schema it is at, the way a running database does.
            # Without that it reads as 1, from before anybody was counting.
            from sync.registry import schema_version
            db.execute(
                "INSERT INTO settings (key, value) VALUES ('schema_version', ?)",
                (str(schema_version()),),
            )

            self.user = _uuid()
            self.shown, self.hidden = "a" * 64, "b" * 64
            db.execute(
                "INSERT INTO papers (sha256, doi, title, file_path, created_at,"
                "  updated_at, revision) VALUES (?,?,?,?,?,?,1)",
                (self.shown, "10.1/shown", "Shown", "a.pdf", NOW, NOW),
            )
            db.execute(
                "INSERT INTO papers (sha256, title, file_path, created_at,"
                "  updated_at, revision) VALUES (?,?,?,?,?,1)",
                (self.hidden, "Hidden", "b.pdf", NOW, NOW),
            )
            db.commit()
        finally:
            db.close()
        database.engine.dispose()

    def upgrade(self):
        """Exactly what a server start does to an existing database."""
        database = _fresh_database_module(self.path)
        database.migrate()
        database.Base.metadata.create_all(bind=database.engine)
        database.engine.dispose()
        return database

    def rows(self, query, *args):
        db = sqlite3.connect(self.path)
        try:
            return db.execute(query, args).fetchall()
        finally:
            db.close()

    def columns(self, table):
        return {row[1] for row in self.rows(f"PRAGMA table_info({table})")}

    # --- seminars ----------------------------------------------------------

    def seed_seminars(self):
        """Three seminars under the keys a seminar used to be filed by.

        The shown paper carries a DOI, so its key was the DOI; the hidden
        one has none, so its key was its title. Both spellings have to find
        their paper. The third names nothing at all.
        """
        db = sqlite3.connect(self.path)
        try:
            self.by_doi, self.by_title, self.stranded = _uuid(), _uuid(), _uuid()
            for room_uuid, key in (
                (self.by_doi, "doi:10.1/shown"),
                (self.by_title, "title:hidden"),
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
                db.execute(
                    "INSERT INTO room_participants VALUES (?,?,?,?)",
                    (_uuid(), room_uuid, self.user, NOW),
                )
            db.commit()
        finally:
            db.close()

    def test_a_seminar_comes_out_naming_the_paper_it_was_called_on(self):
        """The key a seminar was filed under becomes the paper's own name.

        Both spellings of that key have to find their paper: one by the DOI
        the old key preferred, one by the title it fell back to."""
        self.seed_seminars()
        self.upgrade()

        rooms = dict(self.rows("SELECT uuid, paper_sha256 FROM rooms"))
        self.assertEqual(rooms[self.by_doi], self.shown)
        self.assertEqual(rooms[self.by_title], self.hidden)
        self.assertNotIn("paper_key", self.columns("rooms"))
        # The title snapshot goes with it; the room reads the paper's own.
        self.assertNotIn("paper_title", self.columns("rooms"))

    def test_a_seminar_naming_no_paper_goes_rather_than_naming_nothing(self):
        """There is no digest to give it, and a seminar about no paper is
        not a seminar. It goes, and what was said in it goes with it."""
        self.seed_seminars()
        self.upgrade()

        self.assertEqual(
            self.rows("SELECT uuid FROM rooms WHERE uuid = ?", self.stranded), [],
        )
        for table in ("room_messages", "room_participants"):
            with self.subTest(table=table):
                self.assertEqual(
                    self.rows(f"SELECT uuid FROM {table} WHERE room_uuid = ?",
                              self.stranded),
                    [],
                )
                # The seminars that found their paper kept theirs.
                self.assertEqual(len(self.rows(f"SELECT uuid FROM {table}")), 2)

    def test_a_seminar_that_already_names_its_paper_is_left_alone(self):
        self.seed_seminars()
        self.upgrade()
        before = self.rows("SELECT uuid, paper_sha256 FROM rooms ORDER BY uuid")
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT uuid, paper_sha256 FROM rooms ORDER BY uuid"), before,
        )

    # --- the pull cursor ---------------------------------------------------

    def test_a_change_log_written_without_a_growing_sequence_is_rebuilt(self):
        """An ordinary integer key is the row id, and a row id is reused.

        The log has always had entries removed from it, so an existing one
        could hand the next change a sequence some replica had already gone
        past — and that replica would pull nothing from then on, silently.
        """
        with sqlite3.connect(self.path) as db:
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

    def test_a_change_written_under_a_shape_no_replica_has_is_not_replayed(self):
        """A replica applies a pulled change by name, and refuses a page that
        names a column its table has not got — without advancing its cursor.

        So an entry left over from an earlier shape is one no upgraded
        installation could ever get past. It is dropped; the snapshot that
        precedes every pull carries that state instead."""
        with sqlite3.connect(self.path) as db:
            for row_json in (
                json.dumps({"uuid": _uuid(), "paper_uuid": self.shown}),
                json.dumps({"uuid": _uuid(), "user_uuid": self.user,
                            "name": "Display", "color": "#7ba26c",
                            "is_public": 1, "is_default": 1, "position": 0,
                            "created_at": NOW, "updated_at": NOW,
                            "revision": 1, "deleted_at": None}),
            ):
                db.execute(
                    "INSERT INTO _server_change_log"
                    "  (user_uuid, table_name, row_uuid, revision, operation,"
                    "   row_json, created_at)"
                    "  VALUES (?,?,?,1,'upsert',?,?)",
                    (self.user, "shelves", _uuid(), row_json, NOW),
                )
        self.upgrade()

        left = [json.loads(row[0]) for row in
                self.rows("SELECT row_json FROM _server_change_log")]
        self.assertEqual(len(left), 1)
        self.assertNotIn("paper_uuid", left[0])

    # --- indexes and columns -----------------------------------------------

    def test_every_index_the_models_declare_is_on_the_upgraded_database(self):
        """An index is part of the schema, and arrives with the upgrade.

        `create_all` skips a table it can already find, and with it every
        index that table declares — so an index added to a model after its
        table existed used to reach fresh databases and no other. The one
        database it was written for, the one with the rows in it, kept
        scanning."""
        database = self.upgrade()

        have = {
            row[0] for row in self.rows(
                "SELECT name FROM sqlite_master WHERE type='index' "
                "AND name NOT LIKE 'sqlite_%'"
            )
        }
        want = {
            index.name
            for table in database.Base.metadata.sorted_tables
            for index in table.indexes
        }
        self.assertEqual(sorted(want - have), [])

    def test_a_column_a_table_has_gained_is_added(self):
        with sqlite3.connect(self.path) as db:
            db.execute("ALTER TABLE papers DROP COLUMN journal")
        self.assertNotIn("journal", self.columns("papers"))
        self.upgrade()
        self.assertIn("journal", self.columns("papers"))
        # And the rows that were there are still there.
        self.assertEqual(
            sorted(row[0] for row in self.rows("SELECT sha256 FROM papers")),
            sorted([self.shown, self.hidden]),
        )

    def test_upgrading_twice_changes_nothing(self):
        self.seed_seminars()
        self.upgrade()
        first = self.rows(
            "SELECT name, sql FROM sqlite_master ORDER BY name"
        )
        self.upgrade()
        self.assertEqual(
            self.rows("SELECT name, sql FROM sqlite_master ORDER BY name"), first,
        )


class ADatabaseAtAnotherSchemaVersionTests(unittest.TestCase):
    """A database at a version this build was not written for is refused.

    The version is declared in `schema/sync_registry.json` and moved by the
    developer when a change lands that an existing database cannot be read
    under. Nothing here works out what shape it is looking at; it is told,
    and acts on having been told. What must not happen is the passes that
    remain finding a schema they do not expect and carrying on into one the
    rows do not fit.
    """

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "papol.db")

    def recorded(self):
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT value FROM settings WHERE key = 'schema_version'"
            ).fetchone()
        return int(row[0]) if row else None

    def start_and_expect_refusal(self):
        database = _fresh_database_module(self.path)
        try:
            with self.assertRaises(RuntimeError) as caught:
                database.migrate()
        finally:
            database.engine.dispose()
        return str(caught.exception)

    def test_a_fresh_database_is_stamped_with_the_declared_version(self):
        database = _fresh_database_module(self.path)
        database.migrate()
        database.engine.dispose()
        from sync.registry import schema_version
        self.assertEqual(self.recorded(), schema_version())

    def test_a_database_recording_nothing_is_at_version_one(self):
        """Everything written before anybody was counting is 1. This build
        declares a later version, so such a database is refused — and the
        refusal says which two numbers disagreed."""
        with sqlite3.connect(self.path) as db:
            db.executescript(
                "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT);"
            )
        said = self.start_and_expect_refusal()
        self.assertIn("at schema 1", said)
        from sync.registry import schema_version
        self.assertIn(f"written for schema {schema_version()}", said)

    def test_a_database_at_another_version_is_refused_and_told_how_to_say_otherwise(self):
        with sqlite3.connect(self.path) as db:
            db.executescript(
                "CREATE TABLE settings (key VARCHAR PRIMARY KEY, value TEXT);"
                "INSERT INTO settings VALUES ('schema_version', '999');"
                "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT);"
            )
        said = self.start_and_expect_refusal()
        self.assertIn("at schema 999", said)
        self.assertIn("backup", said)
        # The remedy for a database already brought across by hand is a
        # statement, spelled out, that records the declared version.
        from sync.registry import schema_version
        self.assertIn(f"'schema_version', '{schema_version()}'", said)
        # And refusing changed nothing.
        self.assertEqual(self.recorded(), 999)

    def test_the_stamp_is_what_lets_a_database_in(self):
        """The same database, once it says it is at the declared version,
        starts — the number is the whole test, not the shape behind it."""
        from sync.registry import schema_version
        with sqlite3.connect(self.path) as db:
            db.executescript(
                "CREATE TABLE settings (key VARCHAR PRIMARY KEY, value TEXT);"
                f"INSERT INTO settings VALUES ('schema_version', '{schema_version()}');"
                "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT);"
            )
        database = _fresh_database_module(self.path)
        database.migrate()
        database.engine.dispose()
        self.assertEqual(self.recorded(), schema_version())


class FreshInstallTests(unittest.TestCase):
    def test_a_database_that_never_had_anything_upgrades_quietly(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "papol.db")
        database = _fresh_database_module(path)
        database.migrate()
        database.Base.metadata.create_all(bind=database.engine)
        database.migrate()  # and again, on a database it has already seen
        database.engine.dispose()

        db = sqlite3.connect(path)
        try:
            tables = {
                row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            self.assertIn("rooms", tables)
            self.assertIn("papers", tables)
            columns = {row[1] for row in db.execute("PRAGMA table_info(rooms)")}
            self.assertIn("paper_sha256", columns)
            self.assertNotIn("paper_key", columns)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
