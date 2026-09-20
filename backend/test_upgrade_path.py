"""What happens to a database that already exists.

A database at the declared schema version starts. One at any other version
is refused, whatever shape it is in: the version is a number the developer
moves, and nothing here works out what it is looking at.
"""
import unittest

from sqlalchemy import inspect, text

import database
import models  # noqa: F401  (registers the models on the metadata)
import testdb
from sync.registry import schema_version


class ADatabaseAtAnotherSchemaVersionTests(unittest.TestCase):
    """A database at a version this build was not written for is refused.

    The version is declared in `schema/sync_registry.json` and moved by the
    developer when a change lands that an existing database cannot be read
    under. Nothing here works out what shape it is looking at; it is told,
    and acts on having been told.
    """

    def setUp(self):
        self.engine = testdb.reset()

    def shape(self, ddl):
        with self.engine.begin() as conn:
            for statement in ddl:
                conn.execute(text(statement))

    def recorded(self):
        with self.engine.connect() as conn:
            return conn.execute(text(
                "SELECT value FROM settings WHERE key = 'schema_version'"
            )).scalar()

    def start_and_expect_refusal(self):
        with self.assertRaises(RuntimeError) as caught:
            database.migrate()
        return str(caught.exception)

    def test_a_fresh_database_is_stamped_with_the_declared_version(self):
        database.migrate()
        self.assertEqual(int(self.recorded()), schema_version())

    def test_a_database_recording_nothing_is_refused(self):
        """A database with tables and no version is not one this build wrote,
        so it is refused — and the refusal says what it found."""
        self.shape([
            "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT)",
        ])
        said = self.start_and_expect_refusal()
        self.assertIn("records no schema version", said)
        self.assertIn(f"written for schema {schema_version()}", said)

    def test_a_database_at_another_version_is_refused_and_told_how_to_say_otherwise(self):
        self.shape([
            "CREATE TABLE settings (key VARCHAR PRIMARY KEY, value TEXT)",
            "INSERT INTO settings VALUES ('schema_version', '999')",
            "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT)",
        ])
        said = self.start_and_expect_refusal()
        self.assertIn("is at schema 999", said)
        self.assertIn("backup", said)
        self.assertIn("DELETE FROM _server_change_log", said)
        # The remedy for a database already brought across by hand is a
        # statement, spelled out, that records the declared version.
        self.assertIn(f"'schema_version', '{schema_version()}'", said)
        # And refusing changed nothing.
        self.assertEqual(int(self.recorded()), 999)

    def test_the_stamp_is_what_lets_a_database_in(self):
        """The same database, once it says it is at the declared version,
        starts — the number is the whole test, not the shape behind it."""
        self.shape([
            "CREATE TABLE settings (key VARCHAR PRIMARY KEY, value TEXT)",
            f"INSERT INTO settings VALUES ('schema_version', '{schema_version()}')",
            "CREATE TABLE papers (sha256 TEXT PRIMARY KEY NOT NULL, title TEXT)",
        ])
        database.migrate()
        self.assertEqual(int(self.recorded()), schema_version())


class FreshInstallTests(unittest.TestCase):
    def test_a_database_that_never_had_anything_upgrades_quietly(self):
        engine = testdb.reset()
        database.migrate()
        database.migrate()  # and again, on a database it has already seen

        with engine.connect() as conn:
            inspector = inspect(conn)
            tables = set(inspector.get_table_names())
            self.assertIn("rooms", tables)
            self.assertIn("papers", tables)
            columns = {column["name"] for column in inspector.get_columns("rooms")}
            self.assertIn("paper_sha256", columns)


if __name__ == "__main__":
    unittest.main()
