"""What a start does to a database that already exists.

Every other suite builds its schema with `create_all`, which makes today's
shape out of today's models. That answers "does the code work against the
schema it expects" and never "does the database already on the server pick
up today's schema" — so a column that never arrives passes all of them.

There is no upgrade path beyond one start and the next. Papol is deployed
onto its own data, and the desktop throws away a replica it does not
recognize rather than carrying it forward, so the only database `migrate()`
has to meet is one a column or an index behind the models.

Run in the repository's development environment with:
    cd backend && python -m unittest test_existing_database.py
"""
import os
import sqlite3
import sys
import tempfile
import unittest

NOW = "2026-01-01T00:00:00"


def start(path):
    """Exactly what a server start does to the database at `path`."""
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    for name in ("database", "models"):
        sys.modules.pop(name, None)
    import database
    import models  # noqa: F401  (registers the models on the metadata)
    database.migrate()
    database.Base.metadata.create_all(bind=database.engine)
    database.engine.dispose()
    return database


class ExistingDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "papol.db")
        start(self.path)  # a database that has been running

    def rows(self, query, *args):
        db = sqlite3.connect(self.path)
        try:
            return db.execute(query, args).fetchall()
        finally:
            db.close()

    def execute(self, *statements):
        db = sqlite3.connect(self.path)
        try:
            for statement in statements:
                db.execute(statement)
            db.commit()
        finally:
            db.close()

    def test_a_column_the_models_declare_arrives_on_a_table_that_exists(self):
        """`create_all` skips a table it can already find, and with it every
        column added to that table since. The one database it matters for —
        the one with the rows in it — is the one that would never get it."""
        self.execute("ALTER TABLE copies DROP COLUMN summary")
        start(self.path)
        columns = {row[1] for row in self.rows("PRAGMA table_info(copies)")}
        self.assertIn("summary", columns)

    def test_an_index_the_models_declare_arrives_on_a_table_that_exists(self):
        """An index is part of the schema and arrives the same way. It used
        to have no owner at all: a column had the pass above, a table had
        `create_all`, and an index declared after its table reached fresh
        databases and no other, while the one with the rows kept scanning."""
        self.execute("DROP INDEX ix_copies_shelf_uuid")
        database = start(self.path)
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
        self.assertEqual(sorted(name for name in want if name not in have), [])

    def test_starting_again_changes_nothing(self):
        before = self.rows("SELECT name, sql FROM sqlite_master ORDER BY name")
        start(self.path)
        self.assertEqual(
            self.rows("SELECT name, sql FROM sqlite_master ORDER BY name"), before,
        )


class ChangeLogTests(unittest.TestCase):
    """A replica applies a pulled change by name, and refuses a whole page
    that names a column its table has not got — without advancing its
    cursor. An entry like that is one no replica could ever get past: it
    would stop synchronizing for good on its first pull after the change.

    Those entries go. Nothing is lost by it, because the snapshot that
    precedes every pull carries the same state."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "papol.db")
        start(self.path)

    def write(self, sequence, table_name, row):
        import json
        db = sqlite3.connect(self.path)
        try:
            db.execute(
                "INSERT INTO _server_change_log "
                "  (sequence, user_uuid, table_name, row_uuid, revision,"
                "   operation, row_json, created_at) "
                "VALUES (?,?,?,?,1,'upsert',?,?)",
                (sequence, "a-user", table_name, row["uuid"], json.dumps(row), NOW),
            )
            db.commit()
        finally:
            db.close()

    def sequences(self):
        db = sqlite3.connect(self.path)
        try:
            return [
                row[0] for row in
                db.execute("SELECT sequence FROM _server_change_log ORDER BY sequence")
            ]
        finally:
            db.close()

    def test_a_change_naming_a_column_the_table_has_not_got_is_forgotten(self):
        self.write(1, "copies", {
            "uuid": "a-copy", "paper_sha256": "f" * 64, "user_uuid": "a-user",
            # A column no `copies` has: whatever wrote this, no replica can
            # read it.
            "edition_uuid": "an-edition",
        })
        start(self.path)
        self.assertEqual(self.sequences(), [])

    def test_a_change_every_field_of_which_is_still_a_column_is_kept(self):
        self.write(1, "copies", {
            "uuid": "a-copy", "paper_sha256": "f" * 64, "user_uuid": "a-user",
            "summary": "Readable by any replica", "revision": 1,
        })
        start(self.path)
        self.assertEqual(self.sequences(), [1])

    def test_the_cursor_only_grows(self):
        """A sequence handed out twice is a replica that pulls nothing, for
        good, and says nothing about it. The log has entries removed from it
        — an account closing takes its own — so the next change has to come
        after the last one written rather than the last one kept."""
        self.write(1, "copies", {
            "uuid": "a-copy", "paper_sha256": "f" * 64, "user_uuid": "a-user",
        })
        db = sqlite3.connect(self.path)
        try:
            db.execute("DELETE FROM _server_change_log")
            db.execute(
                "INSERT INTO _server_change_log "
                "  (user_uuid, table_name, row_uuid, revision, operation,"
                "   row_json, created_at) "
                "VALUES ('a-user','copies','another-copy',1,'upsert','{}',?)",
                (NOW,),
            )
            db.commit()
            self.assertEqual(
                db.execute("SELECT sequence FROM _server_change_log").fetchone()[0], 2,
            )
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
