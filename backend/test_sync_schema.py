import copy
import sqlite3
import unittest
from pathlib import Path
from unittest import mock

from sqlalchemy.sql.sqltypes import Boolean, DateTime, Float, Integer

from models import Board, BoardItem, Copy
from sync.registry import MODELS, owner_uuid, registry, validate_registry


def sqlite_type(column):
    if isinstance(column.type, (Boolean, Integer)):
        return "INTEGER"
    if isinstance(column.type, Float):
        return "REAL"
    if isinstance(column.type, DateTime):
        return "TEXT"
    return "TEXT"


class SharedSyncSchemaTests(unittest.TestCase):
    def test_registry_matches_sqlalchemy_models(self):
        self.assertTrue(validate_registry())

    def test_shared_ddl_exposes_every_synchronized_model_column(self):
        domain = Path(__file__).parents[1] / "schema" / "domain" / "domain.sql"
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(domain.read_text())
            for table_name, rule in registry()["tables"].items():
                local_info = list(connection.execute(f"PRAGMA table_info({table_name})"))
                local = {row[1]: row[2].upper() for row in local_info}
                skipped = set(rule.get("server_columns", []))
                server = {
                    column.name: sqlite_type(column)
                    for column in MODELS[table_name].__table__.columns
                    if column.name not in skipped
                }
                self.assertEqual(local, server, table_name)
                # Whatever the model is keyed by, the replica is keyed by
                # too. A paper is named by its file; everything else by a
                # UUID its writer made up.
                primary_keys = {row[1] for row in local_info if row[5]}
                self.assertEqual(
                    primary_keys,
                    {column.name
                     for column in MODELS[table_name].__table__.primary_key},
                    table_name,
                )
        finally:
            connection.close()


class EveryColumnIsPlacedTests(unittest.TestCase):
    """A column the registry does not describe is the drift this catches.

    It is the quiet kind: nothing fails, the push path simply refuses a
    field it was never told about, and the desktop loses an edit the website
    has. Each of these breaks the registry in one way and checks that
    startup says so.
    """

    def rule_with(self, table_name, **changes):
        altered = copy.deepcopy(registry())
        altered["tables"][table_name].update(changes)
        return mock.patch("sync.registry.registry", return_value=altered)

    def test_a_column_placed_nowhere_is_refused(self):
        with self.rule_with("copies", server_owned=[]):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("thought", str(caught.exception))

    def test_a_key_nothing_reads_is_refused(self):
        with self.rule_with("copies", conflict="last-write-wins"):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("conflict", str(caught.exception))

    def test_a_table_must_say_whose_its_rows_are(self):
        altered = copy.deepcopy(registry())
        del altered["tables"]["tags"]["owner"]
        with mock.patch("sync.registry.registry", return_value=altered):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("tags", str(caught.exception))

    def test_an_owner_path_that_does_not_resolve_is_refused(self):
        with self.rule_with("board_items", owner="shelf.user_uuid"):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("shelf", str(caught.exception))

    def test_a_client_cannot_be_given_the_column_that_says_whose_a_row_is(self):
        with self.rule_with(
            "copies",
            client_writable=[*registry()["tables"]["copies"]["client_writable"], "user_uuid"],
        ):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("user_uuid", str(caught.exception))

    def test_a_column_cannot_be_both_the_clients_and_the_services(self):
        with self.rule_with("copies", server_owned=["thought", "is_author", "summary"]):
            with self.assertRaises(RuntimeError) as caught:
                validate_registry()
        self.assertIn("summary", str(caught.exception))


class OwnerPathTests(unittest.TestCase):
    """The registry's owner path is what files a change under a user."""

    def test_a_row_that_holds_its_owner_answers_directly(self):
        self.assertEqual(owner_uuid(None, Copy(user_uuid="u1")), "u1")

    def test_a_row_reaches_its_owner_through_its_parent(self):
        item = BoardItem(board=Board(user_uuid="u2"))
        self.assertEqual(owner_uuid(None, item), "u2")

    def test_a_paper_belongs_to_nobody(self):
        self.assertIsNone(registry()["tables"]["papers"]["owner"])

    def test_a_row_with_no_parent_to_reach_says_so(self):
        with self.assertRaises(RuntimeError):
            owner_uuid(_NoSession(), BoardItem(board_uuid=None))


class _NoSession:
    def get(self, model, key):
        return None


if __name__ == "__main__":
    unittest.main()
