import json
from datetime import date, datetime

from models import (
    Annotation, Board, Copy, CopyTagLink,
    ServerChange, Shelf, Tag, new_uuid,
)
from sync.registry import WRITABLE_MODELS, registry, validate_registry


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row_snapshot(record):
    """Serialize a synchronized row exactly as every replica stores it."""
    rule = registry()["tables"][record.__table__.name]
    skipped = set(rule.get("server_columns", []))
    return {
        column.name: _json_value(getattr(record, column.name))
        for column in record.__table__.columns
        if column.name not in skipped
    }


def _board_for(db, record):
    board = record.board
    if board is None and record.board_uuid is not None:
        board = db.get(Board, record.board_uuid)
    if board is None:
        raise RuntimeError(f"{record.__tablename__} has no board")
    return board


def _owner_uuid(db, record):
    if isinstance(record, (Annotation, Board, Copy, CopyTagLink, Shelf, Tag)):
        return record.user_uuid
    return _board_for(db, record).user_uuid


def _prepare_identity(db, record):
    if not record.uuid:
        record.uuid = new_uuid()
    if isinstance(record, CopyTagLink):
        copy = record.copy or db.get(Copy, record.copy_uuid)
        tag = record.tag or db.get(Tag, record.tag_uuid)
        if copy is None or tag is None or copy.user_uuid != tag.user_uuid:
            raise RuntimeError("copy tag link has invalid parents")
        record.user_uuid = copy.user_uuid


def prepare_sync_changes(db):
    """Version and log all changed registered rows in the current unit of work."""
    validate_registry()
    synchronized = tuple(WRITABLE_MODELS.values())
    candidates = []
    seen = set()
    for record in [*db.new, *db.dirty]:
        if not isinstance(record, synchronized) or id(record) in seen:
            continue
        if record not in db.new and not db.is_modified(record, include_collections=False):
            continue
        seen.add(id(record))
        candidates.append(record)

    now = datetime.utcnow()
    for record in candidates:
        _prepare_identity(db, record)
        record.revision = (record.revision or 0) + 1
        if hasattr(record, "updated_at"):
            record.updated_at = now
    db.flush()

    snapshots = []
    for record in candidates:
        row = row_snapshot(record)
        operation = "delete" if record.deleted_at is not None else "upsert"
        change = ServerChange(
            user_uuid=_owner_uuid(db, record),
            table_name=record.__table__.name,
            row_uuid=record.uuid,
            revision=record.revision,
            operation=operation,
            row_json=json.dumps(row, separators=(",", ":"), sort_keys=True),
        )
        db.add(change)
        snapshots.append(row)
    db.flush()
    return snapshots


def commit_sync(db):
    snapshots = prepare_sync_changes(db)
    db.commit()
    return snapshots

