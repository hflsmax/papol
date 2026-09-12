from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn
from contextvars import ContextVar
import os
from pathlib import Path
import hashlib
import urllib.parse
import uuid

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


def migrate():
    """Add columns the models declare but an existing table lacks.
    create_all only creates missing tables, so a database written under an
    earlier schema needs these ALTERs. Driven off the model metadata, so
    there is no second list to keep in step: declare the column on the
    model (with a server_default if it is NOT NULL, which SQLite requires
    to add one) and an existing database picks it up on the next start."""
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


def _table_exists(conn, name: str) -> bool:
    return conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": name},
    ).fetchone() is not None


def backfill_board_guids():
    """Give legacy boards their permanent public route identifier."""
    with engine.begin() as conn:
        if not _table_exists(conn, "boards"):
            return
        rows = conn.execute(text("SELECT id FROM boards WHERE guid IS NULL OR guid = ''")).all()
        for (board_id,) in rows:
            conn.execute(
                text("UPDATE boards SET guid=:guid WHERE id=:id"),
                {"guid": str(uuid.uuid4()), "id": board_id},
            )
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_boards_guid ON boards (guid)"
        ))


def backfill_board_sync_identity():
    """Populate the UUID relationship columns used by the sync protocol."""
    with engine.begin() as conn:
        if not all(_table_exists(conn, table) for table in (
            "boards", "board_groups", "board_items",
        )):
            return
        boards = conn.execute(text(
            "SELECT id, guid, sync_id FROM boards"
        )).all()
        for board_id, guid, sync_id in boards:
            value = sync_id or guid or str(uuid.uuid4())
            conn.execute(text(
                "UPDATE boards SET sync_id=:sync_id, guid=COALESCE(guid,:sync_id) WHERE id=:id"
            ), {"sync_id": value, "id": board_id})
        groups = conn.execute(text(
            "SELECT board_groups.id, board_groups.sync_id, boards.sync_id "
            "FROM board_groups JOIN boards ON boards.id=board_groups.board_id"
        )).all()
        for group_id, sync_id, board_sync_id in groups:
            conn.execute(text(
                "UPDATE board_groups SET sync_id=:sync_id, board_sync_id=:board_sync_id, "
                "updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1) WHERE id=:id"
            ), {
                "sync_id": sync_id or str(uuid.uuid4()),
                "board_sync_id": board_sync_id,
                "id": group_id,
            })
        items = conn.execute(text(
            "SELECT board_items.id, board_items.sync_id, boards.sync_id, board_groups.sync_id "
            "FROM board_items JOIN boards ON boards.id=board_items.board_id "
            "LEFT JOIN board_groups ON board_groups.id=board_items.group_id"
        )).all()
        for item_id, sync_id, board_sync_id, group_sync_id in items:
            conn.execute(text(
                "UPDATE board_items SET sync_id=:sync_id, board_sync_id=:board_sync_id, "
                "group_sync_id=:group_sync_id, updated_at=COALESCE(updated_at,created_at), "
                "revision=MAX(revision,1) WHERE id=:id"
            ), {
                "sync_id": sync_id or str(uuid.uuid4()),
                "board_sync_id": board_sync_id,
                "group_sync_id": group_sync_id,
                "id": item_id,
            })
        conn.execute(text(
            "UPDATE boards SET updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1)"
        ))
        if _table_exists(conn, "shelves"):
            conn.execute(text(
                "UPDATE boards SET shelf_sync_id=(SELECT shelves.sync_id FROM shelves "
                "WHERE shelves.id=boards.shelf_id)"
            ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_boards_sync_id ON boards(sync_id)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_board_groups_sync_id ON board_groups(sync_id)"
        ))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_board_items_sync_id ON board_items(sync_id)"
        ))


def backfill_annotation_sync_identity():
    """Populate stable UUID references for papers and private annotations."""
    with engine.begin() as conn:
        required = ("papers", "paper_editions", "comments", "ink_strokes", "paper_clips")
        if not all(_table_exists(conn, table) for table in required):
            return
        for table in ("papers", "paper_editions"):
            for row_id, sync_id in conn.execute(text(
                f"SELECT id, sync_id FROM {table}"
            )).all():
                conn.execute(text(
                    f"UPDATE {table} SET sync_id=:sync_id WHERE id=:id"
                ), {"sync_id": sync_id or str(uuid.uuid4()), "id": row_id})
        conn.execute(text(
            "UPDATE paper_editions SET paper_sync_id=(SELECT papers.sync_id FROM papers "
            "WHERE papers.id=paper_editions.paper_id), "
            "updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1)"
        ))
        conn.execute(text(
            "UPDATE papers SET updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1)"
        ))
        relationships = {
            "comments": (
                "paper_sync_id=(SELECT papers.sync_id FROM papers WHERE papers.id=comments.paper_id), "
                "edition_sync_id=(SELECT paper_editions.sync_id FROM paper_editions "
                "WHERE paper_editions.id=comments.edition_id)"
            ),
            "ink_strokes": (
                "edition_sync_id=(SELECT paper_editions.sync_id FROM paper_editions "
                "WHERE paper_editions.id=ink_strokes.edition_id)"
            ),
            "paper_clips": (
                "edition_sync_id=(SELECT paper_editions.sync_id FROM paper_editions "
                "WHERE paper_editions.id=paper_clips.edition_id)"
            ),
        }
        for table, relationship_sql in relationships.items():
            rows = conn.execute(text(f"SELECT id, sync_id FROM {table}")).all()
            for row_id, sync_id in rows:
                conn.execute(text(
                    f"UPDATE {table} SET sync_id=:sync_id, {relationship_sql}, "
                    "updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1) "
                    "WHERE id=:id"
                ), {"sync_id": sync_id or str(uuid.uuid4()), "id": row_id})
        for table in required:
            conn.execute(text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_sync_id ON {table}(sync_id)"
            ))


def backfill_nook_sync_identity():
    """Populate stable UUIDs and UUID relationships for private nook rows."""
    with engine.begin() as conn:
        if not all(_table_exists(conn, table) for table in ("shelves", "tags", "copies")):
            return
        for table in ("shelves", "tags"):
            for row_id, sync_id in conn.execute(text(
                f"SELECT id, sync_id FROM {table}"
            )).all():
                conn.execute(text(
                    f"UPDATE {table} SET sync_id=:sync_id, "
                    "updated_at=COALESCE(updated_at,created_at), revision=MAX(revision,1) "
                    "WHERE id=:id"
                ), {"sync_id": sync_id or str(uuid.uuid4()), "id": row_id})
        copies = conn.execute(text(
            "SELECT copies.id, copies.sync_id, papers.sync_id, shelves.sync_id, "
            "paper_editions.sync_id, ignored.sync_id "
            "FROM copies JOIN papers ON papers.id=copies.paper_id "
            "LEFT JOIN shelves ON shelves.id=copies.shelf_id "
            "LEFT JOIN paper_editions ON paper_editions.id=copies.edition_id "
            "LEFT JOIN paper_editions AS ignored ON ignored.id=copies.ignored_edition_id"
        )).all()
        for row_id, sync_id, paper_id, shelf_id, edition_id, ignored_id in copies:
            conn.execute(text(
                "UPDATE copies SET sync_id=:sync_id,paper_sync_id=:paper_id,"
                "shelf_sync_id=:shelf_id,edition_sync_id=:edition_id,"
                "ignored_edition_sync_id=:ignored_id,"
                "updated_at=COALESCE(updated_at,created_at),revision=MAX(revision,1) "
                "WHERE id=:id"
            ), {
                "sync_id": sync_id or str(uuid.uuid4()), "paper_id": paper_id,
                "shelf_id": shelf_id, "edition_id": edition_id,
                "ignored_id": ignored_id, "id": row_id,
            })
        for table in ("shelves", "tags", "copies"):
            conn.execute(text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS ix_{table}_sync_id ON {table}(sync_id)"
            ))
        if _table_exists(conn, "copy_tags"):
            links = conn.execute(text(
                "SELECT copy_tags.copy_id,copy_tags.tag_id,copy_tags.sync_id,"
                "copies.sync_id,tags.sync_id,copies.user_id "
                "FROM copy_tags JOIN copies ON copies.id=copy_tags.copy_id "
                "JOIN tags ON tags.id=copy_tags.tag_id"
            )).all()
            for copy_id, tag_id, sync_id, copy_sync_id, tag_sync_id, user_id in links:
                conn.execute(text(
                    "UPDATE copy_tags SET sync_id=:sync_id,copy_sync_id=:copy_sync_id,"
                    "tag_sync_id=:tag_sync_id,user_id=:user_id,"
                    "created_at=COALESCE(created_at,CURRENT_TIMESTAMP),"
                    "updated_at=COALESCE(updated_at,CURRENT_TIMESTAMP),revision=MAX(revision,1) "
                    "WHERE copy_id=:copy_id AND tag_id=:tag_id"
                ), {
                    "sync_id": sync_id or str(uuid.uuid4()), "copy_sync_id": copy_sync_id,
                    "tag_sync_id": tag_sync_id, "user_id": user_id,
                    "copy_id": copy_id, "tag_id": tag_id,
                })
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_copy_tags_sync_id ON copy_tags(sync_id)"
            ))
        if _table_exists(conn, "boards"):
            conn.execute(text(
                "UPDATE boards SET shelf_sync_id=(SELECT shelves.sync_id FROM shelves "
                "WHERE shelves.id=boards.shelf_id)"
            ))


def normalize_board_group_kinds():
    """Rename the legacy chapter discriminator without breaking saved boards."""
    with engine.begin() as conn:
        if not _table_exists(conn, "board_groups"):
            return
        conn.execute(text(
            "UPDATE board_groups SET kind='booklet' WHERE kind='chapter'"
        ))


def backfill_board_shelves():
    """Place legacy boards on their owner's default shelf."""
    with engine.begin() as conn:
        if not _table_exists(conn, "boards") or not _table_exists(conn, "shelves"):
            return
        conn.execute(text(
            "UPDATE boards SET shelf_id=(SELECT id FROM shelves "
            "WHERE shelves.user_id=boards.user_id "
            "ORDER BY is_default DESC, position, id LIMIT 1) "
            "WHERE shelf_id IS NULL"
        ))


def backfill_board_excerpts():
    """Move excerpts created by the initial staging implementation out of
    the editable comment field and into their immutable quote field."""
    with engine.begin() as conn:
        if not _table_exists(conn, "board_items"):
            return
        columns = {
            row[1] for row in conn.execute(text("PRAGMA table_info(board_items)"))
        }
        if "excerpt_text" not in columns:
            return
        conn.execute(text(
            "UPDATE board_items SET excerpt_text=content, content=NULL "
            "WHERE kind='excerpt' AND excerpt_text IS NULL AND content IS NOT NULL"
        ))


def backfill_board_clip_source_labels():
    """Give viewer clips created before descriptive backlinks a useful label."""
    with engine.begin() as conn:
        if not all(_table_exists(conn, table) for table in (
            "board_items", "paper_editions", "papers",
        )):
            return
        clips = conn.execute(text(
            "SELECT id, source_url FROM board_items "
            "WHERE kind='image' AND source_url IS NOT NULL "
            "AND (source_label IS NULL OR source_label='Open source')"
        )).all()
        for item_id, source_url in clips:
            try:
                params = urllib.parse.parse_qs(urllib.parse.urlparse(source_url).query)
                digest = params.get("pdf", [None])[0]
                page = params.get("page", [None])[0]
            except (TypeError, ValueError):
                continue
            if not digest or not page:
                continue
            title = conn.execute(text(
                "SELECT papers.title FROM paper_editions "
                "JOIN papers ON papers.id=paper_editions.paper_id "
                "WHERE paper_editions.sha256=:digest LIMIT 1"
            ), {"digest": digest}).scalar()
            if title:
                label = f"{title}, page {page}"[:500]
                conn.execute(text(
                    "UPDATE board_items SET source_label=:label WHERE id=:id"
                ), {"label": label, "id": item_id})


def backfill_copy_edition_hashes():
    """Give every edition and pinned nook copy a durable PDF identity."""
    with engine.begin() as conn:
        if not _table_exists(conn, "copies") or not _table_exists(conn, "paper_editions"):
            return
        uploads = Path(__file__).parent.parent / "uploads"
        missing = conn.execute(text(
            "SELECT id, file_path FROM paper_editions WHERE sha256 IS NULL"
        )).all()
        for edition_id, file_path in missing:
            candidate = uploads / file_path
            if not candidate.is_file():
                continue
            digest = hashlib.sha256()
            with candidate.open("rb") as pdf:
                for chunk in iter(lambda: pdf.read(1 << 20), b""):
                    digest.update(chunk)
            conn.execute(
                text("UPDATE paper_editions SET sha256=:sha WHERE id=:id"),
                {"sha": digest.hexdigest(), "id": edition_id},
            )
        conn.execute(text(
            "UPDATE copies SET edition_sha256 = ("
            "SELECT sha256 FROM paper_editions WHERE paper_editions.id = copies.edition_id"
            ") WHERE edition_sha256 IS NULL AND edition_id IS NOT NULL"
        ))


def backfill_shelves():
    """Create Display/Personal shelves and place every legacy copy."""
    with engine.begin() as conn:
        if not _table_exists(conn, "shelves") or not _table_exists(conn, "copies"):
            return
        users = conn.execute(text("SELECT id FROM users WHERE deleted_at IS NULL")).all()
        for (user_id,) in users:
            shelves = conn.execute(text(
                "SELECT id, is_public FROM shelves WHERE user_id=:u ORDER BY position, id"
            ), {"u": user_id}).all()
            if not shelves:
                conn.execute(text(
                    "INSERT INTO shelves (user_id,name,color,is_public,is_default,position,created_at) "
                    "VALUES (:u,'Display','#7ba26c',1,1,0,CURRENT_TIMESTAMP),"
                    "(:u,'Personal','#2b4a6f',0,0,1,CURRENT_TIMESTAMP)"
                ), {"u": user_id})
            public_id = conn.execute(text(
                "SELECT id FROM shelves WHERE user_id=:u AND is_public=1 ORDER BY position,id LIMIT 1"
            ), {"u": user_id}).scalar()
            private_id = conn.execute(text(
                "SELECT id FROM shelves WHERE user_id=:u AND is_public=0 ORDER BY position,id LIMIT 1"
            ), {"u": user_id}).scalar()
            fallback = public_id or private_id
            conn.execute(text(
                "UPDATE copies SET shelf_id=CASE WHEN marketed=1 THEN :pub ELSE :priv END "
                "WHERE user_id=:u AND shelf_id IS NULL"
            ), {"u": user_id, "pub": public_id or fallback, "priv": private_id or fallback})


def backfill_favourite_tags():
    """One-time seed for existing readers; a deleted starter stays deleted."""
    with engine.begin() as conn:
        if not all(_table_exists(conn, table) for table in ("users", "tags", "settings")):
            return
        marker = "migration_favourite_tag_seeded_v1"
        if conn.execute(text("SELECT 1 FROM settings WHERE key=:key"), {"key": marker}).first():
            return
        conn.execute(text(
            "INSERT INTO tags (user_id,name,created_at) "
            "SELECT users.id,'favourite',CURRENT_TIMESTAMP FROM users "
            "WHERE users.deleted_at IS NULL AND NOT EXISTS ("
            "SELECT 1 FROM tags WHERE tags.user_id=users.id "
            "AND lower(tags.name)='favourite')"
        ))
        conn.execute(
            text("INSERT INTO settings (key,value) VALUES (:key,'complete')"),
            {"key": marker},
        )


def normalize_papers():
    """One-time migration from the denormalized model (one papers row per
    nook entry) to the canonical model (one papers row per paper, per-user
    state in copies). Returns file paths of removed duplicate PDFs."""
    removed_files = []
    with engine.begin() as conn:
        # An interim schema revision named the per-user table "readings";
        # carry its rows over to "copies" and drop it.
        if _table_exists(conn, "readings"):
            if not conn.execute(text("SELECT COUNT(*) FROM copies")).scalar():
                conn.execute(text(
                    "INSERT INTO copies (id, paper_id, user_id, summary, marketed, "
                    "rating_expertise, rating_reading, rating_liking, created_at) "
                    "SELECT id, paper_id, user_id, summary, marketed, "
                    "rating_expertise, rating_reading, rating_liking, created_at "
                    "FROM readings"
                ))
            conn.execute(text("DROP TABLE readings"))

        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(papers)"))}
        if "user_id" not in cols:
            return removed_files  # fresh database, already canonical
        if conn.execute(text("SELECT COUNT(*) FROM copies")).scalar():
            return removed_files  # already migrated

        rows = conn.execute(text(
            "SELECT id, user_id, doi, title, summary, marketed, rating_expertise, "
            "rating_reading, rating_liking, created_at, file_path FROM papers ORDER BY id"
        )).mappings().all()

        groups = {}
        for r in rows:
            key = (
                "doi:" + r["doi"].strip().lower()
                if r["doi"]
                else "title:" + (r["title"] or "").strip().lower()
            )
            groups.setdefault(key, []).append(r)

        for key, grp in groups.items():
            canon = grp[0]["id"]
            for r in grp:
                if r["user_id"] is not None:
                    conn.execute(text(
                        "INSERT OR IGNORE INTO copies "
                        "(paper_id, user_id, summary, marketed, rating_expertise, "
                        "rating_reading, rating_liking, created_at) "
                        "VALUES (:p, :u, :s, :m, :e, :rd, :l, :c)"
                    ), dict(
                        p=canon, u=r["user_id"], s=r["summary"],
                        m=1 if r["marketed"] in (1, True, None) else 0,
                        e=r["rating_expertise"], rd=r["rating_reading"],
                        l=r["rating_liking"], c=r["created_at"],
                    ))
                if r["id"] != canon:
                    conn.execute(
                        text("UPDATE comments SET paper_id=:c WHERE paper_id=:o"),
                        dict(c=canon, o=r["id"]),
                    )
                    for legacy in ("interests", "seminars"):
                        if _table_exists(conn, legacy):
                            conn.execute(
                                text(f"DELETE FROM {legacy} WHERE paper_id=:o"),
                                dict(o=r["id"]),
                            )
                    conn.execute(text("DELETE FROM papers WHERE id=:o"), dict(o=r["id"]))
                    removed_files.append(r["file_path"])
    return removed_files
