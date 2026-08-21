"""Taking your things with you, and leaving.

Two halves of the same promise: a reader can walk out of Papol with
everything they put into it, and can then ask Papol to forget them.

The export is deliberately readable. A zip of JSON is a technicality
dressed as a favour, so the notes are also written out as Markdown, and
the PDFs come with the names of the papers rather than the names of the
uploads.

Deleting is the harder half, because a reader's things are tangled with
other readers': a seminar they started that others joined, a PDF they
uploaded that others now read. What is theirs alone goes. What others
depend on stays, with their name taken off it.
"""

import json
import re
import unicodedata
import zipfile
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from models import (
    AuthToken,
    Comment,
    Copy,
    Feedback,
    Notification,
    Paper,
    PaperEdition,
    Room,
    RoomAvailability,
    RoomMessage,
    RoomParticipant,
    User,
)


# ---------------------------------------------------------------- helpers


def _authors(paper: Paper) -> list:
    """Paper.authors is a JSON array kept as text, and has been written by
    several versions of the app. A bad value must not cost the reader
    their export."""
    if not paper.authors:
        return []
    try:
        value = json.loads(paper.authors)
    except (ValueError, TypeError):
        return [paper.authors]
    return value if isinstance(value, list) else [str(value)]


def _slug(text: str, limit: int = 60) -> str:
    """A filename a person would recognise, out of a paper's title."""
    text = unicodedata.normalize("NFKD", text or "")
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    text = re.sub(r"[\s_-]+", "-", text)
    return text[:limit].strip("-") or "paper"


def _when(value) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _paper_ref(paper: Paper) -> dict:
    return {
        "id": paper.id,
        "title": paper.title,
        "authors": _authors(paper),
        "journal": paper.journal,
        "year": paper.year,
        "doi": paper.doi,
    }


# ----------------------------------------------------------------- export


def gather(db: Session, user: User) -> dict:
    """Everything Papol holds about this reader, as plain data."""
    copies = (
        db.query(Copy).filter(Copy.user_id == user.id).order_by(Copy.created_at).all()
    )
    notes = (
        db.query(Comment)
        .filter(Comment.user_id == user.id)
        .order_by(Comment.paper_id, Comment.page, Comment.created_at)
        .all()
    )
    rooms = (
        db.query(Room)
        .join(RoomParticipant, RoomParticipant.room_id == Room.id)
        .filter(RoomParticipant.user_id == user.id)
        .order_by(Room.created_at)
        .all()
    )
    messages = (
        db.query(RoomMessage)
        .filter(RoomMessage.user_id == user.id)
        .order_by(RoomMessage.created_at)
        .all()
    )
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at)
        .all()
    )
    uploads = (
        db.query(PaperEdition)
        .filter(PaperEdition.uploaded_by == user.id)
        .order_by(PaperEdition.created_at)
        .all()
    )

    return {
        "profile": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "affiliation": user.affiliation,
            "email_public": user.email_public,
            "is_admin": user.is_admin,
            "joined": _when(user.created_at),
        },
        "nook": [
            {
                "paper": _paper_ref(c.paper),
                "summary": c.summary,
                "thought": c.thought,
                "on_display": c.marketed,
                "i_am_an_author": c.is_author,
                "ratings": {
                    "expertise": c.rating_expertise,
                    "reading": c.rating_reading,
                    "liking": c.rating_liking,
                },
                "added": _when(c.created_at),
            }
            for c in copies
            if c.paper is not None
        ],
        "notes": [
            {
                "id": n.id,
                "paper": _paper_ref(n.paper) if n.paper else None,
                "name": n.name,
                "content": n.content,
                "page": n.page,
                "anchor_type": n.anchor_type,
                "anchor": json.loads(n.anchor) if n.anchor else None,
                "is_my_place": n.current_place,
                "written": _when(n.created_at),
            }
            for n in notes
        ],
        "seminars": [
            {
                "id": r.id,
                "paper_title": r.paper_title,
                "status": r.status,
                "scheduled_time": r.scheduled_time,
                "platform": r.platform,
                "i_started_it": r.created_by == user.id,
                "i_am_leading": r.leader_id == user.id,
                "my_messages": [
                    {"content": m.content, "sent": _when(m.created_at)}
                    for m in messages
                    if m.room_id == r.id
                ],
            }
            for r in rooms
        ],
        "notifications": [
            {"content": n.content, "read": n.read, "received": _when(n.created_at)}
            for n in notifications
        ],
        "pdfs_i_uploaded": [
            {
                "paper": _paper_ref(e.paper) if e.paper else None,
                "file": e.file_path,
                "uploaded": _when(e.created_at),
            }
            for e in uploads
        ],
    }


def _notes_markdown(data: dict) -> str:
    """The notes again, for a person rather than a parser."""
    lines = [
        f"# Notes — {data['profile']['display_name']}",
        "",
        f"{len(data['notes'])} notes, exported {datetime.utcnow():%Y-%m-%d}.",
        "",
    ]
    by_paper: dict = {}
    for note in data["notes"]:
        title = note["paper"]["title"] if note["paper"] else "(paper since removed)"
        by_paper.setdefault(title, []).append(note)

    for title, notes in by_paper.items():
        lines += [f"## {title}", ""]
        for note in notes:
            where = f"page {note['page']}" if note["page"] else "not placed on the page"
            label = note["name"] or where
            head = f"### {label}"
            if note["name"] and note["page"]:
                head += f" — page {note['page']}"
            if note["is_my_place"]:
                head += "  *(where I left off)*"
            lines += [head, ""]
            # An anchor with nothing written on it is a mark, not a note —
            # say so rather than leaving a blank.
            lines += [note["content"] or "*(a mark, with nothing written on it)*", ""]
    return "\n".join(lines)


README = """\
Your Papol export
=================

Everything Papol holds about you, as of {date}.

  profile.json        Your account: name, email, affiliation, when you joined.
  nook.json           The papers in your nook, with your ratings, your private
                      summaries and your public one-line thoughts.
  notes.json          Every note you have written, with the page and the exact
                      spot on it where you placed each one.
  notes.md            The same notes, written out to be read.
  seminars.json       The seminar cohorts you joined, and what you said in them.
  notifications.json  What Papol has told you.
  uploads.json        The PDFs you contributed.
  pdfs/               The PDF of every paper in your nook, named after the
                      paper rather than after the upload.
{avatar}
The PDFs are the files as they were uploaded to Papol. They are the
publishers' documents, not Papol's, and your rights over them are whatever
they were before Papol held a copy.

This export does not include your password, which Papol cannot read either
— it stores a hash, not the word you typed.
"""


def write_zip(db: Session, user: User, uploads_dir: Path, out_path: Path) -> Path:
    """Write the reader's whole export to `out_path`.

    Written to a file rather than built in memory: a nook of a hundred
    papers is a few hundred megabytes of PDF, and the server should not
    have to hold that to hand it over.
    """
    data = gather(db, user)
    stamp = f"{datetime.utcnow():%Y-%m-%d}"
    root = f"papol-export-{stamp}"

    copies = db.query(Copy).filter(Copy.user_id == user.id).all()

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        avatar_line = ""
        if user.avatar_path:
            avatar = uploads_dir / user.avatar_path
            if avatar.exists():
                zf.write(avatar, f"{root}/avatar{avatar.suffix}")
                avatar_line = "  avatar" + avatar.suffix + (
                    "        Your picture.\n"
                )

        zf.writestr(
            f"{root}/README.txt", README.format(date=stamp, avatar=avatar_line)
        )
        for name, payload in (
            ("profile", data["profile"]),
            ("nook", data["nook"]),
            ("notes", data["notes"]),
            ("seminars", data["seminars"]),
            ("notifications", data["notifications"]),
            ("uploads", data["pdfs_i_uploaded"]),
        ):
            zf.writestr(
                f"{root}/{name}.json",
                json.dumps(payload, indent=2, ensure_ascii=False),
            )
        zf.writestr(f"{root}/notes.md", _notes_markdown(data))

        # One PDF per paper in the nook: the edition this reader actually
        # reads, which is not always the newest one.
        seen: set = set()
        for copy in copies:
            edition = copy.edition
            if edition is None and copy.paper is not None and copy.paper.editions:
                edition = copy.paper.editions[-1]
            if edition is None or copy.paper is None:
                continue
            source = uploads_dir / edition.file_path
            if not source.exists():
                continue
            name = _slug(copy.paper.title)
            if copy.paper.year:
                name = f"{name}-{copy.paper.year}"
            candidate, n = f"{name}.pdf", 2
            while candidate in seen:  # two papers can slug the same
                candidate, n = f"{name}-{n}.pdf", n + 1
            seen.add(candidate)
            zf.write(source, f"{root}/pdfs/{candidate}")

    return out_path


# ----------------------------------------------------------------- delete


def delete_account(db: Session, user: User, uploads_dir: Path) -> dict:
    """Remove the reader, and everything of theirs that is theirs alone.

    What other readers depend on is kept and disowned instead of deleted:
    a PDF they uploaded is still the PDF everyone else reads, and a
    seminar they started may have a cohort in it. Taking those away to
    honour one reader's departure would be taking them from everybody.
    """
    removed = {}
    user_id = user.id

    # Their own words and their own shelf go entirely.
    removed["notes"] = (
        db.query(Comment).filter(Comment.user_id == user_id).delete(synchronize_session=False)
    )
    removed["papers_in_nook"] = (
        db.query(Copy).filter(Copy.user_id == user_id).delete(synchronize_session=False)
    )
    removed["notifications"] = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .delete(synchronize_session=False)
    )
    removed["seminar_messages"] = (
        db.query(RoomMessage)
        .filter(RoomMessage.user_id == user_id)
        .delete(synchronize_session=False)
    )
    db.query(RoomAvailability).filter(
        RoomAvailability.user_id == user_id
    ).delete(synchronize_session=False)
    db.query(RoomParticipant).filter(
        RoomParticipant.user_id == user_id
    ).delete(synchronize_session=False)
    db.query(AuthToken).filter(AuthToken.user_id == user_id).delete(
        synchronize_session=False
    )
    db.flush()  # so the participant rows below no longer count this reader

    # A seminar they started. Room.created_by cannot be null, so the room
    # is handed to whoever is still in it — the leader first, then whoever
    # joined earliest. A room nobody is left in goes.
    rooms_deleted = 0
    for room in db.query(Room).filter(Room.created_by == user_id).all():
        heir = None
        if room.leader_id and room.leader_id != user_id:
            heir = room.leader_id
        else:
            successor = (
                db.query(RoomParticipant)
                .filter(RoomParticipant.room_id == room.id)
                .order_by(RoomParticipant.created_at, RoomParticipant.id)
                .first()
            )
            heir = successor.user_id if successor else None
        if heir is None:
            db.delete(room)  # cascades to participants, messages, availabilities
            rooms_deleted += 1
        else:
            room.created_by = heir
    removed["seminars_ended"] = rooms_deleted

    # Led but not started: the seminar carries on without a leader.
    db.query(Room).filter(Room.leader_id == user_id).update(
        {Room.leader_id: None}, synchronize_session=False
    )

    # A PDF others read stays; only the name on it goes.
    removed["pdfs_disowned"] = (
        db.query(PaperEdition)
        .filter(PaperEdition.uploaded_by == user_id)
        .update({PaperEdition.uploaded_by: None}, synchronize_session=False)
    )

    # A bug report is about Papol, not about them: it stays, unsigned.
    db.query(Feedback).filter(Feedback.user_id == user_id).update(
        {Feedback.user_id: None}, synchronize_session=False
    )

    avatar = user.avatar_path
    db.delete(user)
    db.commit()

    # Only once the row is certainly gone, so a failed commit never leaves
    # an account pointing at a file that is not there.
    if avatar:
        path = uploads_dir / avatar
        if path.exists():
            path.unlink()

    return removed
