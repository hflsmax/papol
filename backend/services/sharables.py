"""Sharables: one reader's reading of one edition, given away by link.

A reader's marks are private. A sharable is the single, deliberate exception:
it names a reading — this reader, this PDF — and whoever holds the link may
read it, signed in or not. The UUID in the link is the whole of the
permission, so everything here is about establishing that the UUID is live
and then answering with exactly the reading it names, and nothing else in
that reader's nook.

The reading is named rather than copied, so what a visitor sees is what the
reader has now — down to nothing at all, once they no longer keep the paper.
Revoking is what closes the link itself.
"""

from datetime import datetime

from models import Comment, Copy, InkStroke, Paper, PaperClip, PaperEdition, Sharable, User
from schemas import SharedNote, SharedPaper, SharedReading, UserPublic
from services.annotations import anchor_of, clip_out, stroke_out
from sqlalchemy.orm import Session


def open_sharable(db: Session, sharable_uuid: str) -> Sharable | None:
    """The live sharable named by a link, or None if there is no such link
    or its maker has taken it back."""
    if not sharable_uuid:
        return None
    sharable = (
        db.query(Sharable)
        .filter(Sharable.uuid == sharable_uuid, Sharable.revoked_at.is_(None))
        .first()
    )
    if sharable is None:
        return None
    # A reader who closed their account left their nook behind as a
    # tombstone; nothing of theirs is handed out under their name again.
    if sharable.user is None or sharable.user.is_deleted:
        return None
    return sharable


def live_sharable_for(db: Session, user: User, edition_uuid: str) -> Sharable | None:
    """The link this reader already has out for this edition, if any."""
    return (
        db.query(Sharable)
        .filter(
            Sharable.user_uuid == user.uuid,
            Sharable.edition_uuid == edition_uuid,
            Sharable.revoked_at.is_(None),
        )
        .order_by(Sharable.created_at.desc())
        .first()
    )


def share_reading(db: Session, user: User, copy: Copy, edition: PaperEdition) -> Sharable:
    """The link for this reader's reading of this edition, made if needed.

    Asking twice gives the same link back rather than a second one: a reader
    who opens the share menu again means "where is my link", not "give me
    another". A revoked link is not resurrected — taking one back is meant
    to be final, so the next ask mints a new UUID and the old link stays
    dead."""
    existing = live_sharable_for(db, user, edition.uuid)
    if existing is not None:
        return existing
    sharable = Sharable(
        user_uuid=user.uuid,
        paper_uuid=copy.paper_uuid,
        edition_uuid=edition.uuid,
    )
    db.add(sharable)
    db.commit()
    db.refresh(sharable)
    return sharable


def revoke(db: Session, sharable: Sharable) -> None:
    if sharable.revoked_at is None:
        sharable.revoked_at = datetime.utcnow()
        db.commit()


def shared_reading(db: Session, sharable: Sharable) -> SharedReading:
    """Everything the link opens, and nothing else."""
    edition = sharable.edition
    paper = sharable.paper
    # A reading belongs to a copy. Once the reader takes the paper out of
    # their nook they are no longer reading it, and the link opens the PDF
    # they shared with nothing on it — the same live view that carries a
    # reworded note to everyone holding the link, carrying its absence.
    # Their marks are not destroyed by this; leaving a nook is not meant to
    # be a deletion, and re-adding the paper brings the reading back.
    kept = _still_in_their_nook(db, sharable)
    notes = _notes(db, sharable) if kept else []
    ink = _ink(db, sharable) if kept else []
    clips = _clips(db, sharable) if kept else []
    return SharedReading(
        uuid=sharable.uuid,
        created_at=sharable.created_at,
        reader=UserPublic.model_validate(sharable.user),
        paper=SharedPaper(
            uuid=paper.uuid if _paper_is_public(paper) else None,
            doi=paper.doi,
            title=paper.title,
            authors=paper.authors,
            journal=paper.journal,
            year=paper.year,
            file_path=edition.file_path,
            edition_uuid=edition.uuid,
            edition_sha256=edition.sha256,
        ),
        notes=[_note_out(note) for note in notes],
        ink=[stroke_out(stroke) for stroke in ink],
        clips=[clip_out(clip) for clip in clips],
    )


def _still_in_their_nook(db: Session, sharable: Sharable) -> bool:
    """Whether the reader still keeps the paper they shared a reading of."""
    return db.query(Copy).filter(
        Copy.user_uuid == sharable.user_uuid,
        Copy.paper_uuid == sharable.paper_uuid,
        Copy.deleted_at.is_(None),
    ).first() is not None


def _paper_is_public(paper: Paper) -> bool:
    """Whether the paper's own page opens for a visitor. A shared reading
    links to it when it does, and says nothing when it does not."""
    return any(copy.marketed and copy.deleted_at is None for copy in paper.copies)


def _notes(db: Session, sharable: Sharable) -> list[Comment]:
    """The reader's notes on this reading: the ones placed on this PDF, and
    the ones they wrote about the paper without pinning anywhere. Notes
    placed on a different edition are marks on a different file and stay
    where they were made."""
    return (
        db.query(Comment)
        .filter(
            Comment.user_uuid == sharable.user_uuid,
            Comment.paper_uuid == sharable.paper_uuid,
            Comment.deleted_at.is_(None),
            (Comment.edition_uuid == sharable.edition_uuid)
            | (Comment.edition_uuid.is_(None)),
        )
        .order_by(Comment.created_at)
        .all()
    )


def _ink(db: Session, sharable: Sharable) -> list[InkStroke]:
    """Oldest first, which is the order it has to be drawn in for later ink
    to sit over earlier ink."""
    return (
        db.query(InkStroke)
        .filter(
            InkStroke.user_uuid == sharable.user_uuid,
            InkStroke.edition_uuid == sharable.edition_uuid,
            InkStroke.deleted_at.is_(None),
        )
        .order_by(InkStroke.created_at)
        .all()
    )


def _clips(db: Session, sharable: Sharable) -> list[PaperClip]:
    return (
        db.query(PaperClip)
        .filter(
            PaperClip.user_uuid == sharable.user_uuid,
            PaperClip.edition_uuid == sharable.edition_uuid,
            PaperClip.deleted_at.is_(None),
        )
        .order_by(PaperClip.created_at)
        .all()
    )


def _note_out(note: Comment) -> SharedNote:
    return SharedNote(
        uuid=note.uuid,
        content=note.content,
        created_at=note.created_at,
        page=note.page,
        anchor_type=note.anchor_type,
        anchor=anchor_of(note),
        edition_uuid=note.edition_uuid,
        name=note.name,
    )
