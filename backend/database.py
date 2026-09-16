from sqlalchemy import MetaData, create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn, CreateIndex, CreateTable
from contextvars import ContextVar
import os
import uuid
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
# empty `annotations` and every annotation a user has ever made is left behind in
# tables nothing reads. Geometry that had its own columns moves into `body`,
# and a note's anchor kind moves inside the anchor, where it belongs.
#
# Idempotent by construction: each source is dropped once it has been carried,
# so a second run finds nothing to carry and does nothing.
_UNIFY_ANNOTATIONS = {
    "comments": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT uuid, 'note', user_uuid, paper_uuid, page, NULL,
       content, name,
       CASE WHEN anchor IS NULL OR anchor_type IS NULL THEN '{}'
            ELSE json_object('anchor', json_insert(anchor, '$.type', anchor_type)) END,
       created_at, updated_at, revision, deleted_at
  FROM comments;
DROP TABLE comments;
""",
    "ink_strokes": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT s.uuid, 'ink', s.user_uuid, s.paper_uuid, s.page,
       s.group_uuid, '', NULL,
       json_object('points', json(s.points), 'color', s.color, 'width', s.width,
                   'opacity', s.opacity, 'shape', s.shape),
       s.created_at, s.updated_at, s.revision, s.deleted_at
  FROM ink_strokes s;
DROP TABLE ink_strokes;
""",
    "paper_clips": """
INSERT INTO annotations
  (uuid, kind, user_uuid, paper_uuid, page, group_uuid,
   content, name, body, created_at, updated_at, revision, deleted_at)
SELECT c.uuid, 'clip', c.user_uuid, c.paper_uuid, c.page, NULL,
       '', NULL,
       json_object('source', json(c.source), 'frame', json(c.frame),
                   'floating', json(CASE WHEN c.floating THEN 'true' ELSE 'false' END)),
       c.created_at, c.updated_at, c.revision, c.deleted_at
  FROM paper_clips c;
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


def _table_columns(conn, name: str) -> list:
    """The table's columns in declaration order, or [] if it does not exist."""
    return [row[1] for row in conn.execute(text(f"PRAGMA table_info({name})"))]


def _rebuild_table(conn, target: str, source: str, alias: str,
                   join: str = "", sources: dict | None = None):
    """Make `target` as the models now define it and carry `source` into it.

    SQLite will not drop a column named in a foreign key, and every column
    retiring here is one. So the table is rebuilt rather than altered: the
    model's own definition is created under a staging name, the old rows are
    selected into it, and the staging table takes the old one's place.

    A target column is filled from `sources` when named there, from the
    identically named source column when there is one, and left at its
    default otherwise."""
    sources = sources or {}
    table = Base.metadata.tables[target]
    available = set(_table_columns(conn, source))
    staging = f"_new_{target}"

    columns, expressions = [], []
    for column in table.columns:
        if column.name in sources:
            expression = sources[column.name]
        elif column.name in available:
            # Quoted: a column may be spelled with a SQLite keyword, and
            # `index` is.
            expression = f'{alias}."{column.name}"'
        else:
            continue
        columns.append(f'"{column.name}"')
        expressions.append(expression)

    # The staging table is a renamed copy of the model's own definition. Its
    # foreign keys name other tables, so those have to be copied alongside it
    # or there is nothing for the names to resolve against.
    staging_metadata = MetaData()
    for other in Base.metadata.tables.values():
        if other.name != target:
            other.to_metadata(staging_metadata)

    conn.execute(text(f"DROP TABLE IF EXISTS {staging}"))
    conn.execute(CreateTable(table.to_metadata(staging_metadata, name=staging)))
    conn.execute(text(
        f"INSERT INTO {staging} ({', '.join(columns)}) "
        f"SELECT {', '.join(expressions)} FROM {source} {alias} {join}"
    ))
    conn.execute(text(f"DROP TABLE {source}"))
    conn.execute(text(f"ALTER TABLE {staging} RENAME TO {target}"))
    for index in table.indexes:
        conn.execute(CreateIndex(index, if_not_exists=True))


# Editions are gone: a paper is one PDF, named by its content hash. A
# database written when a paper could have several has to be taken apart
# along that line, and this is where it happens.
#
# Each edition becomes a paper. The oldest keeps the paper's own UUID, so
# everything already pointing at it — copies, notes, seminar rooms, the
# desktop replica's idea of what it holds — goes on pointing at the same
# row. Every later edition becomes a paper of its own, cloning the shared
# metadata, and whatever named that edition is carried over to it.
#
# Nothing is thrown away. An edition nobody was reading becomes a paper
# nobody holds — listed in the Library like any other, with no readers
# against it — and its file stays where it is.
#
# Idempotent by construction: `paper_editions` is dropped at the end, and
# its absence is what says the work is done.
def _fold_editions(conn):
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "paper_editions" not in tables:
        return

    # Which paper each edition becomes. One paper per distinct file: two
    # editions of a paper holding the same bytes were always the same PDF
    # — the upload path said so and reused one — so they fold together
    # rather than becoming two papers nothing can tell apart. An edition
    # with no digest recorded is nobody's twin, and stands alone.
    #
    # The first file of a paper keeps that paper's UUID, so everything
    # already pointing at it goes on pointing at the same row.
    rows = list(conn.execute(text(
        "SELECT uuid, paper_uuid, sha256 FROM paper_editions "
        "ORDER BY paper_uuid, created_at, uuid"
    )))
    becomes: dict[str, str] = {}
    by_file: dict[tuple, str] = {}
    kept: set = set()
    for edition_uuid, paper_uuid, sha256 in rows:
        key = (paper_uuid, sha256 or f"edition:{edition_uuid}")
        if key in by_file:
            becomes[edition_uuid] = by_file[key]
            continue
        if paper_uuid in kept:
            target = str(uuid.uuid4())
        else:
            kept.add(paper_uuid)
            target = paper_uuid
        by_file[key] = target
        becomes[edition_uuid] = target

    # A table everything else can be joined against, rather than a statement
    # per edition. Dropped before this function returns.
    conn.execute(text("DROP TABLE IF EXISTS _edition_paper"))
    conn.execute(text(
        "CREATE TABLE _edition_paper "
        "(edition_uuid TEXT PRIMARY KEY NOT NULL, paper_uuid TEXT NOT NULL)"
    ))
    for edition_uuid, paper_uuid in becomes.items():
        conn.execute(
            text("INSERT INTO _edition_paper VALUES (:edition, :paper)"),
            {"edition": edition_uuid, "paper": paper_uuid},
        )

    # The papers the later files become, cloning the shared metadata. One
    # row per new paper, however many editions folded onto it.
    conn.execute(text(
        "INSERT INTO papers "
        "  (uuid, doi, title, authors, journal, year, created_at,"
        "   updated_at, revision, deleted_at) "
        "SELECT m.paper_uuid, p.doi, p.title, p.authors, p.journal, p.year,"
        "       p.created_at, p.updated_at, p.revision, p.deleted_at "
        "  FROM _edition_paper m "
        "  JOIN paper_editions e ON e.uuid = m.edition_uuid "
        "  JOIN papers p ON p.uuid = e.paper_uuid "
        " WHERE m.paper_uuid <> e.paper_uuid "
        " GROUP BY m.paper_uuid"
    ))

    # Each paper takes on the file of the edition it came from. The columns
    # have to be made here: the metadata pass that would otherwise add them
    # runs after this, and by then there would be nothing left to fill them
    # from.
    carried = [column for column in
               ("file_path", "sha256", "uploaded_by", "references_status",
                "references_error", "references_at")
               if column in _table_columns(conn, "paper_editions")]
    present = set(_table_columns(conn, "papers"))
    for column in carried:
        if column not in present:
            conn.execute(text(f"ALTER TABLE papers ADD COLUMN {column} TEXT"))
    conn.execute(text(
        f"UPDATE papers SET ({', '.join(carried)}) = ("
        f"  SELECT {', '.join('e.' + c for c in carried)}"
        "     FROM _edition_paper m JOIN paper_editions e ON e.uuid = m.edition_uuid"
        "    WHERE m.paper_uuid = papers.uuid"
        # Editions that folded together hold the same bytes, so the file is
        # the same whichever is read; the earliest is named so that the rest
        # — the analysis state, which can differ — is settled rather than
        # left to whatever the query happens to reach first.
        "    ORDER BY e.created_at, e.uuid LIMIT 1) "
        "WHERE uuid IN (SELECT paper_uuid FROM _edition_paper)"
    ))

    # Everything that named an edition now names the paper it became, and
    # loses the columns that named it.
    on = "LEFT JOIN _edition_paper m ON m.edition_uuid = {alias}.edition_uuid"
    if "copies" in tables:
        _rebuild_table(
            conn, "copies", "copies", "c", on.format(alias="c"),
            {"paper_uuid": "COALESCE(m.paper_uuid, c.paper_uuid)"},
        )
    if "annotations" in tables:
        # A note about the paper was never on a page, so it has no edition
        # to follow and stays where it is.
        _rebuild_table(
            conn, "annotations", "annotations", "a", on.format(alias="a"),
            {"paper_uuid": "COALESCE(m.paper_uuid, a.paper_uuid)"},
        )
    if "sharables" in tables:
        _rebuild_table(
            conn, "sharables", "sharables", "s", on.format(alias="s"),
            {"paper_uuid": "COALESCE(m.paper_uuid, s.paper_uuid)"},
        )

    # The bibliography read off a PDF belongs to the paper that PDF became.
    for source, target in (
        ("edition_references", "paper_references"),
        ("edition_citations", "paper_citations"),
        ("edition_links", "paper_links"),
    ):
        if source not in tables:
            continue
        _rebuild_table(
            conn, target, source, "r",
            "JOIN _edition_paper m ON m.edition_uuid = r.edition_uuid",
            {"paper_uuid": "m.paper_uuid"},
        )

    # Notes, ink and clips are carried into `annotations` after this, and two
    # of those tables only ever found their paper through the edition. Hand
    # them the paper directly, while there is still something to ask.
    for table in ("ink_strokes", "paper_clips"):
        if table not in tables:
            continue
        if "paper_uuid" not in _table_columns(conn, table):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN paper_uuid TEXT"))
        conn.execute(text(
            f"UPDATE {table} SET paper_uuid = ("
            "  SELECT paper_uuid FROM _edition_paper"
            f"   WHERE edition_uuid = {table}.edition_uuid)"
        ))
    if "comments" in tables:
        conn.execute(text(
            "UPDATE comments SET paper_uuid = COALESCE(("
            "  SELECT paper_uuid FROM _edition_paper"
            "   WHERE edition_uuid = comments.edition_uuid), paper_uuid)"
        ))

    conn.execute(text("DROP INDEX IF EXISTS ix_annotations_edition"))
    conn.execute(text("DROP TABLE paper_editions"))
    conn.execute(text("DROP TABLE _edition_paper"))



# One paper per file.
#
# A paper is its PDF, so two rows holding the same bytes are one paper
# written down twice. The old upload path could produce that pair: it
# matched on DOI, so a second upload of the same file under a title it had
# not seen became a paper of its own. The earliest row survives and
# everything pointing at the others is carried onto it.
#
# Run on every start rather than once. It is a no-op on a database that has
# no duplicates — which is every database the current upload path writes —
# and it means a pair that appears any other way is closed at the next
# restart instead of living on.
_PAPER_DEPENDENTS = (
    "annotations", "sharables", "paper_references", "paper_citations", "paper_links",
)

# What a copy knows that is the user's own. A user holding both rows was
# always holding one paper, so the surviving copy takes anything it has not
# got rather than either version being thrown away.
_COPY_FIELDS = (
    "summary", "thought",
    "rating_expertise", "rating_reading", "rating_liking",
)


def _merge_duplicate_papers(conn):
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "papers" not in tables:
        return
    digests = [row[0] for row in conn.execute(text(
        "SELECT sha256 FROM papers WHERE sha256 IS NOT NULL "
        "GROUP BY sha256 HAVING COUNT(*) > 1"
    ))]
    for digest in digests:
        rows = [row[0] for row in conn.execute(
            text("SELECT uuid FROM papers WHERE sha256 = :digest "
                 "ORDER BY created_at, uuid"),
            {"digest": digest},
        )]
        survivor, losers = rows[0], rows[1:]
        for loser in losers:
            _merge_paper_into(conn, tables, loser, survivor)


def _merge_paper_into(conn, tables: set, loser: str, survivor: str):
    # A user with a copy on both rows keeps the one on the survivor, since
    # that is what everything else already points at.
    paired = list(conn.execute(
        text("SELECT losing.uuid, keeping.uuid "
             "  FROM copies losing "
             "  JOIN copies keeping ON keeping.paper_uuid = :survivor "
             "                     AND keeping.user_uuid = losing.user_uuid "
             " WHERE losing.paper_uuid = :loser"),
        {"survivor": survivor, "loser": loser},
    ))
    for losing_copy, keeping_copy in paired:
        bound = {"losing": losing_copy, "keeping": keeping_copy}
        filled = ", ".join(
            f"{field} = COALESCE({field}, "
            f"(SELECT {field} FROM copies WHERE uuid = :losing))"
            for field in _COPY_FIELDS
        )
        conn.execute(text(
            f"UPDATE copies SET {filled}, "
            # Either row saying so is the user saying so.
            "  is_author = MAX(is_author, "
            "    (SELECT is_author FROM copies WHERE uuid = :losing)), "
            # Keeping the paper outranks having let it go: a user who holds
            # it under either row still holds it.
            "  deleted_at = CASE "
            "    WHEN (SELECT deleted_at FROM copies WHERE uuid = :losing) IS NULL "
            "    THEN NULL ELSE deleted_at END "
            " WHERE uuid = :keeping"
        ), bound)
        # Noted before they move: a link that ends up on the surviving copy
        # has still stopped being the row the log describes.
        tag_links = [row[0] for row in conn.execute(
            text("SELECT uuid FROM copy_tags WHERE copy_uuid = :losing"), bound,
        )]
        # Tags follow the copy, minus any the surviving copy already carries.
        conn.execute(text(
            "UPDATE copy_tags SET copy_uuid = :keeping WHERE copy_uuid = :losing "
            "  AND tag_uuid NOT IN "
            "      (SELECT tag_uuid FROM copy_tags WHERE copy_uuid = :keeping)"
        ), bound)
        conn.execute(text("DELETE FROM copy_tags WHERE copy_uuid = :losing"), bound)
        conn.execute(text("DELETE FROM copies WHERE uuid = :losing"), bound)
        _forget_change_log(conn, tables, "copy_tags", tag_links)
        _forget_change_log(conn, tables, "copies", [losing_copy])

    for table in ("copies", *_PAPER_DEPENDENTS):
        if table not in tables:
            continue
        conn.execute(
            text(f"UPDATE {table} SET paper_uuid = :survivor WHERE paper_uuid = :loser"),
            {"survivor": survivor, "loser": loser},
        )
    conn.execute(text("DELETE FROM papers WHERE uuid = :loser"), {"loser": loser})


def _forget_change_log(conn, tables: set, table_name: str, row_uuids: list):
    """Drop the log entries for rows this merge removed.

    A replica still behind the cursor would otherwise replay them and put
    back a copy of a paper that no longer exists. The cursor only has to
    grow, so the gap costs nothing."""
    if "_server_change_log" not in tables or not row_uuids:
        return
    for row_uuid in row_uuids:
        conn.execute(
            text("DELETE FROM _server_change_log "
                 "WHERE table_name = :table_name AND row_uuid = :row_uuid"),
            {"table_name": table_name, "row_uuid": row_uuid},
        )


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
        # Before the annotation unification, which reads columns this leaves
        # behind, and before the metadata pass, which would otherwise add
        # `papers.sha256` as an empty column the fold then has to fill.
        _fold_editions(conn)
        _unify_annotations(conn)
        # After the fold, which can leave two papers on one file when they
        # were two papers before.
        _merge_duplicate_papers(conn)
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
