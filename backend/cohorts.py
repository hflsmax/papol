"""Who is in a seminar's cohort.

A seminar is about one paper, and a paper is its PDF, so a cohort is simply
the users who keep that file. Both questions here are therefore about a
digest and nothing else.

Shared by the API and desktop sync, which both refuse to hide a paper its
user is still discussing.
"""

from sqlalchemy.orm import Session

from models import Copy, Room, RoomParticipant, User


def cohort_user_uuids(db: Session, paper_sha256: str, public_only: bool = True) -> set[str]:
    """Everyone who keeps this paper.

    `public_only` narrows it to those displaying it, which is who may call
    or host a seminar; everyone else is still told one was called."""
    copies = db.query(Copy).filter(
        Copy.paper_sha256 == paper_sha256, Copy.deleted_at.is_(None),
    ).all()
    return {copy.user_uuid for copy in copies if copy.is_public or not public_only}


def in_active_cohort(db: Session, user: User, paper_sha256: str) -> bool:
    """True if the user is in the cohort of a still-active seminar (anything
    but finished) on this paper."""
    return db.query(RoomParticipant).join(Room).filter(
        Room.paper_sha256 == paper_sha256,
        Room.status != "finished",
        RoomParticipant.user_uuid == user.uuid,
    ).first() is not None
