"""Taking your things with you, and leaving.

Two halves of the same promise: a reader can walk out of Papol with
everything they put into it, and can then ask Papol to forget them.

The export is deliberately readable. A zip of JSON is a technicality
dressed as a favour, so the notes are also written out as Markdown, and
the PDFs come with the names of the papers rather than the names of the
uploads.

Deleting is the harder half, because a reader's things are tangled with
other readers': a seminar they started that others joined, a PDF they
uploaded that others now read. So the row survives as a tombstone with
the person scrubbed out of it, and the rows that point at it go on
working. What was private goes; what was said to others stays, under
"A former reader".
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
    InkStroke,
    Notification,
    Paper,
    PaperEdition,
    Room,
    RoomAvailability,
    RoomMessage,
    RoomParticipant,
    Shelf,
    Tag,
    User,
    copy_tags,
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
    ink = (
        db.query(InkStroke)
        .filter(InkStroke.user_id == user.id)
        .order_by(InkStroke.id)
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
                "shelf": c.shelf.name if c.shelf else None,
                "i_am_an_author": c.is_author,
                "ratings": {
                    "expertise": c.rating_expertise,
                    "reading": c.rating_reading,
                    "liking": c.rating_liking,
                },
                "tags": [t.name for t in sorted(c.tags, key=lambda t: t.name.lower())],
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
                "written": _when(n.created_at),
            }
            for n in notes
        ],
        "ink": [
            {
                "id": i.id,
                "paper": _paper_ref(i.edition.paper) if i.edition and i.edition.paper else None,
                "edition_id": i.edition_id,
                "page": i.page,
                # Fractions of the page, y from the bottom — the same
                # coordinates a note's anchor uses.
                "points": json.loads(i.points),
                "color": i.color,
                "width": i.width,
                "opacity": i.opacity,
                "shape": i.shape,
                "drawn": _when(i.created_at),
            }
            for i in ink
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
  ink.json            What you drew on the page with the brush, as points on
                      the page rather than as a picture.
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
            ("ink", data["ink"]),
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


# -------------------------------------------------------------- tombstone

# What a closed account is called wherever it still shows: on a seminar
# someone else is still in, beside a message they left there.
FORMER_READER = "A former reader"

# No password can produce this, because verify_password wants a "salt$digest"
# and this has no "$". A tombstone cannot be signed into, ever.
UNUSABLE_PASSWORD = "closed-account-no-password"


def _hand_on_seminars(db: Session, user_id: int, eligible_hosts, notify):
    """Give away the seminars this reader was hosting.

    A seminar without a host is not merely untidy, it is stuck: hosting can
    only be claimed while a seminar is still `open`, so a planning or
    scheduled one whose host vanished could never be picked up again by
    anybody. Whoever is left in the cohort gets it.

    The successor is chosen the way leave_room makes a departing host choose
    one — a cohort member who displays this paper in their nook — and,
    among those, whoever joined earliest. If nobody in the cohort can host,
    the seminar goes back to `open` so that any reader of the paper may
    answer it, which is the state it was in before anyone led it.

    A finished seminar is left alone. It has already happened, and who ran
    it is part of the record rather than a job that needs doing.
    """
    handed = reopened = 0
    rooms = (
        db.query(Room)
        .filter(Room.leader_id == user_id, Room.status != "finished")
        .all()
    )
    for room in rooms:
        cohort = (
            db.query(RoomParticipant)
            .filter(
                RoomParticipant.room_id == room.id,
                RoomParticipant.user_id != user_id,
            )
            .order_by(RoomParticipant.created_at, RoomParticipant.id)
            .all()
        )
        allowed = eligible_hosts(room) if eligible_hosts else None
        successor = next(
            (p.user_id for p in cohort if allowed is None or p.user_id in allowed),
            None,
        )
        if successor is not None:
            room.leader_id = successor
            handed += 1
            if notify:
                notify(
                    room,
                    {successor},
                    "The host of the seminar on \u201c%s\u201d has closed their "
                    "account, so it is yours to host now." % room.paper_title,
                )
        else:
            # Back to the state a seminar is in before anyone leads it, so
            # it can be answered rather than sitting there unhostable.
            room.leader_id = None
            room.status = "open"
            reopened += 1
            if notify and cohort:
                notify(
                    room,
                    {p.user_id for p in cohort},
                    "The host of the seminar on \u201c%s\u201d has closed their "
                    "account. It is open again for someone to host." % room.paper_title,
                )
    return handed, reopened


def tombstone(
    db: Session,
    user: User,
    uploads_dir: Path,
    *,
    eligible_hosts=None,
    notify=None,
) -> dict:
    """Close the account, keeping the row and scrubbing the reader out of it.

    Deleting the row outright is the tidier-looking option and the wrong
    one. A seminar this reader started may have a cohort still in it, and
    the messages in it belong to everyone who was there. Those rows point
    here, so this row has to go on existing.

    What it stops being is a person. The name, the email, the affiliation
    and the picture go; the password is replaced with something no password
    can match; the notes, the nook and the notifications — private, and
    theirs alone — are deleted outright. What is left is a shape that a
    foreign key can point at.

    `eligible_hosts(room) -> set[int]` and `notify(room, user_ids, message)`
    come from main.py, which is where the rules about who may host and how
    a reader is told live. Both are optional so that this module can be
    exercised without dragging the whole app in behind it.
    """
    removed = {}
    user_id = user.id

    # Private, and theirs alone.
    removed["notes"] = (
        db.query(Comment).filter(Comment.user_id == user_id).delete(synchronize_session=False)
    )
    removed["ink"] = (
        db.query(InkStroke).filter(InkStroke.user_id == user_id).delete(
            synchronize_session=False
        )
    )
    copy_ids = [row[0] for row in db.query(Copy.id).filter(Copy.user_id == user_id).all()]
    if copy_ids:
        db.execute(copy_tags.delete().where(copy_tags.c.copy_id.in_(copy_ids)))
    removed["papers_in_nook"] = (
        db.query(Copy).filter(Copy.user_id == user_id).delete(synchronize_session=False)
    )
    removed["tags"] = (
        db.query(Tag).filter(Tag.user_id == user_id).delete(synchronize_session=False)
    )
    removed["shelves"] = (
        db.query(Shelf).filter(Shelf.user_id == user_id).delete(synchronize_session=False)
    )
    removed["notifications"] = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .delete(synchronize_session=False)
    )
    # Signed out of everywhere, and no way back in.
    removed["sessions"] = (
        db.query(AuthToken).filter(AuthToken.user_id == user_id).delete(
            synchronize_session=False
        )
    )

    # Out of the cohorts: someone who has closed their account is not going
    # to turn up to the seminar, and their free times mean nothing now.
    db.query(RoomAvailability).filter(
        RoomAvailability.user_id == user_id
    ).delete(synchronize_session=False)
    removed["seminars_left"] = (
        db.query(RoomParticipant)
        .filter(RoomParticipant.user_id == user_id)
        .delete(synchronize_session=False)
    )
    db.flush()  # so the cohorts below no longer contain this reader

    handed, reopened = _hand_on_seminars(db, user_id, eligible_hosts, notify)
    removed["seminars_handed_on"] = handed
    removed["seminars_reopened"] = reopened

    # What they said to other readers stays where they said it, under
    # "A former reader". Rooms they started stay too, and keep working,
    # because created_by still resolves.
    removed["messages_kept"] = (
        db.query(RoomMessage).filter(RoomMessage.user_id == user_id).count()
    )
    removed["pdfs_kept"] = (
        db.query(PaperEdition).filter(PaperEdition.uploaded_by == user_id).count()
    )

    avatar = user.avatar_path

    # Now scrub the reader out of the row. The email has to stay unique and
    # must not be a real address anyone could reach or re-register into;
    # .invalid is reserved by RFC 2606 for exactly this.
    user.email = f"deleted-{user_id}@papol.invalid"
    user.display_name = FORMER_READER
    user.affiliation = None
    user.avatar_path = None
    user.email_public = False
    user.is_admin = False
    user.password_hash = UNUSABLE_PASSWORD
    user.deleted_at = datetime.utcnow()
    db.commit()

    # Only once the row is certainly scrubbed, so a failed commit never
    # leaves an account pointing at a picture that is not there.
    if avatar:
        path = uploads_dir / avatar
        if path.exists():
            path.unlink()

    return removed
