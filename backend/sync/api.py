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
from cohorts import in_active_cohort, paper_key_for
from database import get_db
from models import (
    AppliedMutation, Board, BoardGroup, BoardItem, Comment, Copy, CopyTagLink, InkStroke,
    Paper, PaperClip, PaperEdition, ServerChange, Shelf, SyncClient, Tag, User,
)
from sync.changes import prepare_sync_changes, row_snapshot
from sync.registry import MODELS, registry
from schemas import CommentCreate, InkStrokeCreate, PaperClipCreate
from app_limits import limit, mebibytes


router = APIRouter(prefix="/api/sync", tags=["sync"])
BOARD_FILES_DIR = Path(os.environ.get(
    "PAPOL_BOARD_FILES_DIR", Path(__file__).parents[2] / "board_uploads",
))
BLOBS_DIR = BOARD_FILES_DIR / "blobs"
PDF_FILES_DIR = Path(os.environ.get(
    "PAPOL_UPLOADS_DIR", Path(__file__).parents[2] / "uploads",
))
BLOB_LIMIT = mebibytes("files", "offline_blob_mb")
PROTOCOL_VERSION = 1


class RowChange(BaseModel):
    table: Literal[
        "boards", "board_groups", "board_items", "papers", "paper_editions",
        "comments", "ink_strokes",
        "paper_clips",
        "shelves", "tags", "copies",
        "copy_tags",
    ]
    uuid: UUID
    base_revision: int | None = Field(default=None, ge=0)
    operation: Literal["upsert", "patch", "delete"]
    values: dict[str, Any] = Field(default_factory=dict)


class PushRequest(BaseModel):
    protocol_version: Literal[1] = PROTOCOL_VERSION
    client_uuid: UUID
    mutation_uuid: UUID
    local_sequence: int = Field(ge=0)
    changes: list[RowChange] = Field(min_length=1, max_length=limit("counts", "sync_push_changes"))


def _canonical_payload(payload: PushRequest) -> bytes:
    return json.dumps(
        payload.model_dump(mode="json"), separators=(",", ":"), sort_keys=True,
    ).encode()


def _find_owned(db: Session, model, row_uuid: str, user_uuid: str):
    for pending in db.new:
        if isinstance(pending, model) and pending.uuid == row_uuid:
            if isinstance(pending, (Paper, PaperEdition)):
                return pending
            if isinstance(pending, (Board, Comment, InkStroke, PaperClip, Copy, CopyTagLink, Shelf, Tag)):
                return pending if pending.user_uuid == user_uuid else None
            return pending if pending.board.user_uuid == user_uuid else None
    query = db.query(model).filter(model.uuid == row_uuid)
    if model in {Paper, PaperEdition}:
        return query.first()
    if model in {Board, Comment, InkStroke, PaperClip, Copy, CopyTagLink, Shelf, Tag}:
        return query.filter(model.user_uuid == user_uuid).first()
    return query.join(Board).filter(Board.user_uuid == user_uuid).first()


def _owned_paper(db: Session, paper_uuid: str, user_uuid: str) -> Paper:
    paper = db.query(Paper).join(Copy).filter(
        Paper.uuid == paper_uuid, Copy.user_uuid == user_uuid,
    ).first()
    if not paper:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _paper_by_uuid(db: Session, paper_uuid: str) -> Paper:
    for pending in db.new:
        if isinstance(pending, Paper) and pending.uuid == paper_uuid:
            return pending
    paper = db.get(Paper, paper_uuid) if isinstance(paper_uuid, str) else None
    if not paper or paper.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _visible_paper(db: Session, paper_uuid: str, user_uuid: str) -> Paper:
    paper = _paper_by_uuid(db, paper_uuid)
    if paper in db.new or getattr(paper, "_sync_import_user", None) == user_uuid:
        return paper
    visible = any(
        copy.deleted_at is None and (copy.user_uuid == user_uuid or copy.marketed)
        for copy in paper.copies
    )
    if not visible:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _owned_edition(db: Session, edition_uuid: str, user_uuid: str) -> PaperEdition:
    for pending in db.new:
        if (isinstance(pending, PaperEdition) and pending.uuid == edition_uuid
                and pending.uploaded_by == user_uuid):
            return pending
    edition = db.query(PaperEdition).join(Paper).join(Copy).filter(
        PaperEdition.uuid == edition_uuid, Copy.user_uuid == user_uuid,
    ).first()
    if edition is None:
        edition = db.get(PaperEdition, edition_uuid) if isinstance(edition_uuid, str) else None
        if edition is not None and getattr(edition, "_sync_import_user", None) == user_uuid:
            return edition
        edition = None
    if not edition:
        raise HTTPException(status_code=409, detail="Referenced edition is unavailable")
    return edition


def _edition_for_new_copy(db: Session, edition_uuid: str, paper: Paper) -> PaperEdition:
    for pending in db.new:
        if (isinstance(pending, PaperEdition) and pending.uuid == edition_uuid
                and pending.paper is paper and pending.deleted_at is None):
            return pending
    edition = db.get(PaperEdition, edition_uuid) if isinstance(edition_uuid, str) else None
    if edition is None or edition.deleted_at is not None or edition.paper_uuid != paper.uuid:
        raise HTTPException(status_code=409, detail="Referenced edition is unavailable")
    return edition


def _owned_shelf(db: Session, shelf_uuid: str | None, user_uuid: str) -> Shelf | None:
    if shelf_uuid is None:
        return None
    for pending in db.new:
        if (isinstance(pending, Shelf) and pending.uuid == shelf_uuid
                and pending.user_uuid == user_uuid and pending.deleted_at is None):
            return pending
    shelf = db.query(Shelf).filter(Shelf.uuid == shelf_uuid, Shelf.user_uuid == user_uuid).first()
    if not shelf or shelf.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced shelf is unavailable")
    return shelf


def _owned_copy(db: Session, copy_uuid: str, user_uuid: str) -> Copy:
    copy = _find_owned(db, Copy, copy_uuid, user_uuid)
    if not copy or copy.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced copy is unavailable")
    return copy


def _owned_tag(db: Session, tag_uuid: str, user_uuid: str) -> Tag:
    tag = _find_owned(db, Tag, tag_uuid, user_uuid)
    if not tag or tag.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced tag is unavailable")
    return tag


def _owned_board(db: Session, board_uuid: str, user_uuid: str) -> Board:
    for pending in db.new:
        if (isinstance(pending, Board) and pending.uuid == board_uuid
                and pending.user_uuid == user_uuid and pending.deleted_at is None):
            return pending
    board = db.query(Board).filter(
        Board.uuid == board_uuid, Board.user_uuid == user_uuid,
    ).first()
    if not board or board.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced board is unavailable")
    return board


def _owned_group(db: Session, group_uuid: str | None, board: Board) -> BoardGroup | None:
    if group_uuid is None:
        return None
    for pending in db.new:
        if (isinstance(pending, BoardGroup) and pending.uuid == group_uuid
                and pending.board is board and pending.deleted_at is None):
            return pending
    group = db.query(BoardGroup).filter(
        BoardGroup.uuid == group_uuid,
        BoardGroup.board_uuid == board.uuid,
        BoardGroup.deleted_at.is_(None),
    ).first()
    if not group:
        raise HTTPException(status_code=409, detail="Referenced group is unavailable")
    return group


def _new_record(db: Session, change: RowChange, user: User, values: dict):
    row_uuid = str(change.uuid)
    if change.table == "papers":
        return Paper(uuid=row_uuid, title="")
    if change.table == "paper_editions":
        paper_uuid = values.get("paper_uuid")
        sha256 = values.get("sha256")
        if not isinstance(paper_uuid, str) or not isinstance(sha256, str):
            raise HTTPException(status_code=422, detail="Paper edition needs paper_uuid and sha256")
        source = BLOBS_DIR / sha256
        if not source.is_file():
            raise HTTPException(status_code=409, detail="Edition blob has not been uploaded")
        PDF_FILES_DIR.mkdir(exist_ok=True)
        filename = f"{sha256}.pdf"
        destination = PDF_FILES_DIR / filename
        if not destination.exists():
            shutil.copyfile(source, destination)
        return PaperEdition(
            uuid=row_uuid, paper=_paper_by_uuid(db, paper_uuid),
            file_path=filename, sha256=sha256, uploaded_by=user.uuid,
        )
    if change.table == "boards":
        shelf = _owned_shelf(db, values.get("shelf_uuid"), user.uuid)
        return Board(
            uuid=row_uuid, user_uuid=user.uuid, shelf=shelf, name="", description=None,
        )
    if change.table == "comments":
        paper_uuid = values.get("paper_uuid")
        if not isinstance(paper_uuid, str):
            raise HTTPException(status_code=422, detail="comments.paper_uuid is required")
        paper = _owned_paper(db, paper_uuid, user.uuid)
        edition = None
        if values.get("edition_uuid") is not None:
            edition = _owned_edition(db, values["edition_uuid"], user.uuid)
            if edition.paper is not paper:
                raise HTTPException(status_code=409, detail="Note edition belongs to another paper")
        return Comment(
            uuid=row_uuid, paper=paper, edition=edition, user_uuid=user.uuid, content="",
        )
    if change.table in {"ink_strokes", "paper_clips"}:
        edition_uuid = values.get("edition_uuid")
        if not isinstance(edition_uuid, str):
            raise HTTPException(status_code=422, detail=f"{change.table}.edition_uuid is required")
        edition = _owned_edition(db, edition_uuid, user.uuid)
        common = {"uuid": row_uuid, "edition": edition, "user_uuid": user.uuid}
        if change.table == "ink_strokes":
            return InkStroke(
                **common, page=1, points="[]", color="#b3923d", width=0.004,
                opacity=1.0, shape="flat",
            )
        return PaperClip(**common, page=1, source="{}", frame="{}", floating=False)
    if change.table == "shelves":
        return Shelf(
            uuid=row_uuid, user_uuid=user.uuid, name="", color="#7f8c8d",
            is_public=False, is_default=False, position=0,
        )
    if change.table == "tags":
        return Tag(uuid=row_uuid, user_uuid=user.uuid, name="")
    if change.table == "copies":
        paper_uuid = values.get("paper_uuid")
        if not isinstance(paper_uuid, str):
            raise HTTPException(status_code=422, detail="copies.paper_uuid is required")
        paper = _visible_paper(db, paper_uuid, user.uuid)
        edition = _edition_for_new_copy(db, values["edition_uuid"], paper) if values.get("edition_uuid") else None
        shelf = _owned_shelf(db, values.get("shelf_uuid"), user.uuid)
        return Copy(
            uuid=row_uuid, paper=paper, edition=edition, shelf=shelf,
            user_uuid=user.uuid, marketed=False, is_author=False,
        )
    if change.table == "copy_tags":
        copy_uuid, tag_uuid = values.get("copy_uuid"), values.get("tag_uuid")
        if not isinstance(copy_uuid, str) or not isinstance(tag_uuid, str):
            raise HTTPException(status_code=422, detail="copy_tags needs copy_uuid and tag_uuid")
        copy, tag = _owned_copy(db, copy_uuid, user.uuid), _owned_tag(db, tag_uuid, user.uuid)
        return CopyTagLink(uuid=row_uuid, copy=copy, tag=tag, user_uuid=user.uuid)
    board_uuid = values.get("board_uuid")
    if not isinstance(board_uuid, str):
        raise HTTPException(status_code=422, detail=f"{change.table}.board_uuid is required")
    board = _owned_board(db, board_uuid, user.uuid)
    if change.table == "board_groups":
        return BoardGroup(
            uuid=row_uuid, board=board, kind="booklet", title="", auto_arrange=False,
        )
    return BoardItem(
        uuid=row_uuid, board=board, group=_owned_group(db, values.get("group_uuid"), board),
        kind="comment", staged=False, text_align="left", position=0,
        x=0, y=0, width=300,
    )


def _assign_values(db: Session, record, values: dict, user: User):
    if isinstance(record, Paper):
        for key, value in values.items():
            if key != "deleted_at":
                setattr(record, key, value)
        record.title = (record.title or "").strip()
        if not record.title or len(record.title) > limit("text", "source_label"):
            raise HTTPException(status_code=422, detail="Paper title must be 1–500 characters")
        return
    if isinstance(record, PaperEdition):
        if "paper_uuid" in values:
            record.paper = _paper_by_uuid(db, values["paper_uuid"])
        if "sha256" in values and values["sha256"] != record.sha256:
            raise HTTPException(status_code=422, detail="Edition content cannot change")
        return
    if isinstance(record, Board):
        if "shelf_uuid" in values:
            record.shelf = _owned_shelf(db, values["shelf_uuid"], user.uuid)
        for key, value in values.items():
            if key not in {"shelf_uuid", "deleted_at"}:
                setattr(record, key, value)
        if not record.name or len(record.name.strip()) > 120:
            raise HTTPException(status_code=422, detail="Board name must be 1–120 characters")
        record.name = record.name.strip()
        return

    if isinstance(record, Comment):
        if "paper_uuid" in values:
            record.paper = _owned_paper(db, values["paper_uuid"], user.uuid)
        if "edition_uuid" in values:
            edition_uuid = values["edition_uuid"]
            record.edition = _owned_edition(db, edition_uuid, user.uuid) if edition_uuid else None
        if record.edition is not None and record.edition.paper is not record.paper:
            raise HTTPException(status_code=409, detail="Note edition belongs to another paper")
        for key, value in values.items():
            if key not in {"paper_uuid", "edition_uuid", "deleted_at"}:
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
        if "edition_uuid" in values:
            record.edition = _owned_edition(db, values["edition_uuid"], user.uuid)
        for key, value in values.items():
            if key not in {"edition_uuid", "deleted_at"}:
                setattr(record, key, value)
        try:
            if isinstance(record, InkStroke):
                InkStrokeCreate(
                    group_uuid=record.group_uuid, page=record.page,
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
        if not record.name or len(record.name) > limit("text", "shelf_name"):
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
        if not record.name or len(record.name) > limit("text", "tag_name"):
            raise HTTPException(status_code=422, detail="Tag name must be 1–60 characters")
        return
    if isinstance(record, Copy):
        if "paper_uuid" in values:
            record.paper = _visible_paper(db, values["paper_uuid"], user.uuid)
        if "shelf_uuid" in values:
            shelf = _owned_shelf(db, values["shelf_uuid"], user.uuid)
            # Visibility belongs to the shelf: moving a copy publishes or
            # hides it exactly as the online move in update_paper does.
            if shelf is not None:
                if (record.marketed and not shelf.is_public and record.paper is not None
                        and in_active_cohort(db, user, paper_key_for(record.paper))):
                    raise HTTPException(
                        status_code=422,
                        detail="Leave the seminar before moving this paper to a private shelf",
                    )
                record.marketed = bool(shelf.is_public)
            record.shelf = shelf
        if "edition_uuid" in values:
            edition_uuid = values["edition_uuid"]
            record.edition = _edition_for_new_copy(db, edition_uuid, record.paper) if edition_uuid else None
        if "ignored_edition_uuid" in values:
            ignored_uuid = values["ignored_edition_uuid"]
            record.ignored_edition = _owned_edition(db, ignored_uuid, user.uuid) if ignored_uuid else None
        for key, value in values.items():
            if key not in {
                "paper_uuid", "shelf_uuid", "edition_uuid", "ignored_edition_uuid", "deleted_at",
            }:
                setattr(record, key, value)
        if record.edition is not None and record.edition.paper is not record.paper:
            raise HTTPException(status_code=409, detail="Copy edition belongs to another paper")
        # The same limits PaperUpdate enforces for the online edit form.
        for key in ("rating_expertise", "rating_reading", "rating_liking"):
            rating = values.get(key)
            if rating is not None and (
                isinstance(rating, bool)
                or not isinstance(rating, int)
                or not limit("ratings", "min") <= rating <= limit("ratings", "max")
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(f'Ratings must be whole numbers from {limit("ratings", "min")} '
                            f'to {limit("ratings", "max")}'),
                )
        return
    if isinstance(record, CopyTagLink):
        if "copy_uuid" in values:
            record.copy = _owned_copy(db, values["copy_uuid"], user.uuid)
        if "tag_uuid" in values:
            record.tag = _owned_tag(db, values["tag_uuid"], user.uuid)
        return

    if "board_uuid" in values:
        record.board = _owned_board(db, values["board_uuid"], user.uuid)
    if isinstance(record, BoardItem) and "group_uuid" in values:
        record.group = _owned_group(db, values["group_uuid"], record.board)
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
        if key not in {"board_uuid", "group_uuid", "deleted_at"}:
            setattr(record, key, value)
    if isinstance(record, BoardGroup):
        if record.kind not in {"booklet", "collection"}:
            raise HTTPException(status_code=422, detail="Invalid board group kind")
        if (len(record.title or "") > limit("text", "board_group_title")
                or len(record.header or "") > limit("text", "board_group_header")):
            raise HTTPException(status_code=422, detail="Board group text is too long")
    else:
        if record.kind not in {"comment", "excerpt", "image", "file", "youtube", "webpage"}:
            raise HTTPException(status_code=422, detail="Invalid board item kind")
        if record.text_align not in {"left", "center", "right"}:
            raise HTTPException(status_code=422, detail="Invalid text alignment")
        if not limit("board", "item_width_min") <= record.width <= limit("board", "item_width_max"):
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
    row_uuid = str(change.uuid)
    record = _find_owned(db, model, row_uuid, user.uuid)
    if rule.get("create_only") and record is not None:
        raise HTTPException(status_code=409, detail=f"{change.table} rows are create-only")
    if record is None:
        collision = next((pending for pending in db.new
                          if isinstance(pending, model) and pending.uuid == row_uuid), None)
        if collision is None:
            collision = db.get(model, row_uuid)
        if collision is not None:
            raise HTTPException(status_code=404, detail="Synchronized row not found")
        # A delete says what the final state should be. If a restored or
        # replaced server database has already lost that row, the requested
        # state is satisfied and the mutation can be acknowledged. This also
        # makes retries idempotent without manufacturing a partial tombstone.
        if change.operation == "delete":
            return None, None
        if change.operation == "patch":
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
            "uuid": row_uuid,
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
            "uuid": row_uuid,
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
    papers = {str(change.uuid) for change in changes if change.table == "papers"}
    editions = {str(change.uuid) for change in changes if change.table == "paper_editions"}
    if not papers and not editions:
        return
    if any(change.operation != "upsert" or change.base_revision not in {None, 0}
           for change in changes if change.table in {"papers", "paper_editions"}):
        raise HTTPException(status_code=422, detail="Paper imports are create-only")
    for paper_uuid in papers:
        edition = next((change for change in changes
                        if change.table == "paper_editions"
                        and change.values.get("paper_uuid") == paper_uuid), None)
        if edition is None or not any(
            change.table == "copies"
            and change.values.get("paper_uuid") == paper_uuid
            and change.values.get("edition_uuid") == str(edition.uuid)
            for change in changes
        ):
            raise HTTPException(status_code=422, detail="Paper import needs an owned edition and copy")
    for edition_uuid in editions:
        if not any(change.table == "copies" and change.values.get("edition_uuid") == edition_uuid
                   for change in changes):
            raise HTTPException(status_code=422, detail="Edition import needs an owned copy")


def _canonical_import_paper(
    db: Session, change: RowChange, sha256: str | None = None,
) -> Paper | None:
    if sha256:
        edition = db.query(PaperEdition).filter(
            PaperEdition.sha256 == sha256,
            PaperEdition.deleted_at.is_(None),
        ).first()
        if edition is not None:
            return edition.paper
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
    client_uuid = str(payload.client_uuid)
    mutation_uuid = str(payload.mutation_uuid)
    fingerprint = hashlib.sha256(_canonical_payload(payload)).hexdigest()
    existing = db.query(AppliedMutation).filter(
        AppliedMutation.user_uuid == user.uuid,
        AppliedMutation.client_uuid == client_uuid,
        AppliedMutation.mutation_uuid == mutation_uuid,
    ).first()
    if existing:
        if existing.request_hash != fingerprint:
            raise HTTPException(status_code=409, detail="Mutation UUID has different content")
        return json.loads(existing.response_body)

    conflicts = []
    touched = []
    aliases: dict[str, str] = {}
    _validate_import_batch(payload.changes)
    import_digests = {
        change.values.get("paper_uuid"): change.values.get("sha256")
        for change in payload.changes
        if change.table == "paper_editions"
    }
    with db.no_autoflush:
        for original in payload.changes:
            change = original.model_copy(deep=True)
            change.values = {
                key: aliases.get(value, value) if isinstance(value, str) else value
                for key, value in change.values.items()
            }
            requested_uuid = str(change.uuid)
            if change.table == "papers":
                canonical = _canonical_import_paper(
                    db, change, import_digests.get(requested_uuid),
                )
                if canonical is not None and canonical.uuid != requested_uuid:
                    aliases[requested_uuid] = canonical.uuid
                    canonical._sync_import_user = user.uuid
                    touched.append(canonical)
                    continue
            if change.table == "paper_editions":
                paper = _paper_by_uuid(db, change.values.get("paper_uuid"))
                digest = change.values.get("sha256")
                canonical = next((edition for edition in paper.editions
                                  if edition.sha256 == digest and edition.deleted_at is None), None)
                if canonical is not None and canonical.uuid != requested_uuid:
                    aliases[requested_uuid] = canonical.uuid
                    canonical._sync_import_user = user.uuid
                    source = BLOBS_DIR / digest
                    destination = PDF_FILES_DIR / canonical.file_path
                    PDF_FILES_DIR.mkdir(exist_ok=True)
                    if source.is_file() and not destination.exists():
                        shutil.copyfile(source, destination)
                    touched.append(canonical)
                    continue
            if change.table == "copies" and change.base_revision in {None, 0}:
                paper = _visible_paper(db, change.values.get("paper_uuid"), user.uuid)
                canonical = db.query(Copy).filter(
                    Copy.user_uuid == user.uuid, Copy.paper_uuid == paper.uuid,
                ).first()
                if canonical is not None and canonical.uuid != requested_uuid:
                    aliases[requested_uuid] = canonical.uuid
                    change.uuid = UUID(canonical.uuid)
            if change.table == "copy_tags" and change.base_revision in {None, 0}:
                copy = _owned_copy(db, change.values.get("copy_uuid"), user.uuid)
                tag = _owned_tag(db, change.values.get("tag_uuid"), user.uuid)
                canonical = db.query(CopyTagLink).filter(
                    CopyTagLink.user_uuid == user.uuid,
                    CopyTagLink.copy_uuid == copy.uuid,
                    CopyTagLink.tag_uuid == tag.uuid,
                ).first()
                if canonical is not None and canonical.uuid != requested_uuid:
                    aliases[requested_uuid] = canonical.uuid
                    change.uuid = UUID(canonical.uuid)
            record, conflict = _apply_change(db, change, user)
            if record is not None:
                touched.append(record)
            if conflict:
                conflicts.append(conflict)
    for record in touched:
        if isinstance(record, (Paper, PaperEdition)):
            record.revision = (record.revision or 0) + 1
            record.updated_at = datetime.utcnow()
    prepare_sync_changes(db)
    result = {
        "protocol_version": PROTOCOL_VERSION,
        "mutation_uuid": mutation_uuid,
        "local_sequence": payload.local_sequence,
        "rows": [row_snapshot(record) | {"table": record.__table__.name} for record in touched],
        "conflicts": conflicts,
        "aliases": aliases,
    }
    body = json.dumps(result, separators=(",", ":"), sort_keys=True).encode()
    db.add(AppliedMutation(
        user_uuid=user.uuid,
        client_uuid=client_uuid,
        mutation_uuid=mutation_uuid,
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
            AppliedMutation.user_uuid == user.uuid,
            AppliedMutation.client_uuid == client_uuid,
            AppliedMutation.mutation_uuid == mutation_uuid,
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
    copies = db.query(Copy).filter(Copy.user_uuid == user.uuid).all()
    shelves = db.query(Shelf).filter(Shelf.user_uuid == user.uuid).all()
    tags = db.query(Tag).filter(Tag.user_uuid == user.uuid).all()
    boards = db.query(Board).filter(Board.user_uuid == user.uuid).all()
    board_uuids = {board.uuid for board in boards}
    board_groups = (
        db.query(BoardGroup).filter(BoardGroup.board_uuid.in_(board_uuids)).all()
        if board_uuids else []
    )
    board_items = (
        db.query(BoardItem).filter(BoardItem.board_uuid.in_(board_uuids)).all()
        if board_uuids else []
    )
    paper_uuids = {copy.paper_uuid for copy in copies}
    papers = db.query(Paper).filter(Paper.uuid.in_(paper_uuids)).all() if paper_uuids else []
    editions = (
        db.query(PaperEdition).filter(PaperEdition.paper_uuid.in_(paper_uuids)).all()
        if paper_uuids else []
    )
    records = [
        *papers,
        *editions,
        *shelves,
        *tags,
        *boards,
        *board_groups,
        *board_items,
        *db.query(Comment).filter(Comment.user_uuid == user.uuid).all(),
        *db.query(InkStroke).filter(InkStroke.user_uuid == user.uuid).all(),
        *db.query(PaperClip).filter(PaperClip.user_uuid == user.uuid).all(),
        *copies,
        *db.query(CopyTagLink).filter(CopyTagLink.user_uuid == user.uuid).all(),
    ]
    return {
        "protocol_version": PROTOCOL_VERSION,
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
        raise HTTPException(status_code=413, detail=f'Offline files may be at most {limit("files", "offline_blob_mb")} MB')
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
        Board.user_uuid == user.uuid,
        BoardItem.deleted_at.is_(None),
    ).first()
    if item and item.file_path:
        path = BOARD_FILES_DIR / item.file_path
        media_type = item.mime_type or "application/octet-stream"
    else:
        edition = db.query(PaperEdition).join(Paper).join(Copy).filter(
            PaperEdition.sha256 == sha256, Copy.user_uuid == user.uuid,
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
    limit: int = Query(
        default=limit("counts", "sync_pull_default"),
        ge=1,
        le=limit("counts", "sync_pull_max"),
    ),
    client_uuid: UUID | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if client_uuid is not None:
        client = db.query(SyncClient).filter(
            SyncClient.user_uuid == user.uuid,
            SyncClient.client_uuid == str(client_uuid),
        ).first()
        if client is None:
            client = SyncClient(user_uuid=user.uuid, client_uuid=str(client_uuid))
            db.add(client)
        client.acknowledged_cursor = max(client.acknowledged_cursor or 0, cursor)
        client.last_seen_at = datetime.utcnow()
        db.commit()
    records = db.query(ServerChange).filter(
        ServerChange.user_uuid == user.uuid,
        ServerChange.sequence > cursor,
    ).order_by(ServerChange.sequence).limit(limit + 1).all()
    page = records[:limit]
    return {
        "protocol_version": PROTOCOL_VERSION,
        "cursor": page[-1].sequence if page else cursor,
        "has_more": len(records) > limit,
        "changes": [{
            "sequence": record.sequence,
            "table": record.table_name,
            "uuid": record.row_uuid,
            "revision": record.revision,
            "operation": record.operation,
            "row": json.loads(record.row_json),
        } for record in page],
    }
