from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.schema import CreateColumn
import os
from pathlib import Path
import hashlib
import uuid

# Use absolute path for database in backend directory
DB_PATH = Path(__file__).parent / "papol.db"
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
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
