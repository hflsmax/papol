from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
import os
from pathlib import Path

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


# Columns added after earlier schema versions; create_all only creates
# missing tables, so pre-existing databases need these ALTERs.
_MIGRATIONS = {
    "comments": {
        "user_id": "INTEGER",
    },
    "users": {
        "affiliation": "TEXT",
        "avatar_path": "TEXT",
        "is_admin": "INTEGER NOT NULL DEFAULT 0",
    },
    "rooms": {
        "style": "TEXT",
        "style_desc": "TEXT",
    },
}


def migrate():
    with engine.begin() as conn:
        for table, columns in _MIGRATIONS.items():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            if not existing:
                continue  # table doesn't exist yet; create_all will handle it
            for name, sqltype in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sqltype}"))


def _table_exists(conn, name: str) -> bool:
    return conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
        {"n": name},
    ).fetchone() is not None


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
