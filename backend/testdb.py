"""The database the suite runs against: PostgreSQL, named expendable.

The server runs on PostgreSQL, so that is what the tests exercise — a suite
green on another engine says nothing about a deploy. The runner names the
database in DATABASE_URL, the same variable everything else reads; the
module engine, the session factories, and every engine a test asks for are
then one engine on one database, which is what lets code that reaches for
SessionLocal directly (the error logger, the emailers) land in the database
the test is looking at.

Tests level the schema and start over whenever they like, so this module
refuses to touch a database that does not announce itself as expendable:
its name must end in `_test`.

    DATABASE_URL="postgresql+psycopg://papol@/papol_test?host=$PWD/../.postgres" \
        python -m unittest
"""
import atexit

from sqlalchemy import text

import database

# Pooled connections left to the garbage collector at interpreter exit make
# psycopg complain; close them while closing is still orderly.
atexit.register(database.engine.dispose)


def reset():
    """Level the test database: no tables, nothing. Returns the engine."""
    name = database.engine.url.database or ""
    if not name.endswith("_test"):
        raise RuntimeError(
            f"DATABASE_URL names the database {name!r}. Backend tests level "
            "the whole schema, so they only run against a database whose "
            "name ends in `_test`."
        )
    with database.engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    return database.engine


def fresh_engine():
    """The suite's engine, its schema just built and holding nothing.

    Built by migrate(), not bare create_all, so the schema version is
    stamped the way a real server start stamps it: anything that runs
    migrate() later in the process — importing main, most likely — must
    find a database this build recognizes, not one that looks like a
    stranger's.
    """
    engine = reset()
    database.migrate()
    return engine
