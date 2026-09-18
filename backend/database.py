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
    # The shape of this migration's own moment, not the models' — the fold
    # and the re-key below carry it forward from here, and they can only do
    # that if what they find is what this wrote.
    if "annotations" not in present:
        body, _columns, indexes = _FOLD_SHAPES["annotations"]
        conn.execute(text(f"CREATE TABLE annotations ({body})"))
        for index in indexes:
            conn.execute(text(index))
    for name in sources:
        for statement in _UNIFY_ANNOTATIONS[name].strip().split(";"):
            if statement.strip():
                conn.execute(text(statement))


def _table_columns(conn, name: str) -> list:
    """The table's columns in declaration order, or [] if it does not exist."""
    return [row[1] for row in conn.execute(text(f"PRAGMA table_info({name})"))]


def _rebuild_to_models(conn, target: str, source: str, alias: str,
                       join: str = "", sources: dict | None = None):
    """Make `target` as the models now define it and carry `source` into it.

    For bringing a table up to today's shape, where following the models is
    the whole point. A migration that has to produce the shape of its own
    moment wants `_rebuild_frozen` instead.

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
        _rebuild_frozen(
            conn, _FOLD_SHAPES, "copies", "copies", "c", on.format(alias="c"),
            {"paper_uuid": "COALESCE(m.paper_uuid, c.paper_uuid)"},
        )
    if "annotations" in tables:
        # A note about the paper was never on a page, so it has no edition
        # to follow and stays where it is.
        _rebuild_frozen(
            conn, _FOLD_SHAPES, "annotations", "annotations", "a", on.format(alias="a"),
            {"paper_uuid": "COALESCE(m.paper_uuid, a.paper_uuid)"},
        )
    if "sharables" in tables:
        _rebuild_frozen(
            conn, _FOLD_SHAPES, "sharables", "sharables", "s", on.format(alias="s"),
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
        _rebuild_frozen(
            conn, _FOLD_SHAPES, target, source, "r",
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
# The shapes these tables had when editions were folded away.
#
# Written out rather than read from the models, because a migration has to
# produce the schema of its own moment. Driving it off live metadata means a
# later rename quietly rewrites an old database into a shape its data does
# not fit — the column the models have moved on to is not the column the
# rows are in, so the link is dropped on the floor and nothing says so.
_FOLD_SHAPES = {
    "copies": (
        """uuid VARCHAR(36) NOT NULL,
           paper_uuid VARCHAR(36) NOT NULL,
           user_uuid VARCHAR(36) NOT NULL,
           shelf_uuid VARCHAR(36),
           summary TEXT,
           thought TEXT,
           is_author BOOLEAN DEFAULT '0' NOT NULL,
           rating_expertise INTEGER,
           rating_reading INTEGER,
           rating_liking INTEGER,
           created_at DATETIME,
           updated_at DATETIME,
           revision INTEGER DEFAULT '0' NOT NULL,
           deleted_at DATETIME,
           PRIMARY KEY (uuid),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid),
           CONSTRAINT uq_copy UNIQUE (paper_uuid, user_uuid),
           FOREIGN KEY(shelf_uuid) REFERENCES shelves (uuid)""",
        ("uuid", "paper_uuid", "user_uuid", "shelf_uuid", "summary", "thought",
         "is_author", "rating_expertise", "rating_reading", "rating_liking",
         "created_at", "updated_at", "revision", "deleted_at"),
        ("CREATE INDEX IF NOT EXISTS ix_copies_user_uuid ON copies (user_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_copies_shelf_uuid ON copies (shelf_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_copies_paper_uuid ON copies (paper_uuid)"),
    ),
    "annotations": (
        """uuid VARCHAR(36) NOT NULL,
           kind VARCHAR(8) NOT NULL,
           user_uuid VARCHAR(36) NOT NULL,
           paper_uuid VARCHAR(36) NOT NULL,
           page INTEGER,
           group_uuid VARCHAR(36),
           content TEXT NOT NULL,
           name VARCHAR,
           body TEXT DEFAULT '{}' NOT NULL,
           created_at DATETIME,
           updated_at DATETIME,
           revision INTEGER DEFAULT '0' NOT NULL,
           deleted_at DATETIME,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid)""",
        ("uuid", "kind", "user_uuid", "paper_uuid", "page", "group_uuid",
         "content", "name", "body", "created_at", "updated_at", "revision",
         "deleted_at"),
        ("CREATE INDEX IF NOT EXISTS ix_annotations_user_uuid ON annotations (user_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_page ON annotations (page)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_paper_uuid ON annotations (paper_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_kind ON annotations (kind)"),
    ),
    "sharables": (
        """uuid VARCHAR(36) NOT NULL,
           kind VARCHAR(8) DEFAULT 'lean' NOT NULL,
           user_uuid VARCHAR(36),
           paper_uuid VARCHAR(36) NOT NULL,
           created_at DATETIME NOT NULL,
           revoked_at DATETIME,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid)""",
        ("uuid", "kind", "user_uuid", "paper_uuid", "created_at", "revoked_at"),
        ("CREATE INDEX IF NOT EXISTS ix_sharables_user_uuid ON sharables (user_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_sharables_paper_uuid ON sharables (paper_uuid)"),
    ),
    "paper_references": (
        """uuid VARCHAR(36) NOT NULL,
           paper_uuid VARCHAR(36) NOT NULL,
           "key" VARCHAR NOT NULL,
           "index" INTEGER NOT NULL,
           raw TEXT, title TEXT, authors TEXT, year INTEGER, journal TEXT,
           doi TEXT, arxiv_id TEXT, page INTEGER, y FLOAT,
           resolved_status VARCHAR, resolved_at DATETIME, resolution TEXT,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid)""",
        ("uuid", "paper_uuid", "key", "index", "raw", "title", "authors",
         "year", "journal", "doi", "arxiv_id", "page", "y",
         "resolved_status", "resolved_at", "resolution"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_references_paper_uuid "
         "ON paper_references (paper_uuid)",),
    ),
    "paper_citations": (
        """uuid VARCHAR(36) NOT NULL,
           paper_uuid VARCHAR(36) NOT NULL,
           reference_uuid VARCHAR(36),
           label TEXT,
           page INTEGER NOT NULL,
           x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL,
           inferred BOOLEAN,
           PRIMARY KEY (uuid),
           FOREIGN KEY(reference_uuid) REFERENCES paper_references (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid)""",
        ("uuid", "paper_uuid", "reference_uuid", "label", "page",
         "x", "y", "w", "h", "inferred"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_citations_page ON paper_citations (page)",
         "CREATE INDEX IF NOT EXISTS ix_paper_citations_paper_uuid "
         "ON paper_citations (paper_uuid)"),
    ),
    "paper_links": (
        """uuid VARCHAR(36) NOT NULL,
           paper_uuid VARCHAR(36) NOT NULL,
           kind VARCHAR NOT NULL,
           label TEXT,
           page INTEGER NOT NULL,
           x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL,
           target_page INTEGER NOT NULL,
           target_y FLOAT NOT NULL,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_uuid) REFERENCES papers (uuid)""",
        ("uuid", "paper_uuid", "kind", "label", "page", "x", "y", "w", "h",
         "target_page", "target_y"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_links_paper_uuid ON paper_links (paper_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_paper_links_page ON paper_links (page)"),
    ),
}


def _rebuild_frozen(conn, shapes: dict, target: str, source: str, alias: str,
                    join: str = "", sources: dict | None = None):
    """Rebuild `source` into `target` at the shape `shapes` records.

    The same move as `_rebuild_to_models`, against a schema written down by
    the migration that needs it instead of read from the models, so that
    what a migration produces cannot drift with them."""
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


# Done once, under `_one_paper_per_file` below. The pairs are historical:
# the old upload path matched on DOI, so the same file uploaded under a
# title Papol had not seen became a paper of its own.
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


def _one_paper_per_file(conn):
    """Close the historical pairs, and put up the index that keeps them shut.

    A paper is its PDF, so the digest is unique by rule. Making that a unique
    index is what turns the rule into something the database holds rather
    than something every writer has to remember — but it can only go up once
    the rows that would break it are gone, so the merge comes first.

    The index's own existence is the record that this has been done: found
    and unique, there is nothing left to do and the merge never runs again.
    A database carrying the earlier plain index has it replaced."""
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "papers" not in tables:
        return
    if "uuid" not in _table_columns(conn, "papers"):
        return  # the digest is the key; being unique is not something to add
    # (seq, name, unique, origin, partial)
    indexes = {
        row[1]: row[2] for row in conn.execute(text("PRAGMA index_list(papers)"))
    }
    if indexes.get(_SHA256_INDEX) == 1:
        return
    _merge_duplicate_papers(conn)
    if _SHA256_INDEX in indexes:
        conn.execute(text(f"DROP INDEX {_SHA256_INDEX}"))
    # Papers with no file recorded are not one another's duplicates: SQLite
    # counts NULLs as distinct, which is exactly what is wanted here.
    conn.execute(text(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {_SHA256_INDEX} ON papers(sha256)"
    ))


_SHA256_INDEX = "ix_papers_sha256"


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


# A paper is its PDF, so the file and its digest are not optional. Older
# rows could be stored without them, and SQLite cannot tighten a column in
# place, so the table is rebuilt to the shape the models now declare.
#
# Only when there is nothing in the way. A row with no digest cannot be
# given one here — the bytes are what would say, and they may be long gone —
# so it is left alone and reported, and the service starts rather than
# refusing to. The column stays as it was until someone settles the row.
# A paper is named by its file, and by nothing else.
#
# It used to carry a UUID as well — a second name for a thing that already
# had one. The digest is what every holder of the bytes arrives at without
# asking, so it becomes the key, and the tables that pointed at a paper name
# it the same way.
#
# Frozen, like the fold above, at the shape of its own moment.
_REKEY_SHAPES = {
    "papers": (
        """sha256 VARCHAR(64) NOT NULL,
           doi TEXT,
           title TEXT NOT NULL,
           authors TEXT,
           journal TEXT,
           year INTEGER,
           file_path TEXT NOT NULL,
           uploaded_by VARCHAR(36),
           created_at DATETIME,
           updated_at DATETIME,
           revision INTEGER DEFAULT '1' NOT NULL,
           deleted_at DATETIME,
           references_status VARCHAR,
           references_error TEXT,
           references_at DATETIME,
           PRIMARY KEY (sha256),
           FOREIGN KEY(uploaded_by) REFERENCES users (uuid)""",
        ("sha256", "doi", "title", "authors", "journal", "year", "file_path",
         "uploaded_by", "created_at", "updated_at", "revision", "deleted_at",
         "references_status", "references_error", "references_at"),
        (),
    ),
    "copies": (
        """uuid VARCHAR(36) NOT NULL,
           paper_sha256 VARCHAR(64) NOT NULL,
           user_uuid VARCHAR(36) NOT NULL,
           shelf_uuid VARCHAR(36),
           summary TEXT,
           thought TEXT,
           is_author BOOLEAN DEFAULT '0' NOT NULL,
           rating_expertise INTEGER,
           rating_reading INTEGER,
           rating_liking INTEGER,
           created_at DATETIME,
           updated_at DATETIME,
           revision INTEGER DEFAULT '0' NOT NULL,
           deleted_at DATETIME,
           PRIMARY KEY (uuid),
           CONSTRAINT uq_copy UNIQUE (paper_sha256, user_uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid),
           FOREIGN KEY(shelf_uuid) REFERENCES shelves (uuid)""",
        ("uuid", "paper_sha256", "user_uuid", "shelf_uuid", "summary", "thought",
         "is_author", "rating_expertise", "rating_reading", "rating_liking",
         "created_at", "updated_at", "revision", "deleted_at"),
        ("CREATE INDEX IF NOT EXISTS ix_copies_paper_sha256 ON copies (paper_sha256)",
         "CREATE INDEX IF NOT EXISTS ix_copies_shelf_uuid ON copies (shelf_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_copies_user_uuid ON copies (user_uuid)"),
    ),
    "annotations": (
        """uuid VARCHAR(36) NOT NULL,
           kind VARCHAR(8) NOT NULL,
           user_uuid VARCHAR(36) NOT NULL,
           paper_sha256 VARCHAR(64) NOT NULL,
           page INTEGER,
           group_uuid VARCHAR(36),
           content TEXT NOT NULL,
           name VARCHAR,
           body TEXT DEFAULT '{}' NOT NULL,
           created_at DATETIME,
           updated_at DATETIME,
           revision INTEGER DEFAULT '0' NOT NULL,
           deleted_at DATETIME,
           PRIMARY KEY (uuid),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)""",
        ("uuid", "kind", "user_uuid", "paper_sha256", "page", "group_uuid",
         "content", "name", "body", "created_at", "updated_at", "revision",
         "deleted_at"),
        ("CREATE INDEX IF NOT EXISTS ix_annotations_kind ON annotations (kind)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_user_uuid ON annotations (user_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_page ON annotations (page)",
         "CREATE INDEX IF NOT EXISTS ix_annotations_paper_sha256 "
         "ON annotations (paper_sha256)"),
    ),
    "sharables": (
        """uuid VARCHAR(36) NOT NULL,
           kind VARCHAR(8) DEFAULT 'lean' NOT NULL,
           user_uuid VARCHAR(36),
           paper_sha256 VARCHAR(64) NOT NULL,
           created_at DATETIME NOT NULL,
           revoked_at DATETIME,
           PRIMARY KEY (uuid),
           FOREIGN KEY(user_uuid) REFERENCES users (uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)""",
        ("uuid", "kind", "user_uuid", "paper_sha256", "created_at", "revoked_at"),
        ("CREATE INDEX IF NOT EXISTS ix_sharables_user_uuid ON sharables (user_uuid)",
         "CREATE INDEX IF NOT EXISTS ix_sharables_paper_sha256 "
         "ON sharables (paper_sha256)"),
    ),
    "paper_references": (
        """uuid VARCHAR(36) NOT NULL,
           paper_sha256 VARCHAR(64) NOT NULL,
           "key" VARCHAR NOT NULL,
           "index" INTEGER NOT NULL,
           raw TEXT, title TEXT, authors TEXT, year INTEGER, journal TEXT,
           doi TEXT, arxiv_id TEXT, page INTEGER, y FLOAT,
           resolved_status VARCHAR, resolved_at DATETIME, resolution TEXT,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)""",
        ("uuid", "paper_sha256", "key", "index", "raw", "title", "authors",
         "year", "journal", "doi", "arxiv_id", "page", "y",
         "resolved_status", "resolved_at", "resolution"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_references_paper_sha256 "
         "ON paper_references (paper_sha256)",),
    ),
    "paper_citations": (
        """uuid VARCHAR(36) NOT NULL,
           paper_sha256 VARCHAR(64) NOT NULL,
           reference_uuid VARCHAR(36),
           label TEXT,
           page INTEGER NOT NULL,
           x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL,
           inferred BOOLEAN,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256),
           FOREIGN KEY(reference_uuid) REFERENCES paper_references (uuid)""",
        ("uuid", "paper_sha256", "reference_uuid", "label", "page",
         "x", "y", "w", "h", "inferred"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_citations_paper_sha256 "
         "ON paper_citations (paper_sha256)",
         "CREATE INDEX IF NOT EXISTS ix_paper_citations_page ON paper_citations (page)"),
    ),
    "paper_links": (
        """uuid VARCHAR(36) NOT NULL,
           paper_sha256 VARCHAR(64) NOT NULL,
           kind VARCHAR NOT NULL,
           label TEXT,
           page INTEGER NOT NULL,
           x FLOAT NOT NULL, y FLOAT NOT NULL, w FLOAT NOT NULL, h FLOAT NOT NULL,
           target_page INTEGER NOT NULL,
           target_y FLOAT NOT NULL,
           PRIMARY KEY (uuid),
           FOREIGN KEY(paper_sha256) REFERENCES papers (sha256)""",
        ("uuid", "paper_sha256", "kind", "label", "page", "x", "y", "w", "h",
         "target_page", "target_y"),
        ("CREATE INDEX IF NOT EXISTS ix_paper_links_page ON paper_links (page)",
         "CREATE INDEX IF NOT EXISTS ix_paper_links_paper_sha256 "
         "ON paper_links (paper_sha256)"),
    ),
}

# Everything that named a paper, and the alias it named it under.
_PAPER_REFERRERS = (
    ("copies", "c"),
    ("annotations", "a"),
    ("sharables", "s"),
    ("paper_references", "r"),
    ("paper_citations", "t"),
    ("paper_links", "l"),
)


def _require_every_paper_to_have_a_file(conn):
    """Stop, loudly, if any paper cannot say which file it is.

    A paper is its PDF and is keyed by it, so a row with no digest has no
    name under the new schema. Nothing here can give it one: the bytes are
    what would say, and they may be long gone.

    This refuses to start rather than carrying on without them. Carrying on
    is not on offer — the models ask for a shape this database would not
    have — and a service that starts and then fails every request is worse
    than one that says what is wrong while someone can still fix it."""
    stranded = [
        row[0] for row in conn.execute(text(
            "SELECT uuid FROM papers "
            " WHERE sha256 IS NULL OR sha256 = ''"
            "    OR file_path IS NULL OR file_path = ''"
        ))
    ]
    if not stranded:
        return
    listed = ", ".join(stranded[:5]) + (" …" if len(stranded) > 5 else "")
    raise RuntimeError(
        f"{len(stranded)} paper(s) have no file recorded and cannot be keyed "
        f"by one: {listed}. A paper is its PDF. Give each row the sha256 of "
        "its file, or remove it and whatever points at it, and start again."
    )


def _rekey_papers_to_the_digest(conn):
    """Make the digest the paper's key, and drop the UUID it had beside it.

    Runs after the duplicates are closed, because the digest is about to
    have to be unique by construction rather than by index."""
    tables = {
        row[0] for row in conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ))
    }
    if "papers" not in tables or "uuid" not in _table_columns(conn, "papers"):
        return  # fresh, or already keyed by the digest
    _require_every_paper_to_have_a_file(conn)

    # The old key beside the new one, for as long as it takes to carry the
    # tables across.
    conn.execute(text("DROP TABLE IF EXISTS _paper_key"))
    conn.execute(text(
        "CREATE TABLE _paper_key AS SELECT uuid, sha256 FROM papers"
    ))

    for target, alias in _PAPER_REFERRERS:
        if target not in tables:
            continue
        stranded = next(conn.execute(text(
            f"SELECT COUNT(*) FROM {target} WHERE paper_uuid NOT IN "
            "(SELECT uuid FROM _paper_key)"
        )))[0]
        if stranded:
            # Rows naming a paper that is not there. They were already
            # broken; say so rather than let the join drop them quietly.
            logger.warning(
                "%s %s row(s) name a paper that does not exist and cannot be "
                "carried over to the new key.", stranded, target,
            )
        _rebuild_frozen(
            conn, _REKEY_SHAPES, target, target, alias,
            f"JOIN _paper_key k ON k.uuid = {alias}.paper_uuid",
            {"paper_sha256": "k.sha256"},
        )

    _rebuild_frozen(conn, _REKEY_SHAPES, "papers", "papers", "p")
    conn.execute(text("DROP TABLE _paper_key"))


def _require_a_file(conn):
    columns = {
        row[1]: row[3] for row in conn.execute(text("PRAGMA table_info(papers)"))
    }
    if not columns:
        return
    if all(columns.get(name) for name in ("file_path", "sha256")):
        return  # already NOT NULL
    _require_every_paper_to_have_a_file(conn)
    _rebuild_to_models(conn, "papers", "papers", "paper")


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
        # After both, because the fold can leave two papers on one file when
        # they were two papers before, and because the annotations being
        # repointed have to have reached their table first.
        _one_paper_per_file(conn)
        # Then the digest can be the key itself.
        _rekey_papers_to_the_digest(conn)
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
            _add_missing_indexes(conn, table)
        # Last: the rebuild copies whatever the model declares, so every
        # column it declares has to be there to copy.
        _require_a_file(conn)
        # Before anything is dropped from the log, so that what the rebuild
        # carries over is what sets the high-water mark.
        _make_the_cursor_only_grow(conn)
        # Later still: the log is judged against the shape every table
        # above has finished arriving at.
        _forget_changes_no_replica_could_read(conn)
