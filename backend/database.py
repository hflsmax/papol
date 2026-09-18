from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn, CreateIndex
from contextvars import ContextVar
import json
import logging
import os
from pathlib import Path

# Use absolute path for database in backend directory
DB_PATH = Path(__file__).parent / "papol.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

logger = logging.getLogger(__name__)


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


def _add_missing_indexes(conn, table):
    """Put up the indexes this table declares and does not have.

    `create_all` only makes tables it cannot find, and it skips a table's
    indexes along with the table. So an index declared on a model *after*
    its table already existed is never created anywhere: the developer
    writes `index=True`, every test passes against a fresh database that
    got the index from `create_all`, and the one database it was meant for
    — the one with the rows in it — goes on doing full scans. The rebuilds
    above put back the indexes of the tables they rebuild, which is why
    this was survivable, but a table nothing has had to rebuild has been
    picking up nothing at all.

    Written here rather than left to `create_all` because the index is the
    only part of a model's schema that had no owner. A column has the pass
    above; a table has `create_all`; an index had neither."""
    for index in table.indexes:
        conn.execute(CreateIndex(index, if_not_exists=True))


# A change in the log is a row as it stood when it was written, and a replica
# replays it by name. Reshaping a synchronized table therefore invalidates
# the log's own history: an entry still speaks of columns the table has not
# got, and a replica applying one refuses the whole page without advancing
# its cursor — so it never gets past that page, and stops synchronizing for
# good rather than saying anything about it.
#
# Those entries are dropped rather than rewritten. Nothing is lost by it: the
# snapshot that precedes every pull is the complete server mirror of exactly
# these tables, so a replica that misses a change learns the same state from
# the snapshot a moment earlier. The cursor only ever has to grow, and the
# gap the deletions leave costs nothing.
#
# The rule is the shape itself, so it needs nothing said about any particular
# change: an entry survives when every field it names is still a column of
# its table, and goes when it is not.
def _forget_changes_no_replica_could_read(conn):
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "_server_change_log" not in tables:
        return
    columns = {
        name: {column.name for column in table.columns}
        for name, table in Base.metadata.tables.items()
    }
    if not columns:
        # Nothing has declared a shape to judge the log against. Called with
        # the models unimported, every entry would look unreadable and the
        # whole log would go; say nothing instead.
        return
    stale = []
    for sequence, table_name, row_json in conn.execute(text(
        "SELECT sequence, table_name, row_json FROM _server_change_log"
    )):
        known = columns.get(table_name)
        if known is not None:
            try:
                named = set(json.loads(row_json))
            except (TypeError, ValueError):
                named = None
            if named is not None and named <= known:
                continue
        stale.append(sequence)
    if not stale:
        return
    for start in range(0, len(stale), 500):
        batch = stale[start:start + 500]
        conn.execute(
            text("DELETE FROM _server_change_log WHERE sequence IN :sequences")
            .bindparams(bindparam("sequences", expanding=True)),
            {"sequences": batch},
        )
    logger.info(
        "Forgot %s change log entr%s written under a schema no replica has; "
        "the snapshot carries that state instead.",
        len(stale), "y" if len(stale) == 1 else "ies",
    )


def migrate():
    """Bring an existing database up to the schema the models declare.

    One pass, and no history. `create_all` makes a table that is not there;
    this adds the columns and indexes a table that is there has not got. A
    database Papol wrote under an older shape is not carried forward by
    anything here — the service is deployed onto its own data and the
    desktop discards a replica it does not recognize, so the only shapes
    this has to meet are today's and one column behind it.

    That is what keeps this readable: declare the column on the model, with
    a server_default if it is NOT NULL, and the next start picks it up.
    """
    with engine.begin() as conn:
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
            _add_missing_indexes(conn, table)
        # Last: the log is judged against the shape every table above has
        # finished arriving at.
        _forget_changes_no_replica_could_read(conn)
