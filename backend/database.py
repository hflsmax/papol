from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn
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


def _add_column_ddl(column) -> str:
    """The column's definition as CREATE TABLE would spell it — type, NOT
    NULL, DEFAULT — which is exactly what ADD COLUMN takes."""
    return CreateColumn(column).compile(dialect=engine.dialect).string


# Columns the models no longer carry. A copy used to keep its own copy of
# its shelf's visibility, under either spelling; the shelf answers for it
# now, so the column is dropped rather than carried along as a second
# version of one fact. Named explicitly because nothing in the metadata
# says what a table used to have.
_DROPPED_COLUMNS = [("copies", "marketed"), ("copies", "is_public")]


def migrate():
    """Retire obsolete tables and columns, and add columns an existing table
    lacks.
    create_all only creates missing tables, so a database written under an
    earlier schema needs these ALTERs. Driven off the model metadata, so
    there is no second list to keep in step: declare the column on the
    model (with a server_default if it is NOT NULL, which SQLite requires
    to add one) and an existing database picks it up on the next start."""
    with engine.begin() as conn:
        # Remove tables belonging to retired features before reconciling the
        # live model metadata. DROP IF EXISTS keeps fresh installs unchanged.
        conn.execute(text("DROP TABLE IF EXISTS presence_pings"))
        for table_name, column_name in _DROPPED_COLUMNS:
            columns = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table_name})"))
            }
            if column_name in columns:
                conn.execute(text(
                    f"ALTER TABLE {table_name} DROP COLUMN {column_name}"
                ))
        for table in Base.metadata.tables.values():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table.name})"))
            }
            if not existing:
                continue  # table doesn't exist yet; create_all will handle it
            for column in table.columns:
                if column.name not in existing:
                    conn.execute(text(
                        f"ALTER TABLE {table.name} ADD COLUMN {_add_column_ddl(column)}"
                    ))
