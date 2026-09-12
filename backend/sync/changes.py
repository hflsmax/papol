import json
import uuid
from datetime import date, datetime

from models import (
    Board, BoardGroup, BoardItem, Comment, Copy, CopyTagLink, InkStroke, PaperClip,
    PaperEdition, ServerChange, Shelf, Tag,
)
from sync.registry import WRITABLE_MODELS, registry, validate_registry


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def row_snapshot(record):
    """Serialize mapped columns using the final shared-schema names."""
    table_name = record.__table__.name
    rule = registry()["tables"][table_name]
    aliases = rule.get("column_aliases", {})
    skipped = set(rule.get("compatibility_columns", []))
    return {
        aliases.get(column.name, column.name): _json_value(getattr(record, column.name))
        for column in record.__table__.columns
        if column.name not in skipped
    }


def _board_for(db, record):
    board = record.board
    if board is None and record.board_id is not None:
        board = db.get(Board, record.board_id)
    if board is None:
        raise RuntimeError(f"{record.__tablename__} has no board")
    return board


def _owner_id(db, record):
    if isinstance(record, Board):
        return record.user_id
    if isinstance(record, (Comment, InkStroke, PaperClip, Copy, CopyTagLink, Shelf, Tag)):
        return record.user_id
    return _board_for(db, record).user_id


def _prepare_identity(db, record):
    if not record.sync_id:
        record.sync_id = str(uuid.uuid4())
    if isinstance(record, Board):
        if not record.guid:
            record.guid = record.sync_id
        record.shelf_sync_id = record.shelf.sync_id if record.shelf else None
    elif isinstance(record, BoardGroup):
        record.board_sync_id = _board_for(db, record).sync_id
    elif isinstance(record, BoardItem):
        record.board_sync_id = _board_for(db, record).sync_id
        group = record.group
        if group is None and record.group_id is not None:
            group = db.get(BoardGroup, record.group_id)
        record.group_sync_id = group.sync_id if group else None
    elif isinstance(record, Comment):
        record.paper_sync_id = record.paper.sync_id
        record.edition_sync_id = record.edition.sync_id if record.edition else None
    elif isinstance(record, (InkStroke, PaperClip)):
        record.edition_sync_id = record.edition.sync_id
    elif isinstance(record, Copy):
        if not record.paper.sync_id:
            record.paper.sync_id = str(uuid.uuid4())
        if record.shelf and not record.shelf.sync_id:
            record.shelf.sync_id = str(uuid.uuid4())
        if record.edition and not record.edition.sync_id:
            record.edition.sync_id = str(uuid.uuid4())
        record.paper_sync_id = record.paper.sync_id
        record.shelf_sync_id = record.shelf.sync_id if record.shelf else None
        record.edition_sync_id = record.edition.sync_id if record.edition else None
        ignored = db.get(PaperEdition, record.ignored_edition_id) \
            if record.ignored_edition_id else None
        record.ignored_edition_sync_id = ignored.sync_id if ignored else None
    elif isinstance(record, CopyTagLink):
        copy = record.copy or db.get(Copy, record.copy_id)
        tag = record.tag or db.get(Tag, record.tag_id)
        if copy is None or tag is None or copy.user_id != tag.user_id:
            raise RuntimeError("copy tag link has invalid parents")
        if not copy.sync_id:
            copy.sync_id = str(uuid.uuid4())
        if not tag.sync_id:
            tag.sync_id = str(uuid.uuid4())
        record.copy_sync_id = copy.sync_id
        record.tag_sync_id = tag.sync_id
        record.user_id = copy.user_id


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
            user_id=_owner_id(db, record),
            table_name=record.__table__.name,
            row_sync_id=record.sync_id,
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


def seed_board_change_log(db):
    """Make pre-sync board rows discoverable by a first cursor pull."""
    existing = {
        (table_name, row_sync_id)
        for table_name, row_sync_id in db.query(
            ServerChange.table_name, ServerChange.row_sync_id,
        ).distinct().all()
    }
    records = []
    for model in (Board, BoardGroup, BoardItem):
        records.extend(
            record for record in db.query(model).all()
            if (record.__tablename__, record.sync_id) not in existing
        )
    for record in records:
        _prepare_identity(db, record)
        if not record.revision:
            record.revision = 1
        row = row_snapshot(record)
        db.add(ServerChange(
            user_id=_owner_id(db, record),
            table_name=record.__tablename__,
            row_sync_id=record.sync_id,
            revision=record.revision,
            operation="delete" if record.deleted_at is not None else "upsert",
            row_json=json.dumps(row, separators=(",", ":"), sort_keys=True),
        ))
    db.commit()
    return len(records)
