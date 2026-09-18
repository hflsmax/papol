"""What happens to a database that already exists.

A database at the declared schema version starts. One at any other version
is refused, whatever shape it is in: the version is a number the developer
moves, and nothing here works out what it is looking at.
"""
import os
import sqlite3
import sys
import tempfile
import unittest


def _fresh_database_module(path):
    """Import `database` and `models` against this file, from scratch."""
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    for name in ("database", "models"):
        sys.modules.pop(name, None)
    import database
    import models  # noqa: F401  (registers the models on the metadata)
    return database


class ADatabaseAtAnotherSchemaVersionTests(unittest.TestCase):
    """A database at a version this build was not written for is refused.

    The version is declared in `schema/sync_registry.json` and moved by the
    developer when a change lands that an existing database cannot be read
    under. Nothing here works out what shape it is looking at; it is told,
    and acts on having been told.
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

    def test_a_database_recording_nothing_is_refused(self):
        """A database with tables and no version is not one this build wrote,
        so it is refused — and the refusal says what it found."""
        with sqlite3.connect(self.path) as db:
            db.executescript(
                "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT);"
            )
        said = self.start_and_expect_refusal()
        self.assertIn("records no schema version", said)
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
        self.assertIn("is at schema 999", said)
        self.assertIn("backup", said)
        self.assertIn("DELETE FROM _server_change_log", said)
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
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main()
