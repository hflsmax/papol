import sqlite3
import unittest
from pathlib import Path

from sqlalchemy.sql.sqltypes import Boolean, DateTime, Float, Integer

from sync.registry import MODELS, registry, validate_registry


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
        migrations = Path(__file__).parents[1] / "schema" / "domain"
        connection = sqlite3.connect(":memory:")
        try:
            for ddl in sorted(migrations.glob("*.sql")):
                connection.executescript(ddl.read_text())
            for table_name, rule in registry()["tables"].items():
                local_info = list(connection.execute(f"PRAGMA table_info({table_name})"))
                local = {row[1]: row[2].upper() for row in local_info}
                aliases = rule.get("column_aliases", {})
                skipped = set(rule.get("compatibility_columns", []))
                server = {
                    aliases.get(column.name, column.name): sqlite_type(column)
                    for column in MODELS[table_name].__table__.columns
                    if column.name not in skipped
                }
                self.assertEqual(local, server, table_name)
                primary_keys = {row[1] for row in local_info if row[5]}
                self.assertEqual(primary_keys, {"id"}, table_name)
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
