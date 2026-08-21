import asyncio
import os
from datetime import timedelta

from fastapi import (
    FastAPI, Depends, HTTPException, UploadFile, File, Request, BackgroundTasks
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from starlette.background import BackgroundTask
import tempfile
from fastapi.security import HTTPAuthorizationCredentials
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.orm import Session
import hashlib
import json
import uuid
import logging
import traceback
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from database import engine, get_db, Base, migrate, normalize_papers, SessionLocal
from models import (
    User, AuthToken, Paper, Copy, Comment,
    Room, RoomParticipant, RoomMessage, RoomAvailability, Notification, ErrorLog,
    Setting, Feedback, PaperEdition, EditionReference, EditionCitation,
    InkStroke,
)
import account
from schemas import (
    UserRegister, UserLogin, UserBase, UserPublic, UserPrivate, UserDirectoryEntry,
    AuthResponse,
    ProfileUpdate, PasswordChange, AccountDeletion, ReaderEntry,
    RoomSummary, RoomDetail, RoomMessageOut, RoomAvailabilityOut,
    RoomMessageCreate, NotificationList, NotificationOut, AdminSQL,
    PaperCreate, PaperUpdate, Paper as PaperSchema, PaperList, UserSpace,
    CommentCreate, Comment as CommentSchema, ExtractedMetadata, NookStats,
    AvailabilitySubmit, RoomAnnounce, RoomLeave,
    FeedbackCreate, FeedbackOut, FeedbackUpdate,
    PaperEditionOut, EditionAdopt,
    CommentUpdate, PointAnchor,
    EditionReferences, ReferenceOut, CitationOut, ResolvedWork,
    InkStrokeCreate, InkStrokeUpdate, InkStrokeOut,
)
from auth import (
    hash_password, verify_password, create_token, get_current_user,
    get_optional_user, bearer_scheme
)
from emailer import send_email
from pdf_parser import extract_doi_from_pdf, get_title_from_filename
from crossref import fetch_metadata_from_doi
import grobid
import biblio
import dbmetrics

# Create database tables and apply column migrations
migrate()
Base.metadata.create_all(bind=engine)

# Uploads directory
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
AVATARS_DIR = UPLOADS_DIR / "avatars"
AVATARS_DIR.mkdir(exist_ok=True)

# Collapse pre-normalization duplicate entries into canonical papers + copies,
# and drop the duplicate PDF copies they carried.
for _stale in normalize_papers():
    _stale_path = UPLOADS_DIR / _stale
    if _stale_path.exists():
        _stale_path.unlink()

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
    app.mount("/viewer", StaticFiles(directory=str(VIEWER_DIR), html=True), name="viewer")


# The {name} placeholder is filled with the new reader's display name.
# Override via the settings table key "welcome_message".
DEFAULT_WELCOME = (
    "Welcome to Papol, {name}! Your nook is where you "
    "document your reading: upload the papers you read, rate them, "
    "keep private notes and a summary, and share a public "
    "one-sentence thought. Visit the Village to see what other "
    "readers keep in their nooks, and add papers from the Library "
    "to your own. When a paper deserves a conversation, call a "
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
        account.write_zip(db, current_user, UPLOADS_DIR, path)
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
    return {"message": "Your account has been closed.", "removed": removed}


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
    if user_copy is not None and user_copy.edition is not None:
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
    entry.edition_id = user_copy.edition_id if user_copy else None
    if user_copy:
        entry.summary = None if hide_private else user_copy.summary
        entry.thought = user_copy.thought
        entry.marketed = user_copy.marketed
        entry.is_author = bool(user_copy.is_author)
        entry.rating_expertise = user_copy.rating_expertise
        entry.rating_reading = user_copy.rating_reading
        entry.rating_liking = user_copy.rating_liking
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
        stats=stats,
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
    Upload a PDF, extract DOI, fetch metadata from CrossRef.
    Returns extracted metadata for user to review/edit.
    Does not save to database yet.
    """
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    filename, _ = _store_pdf(await file.read())
    file_path = UPLOADS_DIR / filename

    # Extract DOI from PDF
    doi, _ = extract_doi_from_pdf(str(file_path))

    # Default metadata from filename
    metadata = {
        "doi": doi,
        "title": get_title_from_filename(file.filename),
        "authors": None,
        "journal": None,
        "year": None,
        "file_path": filename
    }

    # If DOI found, fetch metadata from CrossRef
    if doi:
        crossref_data = await fetch_metadata_from_doi(doi)
        if crossref_data:
            metadata.update({
                "doi": crossref_data.get("doi") or doi,
                "title": crossref_data.get("title") or metadata["title"],
                "authors": crossref_data.get("authors"),
                "journal": crossref_data.get("journal"),
                "year": crossref_data.get("year"),
            })

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


def _clear_other_places(db: Session, paper_id: int, user_id: int, keep_id: int | None):
    """A reader has one place in a paper. Marking a new one removes the old
    marker entirely — it was a note of where they were, and they are no
    longer there."""
    q = db.query(Comment).filter(
        Comment.paper_id == paper_id,
        Comment.user_id == user_id,
        Comment.current_place.is_(True),
    )
    if keep_id is not None:
        q = q.filter(Comment.id != keep_id)
    for other in q.all():
        db.delete(other)


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
        current_place=bool(c.current_place),
        name=c.name,
    )


def _copy_of(paper: Paper, viewer: User | None) -> Copy | None:
    if viewer is None:
        return None
    return next((r for r in paper.copies if r.user_id == viewer.id), None)


def _paper_detail(db: Session, paper: Paper, viewer: User | None) -> PaperSchema:
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
        file_path=_edition_file(paper, user_copy),
        created_at=paper.created_at,
    )
    detail.editions = [PaperEditionOut.model_validate(e) for e in paper.editions]
    latest = _latest_edition(paper)
    detail.latest_edition = (
        PaperEditionOut.model_validate(latest) if latest else None
    )
    detail.edition_id = (
        user_copy.edition_id if user_copy and user_copy.edition_id
        else (latest.id if latest else None)
    )
    detail.ignored_edition_id = user_copy.ignored_edition_id if user_copy else None
    if user_copy:
        detail.summary = user_copy.summary
        detail.thought = user_copy.thought
        detail.marketed = user_copy.marketed
        detail.is_author = bool(user_copy.is_author)
        detail.rating_expertise = user_copy.rating_expertise
        detail.rating_reading = user_copy.rating_reading
        detail.rating_liking = user_copy.rating_liking
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

    db.add(Copy(
        paper_id=db_paper.id,
        user_id=current_user.id,
        edition_id=edition.id,
        summary=paper.summary,
        thought=paper.thought,
        marketed=paper.marketed,
        is_author=paper.is_author,
        rating_expertise=paper.rating_expertise,
        rating_reading=paper.rating_reading,
        rating_liking=paper.rating_liking,
    ))

    if paper.initial_comment and paper.initial_comment.strip():
        db.add(Comment(
            paper_id=db_paper.id,
            user_id=current_user.id,
            content=paper.initial_comment.strip(),
        ))
    db.commit()
    db.refresh(db_paper)
    return _paper_detail(db, db_paper, current_user)


@app.get("/api/papers/{paper_ref:path}", response_model=PaperSchema)
async def get_paper(
    paper_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a paper by id or DOI, merged with the viewer's own copy and notes.
    Signed-in readers only."""
    paper = _resolve_paper_or_404(paper_ref, db)
    _require_visible(paper, current_user)
    return _paper_detail(db, paper, current_user)


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
    personal = {k: v for k, v in update_data.items() if k in _PERSONAL_FIELDS}
    metadata = {k: v for k, v in update_data.items() if k in _METADATA_FIELDS}

    if personal:
        user_copy = _require_copy(paper, current_user)
        if personal.get("marketed") is False and _in_active_cohort(
            db, current_user, _paper_key_for(paper)
        ):
            raise HTTPException(
                status_code=400,
                detail="You are in a seminar cohort for this paper. "
                "Leave the cohort before hiding the paper.",
            )
        for key, value in personal.items():
            setattr(user_copy, key, value)

    for key, value in metadata.items():
        setattr(paper, key, value)

    db.commit()
    db.refresh(paper)
    return _paper_detail(db, paper, current_user)


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
    db.add(Copy(
        paper_id=paper.id,
        user_id=current_user.id,
        marketed=True,
        edition_id=latest.id if latest else None,
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

    Runs after the response, on its own session: the request that asked is
    already answered with `pending`, and the viewer comes back for the
    result. Any failure is recorded on the edition rather than raised, so
    a PDF that cannot be analyzed says so instead of being retried
    forever."""
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

        _finish_analysis(db, edition, "ready", None)
        logger.info(
            f"Edition {edition_id}: {len(analysis.references)} references, "
            f"{len(analysis.citations)} citation markers"
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


@app.get("/api/editions/{edition_id}/references", response_model=EditionReferences)
async def edition_references(
    edition_id: int,
    background: BackgroundTasks,
    refresh: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The references of one edition, and where they are cited in it.

    The first ask starts the analysis and answers `pending`; the viewer
    asks again until it is `ready`. Pass `refresh=true` to read a PDF
    again — the way to retry one GROBID could not handle."""
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
            detail="This Papol has no reference analyzer configured.",
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

    if reference.resolved_status is None:
        try:
            status, summary = await biblio.resolve(reference)
        except Exception as e:
            logger.warning(f"Could not resolve reference {reference_id}: {e}")
            status, summary = "error", None
        if status == "error":
            # Nobody could be asked just now — a lookup service was down or
            # its daily allowance was spent. That is a fact about today, not
            # about this reference, so nothing is stored and the next open
            # tries again.
            answer = _reference_out(reference, None)
            answer.resolved_status = "error"
            return answer
        reference.resolved_status = status
        reference.resolution = json.dumps(summary) if summary else None
        reference.resolved_at = datetime.utcnow()
        db.commit()

    known = _papol_papers_for(db, [reference])
    return _reference_out(reference, known.get(reference.id))


def _reference_out(reference: EditionReference, papol_paper_id: int | None) -> ReferenceOut:
    resolution = None
    if reference.resolution:
        try:
            resolution = ResolvedWork(**json.loads(reference.resolution))
        except Exception:
            resolution = None
    return ReferenceOut(
        id=reference.id,
        key=reference.key,
        index=reference.index,
        raw=reference.raw,
        title=reference.title,
        year=reference.year,
        page=reference.page,
        y=reference.y,
        resolved_status=reference.resolved_status,
        resolution=resolution,
        papol_paper_id=papol_paper_id,
    )


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
        page=stroke.page,
        points=json.loads(stroke.points),
        color=stroke.color,
        width=stroke.width,
        opacity=stroke.opacity,
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
        edition_id=edition_id,
        user_id=current_user.id,
        page=stroke.page,
        points=json.dumps([p.model_dump() for p in stroke.points]),
        color=stroke.color,
        width=stroke.width,
        opacity=stroke.opacity,
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
        current_place=comment.current_place,
        name=(comment.name or "").strip() or None,
    )
    if comment.current_place:
        _clear_other_places(db, paper_id, current_user.id, None)
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
    if comment.current_place is not None:
        db_comment.current_place = comment.current_place
        if comment.current_place:
            _clear_other_places(
                db, db_comment.paper_id, current_user.id, db_comment.id
            )
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
            detail="Add this paper to your nook, and keep it on display, "
            "to take part in the cohort",
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
            detail="Only readers who display this paper in their nook can call a seminar",
        )
    active = (
        db.query(Room)
        .filter(Room.paper_key == key, Room.status.in_(("open", "planning")))
        .first()
    )
    if active:
        raise HTTPException(
            status_code=400, detail="A seminar is already being organized for this paper"
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
            detail="Only a reader with a displayed entry of this paper can host",
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
                status_code=400, detail="The new host must be another cohort member"
            )
        if successor_id not in _reader_ids(db, room.paper_key, public_only=True):
            raise HTTPException(
                status_code=400,
                detail="Only a reader with a displayed entry of this paper can host",
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
        raise HTTPException(status_code=403, detail="Only the host can mark the seminar finished")
    if room.status != "scheduled":
        raise HTTPException(status_code=400, detail="Only a scheduled seminar can be finished")
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
            f"Read and reply in your inbox: {_site_url(db)}#/inbox\n\n"
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
            f"Reports are listed on the admin page: {_site_url(db)}#/admin",
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


@app.get("/{filename}")
async def serve_frontend_root_file(filename: str):
    """Files Vite copies to the top of the build — favicon.svg,
    apple-touch-icon.png, and anything else dropped in frontend/public.

    /assets is mounted, and index.html has a route of its own, but the files
    beside them had nowhere to be served from and answered 404. Registered
    last, so every /api route above still matches first, and confined to one
    path segment: {filename} does not match a slash, and the resolved path is
    checked to be a file directly in the build rather than something reached
    from it.
    """
    candidate = (FRONTEND_DIR / filename).resolve()
    if candidate.parent != FRONTEND_DIR.resolve() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(candidate, headers=_REVALIDATE)
