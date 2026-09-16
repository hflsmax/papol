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


# Notes, ink and clips became one table of annotations. The desktop replica
# carries this same move; the server needs it too, or `create_all` makes an
# empty `annotations` and every mark a reader has ever made is left behind in
# tables nothing reads. Geometry that had its own columns moves into `body`,
# and a note's anchor kind moves inside the anchor, where it belongs.
#
# Idempotent by construction: each source is dropped once it has been carried,
# so a second run finds nothing to carry and does nothing.
_UNIFY_ANNOTATIONS = {
    "comments": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT uuid, 'note', user_uuid, paper_uuid, edition_uuid, page, NULL,
       content, name,
       CASE WHEN anchor IS NULL OR anchor_type IS NULL THEN '{}'
            ELSE json_object('anchor', json_insert(anchor, '$.type', anchor_type)) END,
       created_at, updated_at, revision, deleted_at
  FROM comments;
DROP TABLE comments;
""",
    "ink_strokes": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT s.uuid, 'ink', s.user_uuid, e.paper_uuid, s.edition_uuid, s.page,
       s.group_uuid, '', NULL,
       json_object('points', json(s.points), 'color', s.color, 'width', s.width,
                   'opacity', s.opacity, 'shape', s.shape),
       s.created_at, s.updated_at, s.revision, s.deleted_at
  FROM ink_strokes s JOIN paper_editions e ON e.uuid = s.edition_uuid;
DROP TABLE ink_strokes;
""",
    "paper_clips": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, edition_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT c.uuid, 'clip', c.user_uuid, e.paper_uuid, c.edition_uuid, c.page, NULL,
       '', NULL,
       json_object('source', json(c.source), 'frame', json(c.frame),
                   'floating', json(CASE WHEN c.floating THEN 'true' ELSE 'false' END)),
       c.created_at, c.updated_at, c.revision, c.deleted_at
  FROM paper_clips c JOIN paper_editions e ON e.uuid = c.edition_uuid;
DROP TABLE paper_clips;
""",
}


def _unify_annotations(conn):
    """Carry notes, ink and clips into `annotations`, then retire their tables.

    Runs before the metadata pass, and ahead of `create_all`, so the
    destination has to be made here rather than waited for. A database that
    never had the three tables — a fresh install, or one already carried —
    finds nothing to do."""
    present = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    sources = [name for name in _UNIFY_ANNOTATIONS if name in present]
    if not sources:
        return
    Base.metadata.tables["annotations"].create(conn, checkfirst=True)
    for name in sources:
        for statement in _UNIFY_ANNOTATIONS[name].strip().split(";"):
            if statement.strip():
                conn.execute(text(statement))


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
        _unify_annotations(conn)
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
