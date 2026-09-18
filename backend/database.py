from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from contextvars import ContextVar
import os
from pathlib import Path

# Use absolute path for database in backend directory
DB_PATH = Path(__file__).parent / "papol.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class PapolSession(Session):
    """A session whose request commit can be joined to sync bookkeeping.

    Existing route handlers commit their own domain work. An idempotent desktop
    mutation must commit that work and its replay record atomically, so the
    request middleware temporarily turns those commits into flushes and owns
    the one final commit.
    """

    def commit(self):
        if self.info.get("defer_commit"):
            self.flush()
            return
        return super().commit()

    def commit_deferred(self):
        """Commit even while this request has deferred ordinary commits."""
        return super().commit()


SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine, class_=PapolSession
)
Base = declarative_base()

_request_session = ContextVar("papol_request_session", default=None)


def set_request_session(db: Session):
    return _request_session.set(db)


def reset_request_session(token):
    _request_session.reset(token)


def current_request_session():
    return _request_session.get()


def get_db():
    request_db = current_request_session()
    if request_db is not None:
        yield request_db
        return
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Which schema this database is at, and what to do when it is not this one.
#
# The number comes from `schema/sync_registry.json` and is moved by hand:
# when a change lands that an existing database cannot be read under, the
# person making it says so there. Nothing here tries to work out what shape
# it is looking at — naming the tables some old release had is a list that
# goes out of date the moment the next change lands, and it goes out of date
# silently, which is the failure it was written to prevent.
#
# The service refuses rather than rebuilds, because its database is the only
# copy. Papol breaks rather than bridges, and the one thing a break must not
# do is take a database apart quietly. Stopping leaves an admin with a backup
# one command away, and bringing a database across is done by hand: the
# tables, and the change log, whose entries were written under the old shape
# and would stall every replica that pulled them.
SCHEMA_VERSION_KEY = "schema_version"


def _recorded_schema_version(conn) -> int | None:
    """Which schema this database says it is at, or None if it does not say."""
    present = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "settings" not in present:
        return None
    recorded = conn.execute(
        text("SELECT value FROM settings WHERE key = :key"),
        {"key": SCHEMA_VERSION_KEY},
    ).scalar()
    return None if recorded is None else int(recorded)


def _refuse_a_database_this_build_cannot_read(conn):
    """Stop, loudly, rather than start on a database nothing here can read."""
    from sync.registry import schema_version
    declared = schema_version()
    recorded = _recorded_schema_version(conn)
    if recorded == declared:
        return
    empty = not conn.execute(text(
        "SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1"
    )).first()
    if empty:
        return  # nothing written yet; `_stamp_the_schema_version` names it
    at = "records no schema version" if recorded is None else f"is at schema {recorded}"
    raise RuntimeError(
        f"This database {at} and this build is written for schema "
        f"{declared}. Papol does not carry a database across a break: restore "
        f"a backup taken under schema {declared}, or — if this database has "
        f"already been brought to schema {declared} by hand, tables and "
        "change log both (\"DELETE FROM _server_change_log\") — record that "
        f"with \"INSERT INTO settings (key, value) VALUES ('{SCHEMA_VERSION_KEY}', "
        f"'{declared}') ON CONFLICT(key) DO UPDATE SET value = excluded.value\"."
    )


def _stamp_the_schema_version(conn):
    """Write down which schema this database is at, now that it is at it."""
    from sync.registry import schema_version
    conn.execute(
        text("INSERT INTO settings (key, value) VALUES (:key, :value) "
             "ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
        {"key": SCHEMA_VERSION_KEY, "value": str(schema_version())},
    )


def migrate():
    """Make the tables a fresh database has not got, and name its schema.

    Nothing here alters a table that exists. A change an existing database
    cannot be read under is a new schema version, and a database at another
    version is refused rather than brought across.
    """
    with engine.begin() as conn:
        _refuse_a_database_this_build_cannot_read(conn)
        Base.metadata.create_all(bind=conn)
        _stamp_the_schema_version(conn)
