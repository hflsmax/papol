#!/usr/bin/env python3
"""Bring a papol.db across into PostgreSQL, once.

Reads every synchronized and unsynchronized table straight off the SQLite
file through the application's own models — which is what makes 0/1 into
booleans and timestamp strings into timestamps — and writes them into a
freshly created PostgreSQL schema in one transaction. The change-log
sequence is moved past its high-water mark afterwards, so the first change
written on PostgreSQL continues the log rather than reusing a number some
replica has already pulled past.

The target must be empty: this script creates the schema and refuses a
database that already holds rows. Run it from the repository root, in the
development shell:

    development, against the checkout's cluster (./deploy.sh db first):
        python scripts/migrate-sqlite-to-postgres.py backend/papol.db

    production, on the host, with the papol unit stopped:
        python scripts/migrate-sqlite-to-postgres.py \
            /srv/papol/prod/backend/papol.db \
            'postgresql+psycopg://papol@/papol?host=/run/postgresql'

Afterwards the server starts on the copied data because the settings table
carried the schema version across with everything else.
"""
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))


def main():
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        sys.exit(__doc__)
    sqlite_path = Path(sys.argv[1]).resolve()
    if not sqlite_path.exists():
        sys.exit(f"no SQLite database at {sqlite_path}")
    target_url = (
        sys.argv[2] if len(sys.argv) == 3
        else f"postgresql+psycopg://papol@/papol?host={REPO}/.postgres"
    )

    # The application's engine must be the target, and the import order
    # matters: database.py reads DATABASE_URL when it is imported.
    os.environ["DATABASE_URL"] = target_url
    from sqlalchemy import create_engine, func, select, text
    import database
    import models  # noqa: F401  (registers every table on the metadata)

    source = create_engine(f"sqlite:///{sqlite_path}")
    tables = database.Base.metadata.sorted_tables

    # A server that started once on the empty database has already stamped
    # its schema version, and may have logged an error. Neither is data;
    # both would collide with the rows coming across. Everything else full
    # is a used database, and refused.
    first_boot_residue = {"settings", "error_logs"}

    with database.engine.begin() as target:
        database.Base.metadata.create_all(bind=target)
        for table in tables:
            if table.name in first_boot_residue:
                target.execute(table.delete())
            elif target.execute(select(func.count()).select_from(table)).scalar():
                sys.exit(
                    f"the target already has rows in {table.name} — this "
                    "script fills an empty database, not a used one"
                )

        with source.connect() as reader:
            for table in tables:
                rows = [
                    dict(row) for row in
                    reader.execute(select(table)).mappings()
                ]
                if rows:
                    target.execute(table.insert(), rows)
                copied = target.execute(
                    select(func.count()).select_from(table)
                ).scalar()
                if copied != len(rows):
                    sys.exit(f"{table.name}: copied {copied} of {len(rows)} rows")
                print(f"{table.name}: {len(rows)}")

        # The one integer key. PostgreSQL hands out its values from a
        # sequence that the inserts above did not touch.
        floor = target.execute(text(
            "SELECT setval(pg_get_serial_sequence('_server_change_log', 'sequence'), "
            "COALESCE((SELECT MAX(sequence) FROM _server_change_log), 0) + 1, false)"
        )).scalar()
        print(f"change-log sequence continues at {floor}")

    print(f"\nDone: {sqlite_path.name} is now in {target_url}")


if __name__ == "__main__":
    main()
