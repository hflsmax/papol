import sqlite3
import unittest
from pathlib import Path

from sync.registry import MODELS, registry, validate_registry


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
                local = {
                    row[1]: row[2].upper()
                    for row in connection.execute(f"PRAGMA table_info({table_name})")
                }
                aliases = rule.get("column_aliases", {})
                skipped = set(rule.get("compatibility_columns", []))
                server = {
                    aliases.get(column.name, column.name)
                    for column in MODELS[table_name].__table__.columns
                    if column.name not in skipped
                }
                self.assertEqual(set(local), server, table_name)
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
