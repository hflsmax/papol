import asyncio
import os
from datetime import timedelta

from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Form, Request, BackgroundTasks
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from starlette.background import BackgroundTask
import tempfile
from functools import lru_cache
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime
from sqlalchemy import func, text
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

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from database import (
    engine, get_db, Base, migrate, normalize_papers, backfill_copy_edition_hashes,
    backfill_shelves, backfill_favourite_tags,
    backfill_board_guids, backfill_board_shelves, backfill_board_excerpts,
    normalize_board_group_kinds,
    SessionLocal,
)
from models import (
    User, AuthToken, PresencePing, Paper, Copy, Comment,
    Room, RoomParticipant, RoomMessage, RoomAvailability, Notification, ErrorLog,
    Setting, Feedback, PaperEdition, EditionReference, EditionCitation, EditionLink,
    InkStroke, PaperClip, Tag, Shelf, Board, BoardGroup, BoardItem,
)
import account
from schemas import (
    UserRegister, UserLogin, UserBase, UserPublic, UserPrivate, UserDirectoryEntry,
    AuthResponse,
    ProfileUpdate, PasswordChange, AccountDeletion, ReaderEntry,
    RoomSummary, RoomDetail, RoomMessageOut, RoomAvailabilityOut,
    RoomMessageCreate, NotificationList, NotificationOut, AdminSQL,
    PaperCreate, PaperUpdate, Paper as PaperSchema, PaperList, UserSpace,
    CommentCreate, Comment as CommentSchema, ExtractedMetadata,
    ReextractedMetadata, NookStats,
    AvailabilitySubmit, RoomAnnounce, RoomLeave,
    FeedbackCreate, FeedbackOut, FeedbackUpdate,
    PaperEditionOut, EditionAdopt,
    CommentUpdate, PointAnchor,
    EditionReferences, ReferenceOut, ReferencePreviewIn, CitationOut, DocumentLinkOut,
    ResolvedWork,
    InkStrokeCreate, InkStrokeUpdate, InkStrokeOut,
    PaperClipCreate, PaperClipUpdate, PaperClipOut, TagOut, TagCreate,
    ShelfOut, ShelfCreate, ShelfUpdate, BoardCreate, BoardUpdate,
    BoardItemCreate, BoardItemUpdate, BoardStagingCreate, BoardStagingPlace,
    BoardYouTubeCreate, BoardWebpageCreate,
    BoardItemOut, BoardOut, BoardGroupCreate, BoardGroupUpdate, BoardGroupMove,
    BoardGroupUngroup, BoardGroupLayout, BoardGroupOut,
)
from auth import (
    hash_password, verify_password, create_token, get_current_user,
    get_optional_user, bearer_scheme
)
from emailer import send_email
from pdf_parser import (
    arxiv_doi, extract_arxiv_id, extract_doi_from_pdf, get_title_from_filename,
)
import grobid
import biblio
import metadata_lookup
from reference_engine import (
    EphemeralReferenceEngine, reference_out, resolve as resolve_reference,
)
import dbmetrics

# Create database tables and apply column migrations
migrate()
Base.metadata.create_all(bind=engine)
normalize_board_group_kinds()
backfill_board_guids()
backfill_board_excerpts()

# Uploads directory
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
AVATARS_DIR = UPLOADS_DIR / "avatars"
AVATARS_DIR.mkdir(exist_ok=True)
BOARDS_DIR = Path(__file__).parent.parent / "board_uploads"
BOARDS_DIR.mkdir(exist_ok=True)


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

# Collapse pre-normalization duplicate entries into canonical papers + copies,
# and drop the duplicate PDF copies they carried.
for _stale in normalize_papers():
    _stale_path = UPLOADS_DIR / _stale
    if _stale_path.exists():
        _stale_path.unlink()
backfill_copy_edition_hashes()
backfill_shelves()
backfill_board_shelves()
backfill_favourite_tags()

# Instrument after the startup migrations so the metrics reflect request
# traffic, not one-time schema work.
dbmetrics.init(engine)

app = FastAPI(
    title="Papol - A Nook for Every Reader",
    description="A paper-reading community built to make spontaneous seminars happen.",
)


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
            message=str(exc)[:2000],
            traceback=traceback.format_exc()[:20000],
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

# Serve frontend assets
app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

# The PDF viewer is its own app with its own build; Papol serves it at
# /viewer so it shares this origin — and therefore the reader's session —
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

    @app.get("/boards/{board_guid}")
    async def serve_board(board_guid: str):
        return FileResponse(BOARD_DIR / "index.html", headers={"Cache-Control": "public, max-age=0, must-revalidate"})

    @app.get("/demo/boards/{board_guid}")
    async def serve_demo_board(board_guid: str):
        return FileResponse(BOARD_DIR / "index.html", headers={"Cache-Control": "public, max-age=0, must-revalidate"})


# The {name} placeholder is filled with the new reader's display name.
# Override via the settings table key "welcome_message".
DEFAULT_WELCOME = (
    "Welcome to Papol, {name}! Your nook is where you "
    "document your reading: upload the papers you read, rate them, "
    "keep private notes and a summary, and share a public "
    "one-sentence thought. Use the Library to find papers and see "
    "what other readers keep in their nooks, then add papers to "
    "your own. When a paper deserves a conversation, call a "
    "spontaneous seminar, and every reader of it will be invited. "
    "Each seminar is run by a host: a reader who volunteers to plan "
    "it and lead the discussion. Answer a call to host one yourself!"
)


# ---------------- Auth ----------------

@app.post("/api/auth/register", response_model=AuthResponse)
async def register(data: UserRegister, db: Session = Depends(get_db)):
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
        Shelf(user_id=user.id, name="Display", color="#7ba26c", is_public=True, is_default=True, position=0),
        Shelf(user_id=user.id, name="Personal", color="#2b4a6f", is_public=False, position=1),
        Tag(user_id=user.id, name="favourite"),
    ])
    db.commit()
    db.refresh(user)

    # Greet every new reader with a first inbox message
    template = _setting(db, "welcome_message") or DEFAULT_WELCOME
    db.add(Notification(
        user_id=user.id,
        content=template.replace("{name}", user.display_name),
    ))
    db.commit()

    token = create_token(db, user)
    return AuthResponse(token=token, user=UserPrivate.model_validate(user))


@app.post("/api/auth/login", response_model=AuthResponse)
async def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email.lower()).first()
    # A closed account keeps its row so seminars and messages still resolve,
    # but it is nobody's account any more. Its password hash could not match
    # in any case; this says so plainly rather than relying on that.
    if user is not None and user.is_deleted:
        raise HTTPException(status_code=401, detail="This account has been closed")
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(db, user)
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
    reader's nook. The email address itself is the login identifier and is fixed."""
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
_AVATAR_MAX_BYTES = 2 * 1024 * 1024


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
        raise HTTPException(status_code=400, detail="Image must be under 2 MB")

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
    """Everything Papol holds about this reader, in one zip.

    A reader who cannot leave with their notes does not really own them.
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
        # The reader's copy is theirs; the server's is scratch. Deleted once
        # the response has gone out, whether or not it got there.
        background=BackgroundTask(lambda: path.unlink(missing_ok=True)),
    )


@app.delete("/api/auth/account")
async def delete_my_account(
    data: AccountDeletion,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close the account and scrub the reader out of it.

    The row stays as a tombstone, because a seminar they started and the
    messages they left in it point at it, and those belong to the readers
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
            .filter(User.is_admin.is_(True), User.id != current_user.id)
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

    board_ids = [row[0] for row in db.query(Board.id).filter(
        Board.user_id == current_user.id
    ).all()]
    removed = account.tombstone(
        db,
        current_user,
        UPLOADS_DIR,
        # Who may take over a seminar, and how the cohort hears about it,
        # are this module's rules — the same ones leave_room applies when a
        # host hands over on their way out.
        eligible_hosts=lambda room: _reader_ids(db, room.paper_key, public_only=True),
        notify=lambda room, user_ids, content: _notify(db, user_ids, room, content),
    )
    for board_id in board_ids:
        directory = BOARDS_DIR / str(board_id)
        if directory.is_dir():
            shutil.rmtree(directory)
    return {"message": "Your account has been closed.", "removed": removed}


# ---------------- Boards ----------------

BOARD_FILE_LIMIT = 25 * 1024 * 1024


def _owned_board(board_guid: str, user: User, db: Session) -> Board:
    board = db.query(Board).filter(
        Board.guid == board_guid, Board.user_id == user.id
    ).first()
    if not board:
        # Do not reveal whether another reader's private board exists.
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
        id=board.id,
        guid=board.guid,
        user_id=board.user_id,
        owner=board.owner,
        shelf_id=board.shelf_id,
        can_edit=can_edit,
        name=board.name,
        description=board.description,
        created_at=board.created_at,
        updated_at=board.updated_at,
        item_count=len(active_items),
        items=(active_items if include_items else []),
        staged_items=(staged_items if include_items and can_edit else []),
        groups=([BoardGroupOut(
            id=group.id, kind=group.kind, title=group.title, header=group.header or "",
            auto_arrange=group.auto_arrange,
            item_ids=[item.id for item in group.items if item.deleted_at is None],
        ) for group in board.groups] if include_items else []),
    )


@app.get("/api/boards", response_model=list[BoardOut])
async def list_boards(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    boards = db.query(Board).filter(Board.user_id == user.id).order_by(
        Board.updated_at.desc(), Board.id.desc()
    ).all()
    return [_board_out(board, can_edit=True) for board in boards]


@app.get("/api/library/boards", response_model=list[BoardOut])
async def list_library_boards(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Boards whose shelves are public, for the shared Library."""
    boards = db.query(Board).join(Shelf, Board.shelf_id == Shelf.id).filter(
        Shelf.is_public.is_(True)
    ).order_by(Board.updated_at.desc(), Board.id.desc()).all()
    return [
        _board_out(board, can_edit=board.user_id == current_user.id)
        for board in boards
    ]


@app.post("/api/boards", response_model=BoardOut)
async def create_board(
    data: BoardCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = db.query(Shelf).filter(Shelf.id == data.shelf_id, Shelf.user_id == user.id).first() if data.shelf_id else _default_shelf(user)
    if not shelf:
        raise HTTPException(status_code=400, detail="Choose one of your shelves")
    board = Board(
        user_id=user.id,
        shelf_id=shelf.id,
        name=data.name.strip(),
        description=data.description.strip() if data.description else None,
    )
    db.add(board)
    db.commit()
    db.refresh(board)
    return _board_out(board, can_edit=True)


@app.get("/api/boards/{board_guid}", response_model=BoardOut)
async def get_board(
    board_guid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = db.query(Board).filter(Board.guid == board_guid).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    can_edit = board.user_id == user.id
    if not can_edit and (not board.shelf or not board.shelf.is_public):
        raise HTTPException(status_code=404, detail="Board not found")
    return _board_out(board, include_items=True, can_edit=can_edit)


@app.put("/api/boards/{board_guid}", response_model=BoardOut)
async def update_board(
    board_guid: str,
    data: BoardUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    if data.name is not None:
        board.name = data.name.strip()
    if data.description is not None:
        board.description = data.description.strip() or None
    if data.shelf_id is not None:
        shelf = db.query(Shelf).filter(Shelf.id == data.shelf_id, Shelf.user_id == user.id).first()
        if not shelf:
            raise HTTPException(status_code=400, detail="Choose one of your shelves")
        board.shelf_id = shelf.id
    board.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(board)
    return _board_out(board, include_items=True, can_edit=True)


@app.delete("/api/boards/{board_guid}", status_code=204)
async def delete_board(
    board_guid: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    directory = BOARDS_DIR / str(board.id)
    db.delete(board)
    db.commit()
    if directory.is_dir():
        shutil.rmtree(directory)


@app.post("/api/boards/{board_guid}/comments", response_model=BoardItemOut)
async def add_board_comment(
    board_guid: str,
    data: BoardItemCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    count = len(board.items)
    item = BoardItem(
        board_id=board.id, kind="comment", content=data.content.strip(),
        x=data.x if data.x is not None else (count % 4) * 340,
        y=data.y if data.y is not None else (count // 4) * 260,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/boards/{board_guid}/staging", response_model=BoardItemOut)
async def stage_board_excerpt(
    board_guid: str,
    data: BoardStagingCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a quoted passage to an owned board without placing it yet."""
    board = _owned_board(board_guid, user, db)
    item = BoardItem(
        board_id=board.id,
        kind="excerpt",
        excerpt_text=data.excerpt_text.strip(),
        content=data.content.strip() if data.content and data.content.strip() else None,
        source_url=data.source_url.strip(),
        source_label=data.source_label.strip(),
        staged=True,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/boards/{board_guid}/staging/clip", response_model=BoardItemOut)
async def stage_board_clip(
    board_guid: str,
    file: UploadFile = File(...),
    caption: str = Form(default=""),
    source_url: str = Form(...),
    source_label: str = Form(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stage a clipped PDF rectangle as an image, with its bounding-box backlink."""
    board = _owned_board(board_guid, user, db)
    if len(caption) > 10000 or len(source_url) > 4000 or len(source_label) > 500:
        raise HTTPException(status_code=422, detail="Clip metadata is too long")
    if not source_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Invalid source URL")
    relative = Path(str(board.id)) / f"{uuid.uuid4().hex}.png"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > BOARD_FILE_LIMIT:
                    raise HTTPException(status_code=413, detail="Board files may be at most 25 MB")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    item = BoardItem(
        board_id=board.id,
        kind="image",
        content=caption.strip() or None,
        file_path=str(relative),
        original_filename="paper-clip.png",
        mime_type="image/png",
        source_url=source_url.strip(),
        source_label=source_label.strip(),
        staged=True,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/board-items/{item_id}/place", response_model=BoardItemOut)
async def place_staged_board_item(
    item_id: int,
    data: BoardStagingPlace,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).join(Board).filter(
        BoardItem.id == item_id,
        Board.user_id == user.id,
        BoardItem.deleted_at.is_(None),
        BoardItem.staged.is_(True),
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Staged item not found")
    item.x = data.x
    item.y = data.y
    item.staged = False
    item.board.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/boards/{board_guid}/files", response_model=BoardItemOut)
async def add_board_file(
    board_guid: str,
    file: UploadFile = File(...),
    caption: str = Form(default=""),
    x: float | None = Form(default=None),
    y: float | None = Form(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    if len(caption) > 10000:
        raise HTTPException(status_code=422, detail="Caption is too long")
    original = Path(file.filename or "file").name[:255]
    suffix = Path(original).suffix[:20]
    relative = Path(str(board.id)) / f"{uuid.uuid4().hex}{suffix}"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > BOARD_FILE_LIMIT:
                    raise HTTPException(status_code=413, detail="Board files may be at most 25 MB")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    mime = (file.content_type or "application/octet-stream")[:255]
    item = BoardItem(
        board_id=board.id,
        kind="image" if mime.startswith("image/") else "file",
        content=caption.strip() or None,
        file_path=str(relative),
        original_filename=original,
        mime_type=mime,
        x=x if x is not None else (len(board.items) % 4) * 340,
        y=y if y is not None else (len(board.items) // 4) * 260,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
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
    with urllib.request.urlopen(request, timeout=8) as response:
        metadata = json.loads(response.read(256 * 1024))
    thumbnail = str(metadata.get("thumbnail_url") or "")
    host = (urllib.parse.urlparse(thumbnail).hostname or "").lower()
    if host != "i.ytimg.com" and not host.endswith(".ytimg.com"):
        raise ValueError("YouTube returned an invalid thumbnail location")
    image_request = urllib.request.Request(thumbnail, headers={"User-Agent": "Papol/1.0"})
    with urllib.request.urlopen(image_request, timeout=10) as response:
        image = response.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("YouTube thumbnail is empty or too large")
    return image, str(metadata.get("title") or url)[:10000]


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
            "--max-filesize", "200M",
            "--write-info-json",
            "-f", "bestvideo[height<=1080]/bestvideo/best[height<=1080]/best",
            "-o", template,
            url,
        ]
        download_process = subprocess.run(
            download_command,
            capture_output=True,
            text=True,
            timeout=90,
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
                timeout=30,
                check=False,
            )
            if frame_process.returncode != 0:
                raise ValueError(frame_process.stderr.strip() or "Video frame could not be decoded")
            image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("Captured frame is empty or too large")
    return image, str(metadata.get("title") or url)[:10000]


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
            timeout=30,
            check=False,
        )
        if process.returncode != 0:
            raise ValueError(process.stderr.strip() or "The website could not be rendered")
        output.seek(0)
        image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("The website screenshot is empty or too large")
    return image


@app.post("/api/boards/{board_guid}/youtube", response_model=BoardItemOut)
async def add_youtube_to_board(
    board_guid: str,
    data: BoardYouTubeCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
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
    relative = Path(str(board.id)) / f"{uuid.uuid4().hex}{suffix}"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(image)
    item = BoardItem(
        board_id=board.id,
        kind="youtube",
        content=title,
        file_path=str(relative),
        original_filename=f"youtube-{video_id}{suffix}",
        mime_type=mime,
        source_url=data.url.strip(),
        x=data.x,
        y=data.y,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/boards/{board_guid}/webpage", response_model=BoardItemOut)
async def add_webpage_to_board(
    board_guid: str,
    data: BoardWebpageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    try:
        url = _public_web_url(data.url)
        image = await asyncio.to_thread(_capture_webpage, url)
    except Exception as exc:
        logger.warning("Could not capture webpage %s: %s", data.url, exc)
        raise HTTPException(status_code=502, detail=f"Could not capture the webpage: {exc}")
    relative = Path(str(board.id)) / f"{uuid.uuid4().hex}.png"
    destination = BOARDS_DIR / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(image)
    hostname = urllib.parse.urlparse(url).hostname or url
    item = BoardItem(
        board_id=board.id,
        kind="webpage",
        content=hostname,
        file_path=str(relative),
        original_filename=f"webpage-{hostname[:80]}.png",
        mime_type="image/png",
        source_url=url,
        x=data.x,
        y=data.y,
        width=480,
    )
    board.updated_at = datetime.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/api/board-items/{item_id}", status_code=204)
async def delete_board_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item or item.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board item not found")
    item.board.updated_at = datetime.utcnow()
    item.deleted_at = datetime.utcnow()
    db.commit()


@app.post("/api/board-items/{item_id}/restore", response_model=BoardItemOut)
async def restore_board_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item or item.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board item not found")
    item.deleted_at = None
    item.board.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    return item


@app.put("/api/board-items/{item_id}", response_model=BoardItemOut)
async def move_board_item(
    item_id: int,
    data: BoardItemUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item or item.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board item not found")
    if "group_id" in data.model_fields_set:
        if data.group_id is None:
            item.group_id = None
        else:
            group = db.query(BoardGroup).filter(
                BoardGroup.id == data.group_id,
                BoardGroup.board_id == item.board_id,
            ).first()
            if not group:
                raise HTTPException(status_code=400, detail="Booklet not found on this board")
            item.group_id = group.id
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
    db.commit()
    db.refresh(item)
    return item


@app.post("/api/boards/{board_guid}/groups", response_model=BoardGroupOut)
async def create_board_group(
    board_guid: str,
    data: BoardGroupCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = _owned_board(board_guid, user, db)
    item_ids = list(dict.fromkeys(data.item_ids))
    if len(item_ids) < 2:
        raise HTTPException(status_code=400, detail="Select at least two items")
    items = db.query(BoardItem).filter(
        BoardItem.board_id == board.id,
        BoardItem.id.in_(item_ids),
        BoardItem.deleted_at.is_(None),
    ).all()
    if len(items) != len(item_ids):
        raise HTTPException(status_code=400, detail="Some selected items are unavailable")
    group = BoardGroup(
        board_id=board.id, kind=data.kind, title=data.title.strip(),
        header=data.header.strip() or None,
        auto_arrange=data.auto_arrange if data.kind == "collection" else False,
    )
    db.add(group)
    db.flush()
    anchor_x = min(item.x for item in items)
    for item in items:
        item.group_id = group.id
        if data.kind == "booklet":
            item.x = anchor_x
    board.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    return BoardGroupOut(id=group.id, kind=group.kind, title=group.title, header=group.header or "", auto_arrange=group.auto_arrange, item_ids=item_ids)


@app.put("/api/board-groups/{group_id}/move", response_model=list[BoardItemOut])
async def move_board_group(
    group_id: int,
    data: BoardGroupMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.id == group_id).first()
    if not group or group.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board group not found")
    active_items = [item for item in group.items if item.deleted_at is None]
    for item in active_items:
        item.x += data.dx
        item.y += data.dy
    group.board.updated_at = datetime.utcnow()
    db.commit()
    for item in active_items:
        db.refresh(item)
    return active_items


@app.put("/api/board-groups/{group_id}", response_model=BoardGroupOut)
async def update_board_group(
    group_id: int,
    data: BoardGroupUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.id == group_id).first()
    if not group or group.board.user_id != user.id:
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
    db.commit()
    db.refresh(group)
    return BoardGroupOut(
        id=group.id, kind=group.kind, title=group.title, header=group.header or "",
        auto_arrange=group.auto_arrange,
        item_ids=[item.id for item in group.items if item.deleted_at is None],
    )


@app.post("/api/board-groups/{group_id}/ungroup", status_code=204)
async def ungroup_board_group(
    group_id: int,
    data: BoardGroupUngroup,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.id == group_id).first()
    if not group or group.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board group not found")
    current_ids = {item.id for item in group.items if item.deleted_at is None}
    restore_ids = {entry.id for entry in data.items}
    if current_ids != restore_ids:
        raise HTTPException(status_code=400, detail="Group membership changed")
    target_ids = {entry.group_id for entry in data.items if entry.group_id is not None}
    if target_ids:
        valid_targets = db.query(BoardGroup.id).filter(
            BoardGroup.board_id == group.board_id, BoardGroup.id.in_(target_ids)
        ).count()
        if valid_targets != len(target_ids):
                raise HTTPException(status_code=400, detail="A previous group no longer exists")
    items = {item.id: item for item in group.items}
    board = group.board
    db.delete(group)
    db.flush()
    for entry in data.items:
        item = items[entry.id]
        item.group_id = entry.group_id
        item.x = entry.x
        item.y = entry.y
    board.updated_at = datetime.utcnow()
    db.commit()


@app.put("/api/board-groups/{group_id}/layout", response_model=list[BoardItemOut])
async def layout_board_group(
    group_id: int,
    data: BoardGroupLayout,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(BoardGroup).filter(BoardGroup.id == group_id).first()
    if not group or group.board.user_id != user.id:
        raise HTTPException(status_code=404, detail="Board group not found")
    active_items = {item.id: item for item in group.items if item.deleted_at is None}
    if set(active_items) != {entry.id for entry in data.items}:
        raise HTTPException(status_code=400, detail="Group membership changed")
    for entry in data.items:
        item = active_items[entry.id]
        item.x = entry.x
        item.y = entry.y
    group.board.updated_at = datetime.utcnow()
    db.commit()
    result = list(active_items.values())
    for item in result:
        db.refresh(item)
    return result


@app.get("/api/board-items/{item_id}/file")
async def get_board_item_file(
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(BoardItem).filter(BoardItem.id == item_id).first()
    if not item or not item.file_path:
        raise HTTPException(status_code=404, detail="Board file not found")
    can_view = item.board.user_id == user.id or bool(item.board.shelf and item.board.shelf.is_public)
    if not can_view:
        raise HTTPException(status_code=404, detail="Board file not found")
    stored = BOARDS_DIR / item.file_path
    if not stored.is_file():
        raise HTTPException(status_code=404, detail="Board file not found")
    return FileResponse(
        stored,
        media_type=item.mime_type or "application/octet-stream",
        filename=item.original_filename,
    )


# ---------------- Users / spaces ----------------


@app.get("/api/users", response_model=list[UserDirectoryEntry])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Readers directory. Signed-in readers only."""
    users = (
        db.query(User)
        .filter(User.deleted_at.is_(None))
        .order_by(User.display_name)
        .all()
    )
    return [
        UserDirectoryEntry(
            id=u.id,
            display_name=u.display_name,
            affiliation=u.affiliation,
            avatar_path=u.avatar_path,
            paper_count=sum(1 for r in u.copies if r.marketed),
        )
        for u in users
    ]


def _room_status_map(db: Session) -> dict:
    """paper_key -> status of its latest room."""
    status_map = {}
    for room in db.query(Room).order_by(Room.created_at, Room.id).all():
        status_map[room.paper_key] = room.status
    return status_map


def _shelf_out(shelf: Shelf) -> ShelfOut:
    return ShelfOut(
        id=shelf.id, name=shelf.name, color=shelf.color,
        is_public=bool(shelf.is_public), is_default=bool(shelf.is_default),
        position=shelf.position, paper_count=len(shelf.copies), board_count=len(shelf.boards),
    )


def _default_shelf(user: User) -> Shelf:
    shelf = next((s for s in user.shelves if s.is_default), None)
    return shelf or user.shelves[0]


def _reader_entry(user_copy: Copy) -> ReaderEntry:
    return ReaderEntry(
        paper_id=user_copy.paper_id,
        user=UserPublic.model_validate(user_copy.user),
        is_author=bool(user_copy.is_author),
        thought=user_copy.thought,
        rating_expertise=user_copy.rating_expertise,
        rating_reading=user_copy.rating_reading,
        rating_liking=user_copy.rating_liking,
    )


def _latest_edition(paper: Paper) -> PaperEdition | None:
    return paper.editions[-1] if paper.editions else None


def _edition_for(paper: Paper, user_copy: Copy | None) -> PaperEdition | None:
    """The edition a viewer opens: the one their copy is pinned to, or the
    latest when they have no copy (or a copy from before editions)."""
    if user_copy is not None:
        if user_copy.edition_sha256:
            selected = next(
                (edition for edition in paper.editions if edition.sha256 == user_copy.edition_sha256),
                None,
            )
            if selected is not None:
                return selected
        if user_copy.edition is not None:
            return user_copy.edition
    return _latest_edition(paper)


def _edition_file(paper: Paper, user_copy: Copy | None) -> str:
    edition = _edition_for(paper, user_copy)
    return edition.file_path if edition else ""


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


def _edition_with(paper: Paper, digest: str) -> PaperEdition | None:
    """An existing edition holding exactly these bytes, if there is one."""
    return next((e for e in paper.editions if e.sha256 == digest), None)


def _register_edition(
    db: Session, paper: Paper, filename: str, digest: str, user: User
) -> PaperEdition:
    edition = PaperEdition(
        paper_id=paper.id,
        file_path=filename,
        sha256=digest,
        uploaded_by=user.id,
    )
    db.add(edition)
    db.flush()
    return edition


def _add_edition(db: Session, paper: Paper, filename: str, user: User) -> PaperEdition:
    """Register an already-written upload as an edition, or hand back the
    edition that already holds those exact bytes. The redundant file is
    left where it is: Papol never unlinks anything."""
    digest = _sha256_of(UPLOADS_DIR / filename)
    return _edition_with(paper, digest) or _register_edition(
        db, paper, filename, digest, user
    )


def _displayed_copies(paper: Paper) -> list[Copy]:
    return [r for r in paper.copies if r.marketed]


def _paper_list_entry(
    paper: Paper, user_copy: Copy | None, hide_private: bool, room_map: dict
) -> PaperList:
    """One list row: the canonical paper, plus the personal fields of the
    given user_copy (a nook's own entry), plus every displayed copy."""
    entry = PaperList(
        id=paper.id,
        doi=paper.doi,
        title=paper.title,
        authors=paper.authors,
        journal=paper.journal,
        year=paper.year,
        file_path=_edition_file(paper, user_copy),
        created_at=user_copy.created_at if user_copy else paper.created_at,
    )
    selected_edition = _edition_for(paper, user_copy)
    entry.edition_id = selected_edition.id if selected_edition else None
    entry.edition_sha256 = selected_edition.sha256 if selected_edition else None
    if user_copy:
        entry.shelf_id = user_copy.shelf_id
        entry.summary = None if hide_private else user_copy.summary
        entry.thought = user_copy.thought
        entry.marketed = user_copy.marketed
        entry.is_author = bool(user_copy.is_author)
        entry.rating_expertise = user_copy.rating_expertise
        entry.rating_reading = user_copy.rating_reading
        entry.rating_liking = user_copy.rating_liking
        if not hide_private:
            entry.tags = [TagOut.model_validate(t) for t in sorted(user_copy.tags, key=lambda t: t.name.lower())]
    entry.room_status = room_map.get(_paper_key_for(paper))
    entry.readers = [_reader_entry(r) for r in _displayed_copies(paper)]
    return entry


@app.get("/api/users/{user_id}/space", response_model=UserSpace)
async def get_user_space(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A reader's nook. Signed-in readers only; summaries stay host-only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # A tombstone has no nook — the copies went with the account. Saying so
    # is better than showing an empty shelf under "A former reader".
    if user.is_deleted:
        raise HTTPException(status_code=404, detail="This reader has left Papol")
    hide_private = current_user is None or current_user.id != user_id
    query = db.query(Copy).filter(Copy.user_id == user_id)
    if hide_private:
        query = query.filter(Copy.marketed.is_(True))
    copies = query.order_by(Copy.created_at.desc()).all()
    board_query = db.query(Board).filter(Board.user_id == user_id)
    if hide_private:
        board_query = board_query.join(Shelf).filter(Shelf.is_public.is_(True))
    boards = board_query.order_by(Board.updated_at.desc(), Board.id.desc()).all()
    room_map = _room_status_map(db)
    stats = None
    if not hide_private:
        stats = NookStats(
            papers=len(copies),
            displayed=sum(1 for c in copies if c.marketed),
            notes=db.query(Comment).filter(Comment.user_id == user_id).count(),
            seminars=db.query(RoomParticipant)
            .filter(RoomParticipant.user_id == user_id)
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
            if not hide_private or s.is_public
        ],
    )


# ---------------- Papers ----------------

@app.get("/api/papers", response_model=list[PaperList])
async def list_all_papers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every paper displayed in at least one nook, newest first.
    Signed-in readers only. One row per canonical paper."""
    papers = db.query(Paper).order_by(Paper.created_at.desc()).all()
    room_map = _room_status_map(db)
    return [
        _paper_list_entry(p, user_copy=None, hide_private=True, room_map=room_map)
        for p in papers
        if _displayed_copies(p)
    ]


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
        metadata["doi"] = lookup_doi
    return ExtractedMetadata(**metadata)


def _paper_key_for(paper: Paper) -> str:
    """Canonical identity of a paper: its DOI, falling back to its title."""
    if paper.doi:
        return "doi:" + paper.doi.strip().lower()
    return "title:" + paper.title.strip().lower()


def _papers_for_key(db: Session, key: str) -> list[Paper]:
    return [p for p in db.query(Paper).all() if _paper_key_for(p) == key]


def _reader_ids(db: Session, key: str, public_only: bool = True) -> set[int]:
    return {
        r.user_id
        for p in _papers_for_key(db, key)
        for r in p.copies
        if r.marketed or not public_only
    }


def _in_active_cohort(db: Session, user: User, key: str) -> bool:
    """True if the user is in the cohort of a still-active seminar (anything
    but finished) on this paper."""
    rooms = (
        db.query(Room)
        .filter(Room.paper_key == key, Room.status != "finished")
        .all()
    )
    return any(
        p.user_id == user.id for room in rooms for p in room.participants
    )


def _notify(db: Session, user_ids, room: Room, content: str):
    for uid in user_ids:
        db.add(Notification(user_id=uid, room_id=room.id, content=content))


def _room_summary(room: Room) -> RoomSummary:
    return RoomSummary(
        id=room.id,
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


def _comment_out(c: Comment) -> CommentSchema:
    """A note on the wire. The anchor is stored as JSON text and its kind in
    its own column; together they become the typed anchor the reader's apps
    understand."""
    anchor = None
    if c.anchor and c.anchor_type:
        payload = json.loads(c.anchor)
        payload["type"] = c.anchor_type
        anchor = PointAnchor(**payload)
    return CommentSchema(
        id=c.id,
        paper_id=c.paper_id,
        content=c.content,
        created_at=c.created_at,
        user=UserPublic.model_validate(c.user) if c.user else None,
        page=c.page,
        anchor_type=c.anchor_type,
        anchor=anchor,
        edition_id=c.edition_id,
        name=c.name,
    )


def _copy_of(paper: Paper, viewer: User | None) -> Copy | None:
    if viewer is None:
        return None
    return next((r for r in paper.copies if r.user_id == viewer.id), None)


def _paper_detail(
    db: Session,
    paper: Paper,
    viewer: User | None,
    edition_override: PaperEdition | None = None,
) -> PaperSchema:
    """The canonical paper, merged with the viewer's own copy (summary,
    ratings, display, private notes) when they have one."""
    user_copy = _copy_of(paper, viewer)
    detail = PaperSchema(
        id=paper.id,
        doi=paper.doi,
        title=paper.title,
        authors=paper.authors,
        journal=paper.journal,
        year=paper.year,
        file_path=(edition_override.file_path if edition_override else _edition_file(paper, user_copy)),
        created_at=paper.created_at,
    )
    detail.editions = [PaperEditionOut.model_validate(e) for e in paper.editions]
    latest = _latest_edition(paper)
    detail.latest_edition = (
        PaperEditionOut.model_validate(latest) if latest else None
    )
    selected_edition = edition_override or _edition_for(paper, user_copy)
    detail.edition_id = selected_edition.id if selected_edition else None
    detail.edition_sha256 = selected_edition.sha256 if selected_edition else None
    detail.ignored_edition_id = user_copy.ignored_edition_id if user_copy else None
    if user_copy:
        detail.shelf_id = user_copy.shelf_id
        detail.summary = user_copy.summary
        detail.thought = user_copy.thought
        detail.marketed = user_copy.marketed
        detail.is_author = bool(user_copy.is_author)
        detail.rating_expertise = user_copy.rating_expertise
        detail.rating_reading = user_copy.rating_reading
        detail.rating_liking = user_copy.rating_liking
        detail.tags = [TagOut.model_validate(t) for t in sorted(user_copy.tags, key=lambda t: t.name.lower())]
        detail.comments = [
            _comment_out(c)
            for c in sorted(paper.comments, key=lambda c: (c.created_at, c.id))
            if c.user_id == viewer.id
        ]
    detail.also_read_by = [_reader_entry(r) for r in _displayed_copies(paper)]

    detail.rooms = [
        _room_summary(r)
        for r in db.query(Room)
        .filter(Room.paper_key == _paper_key_for(paper))
        .order_by(Room.created_at.desc(), Room.id.desc())
        .all()
    ]
    detail.viewer_is_reader = user_copy is not None and user_copy.marketed
    detail.viewer_has_entry = user_copy is not None
    return detail


def _get_paper_or_404(paper_id: int, db: Session) -> Paper:
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _resolve_paper_or_404(ref: str, db: Session) -> Paper:
    """Look a paper up by numeric id or by DOI."""
    if ref.isdigit():
        return _get_paper_or_404(int(ref), db)
    paper = next(iter(_papers_for_key(db, "doi:" + ref.strip().lower())), None)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper


def _require_visible(paper: Paper, viewer: User | None):
    """A paper is visible if anyone displays it, or the viewer has an entry."""
    if _displayed_copies(paper) or _copy_of(paper, viewer) is not None:
        return
    raise HTTPException(status_code=404, detail="Paper not found")


def _require_copy(paper: Paper, user: User) -> Copy:
    user_copy = _copy_of(paper, user)
    if user_copy is None:
        raise HTTPException(
            status_code=403, detail="Add this paper to your nook first"
        )
    return user_copy


@app.post("/api/papers", response_model=PaperSchema)
async def create_paper(
    paper: PaperCreate,
    background: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Save a paper with user-edited metadata and optional initial comment.
    If the paper already exists (matched by DOI, or title), the upload
    becomes a new copy of the existing canonical paper.
    """
    # Verify the file exists
    file_path = UPLOADS_DIR / paper.file_path
    if not file_path.exists():
        raise HTTPException(status_code=400, detail="PDF file not found")

    key = (
        "doi:" + paper.doi.strip().lower()
        if paper.doi
        else "title:" + paper.title.strip().lower()
    )
    db_paper = next(iter(_papers_for_key(db, key)), None)

    if db_paper is None:
        db_paper = Paper(
            doi=paper.doi,
            title=paper.title,
            authors=paper.authors,
            journal=paper.journal,
            year=paper.year,
        )
        db.add(db_paper)
        db.flush()
    else:
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

    # The file they uploaded is the file they read: an edition of their
    # own, unless it is byte-identical to one the paper already has.
    edition = _add_edition(db, db_paper, paper.file_path, current_user)

    tag_ids = set(paper.tag_ids)
    tags = db.query(Tag).filter(
        Tag.user_id == current_user.id, Tag.id.in_(tag_ids)
    ).all() if tag_ids else []
    if len(tags) != len(tag_ids):
        raise HTTPException(status_code=400, detail="One or more tags do not belong to you")

    shelf = (
        db.query(Shelf).filter(Shelf.id == paper.shelf_id, Shelf.user_id == current_user.id).first()
        if paper.shelf_id is not None else _default_shelf(current_user)
    )
    if shelf is None:
        raise HTTPException(status_code=400, detail="Shelf does not belong to you")
    user_copy = Copy(
        paper_id=db_paper.id,
        user_id=current_user.id,
        edition_id=edition.id,
        edition_sha256=edition.sha256,
        summary=paper.summary,
        thought=paper.thought,
        marketed=bool(shelf.is_public),
        shelf_id=shelf.id,
        is_author=paper.is_author,
        rating_expertise=paper.rating_expertise,
        rating_reading=paper.rating_reading,
        rating_liking=paper.rating_liking,
    )
    user_copy.tags = tags
    db.add(user_copy)

    if paper.initial_comment and paper.initial_comment.strip():
        db.add(Comment(
            paper_id=db_paper.id,
            user_id=current_user.id,
            content=paper.initial_comment.strip(),
        ))

    # Full-document analysis is independent of the reviewed metadata and can
    # take seconds. Mark it pending in the same commit as the edition, then run
    # it after the response using its own database session.
    queue_analysis = _may_start_analysis(edition)
    if queue_analysis:
        edition.references_status = "pending"
        edition.references_error = None
        edition.references_at = datetime.utcnow()
    db.commit()
    db.refresh(db_paper)
    if queue_analysis:
        _analyzing.add(edition.id)
        background.add_task(_analyze_edition, edition.id)
    return _paper_detail(db, db_paper, current_user)


@app.get("/api/papers/{paper_ref:path}", response_model=PaperSchema)
async def get_paper(
    paper_ref: str,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Get a paper by id or DOI, merged with the viewer's own copy and notes.
    Publicly displayed papers may be opened from a shared canonical URL;
    signed-in readers additionally receive their own nook fields and notes."""
    paper = _resolve_paper_or_404(paper_ref, db)
    _require_visible(paper, current_user)
    return _paper_detail(db, paper, current_user)


@app.post(
    "/api/papers/{paper_ref:path}/extract-metadata",
    response_model=ReextractedMetadata,
)
async def reextract_paper_metadata(
    paper_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-read a paper's selected PDF metadata for the edit form."""
    paper = _resolve_paper_or_404(paper_ref, db)
    _require_visible(paper, current_user)
    edition = _edition_for(paper, _copy_of(paper, current_user)) or _latest_edition(paper)
    path = _edition_pdf_path(edition) if edition else None
    if path is None:
        raise HTTPException(status_code=404, detail="PDF for this paper is missing")

    doi, text = extract_doi_from_pdf(str(path))
    arxiv_id = extract_arxiv_id(text)
    lookup_doi = paper.doi or (arxiv_doi(arxiv_id) if arxiv_id else doi)
    if not lookup_doi:
        raise HTTPException(status_code=422, detail="No DOI or arXiv identifier found")
    try:
        api_metadata = await metadata_lookup.by_doi(lookup_doi)
    except metadata_lookup.Unavailable as exc:
        logger.exception("Bibliographic metadata APIs are unavailable")
        raise HTTPException(
            status_code=503,
            detail="Metadata lookup failed",
        ) from exc
    if not api_metadata:
        raise HTTPException(status_code=404, detail="Metadata was not found")
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


@app.get("/api/viewer/{pdf_sha256}", response_model=PaperSchema)
async def get_viewer_paper(
    pdf_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve the exact PDF edition named by a viewer URL."""
    edition = _viewer_edition_or_404(pdf_sha256, current_user, db)
    return _paper_detail(db, edition.paper, current_user, edition_override=edition)


@app.get("/api/viewer/{pdf_sha256}/info", response_model=ResolvedWork)
async def get_viewer_paper_info(
    pdf_sha256: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enriched bibliographic information for the paper being viewed."""
    edition = _viewer_edition_or_404(pdf_sha256, current_user, db)
    paper = edition.paper
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


def _viewer_edition_or_404(
    pdf_sha256: str,
    current_user: User | None,
    db: Session,
) -> PaperEdition:
    digest = pdf_sha256.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise HTTPException(status_code=404, detail="PDF not found")
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    editions = db.query(PaperEdition).filter(PaperEdition.sha256 == digest).all()
    if not editions:
        raise HTTPException(status_code=404, detail="PDF not found")
    edition = next(
        (candidate for candidate in editions if _copy_of(candidate.paper, current_user)),
        None,
    )
    if edition is None:
        raise HTTPException(status_code=403, detail="Add this paper to your nook first")
    return edition


_METADATA_FIELDS = {"title", "authors", "journal", "year", "doi"}
_PERSONAL_FIELDS = {"summary", "thought", "rating_expertise", "rating_reading", "rating_liking", "marketed", "is_author"}


@app.put("/api/papers/{paper_id}", response_model=PaperSchema)
async def update_paper(
    paper_id: int,
    paper_update: PaperUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a paper.

    Personal fields (summary, ratings, display) apply to the viewer's own
    user_copy. Metadata (title/authors/journal/year/DOI) lives on the one
    canonical paper: any signed-in reader may edit it, for everyone.
    """
    paper = _get_paper_or_404(paper_id, db)
    _require_visible(paper, current_user)

    update_data = paper_update.model_dump(exclude_unset=True)
    tag_ids = update_data.pop("tag_ids", None)
    shelf_id = update_data.pop("shelf_id", None)
    personal = {k: v for k, v in update_data.items() if k in _PERSONAL_FIELDS}
    metadata = {k: v for k, v in update_data.items() if k in _METADATA_FIELDS}

    if personal:
        user_copy = _require_copy(paper, current_user)
        requested_visibility = personal.pop("marketed", None)
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
            user_copy.marketed = bool(target_shelf.is_public)
        for key, value in personal.items():
            setattr(user_copy, key, value)

    if tag_ids is not None:
        user_copy = _require_copy(paper, current_user)
        unique_ids = set(tag_ids)
        tags = db.query(Tag).filter(Tag.user_id == current_user.id, Tag.id.in_(unique_ids)).all() if unique_ids else []
        if len(tags) != len(unique_ids):
            raise HTTPException(status_code=400, detail="One or more tags do not belong to you")
        user_copy.tags = tags

    if shelf_id is not None:
        user_copy = _require_copy(paper, current_user)
        shelf = db.query(Shelf).filter(Shelf.id == shelf_id, Shelf.user_id == current_user.id).first()
        if not shelf:
            raise HTTPException(status_code=400, detail="Shelf does not belong to you")
        if not shelf.is_public and user_copy.marketed and _in_active_cohort(
            db, current_user, _paper_key_for(paper)
        ):
            raise HTTPException(status_code=400, detail="Leave the seminar before moving this paper to a private shelf")
        user_copy.shelf = shelf
        user_copy.marketed = bool(shelf.is_public)

    for key, value in metadata.items():
        setattr(paper, key, value)

    db.commit()
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
        Tag.user_id == current_user.id, func.lower(Tag.name) == name.lower()
    ).first()
    if existing:
        return existing
    tag = Tag(user_id=current_user.id, name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@app.get("/api/tags", response_model=list[TagOut])
async def list_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return db.query(Tag).filter(Tag.user_id == current_user.id).order_by(func.lower(Tag.name)).all()


@app.delete("/api/tags/{tag_id}", status_code=204)
async def delete_tag(
    tag_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == current_user.id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    tag.copies.clear()
    db.delete(tag)
    db.commit()


@app.get("/api/shelves", response_model=list[ShelfOut])
async def list_shelves(
    current_user: User = Depends(get_current_user),
):
    return [_shelf_out(s) for s in current_user.shelves]


@app.post("/api/shelves", response_model=ShelfOut)
async def create_shelf(
    data: ShelfCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(current_user.shelves) >= 5:
        raise HTTPException(status_code=400, detail="A nook can have at most five shelves")
    name = " ".join(data.name.split())
    if any(s.name.lower() == name.lower() for s in current_user.shelves):
        raise HTTPException(status_code=400, detail="You already have a shelf with that name")
    shelf = Shelf(
        user_id=current_user.id, name=name, color=data.color.lower(),
        is_public=data.is_public, position=len(current_user.shelves),
    )
    db.add(shelf)
    db.commit()
    db.refresh(shelf)
    return _shelf_out(shelf)


@app.put("/api/shelves/{shelf_id}", response_model=ShelfOut)
async def update_shelf(
    shelf_id: int,
    data: ShelfUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = db.query(Shelf).filter(Shelf.id == shelf_id, Shelf.user_id == current_user.id).first()
    if not shelf:
        raise HTTPException(status_code=404, detail="Shelf not found")
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        name = " ".join(changes["name"].split())
        if not name:
            raise HTTPException(status_code=400, detail="Shelf name cannot be empty")
        if any(s.id != shelf.id and s.name.lower() == name.lower() for s in current_user.shelves):
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
        shelf.is_public = becoming_public
        for copy in shelf.copies:
            copy.marketed = becoming_public
    if changes.get("is_default"):
        for other in current_user.shelves:
            other.is_default = other.id == shelf.id
    db.commit()
    db.refresh(shelf)
    return _shelf_out(shelf)


@app.delete("/api/shelves/{shelf_id}", status_code=204)
async def delete_shelf(
    shelf_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = db.query(Shelf).filter(Shelf.id == shelf_id, Shelf.user_id == current_user.id).first()
    if not shelf:
        raise HTTPException(status_code=404, detail="Shelf not found")
    remaining = [item for item in current_user.shelves if item.id != shelf.id]
    if not remaining:
        raise HTTPException(status_code=400, detail="A nook must have at least one shelf")
    destination = next((item for item in remaining if item.is_default), remaining[0])
    if not destination.is_public:
        blocked = [
            copy for copy in shelf.copies
            if copy.marketed and _in_active_cohort(db, current_user, _paper_key_for(copy.paper))
        ]
        if blocked:
            raise HTTPException(
                status_code=400,
                detail="Seminar papers cannot move to a private shelf",
            )
    for copy in list(shelf.copies):
        copy.shelf = destination
        copy.marketed = bool(destination.is_public)
    for board in list(shelf.boards):
        board.shelf = destination
    if shelf.is_default:
        destination.is_default = True
    db.delete(shelf)
    db.commit()


@app.delete("/api/papers/{paper_id}")
async def delete_paper(
    paper_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the paper from the viewer's nook: their copy and notes.
    The paper, its editions and their files stay — one reader leaving
    destroys nothing shared, and a paper with no readers is simply absent
    from the Library until someone adds it again."""
    paper = _get_paper_or_404(paper_id, db)
    user_copy = _require_copy(paper, current_user)

    db.delete(user_copy)
    for c in paper.comments:
        if c.user_id == current_user.id:
            db.delete(c)

    db.commit()
    return {"message": "Paper removed from your nook"}


@app.post("/api/papers/{paper_id}/add-to-nook", response_model=PaperSchema)
async def add_to_nook(
    paper_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add the paper to the viewer's nook: a new copy of the one
    canonical paper. The PDF and metadata are shared."""
    paper = _get_paper_or_404(paper_id, db)
    _require_visible(paper, current_user)
    if _copy_of(paper, current_user) is not None:
        raise HTTPException(status_code=400, detail="This paper is already in your nook")

    latest = _latest_edition(paper)
    shelf = _default_shelf(current_user)
    db.add(Copy(
        paper_id=paper.id,
        user_id=current_user.id,
        marketed=bool(shelf.is_public),
        shelf_id=shelf.id,
        edition_id=latest.id if latest else None,
        edition_sha256=latest.sha256 if latest else None,
    ))
    db.commit()
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


@app.post("/api/papers/{paper_id}/editions", response_model=PaperSchema)
async def add_paper_edition(
    paper_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a PDF as a new edition of the paper (any reader with it in
    their nook). Nobody else's copy moves: the uploader's own copy reads
    the new edition, and every other reader is offered it on the paper
    page, to adopt when they choose."""
    paper = _get_paper_or_404(paper_id, db)
    user_copy = _require_copy(paper, current_user)
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Storing is content-addressed and idempotent, so an upload the paper
    # already holds costs no new file and no cleanup.
    data = await file.read()
    digest = hashlib.sha256(data).hexdigest()
    edition = _edition_with(paper, digest)
    if edition is None:
        filename, _ = _store_pdf(data)
        edition = _register_edition(db, paper, filename, digest, current_user)

    user_copy.edition_id = edition.id
    user_copy.edition_sha256 = edition.sha256
    # Choosing a PDF means having seen the ones that exist: an upload that
    # dedupes onto an older edition must not leave the reader being offered
    # a newer one they made themselves and moved off.
    user_copy.ignored_edition_id = _latest_edition(paper).id
    db.commit()
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


def _named_edition_or_404(paper: Paper, edition_id: int | None) -> PaperEdition:
    if edition_id is None:
        edition = _latest_edition(paper)
    else:
        edition = next((e for e in paper.editions if e.id == edition_id), None)
    if edition is None:
        raise HTTPException(status_code=404, detail="Edition not found")
    return edition


@app.post("/api/papers/{paper_id}/ignore-edition", response_model=PaperSchema)
async def ignore_paper_edition(
    paper_id: int,
    data: EditionAdopt,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Wave away the offer of a newer edition — the latest unless one is
    named. The reader keeps the PDF they have and stops being asked about
    this one; a later edition asks again."""
    paper = _get_paper_or_404(paper_id, db)
    user_copy = _require_copy(paper, current_user)
    user_copy.ignored_edition_id = _named_edition_or_404(paper, data.edition_id).id
    db.commit()
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


@app.post("/api/papers/{paper_id}/adopt-edition", response_model=PaperSchema)
async def adopt_paper_edition(
    paper_id: int,
    data: EditionAdopt,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move the viewer's own copy to another edition — the latest unless
    one is named. Only the reader may do this: located notes were placed
    on the file they had, and on a different PDF they may not line up."""
    paper = _get_paper_or_404(paper_id, db)
    user_copy = _require_copy(paper, current_user)

    edition = _named_edition_or_404(paper, data.edition_id)
    user_copy.edition_id = edition.id
    user_copy.edition_sha256 = edition.sha256
    # Adopting settles every edition that exists now, including ones older
    # than the latest if that is what they picked.
    user_copy.ignored_edition_id = _latest_edition(paper).id
    db.commit()
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


# ---------------- References ----------------

# A PDF's bibliography is read once and kept, because reading it costs a
# GROBID pass over the whole document. The work happens in the background
# and the viewer asks again; what follows is the bookkeeping that makes
# "ask again" cheap and "ask twice at once" harmless.

# Editions being analyzed right now in this process, so a viewer polling
# every second does not start a second pass over the same PDF.
_analyzing: set[int] = set()

# A pass that has been pending longer than this was interrupted — the
# server restarted mid-analysis — and may be started again.
_ANALYSIS_STALE = timedelta(minutes=15)

# Demo editions live in the browser, but their bundled PDFs are available to
# this backend. Their analysis mirrors a stored edition while remaining
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


def _edition_pdf_path(edition: PaperEdition) -> Path | None:
    """Where an edition's PDF sits on disk. Demo papers ship with the
    frontend and are served from its build; uploads live under /uploads."""
    if not edition.file_path:
        return None
    if edition.file_path.startswith("assets/"):
        for root in (FRONTEND_DIR, FRONTEND_DIR.parent / "public"):
            candidate = root / edition.file_path
            if candidate.exists():
                return candidate
        return None
    candidate = UPLOADS_DIR / edition.file_path
    return candidate if candidate.exists() else None


async def _analyze_edition(edition_id: int):
    """Read one edition's references through GROBID and store them.

    Runs after the paper-save response, on its own session. The viewer can
    observe `pending` and later retrieve the stored result. Any failure is
    recorded on the edition rather than raised, so a PDF that cannot be
    analyzed says so instead of being retried forever."""
    db = SessionLocal()
    try:
        edition = db.get(PaperEdition, edition_id)
        if edition is None:
            return
        path = _edition_pdf_path(edition)
        if path is None:
            _finish_analysis(db, edition, "failed", "The PDF for this edition is missing")
            return
        try:
            analysis = await grobid.analyze(str(path))
        except Exception as e:
            logger.warning(f"GROBID failed on edition {edition_id}: {e}")
            _finish_analysis(db, edition, "failed", str(e)[:500])
            return

        # A re-analysis replaces what was there. Resolutions are lost with
        # it, which is the honest thing: they were attached to references
        # read out of the PDF a different way.
        db.query(EditionCitation).filter(
            EditionCitation.edition_id == edition_id
        ).delete()
        db.query(EditionLink).filter(
            EditionLink.edition_id == edition_id
        ).delete()
        db.query(EditionReference).filter(
            EditionReference.edition_id == edition_id
        ).delete()

        rows: dict[str, EditionReference] = {}
        for ref in analysis.references:
            row = EditionReference(
                edition_id=edition_id,
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
            db.add(EditionCitation(
                edition_id=edition_id,
                reference_id=row.id,
                label=cite.label,
                page=cite.page,
                x=cite.x, y=cite.y, w=cite.w, h=cite.h,
                inferred=cite.inferred,
            ))

        for link in analysis.links:
            db.add(EditionLink(
                edition_id=edition_id,
                kind=link.kind,
                label=link.label,
                page=link.page,
                x=link.x, y=link.y, w=link.w, h=link.h,
                target_page=link.target_page,
                target_y=link.target_y,
            ))

        _finish_analysis(db, edition, "ready", None)
        logger.info(
            f"Edition {edition_id}: {len(analysis.references)} references, "
            f"{len(analysis.citations)} citation markers, "
            f"{len(analysis.links)} document links"
        )
    except Exception as e:
        # Whatever went wrong, the edition must not be left saying
        # "pending" forever: a reader would poll a job that is not running.
        logger.error(f"Reference analysis of edition {edition_id} failed: {e}")
        db.rollback()
        try:
            edition = db.get(PaperEdition, edition_id)
            if edition is not None:
                _finish_analysis(db, edition, "failed", str(e)[:500])
        except Exception:
            db.rollback()
    finally:
        db.close()
        _analyzing.discard(edition_id)


def _finish_analysis(db: Session, edition: PaperEdition, status: str, detail: str | None):
    edition.references_status = status
    edition.references_error = detail
    edition.references_at = datetime.utcnow()
    db.commit()


def _may_start_analysis(edition: PaperEdition) -> bool:
    """Whether this edition wants a pass now. Never for a failure — a PDF
    GROBID could not read will not read differently on the next open, and
    a reader refreshing should not queue a job each time."""
    if edition.id in _analyzing:
        return False
    if edition.references_status is None:
        return True
    if edition.references_status == "pending":
        stamped = edition.references_at
        return stamped is None or datetime.utcnow() - stamped > _ANALYSIS_STALE
    return False


async def _bundled_edition_references(
    edition_id: int,
    pdf_sha256: str,
    background: BackgroundTasks,
):
    """Analyze a bundled demo PDF through the same GROBID service as prod."""
    digest = pdf_sha256.strip().lower()
    path = _public_pdf_path(digest)
    if path is None:
        raise HTTPException(status_code=404, detail="Demo PDF not found")
    if not grobid.configured():
        return EditionReferences(
            edition_id=0, status="unavailable",
            detail="Reference analysis unavailable",
        )
    if _bundled_references.begin(digest):
        background.add_task(_bundled_references.analyze, digest, path)
    return _bundled_references.response(digest, edition_id)


@app.get("/api/editions/{edition_id}/references", response_model=EditionReferences)
async def edition_references(
    edition_id: int,
    background: BackgroundTasks,
    refresh: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The references of one edition, and where they are cited in it.

    Upload starts the analysis and the viewer observes `pending` until it is
    `ready`. Older unanalyzed editions are started on first access. Pass
    `refresh=true` to read a PDF again — the way to retry one GROBID could
    not handle."""
    edition = db.get(PaperEdition, edition_id)
    if edition is None:
        raise HTTPException(status_code=404, detail="Edition not found")
    _require_visible(edition.paper, current_user)

    # A reading already done is served whatever the analyzer is doing now.
    # References belong to the edition, not to the service that read them,
    # so an analyzer that is stopped — or one taken away again — must not
    # empty the citations out of every paper anyone has already read.
    stored = edition.references_status == "ready"

    if not grobid.configured() and not stored:
        return EditionReferences(
            edition_id=edition_id,
            status="unavailable",
            detail="Reference analysis unavailable",
        )

    if grobid.configured():
        if refresh and edition.id not in _analyzing:
            edition.references_status = None
        if _may_start_analysis(edition):
            _analyzing.add(edition.id)
            _finish_analysis(db, edition, "pending", None)
            background.add_task(_analyze_edition, edition.id)

    if edition.references_status != "ready":
        return EditionReferences(
            edition_id=edition_id,
            status=edition.references_status or "pending",
            detail=edition.references_error,
        )

    references = edition.references
    known = _papol_papers_for(db, references)
    return EditionReferences(
        edition_id=edition_id,
        status="ready",
        references=[_reference_out(r, known.get(r.id)) for r in references],
        citations=[
            CitationOut(
                reference_id=c.reference_id,
                label=c.label,
                page=c.page,
                x=c.x, y=c.y, w=c.w, h=c.h,
                inferred=bool(c.inferred),
            )
            for c in edition.citations
            if c.reference_id is not None
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
            for link in edition.links
        ],
    )


@app.get("/api/references/{reference_id}", response_model=ReferenceOut)
async def open_reference(
    reference_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One reference, looked up if it has not been looked up before.

    Lazy on purpose: a paper cites forty works and a reader opens three of
    them, so forty lookups would be thirty-seven asked of CrossRef and
    OpenAlex for nobody's benefit."""
    reference = db.get(EditionReference, reference_id)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference not found")
    _require_visible(reference.edition.paper, current_user)

    answer = await resolve_reference(reference)
    if answer.resolved_status == "error":
        return answer
    db.commit()

    known = _papol_papers_for(db, [reference])
    return _reference_out(reference, known.get(reference.id))


@app.post("/api/editions/{edition_id}/references/preview", response_model=ReferenceOut)
async def preview_pdf_reference(
    edition_id: int,
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
    edition = db.get(PaperEdition, edition_id)
    if edition is None:
        raise HTTPException(status_code=404, detail="Edition not found")
    _require_visible(edition.paper, current_user)

    key = data.key.strip()
    raw = " ".join(data.raw.split())
    reference = db.query(EditionReference).filter(
        EditionReference.edition_id == edition.id,
        EditionReference.key == key,
    ).first()
    if reference is None:
        last_index = db.query(func.max(EditionReference.index)).filter(
            EditionReference.edition_id == edition.id,
        ).scalar()
        reference = EditionReference(
            edition_id=edition.id,
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
    return _reference_out(reference, known.get(reference.id))


# The viewer speaks one reference protocol. Whether a hash belongs to a
# bundled demo PDF or a reader's stored edition is an authorization/storage
# decision made here, not a mode branch leaked into the UI.
@app.get("/api/viewer-references/{pdf_sha256}", response_model=EditionReferences)
async def viewer_references(
    pdf_sha256: str,
    edition_id: int,
    background: BackgroundTasks,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    digest = pdf_sha256.strip().lower()
    if _public_pdf_path(digest) is not None:
        return await _bundled_edition_references(edition_id, digest, background)
    edition = _viewer_edition_or_404(digest, current_user, db)
    return await edition_references(
        edition.id, background, current_user=current_user, db=db,
    )


@app.get("/api/viewer-references/item/{reference_id}", response_model=ReferenceOut)
async def viewer_reference(
    reference_id: int,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    bundled = await _bundled_references.open(reference_id)
    if bundled is not None:
        return bundled
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return await open_reference(reference_id, current_user, db)


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
    edition = _viewer_edition_or_404(digest, current_user, db)
    return await preview_pdf_reference(edition.id, data, current_user, db)


def _reference_out(reference: EditionReference, papol_paper_id: int | None) -> ReferenceOut:
    answer = reference_out(reference)
    answer.papol_paper_id = papol_paper_id
    return answer


def _papol_papers_for(db: Session, references) -> dict[int, int]:
    """Which of these references name a paper Papol already holds.

    A reference is worth more when the paper it names is one someone here
    has read: the reader can open it rather than leave. Matched on the same
    key papers are deduplicated by, so this agrees with Papol's own idea of
    when two papers are the same paper."""
    by_key = {}
    for paper in db.query(Paper).all():
        by_key.setdefault(_paper_key_for(paper), paper.id)

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
                found[reference.id] = by_key[key]
                break
    return found


# ---------------- Comments ----------------

# ---- Ink -------------------------------------------------------------
#
# Marks a reader made on the page with the brush: private to them, kept
# against the edition they were drawn on. The laser pointer leaves nothing
# here on purpose — it is a way of pointing while you talk, and a gesture
# that outlived the sentence would be litter.


def _stroke_out(stroke: InkStroke) -> InkStrokeOut:
    return InkStrokeOut(
        id=stroke.id,
        group_id=stroke.group_id,
        page=stroke.page,
        points=json.loads(stroke.points),
        color=stroke.color,
        width=stroke.width,
        opacity=stroke.opacity,
        shape=stroke.shape,
    )


def _readable_edition(edition_id: int, user: User, db: Session) -> PaperEdition:
    """The edition, if this reader is someone who may be reading it.

    Ink is private, so letting it be stored against any edition would leak
    nothing — but a reader who has not taken the paper has no page to draw
    on, and notes already ask for the paper to be in the nook first. Ink is
    the same kind of mark and answers the same way."""
    edition = db.query(PaperEdition).filter(PaperEdition.id == edition_id).first()
    if not edition or edition.paper is None:
        raise HTTPException(status_code=404, detail="Edition not found")
    _require_copy(edition.paper, user)
    return edition


@app.get("/api/editions/{edition_id}/ink", response_model=list[InkStrokeOut])
async def list_ink(
    edition_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Your marks on this edition, oldest first — which is the order they
    have to be drawn in for later ink to sit over earlier ink."""
    _readable_edition(edition_id, current_user, db)
    rows = (
        db.query(InkStroke)
        .filter(InkStroke.edition_id == edition_id, InkStroke.user_id == current_user.id)
        .order_by(InkStroke.id)
        .all()
    )
    return [_stroke_out(r) for r in rows]


@app.post("/api/editions/{edition_id}/ink", response_model=InkStrokeOut)
async def add_ink(
    edition_id: int,
    stroke: InkStrokeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Keep one stroke. Posted when the pointer lifts, not as it moves: a
    stroke is one mark, and half of one is not worth storing."""
    _readable_edition(edition_id, current_user, db)
    row = InkStroke(
        group_id=stroke.group_id,
        edition_id=edition_id,
        user_id=current_user.id,
        page=stroke.page,
        points=json.dumps([p.model_dump() for p in stroke.points]),
        color=stroke.color,
        width=stroke.width,
        opacity=stroke.opacity,
        shape=stroke.shape,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _stroke_out(row)


@app.put("/api/ink/{stroke_id}", response_model=InkStrokeOut)
async def move_ink(
    stroke_id: int,
    move: InkStrokeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Put a stroke down somewhere else. Sent when the drag ends rather
    than as it moves, for the same reason a stroke is sent when the pointer
    lifts: where it was passing through is not where it went."""
    row = db.query(InkStroke).filter(InkStroke.id == stroke_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No such stroke")
    if row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only move your own ink")
    row.points = json.dumps([p.model_dump() for p in move.points])
    db.commit()
    db.refresh(row)
    return _stroke_out(row)


@app.delete("/api/ink/{stroke_id}")
async def delete_ink(
    stroke_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rub out one stroke. The eraser works by the stroke rather than by
    the pixel: it is what the reader drew, so it is what they undraw."""
    row = db.query(InkStroke).filter(InkStroke.id == stroke_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No such stroke")
    if row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only erase your own ink")
    db.delete(row)
    db.commit()
    return {"message": "Stroke erased"}


def _clip_out(clip: PaperClip) -> PaperClipOut:
    return PaperClipOut(
        id=clip.id,
        page=clip.page,
        source=json.loads(clip.source),
        frame=json.loads(clip.frame),
        floating=clip.floating,
    )


@app.get("/api/editions/{edition_id}/clips", response_model=list[PaperClipOut])
async def list_clips(
    edition_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _readable_edition(edition_id, current_user, db)
    rows = (
        db.query(PaperClip)
        .filter(PaperClip.edition_id == edition_id, PaperClip.user_id == current_user.id)
        .order_by(PaperClip.id)
        .all()
    )
    return [_clip_out(row) for row in rows]


@app.post("/api/editions/{edition_id}/clips", response_model=PaperClipOut)
async def add_clip(
    edition_id: int,
    clip: PaperClipCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _readable_edition(edition_id, current_user, db)
    row = PaperClip(
        edition_id=edition_id,
        user_id=current_user.id,
        page=clip.page,
        source=json.dumps(clip.source.model_dump()),
        frame=json.dumps(clip.frame.model_dump()),
        floating=clip.floating,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _clip_out(row)


@app.put("/api/clips/{clip_id}", response_model=PaperClipOut)
async def move_clip(
    clip_id: int,
    change: PaperClipUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(PaperClip).filter(PaperClip.id == clip_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No such clip")
    if row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only move your own clips")
    row.frame = json.dumps(change.frame.model_dump())
    row.floating = change.floating
    db.commit()
    db.refresh(row)
    return _clip_out(row)


@app.delete("/api/clips/{clip_id}")
async def delete_clip(
    clip_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(PaperClip).filter(PaperClip.id == clip_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="No such clip")
    if row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only remove your own clips")
    db.delete(row)
    db.commit()
    return {"message": "Clip removed"}


@app.post("/api/papers/{paper_id}/comments", response_model=CommentSchema)
async def add_comment(
    paper_id: int,
    comment: CommentCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a private note to a paper in your nook. Notes are visible only to
    you. A note may be *located* — given a page and an anchor, as the PDF
    viewer does — in which case it also records the edition it was placed
    on, so a note taken on a different PDF can be told apart."""
    paper = _get_paper_or_404(paper_id, db)
    user_copy = _require_copy(paper, current_user)
    anchor_type = anchor_json = edition_id = None
    if comment.anchor is not None:
        payload = comment.anchor.model_dump()
        anchor_type = payload.pop("type")
        anchor_json = json.dumps(payload)
        edition = _edition_for(paper, user_copy)
        edition_id = edition.id if edition else None
    db_comment = Comment(
        paper_id=paper_id,
        user_id=current_user.id,
        content=comment.content.strip(),
        page=comment.page,
        anchor_type=anchor_type,
        anchor=anchor_json,
        edition_id=edition_id,
        name=(comment.name or "").strip() or None,
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    return _comment_out(db_comment)


@app.put("/api/comments/{comment_id}", response_model=CommentSchema)
async def edit_comment(
    comment_id: int,
    comment: CommentUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit a note (author only): reword it, move its anchor, or both.
    Moving re-places it on the edition the reader is looking at, since that
    is the page they moved it across."""
    db_comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not db_comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if db_comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own notes")
    if comment.content is not None:
        db_comment.content = comment.content.strip()
    if comment.anchor is not None:
        payload = comment.anchor.model_dump()
        db_comment.anchor_type = payload.pop("type")
        db_comment.anchor = json.dumps(payload)
        db_comment.page = comment.page
        paper = _get_paper_or_404(db_comment.paper_id, db)
        edition = _edition_for(paper, _copy_of(paper, current_user))
        db_comment.edition_id = edition.id if edition else None
    if comment.name is not None:
        db_comment.name = comment.name.strip() or None
    db.commit()
    db.refresh(db_comment)
    return _comment_out(db_comment)


@app.delete("/api/comments/{comment_id}")
async def delete_comment(
    comment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a comment (author only)."""
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own comments")

    db.delete(comment)
    db.commit()
    return {"message": "Comment deleted"}


# ---------------- Seminar rooms ----------------

def _get_room_or_404(room_id: int, db: Session) -> Room:
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Cohort not found")
    return room


def _ensure_participant(db: Session, room: Room, user: User):
    exists = (
        db.query(RoomParticipant)
        .filter(RoomParticipant.room_id == room.id, RoomParticipant.user_id == user.id)
        .first()
    )
    if not exists:
        db.add(RoomParticipant(room_id=room.id, user_id=user.id))


def _require_reader(db: Session, room: Room, user: User):
    if user.id not in _reader_ids(db, room.paper_key, public_only=True):
        raise HTTPException(
            status_code=403,
            detail="Display this paper to join the cohort",
        )


def _room_detail(db: Session, room: Room, viewer: User) -> RoomDetail:
    public_readers = _reader_ids(db, room.paper_key, public_only=True)

    # The canonical paper this room is about, and the viewer's copy of it
    paper = next(iter(_papers_for_key(db, room.paper_key)), None)
    own = _copy_of(paper, viewer) if paper else None
    link_paper = (
        paper if paper and (own is not None or _displayed_copies(paper)) else None
    )
    hidden_entry = paper if own is not None and not own.marketed else None

    summary = _room_summary(room)
    return RoomDetail(
        **summary.model_dump(),
        paper_title=room.paper_title,
        paper_id=link_paper.id if link_paper else None,
        messages=[
            RoomMessageOut.model_validate(m)
            for m in sorted(room.messages, key=lambda m: (m.created_at, m.id))
        ],
        availabilities=[RoomAvailabilityOut.model_validate(a) for a in room.availabilities],
        viewer_can_lead=room.status == "open"
        and viewer.id in public_readers
        and any(p.user_id == viewer.id for p in room.participants),
        viewer_is_participant=any(p.user_id == viewer.id for p in room.participants),
        viewer_is_reader=viewer.id in public_readers,
        viewer_hidden_entry_id=hidden_entry.id if hidden_entry else None,
    )


@app.post("/api/papers/{paper_id}/room", response_model=RoomSummary)
async def call_seminar(
    paper_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Call for a seminar on this paper. Only readers of it may call.
    Notifies every reader — including those who keep their copy hidden."""
    paper = _get_paper_or_404(paper_id, db)
    _require_visible(paper, current_user)

    key = _paper_key_for(paper)
    if current_user.id not in _reader_ids(db, key, public_only=True):
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

    room = Room(paper_key=key, paper_title=paper.title, created_by=current_user.id)
    db.add(room)
    db.flush()
    _ensure_participant(db, room, current_user)
    all_readers = _reader_ids(db, key, public_only=False) - {current_user.id}
    _notify(
        db, all_readers, room,
        f"{current_user.display_name} called for a seminar on “{paper.title}”. "
        "A reader of the paper can answer to host.",
    )
    db.commit()
    db.refresh(room)
    return _room_summary(room)


@app.get("/api/rooms/{room_id}", response_model=RoomDetail)
async def get_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_id, db)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/lead", response_model=RoomDetail)
async def lead_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Answer the call and take charge of the seminar."""
    room = _get_room_or_404(room_id, db)
    if room.status != "open":
        raise HTTPException(status_code=400, detail="This seminar already has a host")
    if current_user.id not in _reader_ids(db, room.paper_key, public_only=True):
        raise HTTPException(
            status_code=403,
            detail="Display this paper to host",
        )
    if not any(p.user_id == current_user.id for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before answering to host"
        )
    room.leader_id = current_user.id
    room.status = "planning"
    _ensure_participant(db, room, current_user)
    others = (
        _reader_ids(db, room.paper_key, public_only=False)
        | {p.user_id for p in room.participants}
    ) - {current_user.id}
    _notify(
        db, others, room,
        f"{current_user.display_name} will host the seminar on “{room.paper_title}”. "
        "Share your availability in the cohort.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/unhost", response_model=RoomDetail)
async def unhost_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Step back from hosting a seminar still in planning. The room reopens
    and waits for another reader to answer."""
    room = _get_room_or_404(room_id, db)
    if room.leader_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the host can step back")
    if room.status != "planning":
        raise HTTPException(
            status_code=400, detail="Only a seminar in planning can lose its host"
        )
    room.leader_id = None
    room.status = "open"
    others = {p.user_id for p in room.participants} - {current_user.id}
    _notify(
        db, others, room,
        f"{current_user.display_name} stepped back from hosting the seminar on "
        f"“{room.paper_title}”. A reader of the paper can answer to host.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/join", response_model=RoomDetail)
async def join_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_id, db)
    _require_reader(db, room, current_user)
    _ensure_participant(db, room, current_user)
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/leave", response_model=RoomDetail)
async def leave_room(
    room_id: int,
    data: RoomLeave | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leave the cohort. A host leaving an active seminar must appoint a
    cohort member to host in their place."""
    room = _get_room_or_404(room_id, db)
    if not any(p.user_id == current_user.id for p in room.participants):
        raise HTTPException(status_code=400, detail="You are not in this cohort")

    successor_id = data.successor_id if data else None
    if room.leader_id == current_user.id and room.status != "finished":
        if successor_id is None:
            raise HTTPException(
                status_code=400,
                detail="Appoint a cohort member to host before leaving",
            )
        if successor_id == current_user.id or not any(
            p.user_id == successor_id for p in room.participants
        ):
            raise HTTPException(
                status_code=400, detail="Choose another cohort member"
            )
        if successor_id not in _reader_ids(db, room.paper_key, public_only=True):
            raise HTTPException(
                status_code=400,
                detail="Display this paper to host",
            )
        room.leader_id = successor_id
        successor = db.query(User).filter(User.id == successor_id).first()
        _notify(
            db, {successor_id}, room,
            f"{current_user.display_name} handed you hosting of the seminar on "
            f"“{room.paper_title}”.",
        )
        logger.info(
            "room %s: leadership handed from %s to %s",
            room.id, current_user.id, successor.id,
        )

    db.query(RoomParticipant).filter(
        RoomParticipant.room_id == room.id, RoomParticipant.user_id == current_user.id
    ).delete()
    db.query(RoomAvailability).filter(
        RoomAvailability.room_id == room.id, RoomAvailability.user_id == current_user.id
    ).delete()
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/messages", response_model=RoomDetail)
async def post_room_message(
    room_id: int,
    data: RoomMessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_id, db)
    _require_reader(db, room, current_user)
    if not any(p.user_id == current_user.id for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before posting a message"
        )
    db.add(RoomMessage(room_id=room.id, user_id=current_user.id, content=data.content.strip()))
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/availability", response_model=RoomDetail)
async def set_room_availability(
    room_id: int,
    data: AvailabilitySubmit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = _get_room_or_404(room_id, db)
    if room.status == "scheduled":
        raise HTTPException(status_code=400, detail="This seminar has already been scheduled")
    _require_reader(db, room, current_user)
    if not any(p.user_id == current_user.id for p in room.participants):
        raise HTTPException(
            status_code=400, detail="Join the cohort before sharing availability"
        )
    entry = (
        db.query(RoomAvailability)
        .filter(RoomAvailability.room_id == room.id, RoomAvailability.user_id == current_user.id)
        .first()
    )
    if entry:
        entry.availability = data.availability
    else:
        db.add(RoomAvailability(room_id=room.id, user_id=current_user.id, availability=data.availability))
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.put("/api/rooms/{room_id}/announce", response_model=RoomDetail)
async def announce_room(
    room_id: int,
    data: RoomAnnounce,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Announce the seminar's time, platform, and style — or edit them
    later (host only)."""
    room = _get_room_or_404(room_id, db)
    if room.leader_id != current_user.id:
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
        _reader_ids(db, room.paper_key, public_only=False)
        | {p.user_id for p in room.participants}
    ) - {current_user.id}
    _notify(
        db, others, room,
        f"Seminar on “{room.paper_title}” "
        f"{'updated' if editing else 'scheduled'}: "
        f"{data.scheduled_time} · {data.platform}.",
    )
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


@app.post("/api/rooms/{room_id}/finish", response_model=RoomDetail)
async def finish_room(
    room_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark the seminar as held (host only)."""
    room = _get_room_or_404(room_id, db)
    if room.leader_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the host can finish the seminar")
    if room.status != "scheduled":
        raise HTTPException(status_code=400, detail="Schedule the seminar first")
    room.status = "finished"
    db.commit()
    db.refresh(room)
    return _room_detail(db, room, current_user)


# ---------------- Notifications ----------------

@app.get("/api/notifications", response_model=NotificationList)
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(50)
        .all()
    )
    unread = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.read.is_(False))
        .count()
    )
    return NotificationList(
        unread_count=unread,
        notifications=[NotificationOut.model_validate(n) for n in rows],
    )


def _site_url(db: Session) -> str:
    return (
        os.environ.get("PAPOL_URL")
        or _setting(db, "site_url")
        or "https://mc-pony.com/papol/"
    )


def _setting(db: Session, key: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row and row.value else None


def _smtp_cfg(db: Session):
    """SMTP configuration: environment variables win, then the settings
    table (keys smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from).
    Returns None when no host is configured anywhere."""
    def get(env, key, default=None):
        return os.environ.get(env) or _setting(db, key) or default

    host = get("SMTP_HOST", "smtp_host")
    if not host:
        return None
    user = get("SMTP_USER", "smtp_user")
    return {
        "host": host,
        "port": int(get("SMTP_PORT", "smtp_port", "587")),
        "user": user,
        "password": get("SMTP_PASS", "smtp_pass"),
        "from_addr": get("SMTP_FROM", "smtp_from", user or "papol@localhost"),
        "starttls": get("SMTP_STARTTLS", "smtp_starttls", "1") != "0",
    }


def send_daily_digest(db: Session) -> dict:
    """Email each user their unread notifications from the past day.
    A notification is emailed at most once."""
    since = datetime.utcnow() - timedelta(days=1)
    rows = (
        db.query(Notification)
        .filter(
            Notification.read.is_(False),
            Notification.emailed.is_(False),
            Notification.created_at >= since,
        )
        .order_by(Notification.created_at)
        .all()
    )
    by_user = {}
    for n in rows:
        by_user.setdefault(n.user_id, []).append(n)

    cfg = _smtp_cfg(db)
    if cfg is None:
        return {"emails_sent": 0, "users_with_news": len(by_user), "skipped": "SMTP not configured"}

    sent = 0
    for uid, notifs in by_user.items():
        user = db.query(User).filter(User.id == uid).first()
        if not user:
            continue
        lines = "\n".join(f"  - {n.content}" for n in notifs)
        count = len(notifs)
        body = (
            f"Hello {user.display_name},\n\n"
            f"You have {count} new message{'s' if count != 1 else ''} in Papol today:\n\n"
            f"{lines}\n\n"
            f"Read and reply in your inbox: {_site_url(db).rstrip('/')}/inbox\n\n"
            "— Papol"
        )
        try:
            send_email(
                cfg,
                user.email,
                f"Papol: {count} new message{'s' if count != 1 else ''} today",
                body,
            )
        except Exception:
            logger.exception("Digest email to %s failed", user.email)
            continue
        for n in notifs:
            n.emailed = True
        sent += 1
    db.commit()
    return {"emails_sent": sent, "users_with_news": len(by_user)}


def _seconds_until(hour: int) -> float:
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


@app.on_event("startup")
async def _start_digest_loop():
    async def loop():
        while True:
            # Send hour is the digest_hour setting (0-23, server time)
            db = SessionLocal()
            try:
                hour = int(_setting(db, "digest_hour") or 21)
            except (TypeError, ValueError):
                hour = 21
            finally:
                db.close()
            await asyncio.sleep(_seconds_until(hour))
            db = SessionLocal()
            try:
                logger.info("Daily digest: %s", send_daily_digest(db))
            except Exception:
                logger.exception("Daily digest failed")
            finally:
                db.close()

    asyncio.create_task(loop())


@app.post("/api/notifications/{notif_id}/read")
async def mark_notification_read(
    notif_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification read — reading happens by clicking."""
    n = (
        db.query(Notification)
        .filter(Notification.id == notif_id, Notification.user_id == current_user.id)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.read = True
    db.commit()
    return {"message": "Notification marked read"}


@app.post("/api/notifications/read")
async def mark_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id, Notification.read.is_(False)
    ).update({"read": True})
    db.commit()
    return {"message": "All notifications marked read"}


# ---------------- Admin ----------------

# Browsers check in once a minute. The extra minute tolerates a delayed
# background-tab timer without leaving closed browsers present for long.
ACTIVE_USER_WINDOW = timedelta(minutes=2)


@app.post("/api/presence")
async def presence(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Keep the session current and retain one history point per minute."""
    now = datetime.utcnow().replace(second=0, microsecond=0)
    exists = db.query(PresencePing.id).filter(
        PresencePing.user_id == current_user.id,
        PresencePing.bucket_at == now,
    ).first()
    if exists is None:
        db.add(PresencePing(user_id=current_user.id, bucket_at=now))
        # Bound storage without paying for cleanup on every heartbeat.
        if now.minute == 0:
            db.query(PresencePing).filter(
                PresencePing.bucket_at < now - timedelta(days=30)
            ).delete(synchronize_session=False)
        try:
            db.commit()
        except IntegrityError:
            # Two tabs can check in for the same user in the same instant.
            # The unique minute bucket means the other request already won.
            db.rollback()
    return {"ok": True}

# ---------------- Feedback ----------------

def _feedback_reporter(fb: Feedback) -> str:
    if fb.user:
        return f"{fb.user.display_name} <{fb.user.email}>"
    if fb.contact:
        return f"a visitor <{fb.contact}>"
    return "an anonymous visitor"


def _feedback_out(fb: Feedback) -> FeedbackOut:
    return FeedbackOut(
        id=fb.id,
        content=fb.content,
        page=fb.page,
        contact=fb.contact,
        resolved=fb.resolved,
        created_at=fb.created_at,
        user=UserBase.model_validate(fb.user) if fb.user else None,
        user_email=fb.user.email if fb.user else None,
    )


def _feedback_message(fb: Feedback, reporter: str) -> str:
    where = f" (from {fb.page})" if fb.page else ""
    return f"Feedback from {reporter}{where}:\n\n{fb.content}"


def _email_admins_feedback(feedback_id: int, notification_ids: dict):
    """Mail the admins a new report right away. Best effort: a report that
    cannot be emailed is still in the database and in every admin's inbox,
    and an admin whose mail fails keeps the notification unemailed so the
    daily digest carries it. Runs after the response, on its own session."""
    db = SessionLocal()
    try:
        fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        cfg = _smtp_cfg(db)
        if fb is None or cfg is None:
            return
        reporter = _feedback_reporter(fb)
        lines = [f"Feedback from {reporter}"]
        if fb.page:
            lines.append(f"Page: {fb.page}")
        lines += [
            "",
            fb.content,
            "",
            f"Reports are listed on the admin page: {_site_url(db).rstrip('/')}/admin",
            "",
            "— Papol",
        ]
        body = "\n".join(lines)
        headline = fb.content.strip().splitlines()[0][:60]
        subject = f"Papol feedback: {headline}"
        for admin in db.query(User).filter(User.is_admin.is_(True)).all():
            try:
                send_email(cfg, admin.email, subject, body)
            except Exception:
                logger.exception("Feedback email to %s failed", admin.email)
                continue
            notif_id = notification_ids.get(admin.id)
            if notif_id:
                notif = db.query(Notification).filter(Notification.id == notif_id).first()
                if notif:
                    notif.emailed = True
        db.commit()
    except Exception:
        logger.exception("Feedback notification email failed")
    finally:
        db.close()


@app.post("/api/feedback", response_model=FeedbackOut)
async def submit_feedback(
    data: FeedbackCreate,
    background: BackgroundTasks,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Report a bug or request a feature. Open to visitors too, so that a
    reader who cannot sign in can still say so. The report is stored and
    every admin gets it as an inbox message and an email."""
    fb = Feedback(
        user_id=current_user.id if current_user else None,
        content=data.content.strip(),
        page=(data.page or None),
        contact=(data.contact or "").strip() or None,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)

    admins = db.query(User).filter(User.is_admin.is_(True)).all()
    message = _feedback_message(fb, _feedback_reporter(fb))
    notifications = [Notification(user_id=a.id, content=message) for a in admins]
    db.add_all(notifications)
    db.commit()

    background.add_task(
        _email_admins_feedback,
        fb.id,
        {a.id: n.id for a, n in zip(admins, notifications)},
    )
    return _feedback_out(fb)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


def _admin_table(table_name: str):
    table = Base.metadata.tables.get(table_name)
    if table is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return table


def _admin_single_pk(table):
    pk_cols = list(table.primary_key.columns)
    if len(pk_cols) != 1:
        raise HTTPException(status_code=400, detail="Table has no single-column primary key")
    return pk_cols[0]


def _coerce_value(column, value):
    """Coerce a JSON value from the admin UI to the column's Python type."""
    if value is None or value == "":
        return None
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        return value
    if python_type is datetime and isinstance(value, str):
        return datetime.fromisoformat(value)
    if python_type in (int, bool, float) and isinstance(value, str):
        try:
            return python_type(int(value)) if python_type is bool else python_type(value)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid value for {column.name}")
    return value


def _coerce_pk(table, pk_value: str):
    pk_col = _admin_single_pk(table)
    try:
        if pk_col.type.python_type is int:
            return pk_col, int(pk_value)
    except NotImplementedError:
        pass
    return pk_col, pk_value


@app.post("/api/admin/send-digest")
async def admin_send_digest(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run the daily email digest immediately (admin only)."""
    if _smtp_cfg(db) is None:
        raise HTTPException(
            status_code=400,
            detail="SMTP is not configured — fill the settings table "
            "(smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from) "
            "or set SMTP_* environment variables",
        )
    return send_daily_digest(db)


@app.get("/api/admin/db-metrics")
async def admin_db_metrics(admin: User = Depends(require_admin)):
    """Aggregated timings of database operations since startup (or reset)."""
    return dbmetrics.snapshot()


@app.post("/api/admin/db-metrics/reset")
async def admin_reset_db_metrics(admin: User = Depends(require_admin)):
    dbmetrics.reset()
    return dbmetrics.snapshot()


@app.get("/api/admin/active-users")
async def admin_active_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Signed-in readers with an unrevoked session used in the live window."""
    now = datetime.utcnow()
    cutoff = now - ACTIVE_USER_WINDOW
    sessions = (
        db.query(AuthToken)
        .join(User, AuthToken.user_id == User.id)
        .filter(
            AuthToken.revoked_at.is_(None),
            AuthToken.last_used_at >= cutoff,
            User.deleted_at.is_(None),
        )
        .all()
    )

    by_user = {}
    for session in sessions:
        entry = by_user.get(session.user_id)
        if entry is None:
            entry = {
                "id": session.user.id,
                "display_name": session.user.display_name,
                "email": session.user.email,
                "last_seen_at": session.last_used_at,
                "session_count": 0,
            }
            by_user[session.user_id] = entry
        entry["session_count"] += 1
        if session.last_used_at > entry["last_seen_at"]:
            entry["last_seen_at"] = session.last_used_at

    users = sorted(
        by_user.values(), key=lambda row: row["last_seen_at"], reverse=True
    )
    return {
        "count": len(users),
        "window_seconds": int(ACTIVE_USER_WINDOW.total_seconds()),
        "as_of": now,
        "users": users,
    }


@app.get("/api/admin/concurrency-series")
async def admin_concurrency_series(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Five-minute concurrency observations for the trailing 24 hours."""
    now = datetime.utcnow().replace(second=0, microsecond=0)
    end = now.replace(minute=(now.minute // 5) * 5)
    start = end - timedelta(hours=24)
    pings = (
        db.query(PresencePing)
        .join(User, PresencePing.user_id == User.id)
        .filter(PresencePing.bucket_at >= start - ACTIVE_USER_WINDOW)
        .filter(User.deleted_at.is_(None))
        .order_by(PresencePing.bucket_at)
        .all()
    )

    user_ids = {ping.user_id for ping in pings}
    reader_names = dict(
        db.query(User.id, User.display_name).filter(User.id.in_(user_ids)).all()
    ) if user_ids else {}

    points = []
    ping_index = 0
    recent = []
    cursor = start
    while cursor <= end:
        lower = cursor - ACTIVE_USER_WINDOW
        while ping_index < len(pings) and pings[ping_index].bucket_at <= cursor:
            recent.append(pings[ping_index])
            ping_index += 1
        recent = [ping for ping in recent if ping.bucket_at > lower]
        active = {ping.user_id for ping in recent}
        readers = sorted(
            (reader_names[user_id] for user_id in active if user_id in reader_names),
            key=str.casefold,
        )
        points.append({"at": cursor, "count": len(readers), "readers": readers})
        cursor += timedelta(minutes=5)
    return {"from": start, "to": end, "interval_seconds": 300, "points": points}


@app.get("/api/admin/feedback", response_model=list[FeedbackOut])
async def admin_list_feedback(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every bug report and feature request, newest first."""
    rows = (
        db.query(Feedback)
        .order_by(Feedback.resolved, Feedback.created_at.desc(), Feedback.id.desc())
        .all()
    )
    return [_feedback_out(fb) for fb in rows]


@app.put("/api/admin/feedback/{feedback_id}", response_model=FeedbackOut)
async def admin_update_feedback(
    feedback_id: int,
    data: FeedbackUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Mark a report done, or reopen it."""
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404, detail="Report not found")
    fb.resolved = data.resolved
    db.commit()
    db.refresh(fb)
    return _feedback_out(fb)


@app.get("/api/admin/tables")
async def admin_list_tables(admin: User = Depends(require_admin)):
    return {"tables": sorted(Base.metadata.tables.keys())}


@app.get("/api/admin/tables/{table_name}")
async def admin_get_table(
    table_name: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    rows = db.execute(table.select().limit(500)).mappings().all()
    return {
        "columns": [c.name for c in table.columns],
        "primary_key": [c.name for c in table.primary_key.columns],
        "rows": [dict(r) for r in rows],
    }


@app.put("/api/admin/tables/{table_name}/rows/{pk_value}")
async def admin_update_row(
    table_name: str,
    pk_value: str,
    data: dict,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    pk_col, pkv = _coerce_pk(table, pk_value)
    values = {
        k: _coerce_value(table.columns[k], v)
        for k, v in data.items()
        if k in table.columns.keys() and k != pk_col.name
    }
    if not values:
        raise HTTPException(status_code=400, detail="No editable columns in payload")
    result = db.execute(table.update().where(pk_col == pkv).values(**values))
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Row not found")
    return {"updated": result.rowcount}


@app.delete("/api/admin/tables/{table_name}/rows/{pk_value}")
async def admin_delete_row(
    table_name: str,
    pk_value: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    pk_col, pkv = _coerce_pk(table, pk_value)
    result = db.execute(table.delete().where(pk_col == pkv))
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Row not found")
    return {"deleted": result.rowcount}


@app.post("/api/admin/sql")
async def admin_run_sql(
    payload: AdminSQL,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run one raw SQL statement against the database. Admin only."""
    try:
        result = db.execute(text(payload.query))
        if result.returns_rows:
            rows = [dict(r) for r in result.mappings().fetchmany(500)]
            db.commit()
            return {"rows": rows, "columns": list(rows[0].keys()) if rows else []}
        db.commit()
        return {"rowcount": result.rowcount}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))


# A name that never changes, for a file that does. Papol is reached both
# through nginx, which adds no-store, and through the Cloudflare tunnel,
# which goes straight to uvicorn and so gets whatever is set here — and a
# CDN left to its own devices caches an .svg for hours. The hashed files
# under /assets are exempt from this problem by construction; index.html and
# the build-root files are not, and they are the two that decide what the
# hashed names even are.
_REVALIDATE = {"Cache-Control": "public, max-age=0, must-revalidate"}


@app.get("/")
async def serve_frontend():
    """Serve the frontend index.html."""
    return FileResponse(FRONTEND_DIR / "index.html", headers=_REVALIDATE)


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
    return FileResponse(FRONTEND_DIR / "index.html", headers=_REVALIDATE)
