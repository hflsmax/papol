import hashlib
import json
import os
import re
import shutil
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from cohorts import in_active_cohort, paper_key_for
from database import get_db
from models import (
    Annotation, AppliedMutation, Board, BoardGroup, BoardItem, Copy, CopyTagLink,
    Paper, ServerChange, Shelf, SyncClient, Tag, User,
)
from services.client_requirements import (
    INCOMPATIBLE, client_version, requirements, verdict,
)
from sync.changes import prepare_sync_changes, row_snapshot
from sync.registry import MODELS, registry
from schemas import AnnotationCreate
from services.annotations import KINDS, NOTE
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


def _require_supported_client(request: Request, db: Session) -> None:
    """Refuse a build this server can no longer speak to.

    426 rather than one more 400: the request was well formed and the
    credential was good, and what is wrong is the program that sent it. The
    client recognizes this status specifically — it stops synchronizing and
    tells its user — so it must never be folded in with ordinary refusals.

    Synchronization is the only thing refused. Everything the user already
    holds on their computer stays theirs to read and mark up.
    """
    if verdict(db, request.headers.get("user-agent")) != INCOMPATIBLE:
        return
    asked = requirements(db)
    raise HTTPException(
        status_code=426,
        detail={
            "error": "client_incompatible",
            "minimum_version": asked["minimum_version"],
            "download_url": asked["download_url"],
        },
    )


class RowChange(BaseModel):
    table: Literal[
        "boards", "board_groups", "board_items", "papers",
        "annotations", "shelves", "tags", "copies", "copy_tags",
    ]
    # The row's own name. A UUID for everything a client makes up, and for
    # a paper the digest of its PDF — which is not made up at all: both ends
    # read it off the same bytes and arrive at the same answer, which is
    # what lets an offline import name its paper without asking first.
    uuid: str
    base_revision: int | None = Field(default=None, ge=0)
    operation: Literal["upsert", "patch", "delete"]
    values: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _id_suits_the_table(self):
        if self.table == "papers":
            if not re.fullmatch(r"[0-9a-f]{64}", self.uuid):
                raise ValueError("a paper is named by the sha256 of its PDF")
        else:
            try:
                UUID(self.uuid)
            except ValueError:
                raise ValueError(f"{self.table} rows are named by UUID")
        return self


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


def _key_of(record) -> str:
    """The row's own name, asked of the row."""
    return record.sha256 if isinstance(record, Paper) else record.uuid


def _row_key(model):
    """The column a table names its rows by: a paper's file, or a UUID."""
    return model.sha256 if model is Paper else model.uuid


def _find_owned(db: Session, model, row_uuid: str, user_uuid: str):
    for pending in db.new:
        if isinstance(pending, model) and _key_of(pending) == row_uuid:
            if isinstance(pending, Paper):
                return pending
            if isinstance(pending, (Annotation, Board, Copy, CopyTagLink, Shelf, Tag)):
                return pending if pending.user_uuid == user_uuid else None
            return pending if pending.board.user_uuid == user_uuid else None
    query = db.query(model).filter(_row_key(model) == row_uuid)
    if model is Paper:
        return query.first()
    if model in {Annotation, Board, Copy, CopyTagLink, Shelf, Tag}:
        return query.filter(model.user_uuid == user_uuid).first()
    return query.join(Board).filter(Board.user_uuid == user_uuid).first()


def _receive_paper_file(digest: str) -> str:
    """Put the uploaded bytes where papers are read from, and say what the
    file is called. The blob has to have been sent already: a paper names
    its file, so a paper Papol cannot open is not one it can store."""
    source = BLOBS_DIR / digest
    if not source.is_file():
        raise HTTPException(status_code=409, detail="Paper blob has not been uploaded")
    PDF_FILES_DIR.mkdir(exist_ok=True)
    filename = f"{digest}.pdf"
    destination = PDF_FILES_DIR / filename
    if not destination.exists():
        shutil.copyfile(source, destination)
    return filename


def _owned_paper(db: Session, paper_sha256: str, user_uuid: str) -> Paper:
    paper = db.query(Paper).join(Copy).filter(
        Paper.sha256 == paper_sha256, Copy.user_uuid == user_uuid,
    ).first()
    if not paper:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _paper_by_digest(db: Session, paper_sha256: str) -> Paper:
    for pending in db.new:
        if isinstance(pending, Paper) and pending.sha256 == paper_sha256:
            return pending
    paper = db.get(Paper, paper_sha256) if isinstance(paper_sha256, str) else None
    if not paper or paper.deleted_at is not None:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


def _visible_paper(db: Session, paper_sha256: str, user_uuid: str) -> Paper:
    paper = _paper_by_digest(db, paper_sha256)
    if paper in db.new or getattr(paper, "_sync_import_user", None) == user_uuid:
        return paper
    visible = any(
        copy.deleted_at is None and (copy.user_uuid == user_uuid or copy.is_public)
        for copy in paper.copies
    )
    if not visible:
        raise HTTPException(status_code=409, detail="Referenced paper is unavailable")
    return paper


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
        # The row's name is the digest, so the bytes it names have to be
        # here before the row is.
        _receive_paper_file(row_uuid)
        return Paper(
            sha256=row_uuid, title="", file_path=f"{row_uuid}.pdf",
            uploaded_by=user.uuid,
        )
    if change.table == "boards":
        shelf = _owned_shelf(db, values.get("shelf_uuid"), user.uuid)
        return Board(
            uuid=row_uuid, user_uuid=user.uuid, shelf=shelf, name="", description=None,
        )
    if change.table == "annotations":
        paper_sha256 = values.get("paper_sha256")
        if not isinstance(paper_sha256, str):
            raise HTTPException(
                status_code=422, detail="annotations.paper_sha256 is required",
            )
        paper = _owned_paper(db, paper_sha256, user.uuid)
        kind = values.get("kind")
        if kind not in KINDS:
            raise HTTPException(status_code=422, detail="Unknown annotation kind")
        return Annotation(
            uuid=row_uuid, kind=kind, paper=paper,
            user_uuid=user.uuid, content="", body="{}",
        )
    if change.table == "shelves":
        return Shelf(
            uuid=row_uuid, user_uuid=user.uuid, name="", color="#7f8c8d",
            is_public=False, is_default=False, position=0,
        )
    if change.table == "tags":
        return Tag(uuid=row_uuid, user_uuid=user.uuid, name="")
    if change.table == "copies":
        paper_sha256 = values.get("paper_sha256")
        if not isinstance(paper_sha256, str):
            raise HTTPException(status_code=422, detail="copies.paper_sha256 is required")
        paper = _visible_paper(db, paper_sha256, user.uuid)
        shelf = _owned_shelf(db, values.get("shelf_uuid"), user.uuid)
        return Copy(
            uuid=row_uuid, paper=paper, shelf=shelf,
            user_uuid=user.uuid, is_author=False,
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
        # The PDF is the paper's identity: metadata may be corrected, but
        # different bytes are a different paper, not an edit to this one.
        if "sha256" in values and values["sha256"] != record.sha256:
            raise HTTPException(status_code=422, detail="Paper content cannot change")
        for key, value in values.items():
            if key not in {"deleted_at", "sha256", "file_path"}:
                setattr(record, key, value)
        record.title = (record.title or "").strip()
        if not record.title or len(record.title) > limit("text", "source_label"):
            raise HTTPException(status_code=422, detail="Paper title must be 1–500 characters")
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

    if isinstance(record, Annotation):
        if "paper_sha256" in values:
            record.paper = _owned_paper(db, values["paper_sha256"], user.uuid)
        for key, value in values.items():
            if key not in {"paper_sha256", "deleted_at"}:
                setattr(record, key, value)
        # The client decides which kind of annotation it made; every kind is then
        # held to its own shape, so a replica cannot write a stroke with no
        # points or an anchor off the page.
        if record.kind not in KINDS:
            raise HTTPException(status_code=422, detail="Unknown annotation kind")
        try:
            AnnotationCreate(
                kind=record.kind,
                page=record.page,
                group_uuid=record.group_uuid,
                content=record.content or "",
                name=record.name,
                body=json.loads(record.body or "{}"),
            )
        except (TypeError, ValueError, ValidationError) as error:
            detail = (
                error.errors(include_context=False, include_url=False)
                if isinstance(error, ValidationError) else str(error)
            )
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
        if "paper_sha256" in values:
            record.paper = _visible_paper(db, values["paper_sha256"], user.uuid)
        if "shelf_uuid" in values:
            shelf = _owned_shelf(db, values["shelf_uuid"], user.uuid)
            # Visibility belongs to the shelf, so the move is the whole of
            # it: there is nothing on the copy left to bring into line.
            if shelf is not None:
                if (record.is_public and not shelf.is_public and record.paper is not None
                        and in_active_cohort(db, user, paper_key_for(record.paper))):
                    raise HTTPException(
                        status_code=422,
                        detail="Leave the seminar before moving this paper to a private shelf",
                    )
            record.shelf = shelf
        for key, value in values.items():
            if key not in {"paper_sha256", "shelf_uuid", "deleted_at"}:
                setattr(record, key, value)
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
    if not papers:
        return
    if any(change.operation != "upsert" or change.base_revision not in {None, 0}
           for change in changes if change.table == "papers"):
        raise HTTPException(status_code=422, detail="Paper imports are create-only")
    for paper_sha256 in papers:
        if not any(change.table == "copies"
                   and change.values.get("paper_sha256") == paper_sha256
                   for change in changes):
            raise HTTPException(status_code=422, detail="Paper import needs an owned copy")


@router.post("/push")
def push(
    payload: PushRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_supported_client(request, db)
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
    with db.no_autoflush:
        for original in payload.changes:
            change = original.model_copy(deep=True)
            change.values = {
                key: aliases.get(value, value) if isinstance(value, str) else value
                for key, value in change.values.items()
            }
            requested_uuid = str(change.uuid)
            if change.table == "papers":
                # No alias: the replica named this paper by its digest, and
                # so would we. When Papol already holds the file, the import
                # is simply the user saying they have it too.
                held = db.get(Paper, requested_uuid)
                if held is not None:
                    held._sync_import_user = user.uuid
                    _receive_paper_file(requested_uuid)
                    touched.append(held)
                    continue
            if change.table == "copies" and change.base_revision in {None, 0}:
                paper = _visible_paper(db, change.values.get("paper_sha256"), user.uuid)
                owned = db.query(Copy).filter(
                    Copy.user_uuid == user.uuid, Copy.paper_sha256 == paper.sha256,
                )
                canonical = owned.filter(Copy.deleted_at.is_(None)).first() or owned.first()
                if canonical is not None and canonical.uuid != requested_uuid:
                    aliases[requested_uuid] = canonical.uuid
                    change.uuid = UUID(canonical.uuid)
                # A user has one copy per paper (uq_copy), so adding back a
                # paper they once removed has to revive that tombstone rather
                # than insert a second row. Only a fresh addition may do this:
                # a stale edit still loses to the delete.
                if canonical is not None and canonical.deleted_at is not None:
                    canonical.deleted_at = None
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
        if isinstance(record, Paper):
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
def snapshot(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Current read dependencies and private annotations for this account.

    This bounded snapshot is refreshed before cursor replication. It avoids
    pretending globally shared paper metadata belongs in one user's change
    log while still giving the offline viewer complete foreign-key parents.

    Gated like the push and the pull, and for a plainer reason than either:
    the rows name a paper by the digest of its file, and a build that reads
    them expecting a UUID would not fail — it would store the wrong thing.
    """
    _require_supported_client(request, db)
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
    paper_sha256s = {copy.paper_sha256 for copy in copies}
    papers = db.query(Paper).filter(Paper.sha256.in_(paper_sha256s)).all() if paper_sha256s else []
    records = [
        *papers,
        *shelves,
        *tags,
        *boards,
        *board_groups,
        *board_items,
        *db.query(Annotation).filter(Annotation.user_uuid == user.uuid).all(),
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
        paper = db.query(Paper).join(Copy).filter(
            Paper.sha256 == sha256, Copy.user_uuid == user.uuid,
            Copy.deleted_at.is_(None),
        ).first()
        if not paper or not paper.file_path:
            raise HTTPException(status_code=404, detail="Blob not found")
        path = PDF_FILES_DIR / paper.file_path
        media_type = "application/pdf"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Blob not found")
    return FileResponse(path, media_type=media_type)


@router.get("/pull")
def pull(
    request: Request,
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
    _require_supported_client(request, db)
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
        # Remembered on every pull, which is the one call every sync makes.
        # A version that cannot be read leaves the last good one in place
        # rather than erasing what we knew about this installation.
        client.app_version = (
            client_version(request.headers.get("user-agent")) or client.app_version
        )
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
