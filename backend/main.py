import asyncio
import os
from datetime import timedelta

from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, BackgroundTasks
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, Response
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile as StarletteUploadFile
import tempfile
from functools import lru_cache
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
import hashlib
import ipaddress
import json
import re
import uuid
import logging
import shutil
import socket
import subprocess
import traceback
import urllib.parse
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from app_limits import limit, mebibytes

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from database import (
    engine, get_db, Base, migrate,
    SessionLocal, set_request_session, reset_request_session,
)
from models import (
    User, AuthToken, AppliedMutation, Paper, Copy, CopyTagLink,
    Room, RoomParticipant, RoomMessage, RoomAvailability, Notification, ErrorLog,
    PaperReference, PaperCitation, PaperLink,
    Annotation, Tag, Shelf, Board, BoardGroup, BoardItem,
)
import account
from schemas import (
    UserRegister, UserLogin, UserBase, UserPublic, UserPrivate, UserListEntry,
    AuthResponse,
    ProfileUpdate, PasswordChange, AccountDeletion, UserEntry,
    RoomSummary, RoomDetail, RoomMessageOut, RoomAvailabilityOut,
    RoomMessageCreate,
    PaperCreate, PaperUpdate, Paper as PaperSchema, PaperList, UserSpace,
    ExtractedMetadata, ReextractedMetadata, NookStats,
    AvailabilitySubmit, RoomAnnounce, RoomLeave,
    AnnotationCreate, AnnotationUpdate, AnnotationOut,
    PaperReferences, ReferenceOut, ReferencePreviewIn, CitationOut, DocumentLinkOut,
    ResolvedWork,
    TagOut, TagCreate,
    ShelfOut, ShelfCreate, ShelfUpdate, BoardCreate, BoardUpdate,
    BoardItemCreate, BoardItemUpdate, BoardStagingCreate, BoardStagingPlace,
    BoardYouTubeCreate, BoardWebpageCreate,
    BoardItemOut, BoardOut, BoardGroupCreate, BoardGroupUpdate, BoardGroupMove,
    BoardGroupUngroup, BoardGroupLayout, BoardGroupOut,
)
from auth import (
    hash_password, verify_password, create_token, login_platform, get_current_user,
    get_optional_user, bearer_scheme
)
from pdf_parser import (
    arxiv_doi, extract_arxiv_id, extract_doi_from_pdf, get_title_from_filename,
)
import grobid
import biblio
import metadata_lookup
from cohorts import in_active_cohort as _in_active_cohort, paper_key_for as _paper_key_for
from reference_engine import (
    EphemeralReferenceEngine, reference_out, resolve as resolve_reference,
)
import dbmetrics
from sync.api import router as sync_router
from sync.changes import commit_sync
from routes.admin import router as admin_router
from routes.client_requirements import router as client_requirements_router
from routes.feedback import router as feedback_router
from routes.notifications import router as notifications_router
from routes.sharables import router as sharables_router
from services.annotations import (
    KINDS, NOTE, annotation_out, annotations_of, body_text,
)
from services.notifications import setting_value
from services.papers import AmbiguousPaperName, displayed_copies, paper_by_name
from services.sharables import live_sharable_for, open_sharable

# Uploads directory
UPLOADS_DIR = Path(os.environ.get(
    "PAPOL_UPLOADS_DIR", Path(__file__).parent.parent / "uploads",
))
UPLOADS_DIR.mkdir(exist_ok=True)
AVATARS_DIR = UPLOADS_DIR / "avatars"
AVATARS_DIR.mkdir(exist_ok=True)
BOARDS_DIR = Path(os.environ.get(
    "PAPOL_BOARD_FILES_DIR", Path(__file__).parent.parent / "board_uploads",
))
BOARDS_DIR.mkdir(exist_ok=True)

# Add columns the models have gained, and create missing tables.
migrate()
Base.metadata.create_all(bind=engine)


def _install_demo_pdfs() -> set[str]:
    """Put immutable demo inputs into the same content-addressed PDF store."""
    source = Path(__file__).parent.parent / "frontend" / "public" / "assets" / "demo" / "papers"
    if not source.exists():
        return set()
    installed = set()
    for pdf in source.glob("*.pdf"):
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        installed.add(digest)
        target = UPLOADS_DIR / f"{digest}.pdf"
        if not target.exists():
            shutil.copyfile(pdf, target)
    return installed


_PUBLIC_DEMO_PDFS = _install_demo_pdfs()

# Instrument after the startup migrations so the metrics reflect request
# traffic, not one-time schema work.
dbmetrics.init(engine)

app = FastAPI(
    title="Papol — Your Paper Reading Companion",
    description="Papol keeps the papers and ideas that matter close at hand.",
)
app.state.session_factory = SessionLocal
app.state.sqlite_write_lock = asyncio.Lock()
app.include_router(sync_router)
app.include_router(notifications_router)
app.include_router(feedback_router)
app.include_router(admin_router)
app.include_router(sharables_router)
app.include_router(client_requirements_router)

_IDEMPOTENCY_CLIENT_HEADER = "x-papol-client-uuid"
_IDEMPOTENCY_MUTATION_HEADER = "x-papol-mutation-uuid"
_IDEMPOTENCY_RESPONSE_LIMIT = mebibytes("files", "idempotency_response_mb")


def _uuid_header(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError):
        return None


def _stored_mutation_response(record: AppliedMutation) -> Response:
    headers = {"X-Papol-Idempotent-Replay": "true"}
    if record.response_content_type:
        headers["Content-Type"] = record.response_content_type
    return Response(
        content=record.response_body,
        status_code=record.response_status,
        headers=headers,
    )


async def _mutation_request_hash(request: Request, body: bytes) -> str:
    """Hash the logical request, independent of multipart boundary choice."""
    raw_content_type = request.headers.get("content-type") or ""
    media_type = raw_content_type.partition(";")[0].strip().lower()
    payload = body
    if media_type == "multipart/form-data":
        logical_parts = []
        form = await request.form()
        try:
            for name, value in form.multi_items():
                if isinstance(value, StarletteUploadFile):
                    contents = await value.read()
                    logical_parts.append(b"\0".join([
                        b"file", name.encode(), (value.filename or "").encode(),
                        (value.content_type or "").encode(), hashlib.sha256(contents).digest(),
                    ]))
                else:
                    logical_parts.append(b"\0".join([b"field", name.encode(), str(value).encode()]))
        finally:
            await form.close()
        payload = b"\1".join(logical_parts)
    return hashlib.sha256(b"\0".join([
        request.method.encode(),
        request.url.path.encode(),
        request.url.query.encode(),
        media_type.encode(),
        payload,
    ])).hexdigest()


@app.middleware("http")
async def idempotent_desktop_mutations(request: Request, call_next):
    """Commit a mutation and its replayable result as one transaction.

    Requests without Papol's two UUID headers retain the ordinary web/API
    behavior. Identified writes share one deferred session with existing route
    dependencies, so their current ``db.commit()`` calls flush and the final
    commit also includes the idempotency record.
    """
    if (request.method not in {"POST", "PUT", "PATCH", "DELETE"}
            or request.url.path == "/api/sync/push"):
        return await call_next(request)
    raw_client_uuid = request.headers.get(_IDEMPOTENCY_CLIENT_HEADER)
    raw_mutation_uuid = request.headers.get(_IDEMPOTENCY_MUTATION_HEADER)
    if not raw_client_uuid and not raw_mutation_uuid:
        return await call_next(request)
    client_uuid = _uuid_header(raw_client_uuid)
    mutation_uuid = _uuid_header(raw_mutation_uuid)
    if client_uuid is None or mutation_uuid is None:
        return JSONResponse(
            status_code=400,
            content={"detail": "Sync client and mutation IDs must both be UUIDs"},
        )

    authorization = request.headers.get("authorization", "")
    scheme, _, bearer = authorization.partition(" ")
    if scheme.lower() != "bearer" or not bearer:
        return await call_next(request)

    request_body = await request.body()
    fingerprint = await _mutation_request_hash(request, request_body)

    session_factory = request.app.state.session_factory
    db = session_factory()
    context_token = None
    try:
        auth = db.query(AuthToken).filter(
            AuthToken.token == bearer,
            AuthToken.revoked_at.is_(None),
        ).first()
        if auth is None or auth.user is None or auth.user.is_deleted:
            return await call_next(request)

        existing = db.query(AppliedMutation).filter(
            AppliedMutation.user_uuid == auth.user_uuid,
            AppliedMutation.client_uuid == client_uuid,
            AppliedMutation.mutation_uuid == mutation_uuid,
        ).first()
        if existing is not None:
            if existing.request_hash != fingerprint:
                return JSONResponse(
                    status_code=409,
                    content={"detail": "Mutation ID was already used for a different request"},
                )
            return _stored_mutation_response(existing)

        db.info["defer_commit"] = True
        context_token = set_request_session(db)
        response = await call_next(request)
        response_body = b"".join([chunk async for chunk in response.body_iterator])
        if len(response_body) > _IDEMPOTENCY_RESPONSE_LIMIT:
            db.rollback()
            return JSONResponse(
                status_code=507,
                content={"detail": "Mutation response is too large to replay safely"},
            )
        if response.status_code >= 400:
            db.rollback()
        else:
            db.add(AppliedMutation(
                user_uuid=auth.user_uuid,
                client_uuid=client_uuid,
                mutation_uuid=mutation_uuid,
                request_hash=fingerprint,
                method=request.method,
                path=request.url.path,
                response_status=response.status_code,
                response_content_type=response.headers.get("content-type"),
                response_body=response_body,
            ))
            try:
                db.commit_deferred()
            except IntegrityError:
                # A concurrent delivery may have won the unique key. This
                # request's domain work rolled back with its losing insert.
                db.rollback()
                winner = db.query(AppliedMutation).filter(
                    AppliedMutation.user_uuid == auth.user_uuid,
                    AppliedMutation.client_uuid == client_uuid,
                    AppliedMutation.mutation_uuid == mutation_uuid,
                ).first()
                if winner is None or winner.request_hash != fingerprint:
                    raise
                return _stored_mutation_response(winner)

        headers = dict(response.headers)
        headers.pop("content-length", None)
        return Response(
            content=response_body,
            status_code=response.status_code,
            headers=headers,
        )
    except Exception:
        db.rollback()
        raise
    finally:
        if context_token is not None:
            reset_request_session(context_token)
        db.close()


@app.middleware("http")
async def serialize_sqlite_writes(request: Request, call_next):
    """Let one mutating request at a time own SQLite's single writer slot.

    In particular, an identified mutation keeps its transaction open until
    the idempotency middleware stores the response.  A cooperative async gate
    prevents another synchronous SQLite call from blocking the event loop
    while that first request is waiting to finish its commit.
    """
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return await call_next(request)
    async with request.app.state.sqlite_write_lock:
        return await call_next(request)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}")
    logger.error(traceback.format_exc())
    # Record the error in the database so the admin can inspect it later.
    # Use a fresh session: the request's own session may be mid-rollback.
    db = SessionLocal()
    try:
        db.add(ErrorLog(
            method=request.method,
            path=str(request.url.path),
            message=str(exc)[:limit("text", "error_message")],
            traceback=traceback.format_exc()[:limit("text", "error_traceback")],
        ))
        db.commit()
    except Exception:
        db.rollback()
        logger.error("Failed to record the error in the database")
    finally:
        db.close()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )


# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Frontend directory
FRONTEND_DIR = Path(__file__).parent.parent / "frontend" / "dist"

# Serve uploaded files
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Serve frontend assets. Mounted only when the build is there, like the
# viewer and the board below it. An unguarded mount raises at import, so a
# backend started or a test run against a checkout that has not been built
# yet died with "Directory 'frontend/dist/assets' does not exist" — a
# missing frontend reported as a broken service. Without the build the API
# still answers; what is gone is the website, and `serve_frontend` says so.
if (FRONTEND_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

# The PDF viewer is its own app with its own build; Papol serves it at
# /viewer so it shares this origin — and therefore the user's session —
# without a second sign-in.
VIEWER_DIR = Path(__file__).parent.parent / "viewer" / "dist"
if VIEWER_DIR.exists():
    # The same viewer build, under an explicit demo namespace. Its source
    # resolver uses this path—not localStorage—to choose fictional data.
    app.mount("/demo/viewer", StaticFiles(directory=str(VIEWER_DIR), html=True), name="demo-viewer")
    app.mount("/viewer", StaticFiles(directory=str(VIEWER_DIR), html=True), name="viewer")

# Boards are another full-screen workspace with an independent Vite build.
# Explicit routes provide the SPA document while /assets remains owned by
# the main frontend; board asset names are mounted below /boards instead.
BOARD_DIR = Path(__file__).parent.parent / "board" / "dist"
if BOARD_DIR.exists():
    app.mount("/boards/assets", StaticFiles(directory=str(BOARD_DIR / "assets")), name="board-assets")
    app.mount("/demo/boards/assets", StaticFiles(directory=str(BOARD_DIR / "assets")), name="demo-board-assets")

    @app.get("/boards/{board_uuid}")
    async def serve_board(board_uuid: str):
        return FileResponse(BOARD_DIR / "index.html", headers={"Cache-Control": "public, max-age=0, must-revalidate"})

    @app.get("/demo/boards/{board_uuid}")
    async def serve_demo_board(board_uuid: str):
        return FileResponse(BOARD_DIR / "index.html", headers={"Cache-Control": "public, max-age=0, must-revalidate"})


# The {name} placeholder is filled with the new user's display name.
# Override via the settings table key "welcome_message".
DEFAULT_WELCOME = (
    "Welcome to Papol, {name}—your paper reading companion. Your nook is where you "
    "document your reading: upload the papers you read, rate them, "
    "keep private notes and a summary, and share a public "
    "one-sentence thought. Use the Library to find papers and see "
    "what other users keep in their nooks, then add papers to "
    "your own. When a paper deserves a conversation, call a "
    "spontaneous seminar, and every user of it will be invited. "
    "Each seminar is run by a host: a user who volunteers to plan "
    "it and lead the discussion. Answer a call to host one yourself!"
)


# ---------------- Auth ----------------

@app.post("/api/auth/register", response_model=AuthResponse)
async def register(data: UserRegister, request: Request, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists")

    affiliation = (data.affiliation or "").strip()
    user = User(
        email=email,
        display_name=data.display_name.strip(),
        affiliation=affiliation or None,
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.flush()
    db.add_all([
        Shelf(user_uuid=user.uuid, name="Display", color="#7ba26c", is_public=True, is_default=True, position=0),
        Shelf(user_uuid=user.uuid, name="Personal", color="#2b4a6f", is_public=False, position=1),
        Tag(user_uuid=user.uuid, name="favourite"),
    ])
    db.commit()
    db.refresh(user)

    # Greet every new user with a first inbox message
    template = setting_value(db, "welcome_message") or DEFAULT_WELCOME
    db.add(Notification(
        user_uuid=user.uuid,
        content=template.replace("{name}", user.display_name),
    ))
    db.commit()

    token = create_token(db, user, login_platform(request))
    return AuthResponse(token=token, user=UserPrivate.model_validate(user))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(data: UserLogin, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    # A closed account keeps its row so seminars and messages still resolve,
    # but it is nobody's account any more. Its password hash could not match
    # in any case; this says so plainly rather than relying on that.
    if user is not None and user.is_deleted:
        raise HTTPException(status_code=401, detail="This account has been closed")
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(db, user, login_platform(request))
    return AuthResponse(token=token, user=UserPrivate.model_validate(user))


@app.post("/api/auth/logout")
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    if credentials:
        # Revoke rather than delete: the row is the record of a session, and
        # when it ended is part of knowing who is coming back.
        db.query(AuthToken).filter(
            AuthToken.token == credentials.credentials,
            AuthToken.revoked_at.is_(None),
        ).update({AuthToken.revoked_at: datetime.utcnow()})
        db.commit()
    return {"message": "Logged out"}


@app.get("/api/auth/me", response_model=UserPrivate)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@app.put("/api/auth/profile", response_model=UserPrivate)
async def update_profile(
    data: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update display name, affiliation, and whether the email shows on the
    user's nook. The email address itself is the login identifier and is fixed."""
    update = data.model_dump(exclude_unset=True)
    if "display_name" in update:
        name = (update["display_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Display name cannot be empty")
        current_user.display_name = name
    if "affiliation" in update:
        affiliation = (update["affiliation"] or "").strip()
        current_user.affiliation = affiliation or None
    if update.get("email_public") is not None:
        current_user.email_public = bool(update["email_public"])
    db.commit()
    db.refresh(current_user)
    return current_user


_AVATAR_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
_AVATAR_MAX_BYTES = mebibytes("files", "avatar_mb")


def _delete_avatar_file(user: User):
    if user.avatar_path:
        old = UPLOADS_DIR / user.avatar_path
        if old.exists():
            old.unlink()


@app.post("/api/auth/avatar", response_model=UserPrivate)
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _AVATAR_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, or WebP images are allowed")
    data = await file.read()
    if len(data) > _AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f'Image must be at most {limit("files", "avatar_mb")} MB',
        )

    fname = f"avatars/{uuid.uuid4()}{ext}"
    (UPLOADS_DIR / fname).write_bytes(data)
    _delete_avatar_file(current_user)
    current_user.avatar_path = fname
    db.commit()
    db.refresh(current_user)
    return current_user


@app.delete("/api/auth/avatar", response_model=UserPrivate)
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _delete_avatar_file(current_user)
    current_user.avatar_path = None
    db.commit()
    db.refresh(current_user)
    return current_user


@app.put("/api/auth/password")
async def change_password(
    data: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    current_user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"message": "Password updated"}


@app.get("/api/auth/export")
async def export_my_data(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everything Papol holds about this user, in one zip.

    A user who cannot leave with their notes does not really own them.
    The file is built on disk and streamed: a large nook is a lot of PDF,
    and none of it needs to sit in memory to be handed over.
    """
    handle = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    handle.close()
    path = Path(handle.name)
    try:
        account.write_zip(db, current_user, UPLOADS_DIR, BOARDS_DIR, path)
    except Exception:
        path.unlink(missing_ok=True)
        raise

    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"papol-export-{stamp}.zip",
        # The user's copy is theirs; the server's is scratch. Deleted once
        # the response has gone out, whether or not it got there.
        background=BackgroundTask(lambda: path.unlink(missing_ok=True)),
    )


@app.delete("/api/auth/account")
async def delete_my_account(
    data: AccountDeletion,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close the account and scrub the user out of it.

    The row stays as a tombstone, because a seminar they started and the
    messages they left in it point at it, and those belong to the users
    who were there too. Their notes, their nook and their notifications —
    private, and theirs alone — are deleted; see account.py.
    """
    if data.confirm_email.strip().lower() != current_user.email.lower():
        raise HTTPException(
            status_code=400,
            detail="Type your own email address exactly to confirm.",
        )
    # Papol would otherwise have no one who can reach the admin pages, and
    # no way to appoint one.
    if current_user.is_admin:
        others = (
            db.query(User)
            .filter(User.is_admin.is_(True), User.uuid != current_user.uuid)
            .count()
        )
        if others == 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "You are the only admin. Make someone else an admin "
                    "before closing this account."
                ),
            )

    board_uuids = [row[0] for row in db.query(Board.uuid).filter(
        Board.user_uuid == current_user.uuid
    ).all()]
    removed = account.tombstone(
        db,
        current_user,
        UPLOADS_DIR,
        # Who may take over a seminar, and how the cohort hears about it,
        # are this module's rules — the same ones leave_room applies when a
        # host hands over on their way out.
        eligible_hosts=lambda room: _paper_user_uuids(db, room.paper_key, public_only=True),
        notify=lambda room, user_uuids, content: _notify(db, user_uuids, room, content),
    )
    for board_uuid in board_uuids:
        directory = BOARDS_DIR / str(board_uuid)
        if directory.is_dir():
            shutil.rmtree(directory)
    return {"message": "Your account has been closed.", "removed": removed}


# ---------------- Boards ----------------

BOARD_FILE_LIMIT = mebibytes("files", "board_file_mb")


def _owned_board(board_uuid: str, user: User, db: Session) -> Board:
    board = db.query(Board).filter(
        Board.uuid == board_uuid, Board.user_uuid == user.uuid,
        Board.deleted_at.is_(None),
    ).first()
    if not board:
        # Do not reveal whether another user's private board exists.
        raise HTTPException(status_code=404, detail="Board not found")
    return board


def _board_out(board: Board, include_items: bool = False, can_edit: bool = False) -> BoardOut:
    active_items = [
        item for item in board.items if item.deleted_at is None and not item.staged
    ]
    staged_items = [
        item for item in board.items if item.deleted_at is None and item.staged
    ]
    return BoardOut(
        uuid=board.uuid,
        revision=board.revision,
        user_uuid=board.owner.uuid,
        owner=board.owner,
        shelf_uuid=board.shelf.uuid if board.shelf else None,
        can_edit=can_edit,
        name=board.name,
        description=board.description,
        created_at=board.created_at,
        updated_at=board.updated_at,
        item_count=len(active_items),
        items=(active_items if include_items else []),
        staged_items=(staged_items if include_items and can_edit else []),
        groups=([BoardGroupOut(
            uuid=group.uuid, kind=group.kind, title=group.title, header=group.header or "",
            auto_arrange=group.auto_arrange,
            item_uuids=[item.uuid for item in group.items if item.deleted_at is None],
        ) for group in board.groups if group.deleted_at is None] if include_items else []),
    )


@app.get("/api/boards", response_model=list[BoardOut])
async def list_boards(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    boards = db.query(Board).filter(
        Board.user_uuid == user.uuid, Board.deleted_at.is_(None),
    ).order_by(
        Board.updated_at.desc(), Board.uuid.desc()
    ).all()
    return [_board_out(board, can_edit=True) for board in boards]


@app.get("/api/library/boards", response_model=list[BoardOut])
async def list_library_boards(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Boards whose shelves are public, for the shared Library."""
    boards = db.query(Board).join(Shelf, Board.shelf_uuid == Shelf.uuid).filter(
        Shelf.is_public.is_(True), Board.deleted_at.is_(None),
    ).order_by(Board.updated_at.desc(), Board.uuid.desc()).all()
    return [
        _board_out(board, can_edit=board.user_uuid == current_user.uuid)
        for board in boards
    ]


@app.post("/api/boards", response_model=BoardOut)
async def create_board(
    data: BoardCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = db.query(Shelf).filter(Shelf.uuid == data.shelf_uuid, Shelf.user_uuid == user.uuid).first() if data.shelf_uuid else _default_shelf(user)
    if not shelf:
        raise HTTPException(status_code=400, detail="Choose one of your shelves")
    board = Board(
        user_uuid=user.uuid,
        shelf=shelf,
        name=data.name.strip(),
        description=data.description.strip() if data.description else None,
    )
    db.add(board)
    commit_sync(db)
    db.refresh(board)
    return _board_out(board, can_edit=True)


@app.get("/api/boards/{board_uuid}", response_model=BoardOut)
async def get_board(
    board_uuid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = db.query(Board).filter(
        Board.uuid == board_uuid, Board.deleted_at.is_(None),
    ).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    can_edit = board.user_uuid == user.uuid
    if not can_edit and (not board.shelf or not board.shelf.is_public):
        raise HTTPException(status_code=404, detail="Board not found")
    return _board_out(board, include_items=True, can_edit=can_edit)


@app.put("/api/boards/{board_uuid}", response_model=BoardOut)
async def update_board(
    board_uuid: str,
    data: BoardUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    if data.name is not None:
        board.name = data.name.strip()
    if data.description is not None:
        board.description = data.description.strip() or None
    if data.shelf_uuid is not None:
        shelf = db.query(Shelf).filter(Shelf.uuid == data.shelf_uuid, Shelf.user_uuid == user.uuid).first()
        if not shelf:
            raise HTTPException(status_code=400, detail="Choose one of your shelves")
        board.shelf = shelf
    board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(board)
    return _board_out(board, include_items=True, can_edit=True)


@app.delete("/api/boards/{board_uuid}", status_code=204)
async def delete_board(
    board_uuid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    board.deleted_at = datetime.utcnow()
    for group in board.groups:
        group.deleted_at = board.deleted_at
    for item in board.items:
        item.deleted_at = board.deleted_at
    commit_sync(db)


@app.post("/api/boards/{board_uuid}/comments", response_model=BoardItemOut)
async def add_board_comment(
    board_uuid: str,
    data: BoardItemCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    count = len(board.items)
    item = BoardItem(
        board_uuid=board.uuid, kind="comment", content=data.content.strip(),
        x=data.x if data.x is not None else (count % 4) * 340,
        y=data.y if data.y is not None else (count // 4) * 260,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/boards/{board_uuid}/staging", response_model=BoardItemOut)
async def stage_board_excerpt(
    board_uuid: str,
    data: BoardStagingCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a quoted passage to an owned board without placing it yet."""
    board = _owned_board(board_uuid, user, db)
    item = BoardItem(
        board_uuid=board.uuid,
        kind="excerpt",
        excerpt_text=data.excerpt_text.strip(),
        content=data.content.strip() if data.content and data.content.strip() else None,
        source_url=data.source_url.strip(),
        source_label=data.source_label.strip(),
        staged=True,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/boards/{board_uuid}/staging/clip", response_model=BoardItemOut)
async def stage_board_clip(
    board_uuid: str,
    file: UploadFile = File(...),
    caption: str = Form(default=""),
    source_url: str = Form(...),
    source_label: str = Form(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stage a clipped PDF rectangle as an image, with its bounding-box backlink."""
    board = _owned_board(board_uuid, user, db)
    if (len(caption) > limit("text", "board_content")
            or len(source_url) > limit("text", "source_url")
            or len(source_label) > limit("text", "source_label")):
        raise HTTPException(status_code=422, detail="Clip metadata is too long")
    if not source_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Invalid source URL")
    relative = Path(str(board.uuid)) / f"{uuid.uuid4().hex}.png"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    digest = hashlib.sha256()
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > BOARD_FILE_LIMIT:
                    raise HTTPException(status_code=413, detail=f'Board files may be at most {limit("files", "board_file_mb")} MB')
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    item = BoardItem(
        board_uuid=board.uuid,
        kind="image",
        content=caption.strip() or None,
        file_path=str(relative),
        sha256=digest.hexdigest(),
        original_filename="paper-clip.png",
        mime_type="image/png",
        source_url=source_url.strip(),
        source_label=source_label.strip(),
        staged=True,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/board-items/{item_uuid}/place", response_model=BoardItemOut)
async def place_staged_board_item(
    item_uuid: str,
    data: BoardStagingPlace,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).join(Board).filter(
        BoardItem.uuid == item_uuid,
        Board.user_uuid == user.uuid,
        BoardItem.deleted_at.is_(None),
        BoardItem.staged.is_(True),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Staged item not found")
    item.x = data.x
    item.y = data.y
    item.staged = False
    item.board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/boards/{board_uuid}/files", response_model=BoardItemOut)
async def add_board_file(
    board_uuid: str,
    file: UploadFile = File(...),
    caption: str = Form(default=""),
    x: float | None = Form(default=None),
    y: float | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    if len(caption) > limit("text", "board_content"):
        raise HTTPException(status_code=422, detail="Caption is too long")
    original = Path(file.filename or "file").name[:limit("text", "uploaded_filename")]
    suffix = Path(original).suffix[:limit("text", "uploaded_suffix")]
    relative = Path(str(board.uuid)) / f"{uuid.uuid4().hex}{suffix}"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    digest = hashlib.sha256()
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > BOARD_FILE_LIMIT:
                    raise HTTPException(status_code=413, detail=f'Board files may be at most {limit("files", "board_file_mb")} MB')
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    mime = (file.content_type or "application/octet-stream")[:limit("text", "mime_type")]
    item = BoardItem(
        board_uuid=board.uuid,
        kind="image" if mime.startswith("image/") else "file",
        content=caption.strip() or None,
        file_path=str(relative),
        sha256=digest.hexdigest(),
        original_filename=original,
        mime_type=mime,
        x=x if x is not None else (len(board.items) % 4) * 340,
        y=y if y is not None else (len(board.items) // 4) * 260,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


def _youtube_id(url: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    candidate = None
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            candidate = urllib.parse.parse_qs(parsed.query).get("v", [None])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) == 2 and parts[0] in {"shorts", "embed", "live"}:
                candidate = parts[1]
    return candidate if candidate and re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate) else None


def _youtube_time(url: str) -> float | None:
    parsed = urllib.parse.urlparse(url.strip())
    values = urllib.parse.parse_qs(parsed.query)
    raw = (values.get("t") or values.get("start") or [None])[0]
    if raw is None and parsed.fragment.startswith("t="):
        raw = parsed.fragment[2:]
    if not raw:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return float(raw)
    match = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?", raw)
    if not match or not any(match.groups()):
        raise ValueError("Invalid YouTube timestamp")
    hours, minutes, seconds = match.groups()
    return int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(seconds or 0)


def _fetch_youtube_thumbnail(url: str, video_id: str) -> tuple[bytes, str]:
    endpoint = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
        {"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}
    )
    request = urllib.request.Request(endpoint, headers={"User-Agent": "Papol/1.0"})
    with urllib.request.urlopen(request, timeout=limit("timeouts_ms", "youtube_metadata") / 1000) as response:
        metadata = json.loads(response.read(limit("files", "youtube_metadata_kb") * 1024))
    thumbnail = str(metadata.get("thumbnail_url") or "")
    host = (urllib.parse.urlparse(thumbnail).hostname or "").lower()
    if host != "i.ytimg.com" and not host.endswith(".ytimg.com"):
        raise ValueError("YouTube returned an invalid thumbnail location")
    image_request = urllib.request.Request(thumbnail, headers={"User-Agent": "Papol/1.0"})
    with urllib.request.urlopen(image_request, timeout=limit("timeouts_ms", "youtube_thumbnail") / 1000) as response:
        image = response.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("YouTube thumbnail is empty or too large")
    return image, str(metadata.get("title") or url)[:limit("text", "board_content")]


def _capture_youtube_frame(url: str, timestamp: float) -> tuple[bytes, str]:
    """Resolve a constrained YouTube stream and decode the exact requested frame."""
    with tempfile.TemporaryDirectory(prefix="papol-youtube-") as directory:
        template = str(Path(directory) / "source.%(ext)s")
        extractor_args = "youtube:player_client=mweb"
        po_token = os.environ.get("PAPOL_YOUTUBE_PO_TOKEN", "").strip()
        if po_token:
            extractor_args += f";po_token=mweb.gvs+{po_token}"
        cookies = os.environ.get("PAPOL_YOUTUBE_COOKIES", "").strip()
        download_command = [
            "yt-dlp",
            "--no-playlist", "--no-warnings", "--quiet",
            # mweb with a GVS PO token exposes native adaptive formats. With
            # no token it still provides the public fallback used below.
            "--extractor-args", extractor_args,
        ]
        if cookies:
            if not Path(cookies).is_file():
                raise ValueError("PAPOL_YOUTUBE_COOKIES does not name a readable file")
            download_command += ["--cookies", cookies]
        download_command += [
            "--max-filesize", f'{limit("files", "youtube_source_mb")}M',
            "--write-info-json",
            "-f", "bestvideo[height<=1080]/bestvideo/best[height<=1080]/best",
            "-o", template,
            url,
        ]
        download_process = subprocess.run(
            download_command,
            capture_output=True,
            text=True,
            timeout=limit("timeouts_ms", "youtube_download") / 1000,
            check=False,
        )
        if download_process.returncode != 0:
            raise ValueError(download_process.stderr.strip() or "YouTube video could not be downloaded")
        metadata_files = list(Path(directory).glob("source.info.json"))
        media_files = [
            path for path in Path(directory).glob("source.*")
            if path.name != "source.info.json" and path.is_file()
        ]
        if not metadata_files or not media_files:
            raise ValueError("YouTube did not provide a playable video stream")
        metadata = json.loads(metadata_files[0].read_text())
        duration = metadata.get("duration")
        if duration is not None and timestamp > float(duration):
            raise ValueError("The timestamp is beyond the end of this video")

        with tempfile.NamedTemporaryFile(suffix=".png") as output:
            frame_process = subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-ss", f"{timestamp:.3f}",
                    "-i", str(media_files[0]),
                    "-frames:v", "1",
                    "-vf", "scale=1280:-2:flags=lanczos",
                    "-compression_level", "3",
                    "-y", output.name,
                ],
                capture_output=True,
                text=True,
                timeout=limit("timeouts_ms", "media_capture") / 1000,
                check=False,
            )
            if frame_process.returncode != 0:
                raise ValueError(frame_process.stderr.strip() or "Video frame could not be decoded")
            image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("Captured frame is empty or too large")
    return image, str(metadata.get("title") or url)[:limit("text", "board_content")]


def _public_web_url(value: str) -> str:
    """Accept a browser URL without giving the capture process LAN access."""
    url = value.strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Paste a valid http or https URL")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not supported")
    try:
        addresses = {
            ipaddress.ip_address(row[4][0])
            for row in socket.getaddrinfo(parsed.hostname, parsed.port or 443)
        }
    except (OSError, ValueError) as exc:
        raise ValueError("The website address could not be resolved") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Local and private network addresses cannot be captured")
    return url


def _capture_webpage(url: str) -> bytes:
    """Render the visible part of a medium desktop viewport as a PNG."""
    safe_url = _public_web_url(url)
    with tempfile.NamedTemporaryFile(suffix=".png") as output:
        process = subprocess.run(
            [
                "chromium", "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--no-first-run", "--disable-extensions", "--disable-background-networking",
                "--window-size=1280,800", "--force-device-scale-factor=1",
                "--virtual-time-budget=5000", f"--screenshot={output.name}",
                # Defense in depth after the DNS check above, including pages
                # that try to redirect the browser into Papol's own network.
                "--host-resolver-rules=MAP localhost ~NOTFOUND, MAP *.localhost ~NOTFOUND, MAP 127.* ~NOTFOUND, MAP 10.* ~NOTFOUND, MAP 192.168.* ~NOTFOUND, MAP 169.254.* ~NOTFOUND",
                safe_url,
            ],
            capture_output=True,
            text=True,
            timeout=limit("timeouts_ms", "media_capture") / 1000,
            check=False,
        )
        if process.returncode != 0:
            raise ValueError(process.stderr.strip() or "The website could not be rendered")
        output.seek(0)
        image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("The website screenshot is empty or too large")
    return image


@app.post("/api/boards/{board_uuid}/youtube", response_model=BoardItemOut)
async def add_youtube_to_board(
    board_uuid: str,
    data: BoardYouTubeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    video_id = _youtube_id(data.url)
    if not video_id:
        raise HTTPException(status_code=422, detail="Paste a valid YouTube video URL")
    try:
        timestamp = _youtube_time(data.url)
        if timestamp is None:
            image, title = await asyncio.to_thread(
                _fetch_youtube_thumbnail, data.url, video_id
            )
            suffix, mime = ".jpg", "image/jpeg"
        else:
            image, title = await asyncio.to_thread(
                _capture_youtube_frame, data.url, timestamp
            )
            suffix, mime = ".png", "image/png"
    except Exception as exc:
        logger.warning("Could not capture YouTube frame for %s: %s", video_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not capture the YouTube frame: {exc}")
    relative = Path(str(board.uuid)) / f"{uuid.uuid4().hex}{suffix}"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(image)
    item = BoardItem(
        board_uuid=board.uuid,
        kind="youtube",
        content=title,
        file_path=str(relative),
        sha256=hashlib.sha256(image).hexdigest(),
        original_filename=f"youtube-{video_id}{suffix}",
        mime_type=mime,
        source_url=data.url.strip(),
        x=data.x,
        y=data.y,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/boards/{board_uuid}/webpage", response_model=BoardItemOut)
async def add_webpage_to_board(
    board_uuid: str,
    data: BoardWebpageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    try:
        url = _public_web_url(data.url)
        image = await asyncio.to_thread(_capture_webpage, url)
    except Exception as exc:
        logger.warning("Could not capture webpage %s: %s", data.url, exc)
        raise HTTPException(status_code=502, detail=f"Could not capture the webpage: {exc}")
    relative = Path(str(board.uuid)) / f"{uuid.uuid4().hex}.png"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(image)
    hostname = urllib.parse.urlparse(url).hostname or url
    item = BoardItem(
        board_uuid=board.uuid,
        kind="webpage",
        content=hostname,
        file_path=str(relative),
        sha256=hashlib.sha256(image).hexdigest(),
        original_filename=f'webpage-{hostname[:limit("text", "display_name")]}.png',
        mime_type="image/png",
        source_url=url,
        x=data.x,
        y=data.y,
        width=480,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    commit_sync(db)
    db.refresh(item)
    return item


@app.delete("/api/board-items/{item_uuid}", status_code=204)
async def delete_board_item(
    item_uuid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.uuid == item_uuid).first()
    if not item or item.deleted_at is not None or item.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board item not found")
    item.board.updated_at = datetime.utcnow()
    item.deleted_at = datetime.utcnow()
    commit_sync(db)


@app.post("/api/board-items/{item_uuid}/restore", response_model=BoardItemOut)
async def restore_board_item(
    item_uuid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.uuid == item_uuid).first()
    if not item or item.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board item not found")
    item.deleted_at = None
    item.board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(item)
    return item


@app.put("/api/board-items/{item_uuid}", response_model=BoardItemOut)
async def move_board_item(
    item_uuid: str,
    data: BoardItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.uuid == item_uuid).first()
    if not item or item.deleted_at is not None or item.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board item not found")
    if "group_uuid" in data.model_fields_set:
        if data.group_uuid is None:
            item.group = None
            item.group_uuid = None
        else:
            group = db.query(BoardGroup).filter(
                BoardGroup.uuid == data.group_uuid,
                BoardGroup.board_uuid == item.board_uuid,
            ).first()
            if not group:
                raise HTTPException(status_code=400, detail="Booklet not found on this board")
            item.group = group
            item.group_uuid = group.uuid
    if data.x is not None:
        item.x = data.x
    if data.y is not None:
        item.y = data.y
    if data.width is not None:
        item.width = data.width
    if data.position is not None:
        item.position = data.position
    if data.content is not None:
        item.content = data.content.strip() or None
    if data.text_align is not None:
        item.text_align = data.text_align
    item.board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(item)
    return item


@app.post("/api/boards/{board_uuid}/groups", response_model=BoardGroupOut)
async def create_board_group(
    board_uuid: str,
    data: BoardGroupCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_uuid, user, db)
    item_uuids = list(dict.fromkeys(data.item_uuids))
    if len(item_uuids) < 2:
        raise HTTPException(status_code=400, detail="Select at least two items")
    items = db.query(BoardItem).filter(
        BoardItem.board_uuid == board.uuid,
        BoardItem.uuid.in_(item_uuids),
        BoardItem.deleted_at.is_(None),
    ).all()
    if len(items) != len(item_uuids):
        raise HTTPException(status_code=400, detail="Some selected items are unavailable")
    group = BoardGroup(
        board_uuid=board.uuid, kind=data.kind, title=data.title.strip(),
        header=data.header.strip() or None,
        auto_arrange=data.auto_arrange if data.kind == "collection" else False,
    )
    db.add(group)
    db.flush()
    anchor_x = min(item.x for item in items)
    for item in items:
        item.group_uuid = group.uuid
        if data.kind == "booklet":
            item.x = anchor_x
    board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(group)
    return BoardGroupOut(uuid=group.uuid, kind=group.kind, title=group.title, header=group.header or "", auto_arrange=group.auto_arrange, item_uuids=item_uuids)


@app.put("/api/board-groups/{group_uuid}/move", response_model=list[BoardItemOut])
async def move_board_group(
    group_uuid: str,
    data: BoardGroupMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.uuid == group_uuid).first()
    if not group or group.deleted_at is not None or group.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board group not found")
    active_items = [item for item in group.items if item.deleted_at is None]
    for item in active_items:
        item.x += data.dx
        item.y += data.dy
    group.board.updated_at = datetime.utcnow()
    commit_sync(db)
    for item in active_items:
        db.refresh(item)
    return active_items


@app.put("/api/board-groups/{group_uuid}", response_model=BoardGroupOut)
async def update_board_group(
    group_uuid: str,
    data: BoardGroupUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.uuid == group_uuid).first()
    if not group or group.deleted_at is not None or group.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board group not found")
    if data.title is not None:
        group.title = data.title.strip()
    if data.header is not None:
        group.header = data.header.strip() or None
    if data.auto_arrange is not None:
        if group.kind != "collection":
            raise HTTPException(status_code=400, detail="Only collections can use auto-arrange")
        group.auto_arrange = data.auto_arrange
    group.board.updated_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(group)
    return BoardGroupOut(
        uuid=group.uuid, kind=group.kind, title=group.title, header=group.header or "",
        auto_arrange=group.auto_arrange,
        item_uuids=[item.uuid for item in group.items if item.deleted_at is None],
    )


@app.post("/api/board-groups/{group_uuid}/ungroup", status_code=204)
async def ungroup_board_group(
    group_uuid: str,
    data: BoardGroupUngroup,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.uuid == group_uuid).first()
    if not group or group.deleted_at is not None or group.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board group not found")
    current_uuids = {item.uuid for item in group.items if item.deleted_at is None}
    restore_uuids = {entry.uuid for entry in data.items}
    if current_uuids != restore_uuids:
        raise HTTPException(status_code=400, detail="Group membership changed")
    target_uuids = {entry.group_uuid for entry in data.items if entry.group_uuid is not None}
    if target_uuids:
        valid_targets = db.query(BoardGroup.uuid).filter(
            BoardGroup.board_uuid == group.board_uuid, BoardGroup.uuid.in_(target_uuids)
        ).count()
        if valid_targets != len(target_uuids):
                raise HTTPException(status_code=400, detail="A previous group no longer exists")
    items = {item.uuid: item for item in group.items}
    board = group.board
    group.deleted_at = datetime.utcnow()
    for entry in data.items:
        item = items[entry.uuid]
        target = (db.query(BoardGroup).filter(
            BoardGroup.uuid == entry.group_uuid,
            BoardGroup.board_uuid == group.board_uuid,
            BoardGroup.deleted_at.is_(None),
        ).first() if entry.group_uuid is not None else None)
        item.group = target
        item.group_uuid = target.uuid if target else None
        item.x = entry.x
        item.y = entry.y
    board.updated_at = datetime.utcnow()
    commit_sync(db)


@app.put("/api/board-groups/{group_uuid}/layout", response_model=list[BoardItemOut])
async def layout_board_group(
    group_uuid: str,
    data: BoardGroupLayout,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.uuid == group_uuid).first()
    if not group or group.deleted_at is not None or group.board.user_uuid != user.uuid:
        raise HTTPException(status_code=404, detail="Board group not found")
    active_items = {item.uuid: item for item in group.items if item.deleted_at is None}
    if set(active_items) != {entry.uuid for entry in data.items}:
        raise HTTPException(status_code=400, detail="Group membership changed")
    for entry in data.items:
        item = active_items[entry.uuid]
        item.x = entry.x
        item.y = entry.y
    group.board.updated_at = datetime.utcnow()
    commit_sync(db)
    result = list(active_items.values())
    for item in result:
        db.refresh(item)
    return result


@app.get("/api/board-items/{item_uuid}/file")
async def get_board_item_file(
    item_uuid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.uuid == item_uuid).first()
    if not item or not item.file_path:
        raise HTTPException(status_code=404, detail="Board file not found")
    can_view = item.board.user_uuid == user.uuid or bool(item.board.shelf and item.board.shelf.is_public)
    if not can_view:
        raise HTTPException(status_code=404, detail="Board file not found")
    stored = BOARDS_DIR / item.file_path
    if not stored.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    return FileResponse(
        stored,
        media_type=item.mime_type or "application/octet-stream",
        filename=item.original_filename,
        # Board files are write-once: edits change card metadata, never the
        # bytes at this URL. Keep private files in the user's own cache and
        # avoid revalidating immutable previews on every board visit.
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


# ---------------- Users / spaces ----------------


@app.get("/api/users", response_model=list[UserListEntry])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every user in the Library. Signed-in users only."""
    users = (
        db.query(User)
        .filter(User.deleted_at.is_(None))
        .order_by(User.display_name)
        .all()
    )
    return [
        UserListEntry(
            uuid=u.uuid,
            display_name=u.display_name,
            affiliation=u.affiliation,
            avatar_path=u.avatar_path,
            paper_count=sum(1 for r in u.copies if r.is_public),
        )
        for u in users
    ]


def _room_status_map(db: Session) -> dict:
    """paper_key -> status of its latest room."""
    status_map = {}
    for room in db.query(Room).order_by(Room.created_at, Room.uuid).all():
        status_map[room.paper_key] = room.status
    return status_map


def _shelf_out(shelf: Shelf) -> ShelfOut:
    return ShelfOut(
        uuid=shelf.uuid, name=shelf.name, color=shelf.color,
        is_public=bool(shelf.is_public), is_default=bool(shelf.is_default),
        position=shelf.position, paper_count=len(shelf.copies), board_count=len(shelf.boards),
    )


def _default_shelf(user: User) -> Shelf:
    shelves = [s for s in user.shelves if s.deleted_at is None]
    shelf = next((s for s in shelves if s.is_default), None)
    return shelf or shelves[0]


def _user_entry(user_copy: Copy) -> UserEntry:
    return UserEntry(
        paper_sha256=user_copy.paper.sha256,
        user=UserPublic.model_validate(user_copy.user),
        is_author=bool(user_copy.is_author),
        thought=user_copy.thought,
        rating_expertise=user_copy.rating_expertise,
        rating_reading=user_copy.rating_reading,
        rating_liking=user_copy.rating_liking,
    )


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _store_pdf(data: bytes) -> tuple[str, str]:
    """Write an uploaded PDF under its own content hash and return
    (filename, digest). Content-addressed: the same bytes always land on the
    same path, so an upload Papol already holds costs nothing and no two
    names ever refer to different files."""
    digest = hashlib.sha256(data).hexdigest()
    filename = f"{digest}.pdf"
    path = UPLOADS_DIR / filename
    if not path.exists():
        path.write_bytes(data)
    return filename, digest


def _paper_with_digest(db: Session, digest: str) -> Paper | None:
    """The paper holding exactly these bytes, if Papol already has one.

    A paper is its PDF, so this is the whole of the identity check: two
    files printing the same DOI are two papers."""
    return db.query(Paper).filter(
        Paper.sha256 == digest, Paper.deleted_at.is_(None),
    ).first()


def _paper_for_upload(
    db: Session, data: PaperCreate, digest: str, user: User
) -> tuple[Paper, bool]:
    """The paper these bytes are, made if Papol has not got it yet.

    Two uploads of one file at the same moment both look, both find nothing,
    and both try to store it. The digest is unique, so one of them loses —
    and losing means the paper is already there, which is the answer the
    request wanted. It takes the row that won rather than being refused an
    upload that was never wrong.

    Nothing else has been written at this point, so the rollback undoes only
    the row that lost."""
    existing = _paper_with_digest(db, digest)
    if existing is not None:
        return existing, False
    stored = Paper(
        doi=data.doi,
        title=data.title,
        authors=data.authors,
        journal=data.journal,
        year=data.year,
        file_path=data.file_path,
        sha256=digest,
        uploaded_by=user.uuid,
    )
    db.add(stored)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = _paper_with_digest(db, digest)
        if existing is None:
            raise
        return existing, False
    return stored, True


def _paper_list_entry(
    paper: Paper, user_copy: Copy | None, hide_private: bool, room_map: dict
) -> PaperList:
    """One list row: the canonical paper, plus the personal fields of the
    given user_copy (a nook's own entry), plus every displayed copy."""
    entry = PaperList(
        uuid=paper.sha256,
        doi=paper.doi,
        title=paper.title,
        authors=paper.authors,
        journal=paper.journal,
        year=paper.year,
        file_path=paper.file_path or "",
        sha256=paper.sha256,
        created_at=user_copy.created_at if user_copy else paper.created_at,
    )
    if user_copy:
        entry.shelf_uuid = user_copy.shelf.uuid if user_copy.shelf else None
        entry.copy_uuid = user_copy.uuid
        entry.summary = None if hide_private else user_copy.summary
        entry.thought = user_copy.thought
        entry.is_public = user_copy.is_public
        entry.is_author = bool(user_copy.is_author)
        entry.rating_expertise = user_copy.rating_expertise
        entry.rating_reading = user_copy.rating_reading
        entry.rating_liking = user_copy.rating_liking
        if not hide_private:
            entry.tags = [TagOut.model_validate(t) for t in sorted(user_copy.tags, key=lambda t: t.name.lower())]
    entry.room_status = room_map.get(_paper_key_for(paper))
    entry.users = [_user_entry(r) for r in displayed_copies(paper)]
    return entry


@app.get("/api/users/{user_uuid}/space", response_model=UserSpace)
async def get_user_space(
    user_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A user's nook. Signed-in users only; summaries stay with their own user."""
    user = db.query(User).filter(User.uuid == user_uuid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # A tombstone has no nook — the copies went with the account. Saying so
    # is better than showing an empty shelf under "A former user".
    if user.is_deleted:
        raise HTTPException(status_code=404, detail="This user has left Papol")
    hide_private = current_user is None or current_user.uuid != user.uuid
    query = db.query(Copy).filter(Copy.user_uuid == user.uuid, Copy.deleted_at.is_(None))
    if hide_private:
        # On display means sitting on a public shelf, so the shelf is what
        # the question is put to. An inner join also drops the shelfless,
        # which is right: nothing stands behind them.
        query = query.join(Shelf, Copy.shelf_uuid == Shelf.uuid).filter(
            Shelf.is_public.is_(True),
        )
    copies = query.order_by(Copy.created_at.desc()).all()
    board_query = db.query(Board).filter(
        Board.user_uuid == user.uuid, Board.deleted_at.is_(None),
    )
    if hide_private:
        board_query = board_query.join(Shelf).filter(Shelf.is_public.is_(True))
    boards = board_query.order_by(Board.updated_at.desc(), Board.uuid.desc()).all()
    room_map = _room_status_map(db)
    stats = None
    if not hide_private:
        stats = NookStats(
            papers=len(copies),
            displayed=sum(1 for c in copies if c.is_public),
            notes=db.query(Annotation).filter(
                Annotation.user_uuid == user.uuid,
                Annotation.kind == NOTE,
                Annotation.deleted_at.is_(None),
            ).count(),
            seminars=db.query(RoomParticipant)
            .filter(RoomParticipant.user_uuid == user.uuid)
            .count(),
        )
    return UserSpace(
        user=UserPublic.model_validate(user),
        papers=[
            _paper_list_entry(r.paper, r, hide_private, room_map) for r in copies
        ],
        boards=[_board_out(board, can_edit=not hide_private) for board in boards],
        stats=stats,
        tags=(
            [TagOut.model_validate(t) for t in sorted(user.tags, key=lambda t: t.name.lower())]
            if not hide_private else []
        ),
        shelves=[
            _shelf_out(s) for s in user.shelves
            if s.deleted_at is None and (not hide_private or s.is_public)
        ],
    )


# ---------------- Papers ----------------

@app.get("/api/papers", response_model=list[PaperList])
async def list_all_papers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every paper, newest first. Signed-in users only, one row per
    canonical paper.

    Nothing is filtered out: no user's shelf decides what the Library
    holds. What display governs is the row of users shown against a
    paper, which is each user's own business."""
    papers = db.query(Paper).order_by(Paper.created_at.desc()).all()
    room_map = _room_status_map(db)
    return [
        _paper_list_entry(p, user_copy=None, hide_private=True, room_map=room_map)
        for p in papers
    ]


async def _printed_header(path: str) -> grobid.HeaderMetadata | None:
    """What the PDF says about itself, for fields nothing else could supply.

    An author's copy, a preprint, or a tech report often prints no DOI at
    all, and without an identifier the bibliographic APIs have nothing to
    answer. GROBID reads the title block off page one instead.

    It is strictly a last resort. Measured against CrossRef over the library,
    GROBID never names the venue, misses most years, and mistakes an
    affiliation for an author often enough that its answers are a starting
    point for the user to correct, not a result. It is therefore asked only
    about fields no API supplied, and never about the DOI: it finds no
    identifier the printed-text scan misses, and mangles those it does report
    into a PNAS supplement or an unparsed arXiv id.

    A fallback that fails leaves the user where they already were, with a
    filename for a title and every field open for typing, so an unreachable
    or unhappy analyzer is logged rather than raised.
    """
    if not grobid.configured():
        return None
    try:
        return await grobid.extract_header(path)
    except Exception:
        logger.exception("GROBID header extraction failed")
        return None


@app.post("/api/papers/extract", response_model=ExtractedMetadata)
async def extract_paper_metadata(
    file: UploadFile = File(...), current_user: User = Depends(get_current_user)
):
    """
    Upload a PDF and fetch metadata by its DOI or arXiv identifier.
    Returns extracted metadata for user to review/edit.
    Does not save to database yet.
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    filename, _ = _store_pdf(await file.read())
    file_path = UPLOADS_DIR / filename

    # Identifiers are normally printed near the front of a paper.
    doi, text = extract_doi_from_pdf(str(file_path))
    arxiv_id = extract_arxiv_id(text)

    # Default metadata from filename
    metadata = {
        "doi": doi,
        "title": get_title_from_filename(file.filename),
        "authors": None,
        "journal": None,
        "year": None,
        "file_path": filename
    }

    lookup_doi = arxiv_doi(arxiv_id) if arxiv_id else doi
    try:
        api_metadata = await metadata_lookup.by_doi(lookup_doi) if lookup_doi else None
    except metadata_lookup.Unavailable as exc:
        logger.exception("Bibliographic metadata APIs are unavailable")
        raise HTTPException(
            status_code=503,
            detail="Metadata lookup failed",
        ) from exc

    if api_metadata:
        metadata.update({
            "doi": api_metadata.get("doi") or lookup_doi,
            "title": api_metadata.get("title") or metadata["title"],
            "authors": (
                json.dumps(api_metadata["authors"])
                if api_metadata.get("authors") else None
            ),
            "journal": api_metadata.get("venue"),
            "year": api_metadata.get("year"),
        })
    else:
        # Nothing resolved this paper: it prints no identifier, or no API
        # knows the one it prints. Rather than hand back a filename, ask the
        # PDF what it calls itself.
        metadata["doi"] = lookup_doi
        header = await _printed_header(str(file_path))
        if header:
            metadata.update({
                "title": header.title or metadata["title"],
                "authors": json.dumps(header.authors) if header.authors else None,
                "journal": header.journal,
                "year": header.year,
            })
    return ExtractedMetadata(**metadata)




def _papers_for_key(db: Session, key: str) -> list[Paper]:
    return [p for p in db.query(Paper).all() if _paper_key_for(p) == key]


def _paper_user_uuids(db: Session, key: str, public_only: bool = True) -> set[str]:
    return {
        r.user_uuid
        for p in _papers_for_key(db, key)
        for r in p.copies
        if r.is_public or not public_only
    }


def _notify(db: Session, user_uuids, room: Room, content: str):
    for uid in user_uuids:
        db.add(Notification(user_uuid=uid, room_uuid=room.uuid, content=content))


def _room_summary(room: Room) -> RoomSummary:
    return RoomSummary(
        uuid=room.uuid,
        status=room.status,
        scheduled_time=room.scheduled_time,
        platform=room.platform,
        style=room.style,
        style_desc=room.style_desc,
        created_at=room.created_at,
        creator=UserPublic.model_validate(room.creator),
        leader=UserPublic.model_validate(room.leader) if room.leader else None,
        participant_count=len(room.participants),
        participants=[UserPublic.model_validate(p.user) for p in room.participants],
    )


def _copy_of(paper: Paper, viewer: User | None) -> Copy | None:
    if viewer is None:
        return None
    return next((r for r in paper.copies
                 if r.user_uuid == viewer.uuid and r.deleted_at is None), None)


def _paper_detail(db: Session, paper: Paper, viewer: User) -> PaperSchema:
    """The canonical paper, merged with the viewer's own copy (summary,
    ratings, display, private notes) when they have one.

    There is always a viewer. Every route that reaches here takes a
    signed-in user, and this asserts it rather than quietly building a
    page for nobody: a None here would mean a caller had opened the
    Library to someone outside it, which is a bug and not a permission
    to be decided this far in.
    """
    assert viewer is not None, "a paper page is only ever built for a signed-in user"
    user_copy = _copy_of(paper, viewer)
    detail = PaperSchema(
        uuid=paper.sha256,
        doi=paper.doi,
        title=paper.title,
        authors=paper.authors,
        journal=paper.journal,
        year=paper.year,
        file_path=paper.file_path or "",
        sha256=paper.sha256,
        uploader=(
            UserBase.model_validate(paper.uploader)
            if paper.uploader is not None else None
        ),
        created_at=paper.created_at,
    )
    if user_copy:
        detail.shelf_uuid = user_copy.shelf.uuid if user_copy.shelf else None
        detail.copy_uuid = user_copy.uuid
        detail.summary = user_copy.summary
        detail.thought = user_copy.thought
        detail.is_public = user_copy.is_public
        detail.is_author = bool(user_copy.is_author)
        detail.rating_expertise = user_copy.rating_expertise
        detail.rating_reading = user_copy.rating_reading
        detail.rating_liking = user_copy.rating_liking
        detail.tags = [TagOut.model_validate(t) for t in sorted(user_copy.tags, key=lambda t: t.name.lower())]
        detail.notes = [
            annotation_out(row)
            for row in sorted(paper.annotations, key=lambda a: (a.created_at, a.uuid))
            if row.user_uuid == viewer.uuid and row.kind == NOTE
            and row.deleted_at is None
        ]
        # The link this user already has out on this paper, so their share
        # menu opens showing it rather than offering to make a second one.
        # Only ever a link carrying their annotations: the paper's own link
        # is nobody's, and telling them one exists would make it sound like
        # something of theirs is out.
        shared = live_sharable_for(db, viewer, paper.sha256)
        detail.sharable_uuid = shared.uuid if shared else None
    detail.also_read_by = [_user_entry(r) for r in displayed_copies(paper)]

    detail.rooms = [
        _room_summary(r)
        for r in db.query(Room)
        .filter(Room.paper_key == _paper_key_for(paper))
        .order_by(Room.created_at.desc(), Room.uuid.desc())
        .all()
    ]
    detail.viewer_has_copy = user_copy is not None and user_copy.is_public
    detail.viewer_has_entry = user_copy is not None
    return detail


# Every row is named, in the database and on the wire, by its UUID.
def _get_paper_or_404(paper_sha256: str, db: Session) -> Paper:
    try:
        paper = paper_by_name(paper_sha256, db)
    except AmbiguousPaperName:
        raise HTTPException(
            status_code=409,
            detail="That name means more than one paper; use the paper's full digest",
        ) from None
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _own_shelf_or_404(shelf_uuid: str, user: User, db: Session) -> Shelf:
    shelf = db.query(Shelf).filter(Shelf.uuid == shelf_uuid, Shelf.user_uuid == user.uuid).first()
    if not shelf:
        raise HTTPException(status_code=404, detail="Shelf not found")
    return shelf


def _require_copy(paper: Paper, user: User) -> Copy:
    user_copy = _copy_of(paper, user)
    if user_copy is None:
        raise HTTPException(
            status_code=403, detail="Add this paper to your nook first"
        )
    return user_copy


def _set_copy_tags(db: Session, copy: Copy, tags: list[Tag]):
    """Replace private tag membership using versioned association rows."""
    desired = {tag.uuid: tag for tag in tags}
    links = (db.query(CopyTagLink).filter(CopyTagLink.copy_uuid == copy.uuid).all()
             if copy.uuid is not None else [])
    by_tag = {link.tag_uuid: link for link in links}
    now = datetime.utcnow()
    for link in links:
        link.deleted_at = None if link.tag_uuid in desired else now
    for tag_uuid, tag in desired.items():
        if tag_uuid not in by_tag:
            db.add(CopyTagLink(copy=copy, tag=tag, user_uuid=copy.user_uuid))


@app.post("/api/papers", response_model=PaperSchema)
async def create_paper(
    paper: PaperCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Save a paper with user-edited metadata and optional initial comment.
    A paper is its PDF: an upload of bytes Papol already holds becomes a new
    copy of that paper, and anything else is a paper of its own — including
    a different PDF printing a DOI Papol has already seen.
    """
    # Verify the file exists
    file_path = UPLOADS_DIR / paper.file_path
    if not file_path.exists():
        raise HTTPException(status_code=400, detail="PDF file not found")

    digest = _sha256_of(file_path)
    db_paper, is_new = _paper_for_upload(db, paper, digest, current_user)

    if not is_new:
        if _copy_of(db_paper, current_user) is not None:
            raise HTTPException(
                status_code=400, detail="This paper is already in your nook"
            )
        # The uploader reviewed the metadata; shared metadata takes the edit.
        db_paper.doi = paper.doi
        db_paper.title = paper.title
        db_paper.authors = paper.authors
        db_paper.journal = paper.journal
        db_paper.year = paper.year

    tag_uuids = set(paper.tag_uuids)
    tags = db.query(Tag).filter(
        Tag.user_uuid == current_user.uuid, Tag.uuid.in_(tag_uuids)
    ).all() if tag_uuids else []
    if len(tags) != len(tag_uuids):
        raise HTTPException(status_code=400, detail="One or more tags do not belong to you")

    shelf = (
        db.query(Shelf).filter(Shelf.uuid == paper.shelf_uuid, Shelf.user_uuid == current_user.uuid).first()
        if paper.shelf_uuid is not None else _default_shelf(current_user)
    )
    if shelf is None:
        raise HTTPException(status_code=400, detail="Shelf does not belong to you")
    user_copy = Copy(
        paper=db_paper,
        user_uuid=current_user.uuid,
        summary=paper.summary,
        thought=paper.thought,
        shelf=shelf,
        is_author=paper.is_author,
        rating_expertise=paper.rating_expertise,
        rating_reading=paper.rating_reading,
        rating_liking=paper.rating_liking,
    )
    db.add(user_copy)
    _set_copy_tags(db, user_copy, tags)

    if paper.initial_comment and paper.initial_comment.strip():
        db.add(Annotation(
            kind=NOTE,
            paper=db_paper,
            user_uuid=current_user.uuid,
            content=paper.initial_comment.strip(),
        ))

    # Full-document analysis is independent of the reviewed metadata and can
    # take seconds. Mark it pending in the same commit as the paper, then run
    # it after the response using its own database session.
    queue_analysis = _may_start_analysis(db_paper)
    if queue_analysis:
        db_paper.references_status = "pending"
        db_paper.references_error = None
        db_paper.references_at = datetime.utcnow()
    commit_sync(db)
    db.refresh(db_paper)
    if queue_analysis:
        _analyzing.add(db_paper.sha256)
        background.add_task(_analyze_paper, db_paper.sha256)
    return _paper_detail(db, db_paper, current_user)


@app.get("/api/papers/{paper_sha256}", response_model=PaperSchema)
async def get_paper(
    paper_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a paper by UUID, merged with the viewer's own copy and notes.

    Any signed-in user may open any paper: the Library holds every one,
    and whose nook it sits in is nobody's business but theirs. The
    Library is for people with accounts (US-1.4), so there is no visitor
    case here — a paper page is not a thing Papol shows to nobody."""
    paper = _get_paper_or_404(paper_sha256, db)
    return _paper_detail(db, paper, current_user)


@app.post(
    "/api/papers/{paper_sha256}/extract-metadata",
    response_model=ReextractedMetadata,
)
async def reextract_paper_metadata(
    paper_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-read a paper's PDF metadata for the edit form."""
    paper = _get_paper_or_404(paper_sha256, db)
    path = _paper_pdf_path(paper)
    if path is None:
        raise HTTPException(status_code=404, detail="PDF for this paper is missing")

    doi, text = extract_doi_from_pdf(str(path))
    arxiv_id = extract_arxiv_id(text)
    # This action promises to re-read the PDF. Prefer the identifier printed
    # in the file over possibly stale or incorrectly entered paper data.
    lookup_doi = (arxiv_doi(arxiv_id) if arxiv_id else doi) or paper.doi
    api_metadata = None
    if lookup_doi:
        try:
            api_metadata = await metadata_lookup.by_doi(lookup_doi)
        except metadata_lookup.Unavailable as exc:
            logger.exception("Bibliographic metadata APIs are unavailable")
            raise HTTPException(
                status_code=503,
                detail="Metadata lookup failed",
            ) from exc
    if api_metadata:
        return ReextractedMetadata(
            doi=api_metadata.get("doi") or lookup_doi,
            title=api_metadata.get("title"),
            authors=(
                json.dumps(api_metadata["authors"])
                if api_metadata.get("authors") else None
            ),
            journal=api_metadata.get("venue"),
            year=api_metadata.get("year"),
        )
    # A paper with no identifier used to end here, which left the user
    # holding a filename with no way to ask again. The page itself still
    # carries a title and an author list.
    header = await _printed_header(str(path))
    if header and (header.title or header.authors):
        return ReextractedMetadata(
            doi=lookup_doi,
            title=header.title,
            authors=json.dumps(header.authors) if header.authors else None,
            journal=header.journal,
            year=header.year,
        )
    raise HTTPException(status_code=404, detail="Metadata was not found")


@app.get("/api/viewer/{pdf_sha256}", response_model=PaperSchema)
async def get_viewer_paper(
    pdf_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve the paper named by a viewer URL, which names its PDF."""
    paper = _viewer_paper_or_404(pdf_sha256, current_user, db)
    return _paper_detail(db, paper, current_user)


@app.get("/api/viewer/{pdf_sha256}/info", response_model=ResolvedWork)
async def get_viewer_paper_info(
    pdf_sha256: str,
    share: str | None = None,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Enriched bibliographic information for the paper being viewed.

    A shared reading is read by people who have no account here, and what a
    paper is remains public either way."""
    paper = _viewer_paper_or_404(pdf_sha256, current_user, db, share)
    reference = SimpleNamespace(
        doi=paper.doi,
        arxiv_id=None,
        title=paper.title,
        year=paper.year,
        raw=" ".join(str(value) for value in (
            paper.title, paper.journal, paper.year, paper.doi
        ) if value),
    )
    status, resolved = await biblio.resolve(reference)
    if status == "ok" and resolved:
        return resolved
    try:
        authors = json.loads(paper.authors) if paper.authors else []
    except (TypeError, ValueError):
        authors = [paper.authors] if paper.authors else []
    return ResolvedWork(
        title=paper.title,
        authors=authors,
        year=paper.year,
        venue=paper.journal,
        doi=paper.doi,
        url=f"https://doi.org/{paper.doi}" if paper.doi else None,
    )


def _viewer_paper_or_404(
    pdf_sha256: str,
    current_user: User | None,
    db: Session,
    share: str | None = None,
) -> Paper:
    """The paper a viewer URL names, if whoever asked may read it.

    Two ways to be allowed: the user has the paper in their nook, or they
    hold a link someone shared. A shared link names its own paper, so it
    is the file that has to match the URL rather than the user."""
    digest = pdf_sha256.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise HTTPException(status_code=404, detail="PDF not found")
    if share:
        sharable = open_sharable(db, share)
        if sharable is None:
            raise HTTPException(
                status_code=404, detail="This reading is no longer shared",
            )
        if sharable.paper.sha256 != digest:
            raise HTTPException(status_code=404, detail="PDF not found")
        return sharable.paper
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    papers = db.query(Paper).filter(Paper.sha256 == digest).all()
    if not papers:
        raise HTTPException(status_code=404, detail="PDF not found")
    paper = next(
        (candidate for candidate in papers if _copy_of(candidate, current_user)),
        None,
    )
    if paper is None:
        raise HTTPException(status_code=403, detail="Add this paper to your nook first")
    return paper


_METADATA_FIELDS = {"title", "authors", "journal", "year", "doi"}
_PERSONAL_FIELDS = {"summary", "thought", "rating_expertise", "rating_reading", "rating_liking", "is_public", "is_author"}


@app.put("/api/papers/{paper_sha256}", response_model=PaperSchema)
async def update_paper(
    paper_sha256: str,
    paper_update: PaperUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a paper.

    Personal fields (summary, ratings, display) apply to the viewer's own
    user_copy. Metadata (title/authors/journal/year/DOI) lives on the one
    canonical paper: any signed-in user may edit it, for everyone.
    """
    paper = _get_paper_or_404(paper_sha256, db)

    update_data = paper_update.model_dump(exclude_unset=True)
    tag_uuids = update_data.pop("tag_uuids", None)
    shelf_uuid = update_data.pop("shelf_uuid", None)
    personal = {k: v for k, v in update_data.items() if k in _PERSONAL_FIELDS}
    metadata = {k: v for k, v in update_data.items() if k in _METADATA_FIELDS}

    if personal:
        user_copy = _require_copy(paper, current_user)
        requested_visibility = personal.pop("is_public", None)
        if requested_visibility is False and _in_active_cohort(
            db, current_user, _paper_key_for(paper)
        ):
            raise HTTPException(
                status_code=400,
                detail="Leave the seminar before hiding this paper",
            )
        if requested_visibility is not None:
            target_shelf = next(
                (s for s in current_user.shelves if s.is_public == requested_visibility),
                None,
            )
            if not target_shelf:
                visibility = "public" if requested_visibility else "private"
                raise HTTPException(status_code=400, detail=f"Create a {visibility} shelf first")
            user_copy.shelf = target_shelf
        for key, value in personal.items():
            setattr(user_copy, key, value)

    if tag_uuids is not None:
        user_copy = _require_copy(paper, current_user)
        unique_uuids = set(tag_uuids)
        tags = db.query(Tag).filter(Tag.user_uuid == current_user.uuid, Tag.uuid.in_(unique_uuids)).all() if unique_uuids else []
        if len(tags) != len(unique_uuids):
            raise HTTPException(status_code=400, detail="One or more tags do not belong to you")
        _set_copy_tags(db, user_copy, tags)

    if shelf_uuid is not None:
        user_copy = _require_copy(paper, current_user)
        shelf = db.query(Shelf).filter(Shelf.uuid == shelf_uuid, Shelf.user_uuid == current_user.uuid).first()
        if not shelf:
            raise HTTPException(status_code=400, detail="Shelf does not belong to you")
        if not shelf.is_public and user_copy.is_public and _in_active_cohort(
            db, current_user, _paper_key_for(paper)
        ):
            raise HTTPException(status_code=400, detail="Leave the seminar before moving this paper to a private shelf")
        user_copy.shelf = shelf

    for key, value in metadata.items():
        setattr(paper, key, value)

    commit_sync(db)
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


@app.post("/api/tags", response_model=TagOut)
async def create_tag(
    data: TagCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = " ".join(data.name.split())
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    existing = db.query(Tag).filter(
        Tag.user_uuid == current_user.uuid, func.lower(Tag.name) == name.lower()
    ).first()
    if existing:
        return existing
    tag = Tag(user_uuid=current_user.uuid, name=name)
    db.add(tag)
    commit_sync(db)
    db.refresh(tag)
    return tag


@app.get("/api/tags", response_model=list[TagOut])
async def list_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Tag).filter(
        Tag.user_uuid == current_user.uuid, Tag.deleted_at.is_(None),
    ).order_by(func.lower(Tag.name)).all()


@app.delete("/api/tags/{tag_uuid}", status_code=204)
async def delete_tag(
    tag_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = db.query(Tag).filter(Tag.uuid == tag_uuid, Tag.user_uuid == current_user.uuid).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    for link in db.query(CopyTagLink).filter(
        CopyTagLink.tag_uuid == tag.uuid, CopyTagLink.deleted_at.is_(None),
    ).all():
        link.deleted_at = datetime.utcnow()
    tag.deleted_at = datetime.utcnow()
    commit_sync(db)


@app.get("/api/shelves", response_model=list[ShelfOut])
async def list_shelves(
    current_user: User = Depends(get_current_user),
):
    return [_shelf_out(s) for s in current_user.shelves if s.deleted_at is None]


@app.post("/api/shelves", response_model=ShelfOut)
async def create_shelf(
    data: ShelfCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    active_shelves = [s for s in current_user.shelves if s.deleted_at is None]
    if len(active_shelves) >= limit("counts", "shelves_per_nook"):
        raise HTTPException(
            status_code=400,
            detail=f'A nook can have at most {limit("counts", "shelves_per_nook")} shelves',
        )
    name = " ".join(data.name.split())
    if any(s.name.lower() == name.lower() for s in active_shelves):
        raise HTTPException(status_code=400, detail="You already have a shelf with that name")
    shelf = Shelf(
        user_uuid=current_user.uuid, name=name, color=data.color.lower(),
        is_public=data.is_public, position=len(active_shelves),
    )
    db.add(shelf)
    commit_sync(db)
    db.refresh(shelf)
    return _shelf_out(shelf)


@app.put("/api/shelves/{shelf_uuid}", response_model=ShelfOut)
async def update_shelf(
    shelf_uuid: str,
    data: ShelfUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = _own_shelf_or_404(shelf_uuid, current_user, db)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        name = " ".join(changes["name"].split())
        if not name:
            raise HTTPException(status_code=400, detail="Shelf name cannot be empty")
        if any(s.uuid != shelf.uuid and s.deleted_at is None
               and s.name.lower() == name.lower() for s in current_user.shelves):
            raise HTTPException(status_code=400, detail="You already have a shelf with that name")
        shelf.name = name
    if "color" in changes:
        shelf.color = changes["color"].lower()
    if "is_public" in changes and bool(changes["is_public"]) != bool(shelf.is_public):
        becoming_public = bool(changes["is_public"])
        if not becoming_public:
            blocked = [c for c in shelf.copies if _in_active_cohort(db, current_user, _paper_key_for(c.paper))]
            if blocked:
                raise HTTPException(status_code=400, detail="Some papers on this shelf are in active seminar cohorts")
        # Every copy on the shelf moves with it, because none of them was
        # holding a visibility of its own to update.
        shelf.is_public = becoming_public
    if changes.get("is_default"):
        for other in current_user.shelves:
            if other.deleted_at is not None:
                continue
            other.is_default = other.uuid == shelf.uuid
    commit_sync(db)
    db.refresh(shelf)
    return _shelf_out(shelf)


@app.delete("/api/shelves/{shelf_uuid}", status_code=204)
async def delete_shelf(
    shelf_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = _own_shelf_or_404(shelf_uuid, current_user, db)
    remaining = [item for item in current_user.shelves
                 if item.uuid != shelf.uuid and item.deleted_at is None]
    if not remaining:
        raise HTTPException(status_code=400, detail="A nook must have at least one shelf")
    destination = next((item for item in remaining if item.is_default), remaining[0])
    if not destination.is_public:
        blocked = [
            copy for copy in shelf.copies
            if copy.is_public and _in_active_cohort(db, current_user, _paper_key_for(copy.paper))
        ]
        if blocked:
            raise HTTPException(
                status_code=400,
                detail="Seminar papers cannot move to a private shelf",
            )
    for copy in list(shelf.copies):
        copy.shelf = destination
    for board in list(shelf.boards):
        board.shelf = destination
    if shelf.is_default:
        destination.is_default = True
    shelf.deleted_at = datetime.utcnow()
    commit_sync(db)


@app.delete("/api/papers/{paper_sha256}")
async def delete_paper(
    paper_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the paper from the viewer's nook: their copy and notes.

    The paper and its file stay, and the paper stays in the Library — one
    user leaving destroys nothing shared, and the Library holds every paper
    whoever happens to keep one. What leaving takes away is this user's
    name from the row of readers shown against it."""
    paper = _get_paper_or_404(paper_sha256, db)
    user_copy = _require_copy(paper, current_user)

    user_copy.deleted_at = datetime.utcnow()
    # Only the notes, as the confirmation promises. Ink and clips are left
    # where they are: leaving a nook is not meant to be a deletion, and a
    # user who adds the paper again finds their paint still on the page.
    for row in paper.annotations:
        if (row.user_uuid == current_user.uuid and row.kind == NOTE
                and row.deleted_at is None):
            row.deleted_at = datetime.utcnow()

    commit_sync(db)
    return {"message": "Paper removed from your nook"}


@app.post("/api/papers/{paper_sha256}/add-to-nook", response_model=PaperSchema)
async def add_to_nook(
    paper_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add the paper to the viewer's nook: a new copy of the one
    canonical paper. The PDF and metadata are shared."""
    paper = _get_paper_or_404(paper_sha256, db)
    if _copy_of(paper, current_user) is not None:
        raise HTTPException(status_code=400, detail="This paper is already in your nook")

    shelf = _default_shelf(current_user)
    # One copy per user (uq_copy): a paper added back after being removed
    # revives that copy, since a second one cannot be stored. The shelf is the
    # only place its visibility lives, so reviving sets no flag of its own.
    removed = next((r for r in paper.copies if r.user_uuid == current_user.uuid), None)
    if removed is not None:
        removed.deleted_at = None
        removed.shelf = shelf
    else:
        db.add(Copy(
            paper=paper,
            user_uuid=current_user.uuid,
            shelf=shelf,
        ))
    commit_sync(db)
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


# ---------------- References ----------------

# A PDF's bibliography is read once and kept, because reading it costs a
# GROBID pass over the whole document. The work happens in the background
# and the viewer asks again; what follows is the bookkeeping that makes
# "ask again" cheap and "ask twice at once" harmless.

# Papers being analyzed right now in this process, so a viewer polling
# every second does not start a second pass over the same PDF.
_analyzing: set[str] = set()

# A pass that has been pending longer than this was interrupted — the
# server restarted mid-analysis — and may be started again.
_ANALYSIS_STALE = timedelta(minutes=15)

# Demo papers live in the browser, but their bundled PDFs are available to
# this backend. Their analysis mirrors a stored paper while remaining
# process-local: restarting the demo clears it, just like every other demo
# mutation.
_bundled_references = EphemeralReferenceEngine()


@lru_cache(maxsize=32)
def _public_pdf_path(digest: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        return None
    if digest not in _PUBLIC_DEMO_PDFS:
        return None
    candidate = UPLOADS_DIR / f"{digest}.pdf"
    return candidate if candidate.exists() else None


def _paper_pdf_path(paper: Paper) -> Path | None:
    """Where a paper's PDF sits on disk, under /uploads."""
    if not paper.file_path:
        return None
    candidate = UPLOADS_DIR / paper.file_path
    return candidate if candidate.exists() else None


async def _analyze_paper(paper_sha256: str):
    """Read one paper's references through GROBID and store them.

    Runs after the paper-save response, on its own session. The viewer can
    observe `pending` and later retrieve the stored result. Any failure is
    recorded on the paper rather than raised, so a PDF that cannot be
    analyzed says so instead of being retried forever."""
    db = SessionLocal()
    try:
        paper = db.get(Paper, paper_sha256)
        if paper is None:
            return
        path = _paper_pdf_path(paper)
        if path is None:
            _finish_analysis(db, paper, "failed", "The PDF for this paper is missing")
            return
        try:
            analysis = await grobid.analyze(str(path))
        except Exception as e:
            logger.warning(f"GROBID failed on paper {paper_sha256}: {e}")
            _finish_analysis(db, paper, "failed", str(e)[:limit("text", "analysis_error")])
            return

        # A re-analysis replaces what was there. Resolutions are lost with
        # it, which is the honest thing: they were attached to references
        # read out of the PDF a different way.
        db.query(PaperCitation).filter(
            PaperCitation.paper_sha256 == paper_sha256
        ).delete()
        db.query(PaperLink).filter(
            PaperLink.paper_sha256 == paper_sha256
        ).delete()
        db.query(PaperReference).filter(
            PaperReference.paper_sha256 == paper_sha256
        ).delete()

        rows: dict[str, PaperReference] = {}
        for ref in analysis.references:
            row = PaperReference(
                paper_sha256=paper_sha256,
                key=ref.key,
                index=ref.index,
                raw=ref.raw,
                title=ref.title,
                authors=json.dumps(ref.authors) if ref.authors else None,
                year=ref.year,
                journal=ref.journal,
                doi=ref.doi,
                arxiv_id=ref.arxiv_id,
                page=ref.page,
                y=ref.y,
            )
            db.add(row)
            rows[ref.key] = row
        db.flush()  # the citations need the reference ids

        for cite in analysis.citations:
            row = rows.get(cite.key)
            if row is None:
                continue
            db.add(PaperCitation(
                paper_sha256=paper_sha256,
                reference_uuid=row.uuid,
                label=cite.label,
                page=cite.page,
                x=cite.x, y=cite.y, w=cite.w, h=cite.h,
                inferred=cite.inferred,
            ))

        for link in analysis.links:
            db.add(PaperLink(
                paper_sha256=paper_sha256,
                kind=link.kind,
                label=link.label,
                page=link.page,
                x=link.x, y=link.y, w=link.w, h=link.h,
                target_page=link.target_page,
                target_y=link.target_y,
            ))

        _finish_analysis(db, paper, "ready", None)
        logger.info(
            f"Paper {paper_sha256}: {len(analysis.references)} references, "
            f"{len(analysis.citations)} citation markers, "
            f"{len(analysis.links)} document links"
        )
    except Exception as e:
        # Whatever went wrong, the paper must not be left saying
        # "pending" forever: a user would poll a job that is not running.
        logger.error(f"Reference analysis of paper {paper_sha256} failed: {e}")
        db.rollback()
        try:
            paper = db.get(Paper, paper_sha256)
            if paper is not None:
                _finish_analysis(db, paper, "failed", str(e)[:limit("text", "analysis_error")])
        except Exception:
            db.rollback()
    finally:
        db.close()
        _analyzing.discard(paper_sha256)


def _finish_analysis(db: Session, paper: Paper, status: str, detail: str | None):
    paper.references_status = status
    paper.references_error = detail
    paper.references_at = datetime.utcnow()
    db.commit()


def _may_start_analysis(paper: Paper) -> bool:
    """Whether this paper wants a pass now. Never for a failure — a PDF
    GROBID could not read will not read differently on the next open, and
    a user refreshing should not queue a job each time."""
    if paper.sha256 in _analyzing:
        return False
    if paper.references_status is None:
        return True
    if paper.references_status == "pending":
        stamped = paper.references_at
        return stamped is None or datetime.utcnow() - stamped > _ANALYSIS_STALE
    return False


async def _bundled_paper_references(
    paper_sha256: str,
    pdf_sha256: str,
    background: BackgroundTasks,
):
    """Analyze a bundled demo PDF through the same GROBID service as prod."""
    digest = pdf_sha256.strip().lower()
    path = _public_pdf_path(digest)
    if path is None:
        raise HTTPException(status_code=404, detail="Demo PDF not found")
    if not grobid.configured():
        return PaperReferences(
            paper_sha256=paper_sha256, status="unavailable",
            detail="Reference analysis unavailable",
        )
    if _bundled_references.begin(digest):
        background.add_task(_bundled_references.analyze, digest, path)
    return _bundled_references.response(digest, paper_sha256)


@app.get("/api/papers/{paper_sha256}/references", response_model=PaperReferences)
async def paper_references(
    paper_sha256: str,
    background: BackgroundTasks,
    refresh: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The references of one paper, and where they are cited in it.

    Upload starts the analysis and the viewer observes `pending` until it is
    `ready`. Older unanalyzed papers are started on first access. Pass
    `refresh=true` to read a PDF again — the way to retry one GROBID could
    not handle."""
    paper = _get_paper_or_404(paper_sha256, db)
    return await _paper_references(paper, background, db, refresh)


async def _paper_references(
    paper: Paper,
    background: BackgroundTasks,
    db: Session,
    refresh: bool = False,
) -> PaperReferences:
    """The bibliography of one paper, once someone is allowed to read it.

    Kept apart from the endpoint because there is more than one way to be
    allowed — a user with the paper in their nook, or a visitor holding a
    link to someone's reading of it — and only one way to answer."""
    # A reading already done is served whatever the analyzer is doing now.
    # References belong to the paper, not to the service that read them,
    # so an analyzer that is stopped — or one taken away again — must not
    # empty the citations out of every paper anyone has already read.
    stored = paper.references_status == "ready"

    if not grobid.configured() and not stored:
        return PaperReferences(
            paper_sha256=paper.sha256,
            status="unavailable",
            detail="Reference analysis unavailable",
        )

    if grobid.configured():
        if refresh and paper.sha256 not in _analyzing:
            paper.references_status = None
        if _may_start_analysis(paper):
            _analyzing.add(paper.sha256)
            _finish_analysis(db, paper, "pending", None)
            background.add_task(_analyze_paper, paper.sha256)

    if paper.references_status != "ready":
        return PaperReferences(
            paper_sha256=paper.sha256,
            status=paper.references_status or "pending",
            detail=paper.references_error,
        )

    references = paper.references
    known = _papol_papers_for(db, references)
    return PaperReferences(
        paper_sha256=paper.sha256,
        status="ready",
        references=[_reference_out(r, known.get(r.uuid)) for r in references],
        citations=[
            CitationOut(
                reference_uuid=c.reference.uuid,
                label=c.label,
                page=c.page,
                x=c.x, y=c.y, w=c.w, h=c.h,
                inferred=bool(c.inferred),
            )
            for c in paper.citations
            if c.reference_uuid is not None
        ],
        links=[
            DocumentLinkOut(
                kind=link.kind,
                label=link.label,
                page=link.page,
                x=link.x, y=link.y, w=link.w, h=link.h,
                target_page=link.target_page,
                target_y=link.target_y,
            )
            for link in paper.links
        ],
    )


@app.get("/api/references/{reference_uuid}", response_model=ReferenceOut)
async def open_reference(
    reference_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One reference, looked up if it has not been looked up before.

    Lazy on purpose: a paper cites forty works and a user opens three of
    them, so forty lookups would be thirty-seven asked of CrossRef and
    OpenAlex for nobody's benefit."""
    reference = db.query(PaperReference).filter(
        PaperReference.uuid == reference_uuid,
    ).first()
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    return await _open_reference(reference, db)


async def _open_reference(reference: PaperReference, db: Session) -> ReferenceOut:
    answer = await resolve_reference(reference)
    if answer.resolved_status == "error":
        return answer
    db.commit()

    known = _papol_papers_for(db, [reference])
    return _reference_out(reference, known.get(reference.uuid))


@app.post("/api/papers/{paper_sha256}/references/preview", response_model=ReferenceOut)
async def preview_pdf_reference(
    paper_sha256: str,
    data: ReferencePreviewIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve a citation recovered directly from a PDF's link layer.

    Some PDFs identify every citation with a hyperref ``cite.*`` target even
    when Papol's document analyzer is unavailable. The viewer can read the
    printed bibliography entry itself; registering it here gives that entry
    the same cached Crossref/OpenAlex enrichment as analyzed references.
    """
    paper = _get_paper_or_404(paper_sha256, db)

    key = data.key.strip()
    raw = " ".join(data.raw.split())
    reference = db.query(PaperReference).filter(
        PaperReference.paper_sha256 == paper.sha256,
        PaperReference.key == key,
    ).first()
    if reference is None and key.isdigit():
        # The viewer names a PDF-native citation by the number printed on the
        # page: "bib0027" is entry 27. The analyzer names its own rows after
        # GROBID's ids, counting from zero, so the same entry is "b26".
        # Matching on the spelling alone appends a second row for a reference
        # this paper already holds — and one read off the page at that,
        # which is the poorer of the two readings.
        reference = db.query(PaperReference).filter(
            PaperReference.paper_sha256 == paper.sha256,
            PaperReference.index == int(key) - 1,
        ).first()
    if reference is None:
        last_index = db.query(func.max(PaperReference.index)).filter(
            PaperReference.paper_sha256 == paper.sha256,
        ).scalar()
        reference = PaperReference(
            paper_sha256=paper.sha256,
            key=key,
            index=(last_index if last_index is not None else -1) + 1,
            raw=raw,
        )
        db.add(reference)
        db.flush()
    elif not reference.raw:
        reference.raw = raw

    answer = await resolve_reference(reference)
    if answer.resolved_status == "error":
        db.rollback()
        return answer
    db.commit()
    db.refresh(reference)
    known = _papol_papers_for(db, [reference])
    return _reference_out(reference, known.get(reference.uuid))


# The viewer speaks one reference protocol. Whether a hash belongs to a
# bundled demo PDF or a user's stored paper is an authorization/storage
# decision made here, not a mode branch leaked into the UI.
@app.get("/api/viewer-references/{pdf_sha256}", response_model=PaperReferences)
async def viewer_references(
    pdf_sha256: str,
    paper_sha256: str,
    background: BackgroundTasks,
    share: str | None = None,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    digest = pdf_sha256.strip().lower()
    if _public_pdf_path(digest) is not None:
        return await _bundled_paper_references(paper_sha256, digest, background)
    paper = _viewer_paper_or_404(digest, current_user, db, share)
    # What a paper cites is a property of the file, not of the user who
    # shared it, so a shared reading carries its bibliography like any other.
    # The paper is already in hand either way: naming it again only to look it
    # up again would be asking the question this route has already answered.
    return await _paper_references(paper, background, db)


@app.get("/api/viewer-references/item/{reference_uuid}", response_model=ReferenceOut)
async def viewer_reference(
    reference_uuid: str,
    share: str | None = None,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    bundled = await _bundled_references.open(reference_uuid)
    if bundled is not None:
        return bundled
    if share:
        sharable = open_sharable(db, share)
        reference = db.query(PaperReference).filter(
            PaperReference.uuid == reference_uuid,
        ).first()
        if (sharable is None or reference is None
                or reference.paper_sha256 != sharable.paper_sha256):
            raise HTTPException(status_code=404, detail="Reference not found")
        return await _open_reference(reference, db)
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return await open_reference(reference_uuid, current_user, db)


@app.post("/api/viewer-references/{pdf_sha256}/preview", response_model=ReferenceOut)
async def preview_viewer_reference(
    pdf_sha256: str,
    data: ReferencePreviewIn,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    digest = pdf_sha256.strip().lower()
    if _public_pdf_path(digest) is not None:
        return await _bundled_references.preview(data.key.strip(), data.raw)
    paper = _viewer_paper_or_404(digest, current_user, db)
    return await preview_pdf_reference(paper.sha256, data, current_user, db)


def _reference_out(reference: PaperReference, papol_paper_sha256: str | None) -> ReferenceOut:
    answer = reference_out(reference)
    answer.papol_paper_sha256 = papol_paper_sha256
    return answer


def _papol_papers_for(db: Session, references) -> dict[str, str]:
    """Which of these references name a paper Papol already holds.

    A reference is worth more when the paper it names is one someone here
    has read: the user can open it rather than leave. Matched on the same
    key papers are deduplicated by, so this agrees with Papol's own idea of
    when two papers are the same paper."""
    by_key = {}
    for paper in db.query(Paper).all():
        by_key.setdefault(_paper_key_for(paper), paper.sha256)

    found = {}
    for reference in references:
        keys = []
        doi = reference.doi
        title = reference.title
        if reference.resolution:
            try:
                resolved = json.loads(reference.resolution)
                doi = resolved.get("doi") or doi
                title = resolved.get("title") or title
            except Exception:
                pass
        if doi:
            keys.append("doi:" + doi.strip().lower())
        if title:
            keys.append("title:" + title.strip().lower())
        for key in keys:
            if key in by_key:
                found[reference.uuid] = by_key[key]
                break
    return found


# ---------------- Comments ----------------

# ---- Ink -------------------------------------------------------------
#
# Annotations a user made on the page with the brush: private to them, kept
# against the paper they were drawn on. The laser pointer leaves nothing
# here on purpose — it is a way of pointing while you talk, and a gesture
# that outlived the sentence would be litter.


def _own_annotation_or_404(uuid: str, user: User, db: Session) -> Annotation:
    annotation = db.query(Annotation).filter(
        Annotation.uuid == uuid,
        Annotation.user_uuid == user.uuid,
        Annotation.deleted_at.is_(None),
    ).first()
    if annotation is None:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return annotation


@app.get("/api/papers/{paper_sha256}/annotations", response_model=list[AnnotationOut])
async def list_annotations(
    paper_sha256: str,
    kind: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Your annotations on this paper, oldest first — which is the order they
    have to be drawn in for later ink to sit over earlier ink.

    Narrow to one kind with `kind`. A note written about the paper and never
    placed on a page comes back with the rest: it is still a mark on this
    paper, just not on a page of it."""
    paper = _get_paper_or_404(paper_sha256, db)
    _require_copy(paper, current_user)
    if kind is not None and kind not in KINDS:
        raise HTTPException(status_code=422, detail="Unknown annotation kind")
    return [
        annotation_out(row) for row in annotations_of(
            db, current_user.uuid,
            paper_sha256=paper.sha256,
            kinds=(kind,) if kind else None,
        )
    ]


@app.post("/api/papers/{paper_sha256}/annotations", response_model=AnnotationOut)
async def create_annotation(
    paper_sha256: str,
    data: AnnotationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leave an annotation on a paper: a note, a stroke of ink, or a clipped view."""
    paper = _get_paper_or_404(paper_sha256, db)
    _require_copy(paper, current_user)
    annotation = Annotation(
        kind=data.kind,
        user_uuid=current_user.uuid,
        paper_sha256=paper.sha256,
        page=data.page,
        group_uuid=data.group_uuid,
        content=data.content,
        name=data.name,
        body=body_text(data.kind, data.body),
    )
    db.add(annotation)
    commit_sync(db)
    db.refresh(annotation)
    return annotation_out(annotation)


@app.put("/api/annotations/{annotation_uuid}", response_model=AnnotationOut)
async def update_annotation(
    annotation_uuid: str,
    data: AnnotationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change an annotation (its author only). Only what is sent changes, so
    rewording a note never disturbs where it sits, and moving it never
    disturbs the words."""
    annotation = _own_annotation_or_404(annotation_uuid, current_user, db)
    if data.content is not None:
        annotation.content = data.content
    if data.name is not None:
        annotation.name = data.name
    if data.page is not None:
        annotation.page = data.page
    if data.body is not None:
        merged = {**json.loads(annotation.body or "{}"), **data.body}
        try:
            # Creating validates while the request is still being parsed; a
            # change is only a few fields, so its shape is not known to be
            # good until it has been merged with what is already stored.
            annotation.body = body_text(annotation.kind, merged)
        except ValidationError as error:
            raise HTTPException(
                status_code=422,
                detail=error.errors(include_context=False, include_url=False),
            ) from error
    commit_sync(db)
    db.refresh(annotation)
    return annotation_out(annotation)


@app.delete("/api/annotations/{annotation_uuid}")
async def delete_annotation(
    annotation_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    annotation = _own_annotation_or_404(annotation_uuid, current_user, db)
    annotation.deleted_at = datetime.utcnow()
    commit_sync(db)
    return {"message": "Annotation deleted"}


# ---------------- Seminar rooms ----------------

def _get_room_or_404(room_uuid: str, db: Session) -> Room:
    room = db.query(Room).filter(Room.uuid == room_uuid).first()
    if not room:
        raise HTTPException(status_code=404, detail="Cohort not found")
    return room


def _ensure_participant(db: Session, room: Room, user: User):
    exists = (
        db.query(RoomParticipant)
        .filter(RoomParticipant.room_uuid == room.uuid, RoomParticipant.user_uuid == user.uuid)
        .first()
    )
    if not exists:
        db.add(RoomParticipant(room_uuid=room.uuid, user_uuid=user.uuid))


def _require_user(db: Session, room: Room, user: User):
    if user.uuid not in _paper_user_uuids(db, room.paper_key, public_only=True):
        raise HTTPException(
            status_code=403,
            detail="Display this paper to join the cohort",
        )


def _room_detail(db: Session, room: Room, viewer: User) -> RoomDetail:
    users_displaying = _paper_user_uuids(db, room.paper_key, public_only=True)

    # The canonical paper this room is about, and the viewer's copy of it
    paper = next(iter(_papers_for_key(db, room.paper_key)), None)
    own = _copy_of(paper, viewer) if paper else None
    # Every paper has a page and this viewer is signed in, so the cohort
    # always names the paper it is about. Whether the viewer keeps a copy,
    # and whether they display it, decides what they may do in the cohort
    # below — never whether they may look at the paper.
    link_paper = paper
    hidden_entry = paper if own is not None and not own.is_public else None

    summary = _room_summary(room)
    return RoomDetail(
        **summary.model_dump(),
        paper_title=room.paper_title,
        paper_sha256=link_paper.sha256 if link_paper else None,
        messages=[
            RoomMessageOut.model_validate(m)
            for m in sorted(room.messages, key=lambda m: (m.created_at, m.uuid))
        ],
        availabilities=[RoomAvailabilityOut.model_validate(a) for a in room.availabilities],
        viewer_can_lead=room.status == "open"
        and viewer.uuid in users_displaying
        and any(p.user_uuid == viewer.uuid for p in room.participants),
        viewer_is_participant=any(p.user_uuid == viewer.uuid for p in room.participants),
        viewer_has_copy=viewer.uuid in users_displaying,
        viewer_hidden_entry_sha256=hidden_entry.uuid if hidden_entry else None,
    )


@app.post("/api/papers/{paper_sha256}/room", response_model=RoomSummary)
async def call_seminar(
    paper_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Call for a seminar on this paper. Only users of it may call.
    Notifies every user — including those who keep their copy hidden."""
    paper = _get_paper_or_404(paper_sha256, db)

    key = _paper_key_for(paper)
    if current_user.uuid not in _paper_user_uuids(db, key, public_only=True):
        raise HTTPException(
            status_code=403,
            detail="Display this paper to call a seminar",
        )
    active = (
        db.query(Room)
        .filter(Room.paper_key == key, Room.status.in_(("open", "planning")))
        .first()
    )
    if active:
        raise HTTPException(
            status_code=400, detail="A seminar is already being organized"
        )

    room = Room(paper_key=key, paper_title=paper.title, created_by=current_user.uuid)
    db.add(room)
    db.flush()
    _ensure_participant(db, room, current_user)
    users_of_paper = _paper_user_uuids(db, key, public_only=False) - {current_user.uuid}
    _notify(
        db, users_of_paper, room,
        f"{current_user.display_name} called for a seminar on “{paper.title}”. "
        "A user of the paper can answer to host.",
    )
    db.commit()
    db.refresh(room)
    return _room_summary(room)


@app.get("/api/rooms/{room_uuid}", response_model=RoomDetail)
async def get_room(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_uuid, db)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/lead", response_model=RoomDetail)
async def lead_room(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Answer the call and take charge of the seminar."""
    room = _get_room_or_404(room_uuid, db)
    if room.status != "open":
        raise HTTPException(status_code=400, detail="This seminar already has a host")
    if current_user.uuid not in _paper_user_uuids(db, room.paper_key, public_only=True):
        raise HTTPException(
            status_code=403,
            detail="Display this paper to host",
        )
    if not any(p.user_uuid == current_user.uuid for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before answering to host"
        )
    room.leader_uuid = current_user.uuid
    room.status = "planning"
    _ensure_participant(db, room, current_user)
    others = (
        _paper_user_uuids(db, room.paper_key, public_only=False)
        | {p.user_uuid for p in room.participants}
    ) - {current_user.uuid}
    _notify(
        db, others, room,
        f"{current_user.display_name} will host the seminar on “{room.paper_title}”. "
        "Share your availability in the cohort.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/unhost", response_model=RoomDetail)
async def unhost_room(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step back from hosting a seminar still in planning. The room reopens
    and waits for another user to answer."""
    room = _get_room_or_404(room_uuid, db)
    if room.leader_uuid != current_user.uuid:
        raise HTTPException(status_code=403, detail="Only the host can step back")
    if room.status != "planning":
        raise HTTPException(
            status_code=400, detail="Only a seminar in planning can lose its host"
        )
    room.leader_uuid = None
    room.status = "open"
    others = {p.user_uuid for p in room.participants} - {current_user.uuid}
    _notify(
        db, others, room,
        f"{current_user.display_name} stepped back from hosting the seminar on "
        f"“{room.paper_title}”. A user of the paper can answer to host.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/uncall")
async def uncall_seminar(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Withdraw a call that never formed a cohort.

    Only its caller may withdraw it, and only while it is active and has no
    participant other than them. Once another user has joined, the seminar
    is shared state and must remain available to its cohort.
    """
    room = _get_room_or_404(room_uuid, db)
    if room.created_by != current_user.uuid:
        raise HTTPException(status_code=403, detail="Only the caller can uncall this seminar")
    if room.status not in ("open", "planning"):
        raise HTTPException(status_code=400, detail="Only an active seminar can be uncalled")
    if any(p.user_uuid != current_user.uuid for p in room.participants):
        raise HTTPException(
            status_code=400,
            detail="A seminar can only be uncalled when no one else is in the cohort",
        )

    # Invitations link to this room, so remove them before the room and its
    # delete-orphan cohort rows disappear.
    db.query(Notification).filter(Notification.room_uuid == room.uuid).delete()
    db.delete(room)
    db.commit()
    return {"message": "Seminar uncalled"}


@app.post("/api/rooms/{room_uuid}/join", response_model=RoomDetail)
async def join_room(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_uuid, db)
    _require_user(db, room, current_user)
    _ensure_participant(db, room, current_user)
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/leave", response_model=RoomDetail)
async def leave_room(
    room_uuid: str,
    data: RoomLeave | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leave the cohort. A host leaving an active seminar must appoint a
    cohort member to host in their place."""
    room = _get_room_or_404(room_uuid, db)
    if not any(p.user_uuid == current_user.uuid for p in room.participants):
        raise HTTPException(status_code=400, detail="You are not in this cohort")

    successor_ref = data.successor_uuid if data else None
    if room.leader_uuid == current_user.uuid and room.status != "finished":
        if successor_ref is None:
            raise HTTPException(
                status_code=400,
                detail="Appoint a cohort member to host before leaving",
            )
        successor = db.query(User).filter(User.uuid == successor_ref).first()
        successor_uuid = successor.uuid if successor else None
        if successor_uuid is None or successor_uuid == current_user.uuid or not any(
            p.user_uuid == successor_uuid for p in room.participants
        ):
            raise HTTPException(
                status_code=400, detail="Choose another cohort member"
            )
        if successor_uuid not in _paper_user_uuids(db, room.paper_key, public_only=True):
            raise HTTPException(
                status_code=400,
                detail="Display this paper to host",
            )
        room.leader_uuid = successor_uuid
        _notify(
            db, {successor_uuid}, room,
            f"{current_user.display_name} handed you hosting of the seminar on "
            f"“{room.paper_title}”.",
        )
        logger.info(
            "room %s: leadership handed from %s to %s",
            room.uuid, current_user.uuid, successor.uuid,
        )

    db.query(RoomParticipant).filter(
        RoomParticipant.room_uuid == room.uuid, RoomParticipant.user_uuid == current_user.uuid
    ).delete()
    db.query(RoomAvailability).filter(
        RoomAvailability.room_uuid == room.uuid, RoomAvailability.user_uuid == current_user.uuid
    ).delete()
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/messages", response_model=RoomDetail)
async def post_room_message(
    room_uuid: str,
    data: RoomMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_uuid, db)
    _require_user(db, room, current_user)
    if not any(p.user_uuid == current_user.uuid for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before posting a message"
        )
    db.add(RoomMessage(room_uuid=room.uuid, user_uuid=current_user.uuid, content=data.content.strip()))
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/availability", response_model=RoomDetail)
async def set_room_availability(
    room_uuid: str,
    data: AvailabilitySubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_uuid, db)
    if room.status == "scheduled":
        raise HTTPException(status_code=400, detail="This seminar has already been scheduled")
    _require_user(db, room, current_user)
    if not any(p.user_uuid == current_user.uuid for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before sharing availability"
        )
    entry = (
        db.query(RoomAvailability)
        .filter(RoomAvailability.room_uuid == room.uuid, RoomAvailability.user_uuid == current_user.uuid)
        .first()
    )
    if entry:
        entry.availability = data.availability
    else:
        db.add(RoomAvailability(room_uuid=room.uuid, user_uuid=current_user.uuid, availability=data.availability))
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.put("/api/rooms/{room_uuid}/announce", response_model=RoomDetail)
async def announce_room(
    room_uuid: str,
    data: RoomAnnounce,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Announce the seminar's time, platform, and style — or edit them
    later (host only)."""
    room = _get_room_or_404(room_uuid, db)
    if room.leader_uuid != current_user.uuid:
        raise HTTPException(status_code=403, detail="Only the host can announce")
    if room.status not in ("planning", "scheduled"):
        raise HTTPException(status_code=400, detail="This seminar is not being planned")
    editing = room.status == "scheduled"
    room.scheduled_time = data.scheduled_time
    room.platform = data.platform
    # Either a preset key from the frontend's style list, or the host's
    # own style title with its description.
    room.style = data.style.strip()
    room.style_desc = (data.style_desc or "").strip() or None
    room.status = "scheduled"
    others = (
        _paper_user_uuids(db, room.paper_key, public_only=False)
        | {p.user_uuid for p in room.participants}
    ) - {current_user.uuid}
    _notify(
        db, others, room,
        f"Seminar on “{room.paper_title}” "
        f"{'updated' if editing else 'scheduled'}: "
        f"{data.scheduled_time} · {data.platform}.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_uuid}/finish", response_model=RoomDetail)
async def finish_room(
    room_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark the seminar as held (host only)."""
    room = _get_room_or_404(room_uuid, db)
    if room.leader_uuid != current_user.uuid:
        raise HTTPException(status_code=403, detail="Only the host can finish the seminar")
    if room.status != "scheduled":
        raise HTTPException(status_code=400, detail="Schedule the seminar first")
    room.status = "finished"
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


# A name that never changes, for a file that does. Papol is reached both
# through nginx, which adds no-store, and through the Cloudflare tunnel,
# which goes straight to uvicorn and so gets whatever is set here — and a
# CDN left to its own devices caches an .svg for hours. The hashed files
# under /assets are exempt from this problem by construction; index.html and
# the build-root files are not, and they are the two that decide what the
# hashed names even are.
_REVALIDATE = {"Cache-Control": "public, max-age=0, must-revalidate"}


def _frontend_document() -> FileResponse:
    """The SPA document, or a plain answer when there is no build to serve.

    A checkout that has not been built has no index.html, and reading one
    that is not there is an unhandled error the admin sees as a 500 with a
    traceback. The API is fine in that state; it is the website that is
    missing, so say that instead."""
    index = FRONTEND_DIR / "index.html"
    if not index.is_file():
        raise HTTPException(
            status_code=503,
            detail="The Papol website has not been built; run deploy.sh to build it.",
        )
    return FileResponse(index, headers=_REVALIDATE)


@app.get("/")
async def serve_frontend():
    """Serve the frontend index.html."""
    return _frontend_document()


@app.get("/{frontend_path:path}")
async def serve_frontend_path(frontend_path: str):
    """Serve Vite root files and fall back to the SPA for clean routes.

    Registered last, so /api and mounted static trees win first. Only a real
    file directly in frontend/dist is served as a file; every other path is
    index.html for History API routing (/paper/…, /demo/…, /library, …).
    """
    candidate = (FRONTEND_DIR / frontend_path).resolve()
    if candidate.parent == FRONTEND_DIR.resolve() and candidate.is_file():
        return FileResponse(candidate, headers=_REVALIDATE)
    return _frontend_document()
