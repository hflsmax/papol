import hashlib
import json
import os
import shutil
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import (
    AppliedMutation, Board, BoardGroup, BoardItem, Comment, Copy, CopyTagLink, InkStroke,
    Paper, PaperClip, PaperEdition, ServerChange, Shelf, SyncClient, Tag, User,
)
from sync.changes import prepare_sync_changes, row_snapshot
from sync.registry import MODELS, registry
from schemas import CommentCreate, InkStrokeCreate, PaperClipCreate


router = APIRouter(prefix="/api/sync", tags=["sync"])
BOARD_FILES_DIR = Path(os.environ.get(
    "PAPOL_BOARD_FILES_DIR", Path(__file__).parents[2] / "board_uploads",
))
BLOBS_DIR = BOARD_FILES_DIR / "blobs"
PDF_FILES_DIR = Path(os.environ.get(
    "PAPOL_UPLOADS_DIR", Path(__file__).parents[2] / "uploads",
))
BLOB_LIMIT = 25 * 1024 * 1024


class RowChange(BaseModel):
    table: Literal[
        "boards", "board_groups", "board_items", "papers", "paper_editions",
        "comments", "ink_strokes",
        "paper_clips",
        "shelves", "tags", "copies",
        "copy_tags",
    ]
    id: UUID
    base_revision: int | None = Field(default=None, ge=0)
    operation: Literal["upsert", "patch", "delete"]
    values: dict[str, Any] = Field(default_factory=dict)


class PushRequest(BaseModel):
    protocol_version: Literal[1] = 1
    client_id: UUID
    mutation_id: UUID
    local_sequence: int = Field(ge=0)
    changes: list[RowChange] = Field(min_length=1, max_length=250)


def _canonical_payload(payload: PushRequest) -> bytes:
    return json.dumps(
        payload.model_dump(mode="json"), separators=(",", ":"), sort_keys=True,
    ).encode()


def _find_owned(db: Session, model, sync_id: str, user_id: int):
    for pending in db.new:
        if isinstance(pending, model) and pending.sync_id == sync_id:
            if isinstance(pending, (Paper, PaperEdition)):
                return pending
            if isinstance(pending, (Board, Comment, InkStroke, PaperClip, Copy, CopyTagLink, Shelf, Tag)):
                return pending if pending.user_id == user_id else None
            return pending if pending.board.user_id == user_id else None
    query = db.query(model).filter(model.sync_id == sync_id)
    if model in {Paper, PaperEdition}:
        return query.first()
    if model is Board:
        return query.filter(Board.user_id == user_id).first()
    if model in {Comment, InkStroke, PaperClip, Copy, CopyTagLink, Shelf, Tag}:
        return query.filter(model.user_id == user_id).first()
    return query.join(Board).filter(Board.user_id == user_id).first()


def _owned_paper(db: Session, sync_id: str, user_id: int) -> Paper:
    paper = db.query(Paper).join(Copy).filter(
        Paper.sync_id == sync_id, Copy.user_id == user_id,
    ).first()
    if not paper:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _paper_by_sync(db: Session, sync_id: str) -> Paper:
    for pending in db.new:
        if isinstance(pending, Paper) and pending.sync_id == sync_id:
            return pending
    paper = db.query(Paper).filter(Paper.sync_id == sync_id).first()
    if not paper or paper.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _visible_paper(db: Session, sync_id: str, user_id: int) -> Paper:
    for pending in db.new:
        if isinstance(pending, Paper) and pending.sync_id == sync_id:
            return pending
    paper = db.query(Paper).filter(Paper.sync_id == sync_id).first()
    if not paper or paper.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    if getattr(paper, "_sync_import_user", None) == user_id:
        return paper
    visible = any(
        copy.deleted_at is None and (copy.user_id == user_id or copy.marketed)
        for copy in paper.copies
    )
    if not visible:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _owned_edition(db: Session, sync_id: str, user_id: int) -> PaperEdition:
    for pending in db.new:
        if (isinstance(pending, PaperEdition) and pending.sync_id == sync_id
                and pending.uploaded_by == user_id):
            return pending
    edition = db.query(PaperEdition).join(Paper).join(Copy).filter(
        PaperEdition.sync_id == sync_id, Copy.user_id == user_id,
    ).first()
    if edition is None:
        edition = db.query(PaperEdition).filter(PaperEdition.sync_id == sync_id).first()
        if edition is not None and getattr(edition, "_sync_import_user", None) == user_id:
            return edition
    if not edition:
        raise HTTPException(status_code=409, detail="Referenced edition is unavailable")
    return edition


def _owned_shelf(db: Session, sync_id: str | None, user_id: int) -> Shelf | None:
    if sync_id is None:
        return None
    for pending in db.new:
        if (isinstance(pending, Shelf) and pending.sync_id == sync_id
                and pending.user_id == user_id and pending.deleted_at is None):
            return pending
    shelf = db.query(Shelf).filter(Shelf.sync_id == sync_id, Shelf.user_id == user_id).first()
    if not shelf or shelf.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced shelf is unavailable")
    return shelf


def _owned_copy(db: Session, sync_id: str, user_id: int) -> Copy:
    copy = _find_owned(db, Copy, sync_id, user_id)
    if not copy or copy.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced copy is unavailable")
    return copy


def _owned_tag(db: Session, sync_id: str, user_id: int) -> Tag:
    tag = _find_owned(db, Tag, sync_id, user_id)
    if not tag or tag.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced tag is unavailable")
    return tag


def _owned_board(db: Session, sync_id: str, user_id: int) -> Board:
    for pending in db.new:
        if (isinstance(pending, Board) and pending.sync_id == sync_id
                and pending.user_id == user_id and pending.deleted_at is None):
            return pending
    board = db.query(Board).filter(
        Board.sync_id == sync_id, Board.user_id == user_id,
    ).first()
    if not board or board.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced board is unavailable")
    return board


def _owned_group(db: Session, sync_id: str | None, board: Board) -> BoardGroup | None:
    if sync_id is None:
        return None
    for pending in db.new:
        if (isinstance(pending, BoardGroup) and pending.sync_id == sync_id
                and pending.board is board and pending.deleted_at is None):
            return pending
    group = db.query(BoardGroup).filter(
        BoardGroup.sync_id == sync_id,
        BoardGroup.board_id == board.id,
        BoardGroup.deleted_at.is_(None),
    ).first()
    if not group:
        raise HTTPException(status_code=409, detail="Referenced group is unavailable")
    return group


def _new_record(db: Session, change: RowChange, user: User, values: dict):
    sync_id = str(change.id)
    if change.table == "papers":
        return Paper(sync_id=sync_id, title="")
    if change.table == "paper_editions":
        paper_id = values.get("paper_id")
        sha256 = values.get("sha256")
        if not isinstance(paper_id, str) or not isinstance(sha256, str):
            raise HTTPException(status_code=422, detail="Paper edition needs paper_id and sha256")
        source = BLOBS_DIR / sha256
        if not source.is_file():
            raise HTTPException(status_code=409, detail="Edition blob has not been uploaded")
        PDF_FILES_DIR.mkdir(exist_ok=True)
        filename = f"{sha256}.pdf"
        destination = PDF_FILES_DIR / filename
        if not destination.exists():
            shutil.copyfile(source, destination)
        paper = _paper_by_sync(db, paper_id)
        return PaperEdition(
            sync_id=sync_id, paper=paper, paper_sync_id=paper.sync_id,
            file_path=filename, sha256=sha256, uploaded_by=user.id,
        )
    if change.table == "boards":
        shelf_sync_id = values.get("shelf_id")
        shelf = _owned_shelf(db, shelf_sync_id, user.id) if shelf_sync_id else None
        return Board(
            sync_id=sync_id, guid=sync_id, user_id=user.id, shelf=shelf,
            shelf_sync_id=shelf.sync_id if shelf else None,
            name="", description=None,
        )
    if change.table == "comments":
        paper_id = values.get("paper_id")
        if not isinstance(paper_id, str):
            raise HTTPException(status_code=422, detail="comments.paper_id is required")
        paper = _owned_paper(db, paper_id, user.id)
        edition = None
        if values.get("edition_id") is not None:
            edition = _owned_edition(db, values["edition_id"], user.id)
            if edition.paper_id != paper.id:
                raise HTTPException(status_code=409, detail="Note edition belongs to another paper")
        return Comment(
            sync_id=sync_id, paper=paper, paper_sync_id=paper.sync_id,
            edition=edition, edition_sync_id=edition.sync_id if edition else None,
            user_id=user.id, content="",
        )
    if change.table in {"ink_strokes", "paper_clips"}:
        edition_id = values.get("edition_id")
        if not isinstance(edition_id, str):
            raise HTTPException(status_code=422, detail=f"{change.table}.edition_id is required")
        edition = _owned_edition(db, edition_id, user.id)
        common = {
            "sync_id": sync_id, "edition": edition,
            "edition_sync_id": edition.sync_id, "user_id": user.id,
        }
        if change.table == "ink_strokes":
            return InkStroke(
                **common, page=1, points="[]", color="#b3923d", width=0.004,
                opacity=1.0, shape="flat",
            )
        return PaperClip(**common, page=1, source="{}", frame="{}", floating=False)
    if change.table == "shelves":
        return Shelf(
            sync_id=sync_id, user_id=user.id, name="", color="#7f8c8d",
            is_public=False, is_default=False, position=0,
        )
    if change.table == "tags":
        return Tag(sync_id=sync_id, user_id=user.id, name="")
    if change.table == "copies":
        paper_id = values.get("paper_id")
        if not isinstance(paper_id, str):
            raise HTTPException(status_code=422, detail="copies.paper_id is required")
        paper = _visible_paper(db, paper_id, user.id)
        edition = _owned_edition(db, values["edition_id"], user.id) if values.get("edition_id") else None
        shelf = _owned_shelf(db, values.get("shelf_id"), user.id)
        return Copy(
            sync_id=sync_id, paper=paper, paper_sync_id=paper.sync_id,
            edition=edition, edition_sync_id=edition.sync_id if edition else None,
            shelf=shelf, shelf_sync_id=shelf.sync_id if shelf else None,
            user_id=user.id, marketed=False, is_author=False,
        )
    if change.table == "copy_tags":
        copy_id, tag_id = values.get("copy_id"), values.get("tag_id")
        if not isinstance(copy_id, str) or not isinstance(tag_id, str):
            raise HTTPException(status_code=422, detail="copy_tags needs copy_id and tag_id")
        copy, tag = _owned_copy(db, copy_id, user.id), _owned_tag(db, tag_id, user.id)
        return CopyTagLink(
            sync_id=sync_id, copy=copy, copy_sync_id=copy.sync_id,
            tag=tag, tag_sync_id=tag.sync_id, user_id=user.id,
        )
    board_id = values.get("board_id")
    if not isinstance(board_id, str):
        raise HTTPException(status_code=422, detail=f"{change.table}.board_id is required")
    board = _owned_board(db, board_id, user.id)
    if change.table == "board_groups":
        return BoardGroup(
            sync_id=sync_id, board=board, board_sync_id=board.sync_id,
            kind="booklet", title="", auto_arrange=False,
        )
    group = _owned_group(db, values.get("group_id"), board)
    return BoardItem(
        sync_id=sync_id, board=board, board_sync_id=board.sync_id,
        group=group, group_sync_id=group.sync_id if group else None,
        kind="comment", staged=False, text_align="left", position=0,
        x=0, y=0, width=300,
    )


def _assign_values(db: Session, record, values: dict, user: User):
    if isinstance(record, Paper):
        for key, value in values.items():
            if key != "deleted_at":
                setattr(record, key, value)
        record.title = (record.title or "").strip()
        if not record.title or len(record.title) > 500:
            raise HTTPException(status_code=422, detail="Paper title must be 1–500 characters")
        return
    if isinstance(record, PaperEdition):
        if "paper_id" in values:
            record.paper = _paper_by_sync(db, values["paper_id"])
            record.paper_sync_id = record.paper.sync_id
        if "sha256" in values and values["sha256"] != record.sha256:
            raise HTTPException(status_code=422, detail="Edition content cannot change")
        return
    if isinstance(record, Board):
        if "shelf_id" in values:
            shelf = _owned_shelf(db, values["shelf_id"], user.id)
            record.shelf = shelf
            record.shelf_sync_id = shelf.sync_id if shelf else None
        for key, value in values.items():
            if key not in {"shelf_id", "deleted_at"}:
                setattr(record, key, value)
        if not record.name or len(record.name.strip()) > 120:
            raise HTTPException(status_code=422, detail="Board name must be 1–120 characters")
        record.name = record.name.strip()
        return

    if isinstance(record, Comment):
        if "paper_id" in values:
            record.paper = _owned_paper(db, values["paper_id"], user.id)
            record.paper_sync_id = record.paper.sync_id
        if "edition_id" in values:
            edition_id = values["edition_id"]
            record.edition = _owned_edition(db, edition_id, user.id) if edition_id else None
            record.edition_sync_id = record.edition.sync_id if record.edition else None
        if record.edition is not None and record.edition.paper_id != record.paper.id:
            raise HTTPException(status_code=409, detail="Note edition belongs to another paper")
        for key, value in values.items():
            if key not in {"paper_id", "edition_id", "deleted_at"}:
                setattr(record, key, value)
        anchor = None
        if record.anchor is not None:
            try:
                anchor = {"type": record.anchor_type, **json.loads(record.anchor)}
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="Invalid note anchor")
        try:
            CommentCreate(
                content=record.content, page=record.page, anchor=anchor, name=record.name,
            )
        except ValidationError as error:
            raise HTTPException(status_code=422, detail=error.errors())
        return
    if isinstance(record, (InkStroke, PaperClip)):
        if "edition_id" in values:
            record.edition = _owned_edition(db, values["edition_id"], user.id)
            record.edition_sync_id = record.edition.sync_id
        for key, value in values.items():
            if key not in {"edition_id", "deleted_at"}:
                setattr(record, key, value)
        try:
            if isinstance(record, InkStroke):
                InkStrokeCreate(
                    group_id=record.group_id, page=record.page,
                    points=json.loads(record.points), color=record.color,
                    width=record.width, opacity=record.opacity, shape=record.shape,
                )
            else:
                PaperClipCreate(
                    page=record.page, source=json.loads(record.source),
                    frame=json.loads(record.frame), floating=record.floating,
                )
        except (TypeError, ValueError, ValidationError) as error:
            detail = error.errors() if isinstance(error, ValidationError) else str(error)
            raise HTTPException(status_code=422, detail=detail)
        return
    if isinstance(record, Shelf):
        for key, value in values.items():
            if key != "deleted_at":
                setattr(record, key, value)
        record.name = (record.name or "").strip()
        if not record.name or len(record.name) > 40:
            raise HTTPException(status_code=422, detail="Shelf name must be 1–40 characters")
        if (not isinstance(record.color, str) or len(record.color) != 7
                or not record.color.startswith("#")):
            raise HTTPException(status_code=422, detail="Invalid shelf color")
        return
    if isinstance(record, Tag):
        for key, value in values.items():
            if key != "deleted_at":
                setattr(record, key, value)
        record.name = (record.name or "").strip()
        if not record.name or len(record.name) > 60:
            raise HTTPException(status_code=422, detail="Tag name must be 1–60 characters")
        return
    if isinstance(record, Copy):
        if "paper_id" in values:
            record.paper = _visible_paper(db, values["paper_id"], user.id)
            record.paper_sync_id = record.paper.sync_id
        if "shelf_id" in values:
            record.shelf = _owned_shelf(db, values["shelf_id"], user.id)
            record.shelf_sync_id = record.shelf.sync_id if record.shelf else None
        if "edition_id" in values:
            record.edition = _owned_edition(db, values["edition_id"], user.id) if values["edition_id"] else None
            record.edition_sync_id = record.edition.sync_id if record.edition else None
        if "ignored_edition_id" in values:
            ignored = _owned_edition(db, values["ignored_edition_id"], user.id) if values["ignored_edition_id"] else None
            record.ignored_edition_id = ignored.id if ignored else None
            record.ignored_edition_sync_id = ignored.sync_id if ignored else None
        for key, value in values.items():
            if key not in {"paper_id", "shelf_id", "edition_id", "ignored_edition_id", "deleted_at"}:
                setattr(record, key, value)
        if (record.edition is not None
                and record.edition.paper.sync_id != record.paper.sync_id):
            raise HTTPException(status_code=409, detail="Copy edition belongs to another paper")
        return
    if isinstance(record, CopyTagLink):
        if "copy_id" in values:
            copy = _owned_copy(db, values["copy_id"], user.id)
            record.copy, record.copy_sync_id = copy, copy.sync_id
        if "tag_id" in values:
            tag = _owned_tag(db, values["tag_id"], user.id)
            record.tag, record.tag_sync_id = tag, tag.sync_id
        return

    if "board_id" in values:
        board = _owned_board(db, values["board_id"], user.id)
        record.board = board
        record.board_sync_id = board.sync_id
    if isinstance(record, BoardItem) and "group_id" in values:
        group = _owned_group(db, values["group_id"], record.board)
        record.group = group
        record.group_sync_id = group.sync_id if group else None
    if isinstance(record, BoardItem) and values.get("sha256"):
        digest = values["sha256"]
        if not isinstance(digest, str) or len(digest) != 64 or not (BLOBS_DIR / digest).is_file():
            raise HTTPException(status_code=409, detail="Referenced blob has not been uploaded")
        record.file_path = str(Path("blobs") / digest)
    if isinstance(record, BoardItem) and values.get("source_url"):
        raw_source = values["source_url"]
        source = urllib.parse.urlparse(raw_source) if isinstance(raw_source, str) else None
        if (source is None or source.scheme not in {"http", "https"}
                or not source.hostname or source.username or source.password):
            raise HTTPException(status_code=422, detail="Board links must use http or https")
    for key, value in values.items():
        if key not in {"board_id", "group_id", "deleted_at"}:
            setattr(record, key, value)
    if isinstance(record, BoardGroup):
        if record.kind not in {"booklet", "collection"}:
            raise HTTPException(status_code=422, detail="Invalid board group kind")
        if len(record.title or "") > 240 or len(record.header or "") > 4000:
            raise HTTPException(status_code=422, detail="Board group text is too long")
    else:
        if record.kind not in {"comment", "excerpt", "image", "file", "youtube", "webpage"}:
            raise HTTPException(status_code=422, detail="Invalid board item kind")
        if record.text_align not in {"left", "center", "right"}:
            raise HTTPException(status_code=422, detail="Invalid text alignment")
        if not 120 <= record.width <= 1200:
            raise HTTPException(status_code=422, detail="Invalid board item width")


def _apply_change(db: Session, change: RowChange, user: User):
    rule = registry()["tables"][change.table]
    writable = set(rule["client_writable"])
    unknown = set(change.values) - writable
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Client cannot write {change.table}: {', '.join(sorted(unknown))}",
        )
    model = MODELS[change.table]
    record = _find_owned(db, model, str(change.id), user.id)
    if rule.get("create_only") and record is not None:
        raise HTTPException(status_code=409, detail=f"{change.table} rows are create-only")
    if record is None:
        collision = next((pending for pending in db.new
                          if isinstance(pending, model)
                          and pending.sync_id == str(change.id)), None)
        if collision is None:
            collision = db.query(model).filter(model.sync_id == str(change.id)).first()
        if collision is not None:
            raise HTTPException(status_code=404, detail="Synchronized row not found")
        if change.operation in {"patch", "delete"}:
            raise HTTPException(status_code=409, detail="Synchronized row no longer exists")
        record = _new_record(db, change, user, change.values)
        db.add(record)

    # A tombstone is an intentional deletion, not an empty row waiting for a
    # stale client to bring it back. Keep the attempted values in the conflict
    # audit so the user's work remains recoverable, while the delete wins
    # deterministically on every device.
    if record.deleted_at is not None and change.operation != "delete":
        return record, {
            "table": change.table,
            "id": str(change.id),
            "strategy": rule.get("conflict", "whole_row"),
            "resolution": "server_won",
            "reason": "row_deleted",
            "server_revision": record.revision,
            "rejected_values": change.values,
        }

    conflict = None
    if change.base_revision is not None and record.revision != change.base_revision:
        conflict = {
            "table": change.table,
            "id": str(change.id),
            "strategy": rule.get("conflict", "whole_row"),
            "resolution": "client_won",
            "server_revision": record.revision,
            "previous": {
                key: row_snapshot(record).get(key) for key in change.values
            },
        }
    if change.operation == "delete":
        now = datetime.utcnow()
        record.deleted_at = now
        if isinstance(record, Board):
            for group in record.groups:
                group.deleted_at = now
            for item in record.items:
                item.deleted_at = now
        elif isinstance(record, BoardGroup):
            for item in record.items:
                item.group = None
                item.group_sync_id = None
        elif isinstance(record, Shelf):
            if record.is_default or any(copy.deleted_at is None for copy in record.copies):
                raise HTTPException(status_code=409, detail="Move shelf contents before deleting it")
    else:
        _assign_values(db, record, change.values, user)
        record.deleted_at = None
    if isinstance(record, (BoardGroup, BoardItem)):
        record.board.updated_at = datetime.utcnow()
    return record, conflict


def _validate_import_batch(changes: list[RowChange]):
    papers = {str(change.id) for change in changes if change.table == "papers"}
    editions = {str(change.id) for change in changes if change.table == "paper_editions"}
    if not papers and not editions:
        return
    if any(change.operation != "upsert" or change.base_revision not in {None, 0}
           for change in changes if change.table in {"papers", "paper_editions"}):
        raise HTTPException(status_code=422, detail="Paper imports are create-only")
    for paper_id in papers:
        edition = next((change for change in changes
                        if change.table == "paper_editions"
                        and change.values.get("paper_id") == paper_id), None)
        if edition is None or not any(
            change.table == "copies"
            and change.values.get("paper_id") == paper_id
            and change.values.get("edition_id") == str(edition.id)
            for change in changes
        ):
            raise HTTPException(status_code=422, detail="Paper import needs an owned edition and copy")
    for edition_id in editions:
        if not any(change.table == "copies" and change.values.get("edition_id") == edition_id
                   for change in changes):
            raise HTTPException(status_code=422, detail="Edition import needs an owned copy")


def _canonical_import_paper(db: Session, change: RowChange) -> Paper | None:
    doi = change.values.get("doi")
    title = change.values.get("title")
    query = db.query(Paper).filter(Paper.deleted_at.is_(None))
    if isinstance(doi, str) and doi.strip():
        return query.filter(func.lower(Paper.doi) == doi.strip().lower()).first()
    if isinstance(title, str) and title.strip():
        return query.filter(func.lower(Paper.title) == title.strip().lower()).first()
    return None


@router.post("/push")
def push(payload: PushRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    client_id = str(payload.client_id)
    mutation_id = str(payload.mutation_id)
    fingerprint = hashlib.sha256(_canonical_payload(payload)).hexdigest()
    existing = db.query(AppliedMutation).filter(
        AppliedMutation.user_id == user.id,
        AppliedMutation.client_id == client_id,
        AppliedMutation.mutation_id == mutation_id,
    ).first()
    if existing:
        if existing.request_hash != fingerprint:
            raise HTTPException(status_code=409, detail="Mutation ID has different content")
        return json.loads(existing.response_body)

    conflicts = []
    touched = []
    aliases: dict[str, str] = {}
    _validate_import_batch(payload.changes)
    with db.no_autoflush:
        for original in payload.changes:
            change = original.model_copy(deep=True)
            change.values = {
                key: aliases.get(value, value) if isinstance(value, str) else value
                for key, value in change.values.items()
            }
            requested_id = str(change.id)
            if change.table == "papers":
                canonical = _canonical_import_paper(db, change)
                if canonical is not None and canonical.sync_id != requested_id:
                    aliases[requested_id] = canonical.sync_id
                    canonical._sync_import_user = user.id
                    touched.append(canonical)
                    continue
            if change.table == "paper_editions":
                paper = _paper_by_sync(db, change.values.get("paper_id"))
                digest = change.values.get("sha256")
                canonical = next((edition for edition in paper.editions
                                  if edition.sha256 == digest and edition.deleted_at is None), None)
                if canonical is not None and canonical.sync_id != requested_id:
                    aliases[requested_id] = canonical.sync_id
                    canonical._sync_import_user = user.id
                    source = BLOBS_DIR / digest
                    destination = PDF_FILES_DIR / canonical.file_path
                    PDF_FILES_DIR.mkdir(exist_ok=True)
                    if source.is_file() and not destination.exists():
                        shutil.copyfile(source, destination)
                    touched.append(canonical)
                    continue
            if change.table == "copies" and change.base_revision in {None, 0}:
                paper = _visible_paper(db, change.values.get("paper_id"), user.id)
                canonical = db.query(Copy).filter(
                    Copy.user_id == user.id, Copy.paper_id == paper.id,
                ).first()
                if canonical is not None and canonical.sync_id != requested_id:
                    aliases[requested_id] = canonical.sync_id
                    change.id = UUID(canonical.sync_id)
            if change.table == "copy_tags" and change.base_revision in {None, 0}:
                copy = _owned_copy(db, change.values.get("copy_id"), user.id)
                tag = _owned_tag(db, change.values.get("tag_id"), user.id)
                canonical = db.query(CopyTagLink).filter(
                    CopyTagLink.user_id == user.id,
                    CopyTagLink.copy_id == copy.id,
                    CopyTagLink.tag_id == tag.id,
                ).first()
                if canonical is not None and canonical.sync_id != requested_id:
                    aliases[requested_id] = canonical.sync_id
                    change.id = UUID(canonical.sync_id)
            record, conflict = _apply_change(db, change, user)
            touched.append(record)
            if conflict:
                conflicts.append(conflict)
    for record in touched:
        if isinstance(record, (Paper, PaperEdition)):
            record.revision = (record.revision or 0) + 1
            record.updated_at = datetime.utcnow()
    prepare_sync_changes(db)
    result = {
        "protocol_version": 1,
        "mutation_id": mutation_id,
        "local_sequence": payload.local_sequence,
        "rows": [row_snapshot(record) | {"table": record.__table__.name} for record in touched],
        "conflicts": conflicts,
        "aliases": aliases,
    }
    body = json.dumps(result, separators=(",", ":"), sort_keys=True).encode()
    db.add(AppliedMutation(
        user_id=user.id,
        client_id=client_id,
        mutation_id=mutation_id,
        request_hash=fingerprint,
        method="POST",
        path="/api/sync/push",
        response_status=200,
        response_content_type="application/json",
        response_body=body,
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        winner = db.query(AppliedMutation).filter(
            AppliedMutation.user_id == user.id,
            AppliedMutation.client_id == client_id,
            AppliedMutation.mutation_id == mutation_id,
        ).first()
        if not winner or winner.request_hash != fingerprint:
            raise
        return json.loads(winner.response_body)
    return result


@router.get("/snapshot")
def snapshot(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Current read dependencies and private annotations for this account.

    This bounded snapshot is refreshed before cursor replication. It avoids
    pretending globally shared paper metadata belongs in one user's change
    log while still giving the offline viewer complete foreign-key parents.
    """
    copies = db.query(Copy).filter(Copy.user_id == user.id).all()
    paper_ids = {copy.paper_id for copy in copies}
    papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all() if paper_ids else []
    editions = (
        db.query(PaperEdition).filter(PaperEdition.paper_id.in_(paper_ids)).all()
        if paper_ids else []
    )
    repaired = False
    for edition in editions:
        if not edition.paper_sync_id:
            edition.paper_sync_id = edition.paper.sync_id
            repaired = True
    if repaired:
        db.commit()
    records = [
        *papers,
        *editions,
        *db.query(Comment).filter(Comment.user_id == user.id).all(),
        *db.query(InkStroke).filter(InkStroke.user_id == user.id).all(),
        *db.query(PaperClip).filter(PaperClip.user_id == user.id).all(),
        *db.query(Shelf).filter(Shelf.user_id == user.id).all(),
        *db.query(Tag).filter(Tag.user_id == user.id).all(),
        *db.query(Copy).filter(Copy.user_id == user.id).all(),
        *db.query(CopyTagLink).filter(CopyTagLink.user_id == user.id).all(),
    ]
    for copy in records:
        if not isinstance(copy, Copy):
            continue
        expected = (
            copy.paper.sync_id,
            copy.shelf.sync_id if copy.shelf else None,
            copy.edition.sync_id if copy.edition else None,
        )
        if (copy.paper_sync_id, copy.shelf_sync_id, copy.edition_sync_id) != expected:
            copy.paper_sync_id, copy.shelf_sync_id, copy.edition_sync_id = expected
            repaired = True
    if repaired:
        db.commit()
    return {
        "protocol_version": 1,
        "rows": [row_snapshot(record) | {"table": record.__table__.name}
                 for record in records],
    }


@router.head("/blobs/{sha256}")
def has_blob(sha256: str, _user: User = Depends(get_current_user)):
    if len(sha256) != 64 or not (BLOBS_DIR / sha256).is_file():
        raise HTTPException(status_code=404, detail="Blob not found")
    return Response(status_code=200)


@router.put("/blobs/{sha256}", status_code=204)
async def put_blob(
    sha256: str,
    request: Request,
    _user: User = Depends(get_current_user),
):
    if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise HTTPException(status_code=422, detail="Blob identifier must be lowercase SHA-256")
    body = await request.body()
    if len(body) > BLOB_LIMIT:
        raise HTTPException(status_code=413, detail="Offline files may be at most 25 MB")
    if hashlib.sha256(body).hexdigest() != sha256:
        raise HTTPException(status_code=422, detail="Blob digest does not match its content")
    BLOBS_DIR.mkdir(parents=True, exist_ok=True)
    destination = BLOBS_DIR / sha256
    if not destination.exists():
        temporary = BLOBS_DIR / f".{sha256}.{uuid4()}.tmp"
        temporary.write_bytes(body)
        temporary.replace(destination)
    return Response(status_code=204)


@router.get("/blobs/{sha256}")
def get_blob(
    sha256: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).join(Board).filter(
        BoardItem.sha256 == sha256,
        Board.user_id == user.id,
        BoardItem.deleted_at.is_(None),
    ).first()
    if item and item.file_path:
        path = BOARD_FILES_DIR / item.file_path
        media_type = item.mime_type or "application/octet-stream"
    else:
        edition = db.query(PaperEdition).join(Paper).join(Copy).filter(
            PaperEdition.sha256 == sha256, Copy.user_id == user.id,
            Copy.deleted_at.is_(None),
        ).first()
        if not edition:
            raise HTTPException(status_code=404, detail="Blob not found")
        path = PDF_FILES_DIR / edition.file_path
        media_type = "application/pdf"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Blob not found")
    return FileResponse(path, media_type=media_type)


@router.get("/pull")
def pull(
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=250, ge=1, le=1000),
    client_id: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if client_id is not None:
        client = db.query(SyncClient).filter(
            SyncClient.user_id == user.id,
            SyncClient.client_id == str(client_id),
        ).first()
        if client is None:
            client = SyncClient(user_id=user.id, client_id=str(client_id))
            db.add(client)
        client.acknowledged_cursor = max(client.acknowledged_cursor or 0, cursor)
        client.last_seen_at = datetime.utcnow()
        db.commit()
    records = db.query(ServerChange).filter(
        ServerChange.user_id == user.id,
        ServerChange.sequence > cursor,
    ).order_by(ServerChange.sequence).limit(limit + 1).all()
    page = records[:limit]
    return {
        "protocol_version": 1,
        "cursor": page[-1].sequence if page else cursor,
        "has_more": len(records) > limit,
        "changes": [{
            "sequence": record.sequence,
            "table": record.table_name,
            "id": record.row_sync_id,
            "revision": record.revision,
            "operation": record.operation,
            "row": json.loads(record.row_json),
        } for record in page],
    }
