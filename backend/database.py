from sqlalchemy import MetaData, bindparam, create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn, CreateIndex, CreateTable
from contextvars import ContextVar
import json
import logging
import os
import uuid
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


def _table_columns(conn, name: str) -> list:
    """The table's columns in declaration order, or [] if it does not exist."""
    return [row[1] for row in conn.execute(text(f"PRAGMA table_info({name})"))]


def _rebuild_frozen(conn, shapes: dict, target: str, source: str, alias: str,
                    join: str = "", sources: dict | None = None):
    """Rebuild `source` into `target` at the shape `shapes` records.

    The shape is written down by the migration that needs it rather than
    read from the models, so what a migration produces cannot drift with
    them: a later rename would otherwise rewrite an old database into a
    shape its rows do not fit, quietly."""
    body, columns, indexes = shapes[target]
    sources = sources or {}
    available = set(_table_columns(conn, source))
    staging = f"_new_{target}"

    picked, expressions = [], []
    for name in columns:
        if name in sources:
            expression = sources[name]
        elif name in available:
            # Quoted: a column may be spelled with a SQLite keyword, and
            # `index` is.
            expression = f'{alias}."{name}"'
        else:
            continue
        picked.append(f'"{name}"')
        expressions.append(expression)

    conn.execute(text(f"DROP TABLE IF EXISTS {staging}"))
    conn.execute(text(f"CREATE TABLE {staging} ({body})"))
    conn.execute(text(
        f"INSERT INTO {staging} ({', '.join(picked)}) "
        f"SELECT {', '.join(expressions)} FROM {source} {alias} {join}"
    ))
    conn.execute(text(f"DROP TABLE {source}"))
    conn.execute(text(f"ALTER TABLE {staging} RENAME TO {target}"))
    for index in indexes:
        conn.execute(text(index))


# A change in the log is a row as it stood when it was written, and a replica
# replays it by name. A migration that reshapes a synchronized table therefore
# invalidates its own history: the rows in the log still speak of columns the
# table has not got, and a replica applying one refuses the whole page —
# "Server sent unknown copies.paper_uuid" — without advancing its cursor. It
# never gets past that page, so every existing installation stops
# synchronizing for good the first time it pulls after the upgrade.
#
# Those entries are dropped rather than rewritten. Nothing is lost by it: the
# snapshot that precedes every pull is the complete server mirror of exactly
# these tables, so a replica that misses a change learns the same state from
# the snapshot a moment earlier. The cursor only ever has to grow, and the
# gap the deletions leave costs nothing.
#
# The rule is the shape itself rather than a list of migrations, so a later
# rename is covered by having happened: an entry survives when every field it
# names is still a column of its table, and goes when it is not.
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


# A seminar names its paper by the paper's own name now — the digest of its
# PDF. It used to carry a key of its own, "doi:…" or "title:…", from when a
# paper could have several editions and a seminar had to name the thing
# standing above them.
#
# Frozen at the shape of its own moment, like the folds above it.
_ROOM_SHAPE = (
    """uuid VARCHAR(36) NOT NULL,
       paper_sha256 VARCHAR(64) NOT NULL,
       created_by VARCHAR(36) NOT NULL,
       leader_uuid VARCHAR(36),
       status VARCHAR NOT NULL,
       scheduled_time TEXT,
       platform TEXT,
       style VARCHAR,
       style_desc TEXT,
       created_at DATETIME,
       PRIMARY KEY (uuid),
       FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
       FOREIGN KEY(created_by) REFERENCES users (uuid),
       FOREIGN KEY(leader_uuid) REFERENCES users (uuid)""",
    ("uuid", "paper_sha256", "created_by", "leader_uuid", "status",
     "scheduled_time", "platform", "style", "style_desc", "created_at"),
    ("CREATE INDEX IF NOT EXISTS ix_rooms_paper_sha256 ON rooms (paper_sha256)",),
)


def _old_room_key(doi, title) -> str:
    """The key a seminar used to be filed under.

    Written out here rather than imported, because a migration has to read
    the rows the way the code that wrote them did — and that code is gone.
    Folded in Python, as it was: SQLite's own `lower()` leaves anything but
    ASCII alone, and a title with an accent in it would not find its paper.
    """
    if doi:
        return "doi:" + doi.strip().lower()
    return "title:" + (title or "").strip().lower()


def _name_the_paper_a_seminar_is_about(conn):
    """Point each seminar at the paper it was called on.

    Idempotent by construction: `paper_key` is gone at the end, and its
    absence is what says the work is done.

    A key that names no paper cannot be carried — there is no digest to
    give the row, and a seminar about no paper is not a seminar. Those are
    dropped with what hangs off them, and counted out loud. A key that
    names two, which is what a preprint and its published version could
    look like, goes to the earliest: they are two papers with two
    conversations now, and the one that was had belongs to the paper it was
    opened on.
    """
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "rooms" not in tables or "paper_key" not in _table_columns(conn, "rooms"):
        return

    by_key: dict[str, str] = {}
    for sha256, doi, title in conn.execute(text(
        "SELECT sha256, doi, title FROM papers ORDER BY created_at, sha256"
    )):
        by_key.setdefault(_old_room_key(doi, title), sha256)

    conn.execute(text("DROP TABLE IF EXISTS _room_paper"))
    conn.execute(text(
        "CREATE TABLE _room_paper "
        "(room_uuid TEXT PRIMARY KEY NOT NULL, paper_sha256 TEXT NOT NULL)"
    ))
    stranded = []
    for room_uuid, paper_key in conn.execute(text(
        "SELECT uuid, paper_key FROM rooms"
    )):
        sha256 = by_key.get(paper_key)
        if sha256 is None:
            stranded.append(room_uuid)
            continue
        conn.execute(
            text("INSERT INTO _room_paper VALUES (:room, :paper)"),
            {"room": room_uuid, "paper": sha256},
        )

    if stranded:
        logger.warning(
            "%s seminar(s) named a paper that is not here and cannot be "
            "carried over; they and their messages are removed.", len(stranded),
        )
        for table, column in (
            ("room_messages", "room_uuid"),
            ("room_participants", "room_uuid"),
            ("room_availabilities", "room_uuid"),
            ("notifications", "room_uuid"),
        ):
            if table not in tables:
                continue
            conn.execute(
                text(f"DELETE FROM {table} WHERE {column} NOT IN "
                     "(SELECT room_uuid FROM _room_paper)"),
            )

    _rebuild_frozen(
        conn, {"rooms": _ROOM_SHAPE}, "rooms", "rooms", "r",
        "JOIN _room_paper m ON m.room_uuid = r.uuid",
        {"paper_sha256": "m.paper_sha256"},
    )
    conn.execute(text("DROP TABLE _room_paper"))


def _make_the_cursor_only_grow(conn):
    """Rebuild the change log so its sequence cannot be handed out twice.

    The column was an ordinary SQLite integer key, which is the row id, and
    a row id is max + 1 of the rows still there. The log has always had
    entries removed from it — an account closing takes its own, a merge
    drops what it invalidated, a migration drops what no replica could read
    — and every one of those could leave the next change carrying a number
    some replica is already past. That replica would then pull nothing, for
    good, and say nothing about it.

    AUTOINCREMENT is the fix, and SQLite will not add it in place. The
    rebuild carries the rows over with the sequences they have, which is
    what sets the high-water mark: the next change comes after the last one
    written rather than after the last one kept.

    Its own existence is the record that it has run — found with
    AUTOINCREMENT, there is nothing to do.
    """
    present = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "_server_change_log" not in present:
        return  # fresh; create_all writes it the right way
    declared = next(conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type='table' "
        "AND name='_server_change_log'"
    )))[0] or ""
    if "AUTOINCREMENT" in declared.upper():
        return

    table = Base.metadata.tables["_server_change_log"]
    staging_metadata = MetaData()
    for other in Base.metadata.tables.values():
        if other.name != table.name:
            other.to_metadata(staging_metadata)
    staging = table.to_metadata(staging_metadata, name="_new_server_change_log")
    conn.execute(text("DROP TABLE IF EXISTS _new_server_change_log"))
    conn.execute(CreateTable(staging))
    columns = ", ".join(f'"{column.name}"' for column in table.columns)
    conn.execute(text(
        f"INSERT INTO _new_server_change_log ({columns}) "
        f"SELECT {columns} FROM _server_change_log ORDER BY sequence"
    ))
    conn.execute(text("DROP TABLE _server_change_log"))
    conn.execute(text(
        "ALTER TABLE _new_server_change_log RENAME TO _server_change_log"
    ))
    # A rebuild puts its own indexes back: the table it dropped took them
    # with it, and the pass that would otherwise add them has already run.
    _add_missing_indexes(conn, table)


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
# do is take a database apart quietly: the passes below would find a shape
# they did not expect, see nothing they recognized, and carry on into a
# schema the rows do not fit. Stopping leaves an admin with a backup one
# command away.
SCHEMA_VERSION_KEY = "schema_version"


def _recorded_schema_version(conn) -> int:
    """Which schema this database says it is at.

    Everything written before anybody was counting is 1, which is what a
    database with no `settings` table and a database with no row in it both
    mean.
    """
    present = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "settings" not in present:
        return 1
    recorded = conn.execute(
        text("SELECT value FROM settings WHERE key = :key"),
        {"key": SCHEMA_VERSION_KEY},
    ).scalar()
    try:
        return int(recorded)
    except (TypeError, ValueError):
        return 1


def _refuse_a_database_this_build_cannot_read(conn):
    """Stop, loudly, rather than upgrade a database nothing here can read."""
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
    raise RuntimeError(
        f"This database is at schema {recorded} and this build is written "
        f"for schema {declared}. Papol does not carry a database across a "
        "break: restore a backup taken under schema "
        f"{declared}, or — if this database has already been brought to "
        f"schema {declared} by hand — record that with "
        f"\"INSERT INTO settings (key, value) VALUES ('{SCHEMA_VERSION_KEY}', "
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
    """Bring an existing database up to the shape the models declare.

    `create_all` makes a table it cannot find and nothing else — not a
    column a table has gained, and not an index, and it does not look
    inside a table it already has. This is what covers the difference.

    Most of it is driven off the model metadata, so there is no second list
    to keep in step: declare the column (with a server_default if it is NOT
    NULL, which SQLite requires to add one) and an existing database picks
    it up on the next start. What metadata cannot say — that a column has
    been re-spelled, that a table is keyed differently now — is written out
    by hand above, and each of those erases itself once it has run.
    """
    with engine.begin() as conn:
        _refuse_a_database_this_build_cannot_read(conn)
        # Retired features, dropped before the live metadata is reconciled.
        conn.execute(text("DROP TABLE IF EXISTS presence_pings"))
        # Before the metadata pass, which would otherwise try to add
        # `rooms.paper_sha256` as a NOT NULL column with nothing to put in it.
        _name_the_paper_a_seminar_is_about(conn)
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
        # Before anything is dropped from the log, so that what the rebuild
        # carries over is what sets the high-water mark.
        _make_the_cursor_only_grow(conn)
        # Last: the log is judged against the shape every table above has
        # finished arriving at.
        _forget_changes_no_replica_could_read(conn)
        # Then the tables the database has not got at all, and — once every
        # table is there to be at it — the record of which schema they are at.
        Base.metadata.create_all(bind=conn)
        _stamp_the_schema_version(conn)
