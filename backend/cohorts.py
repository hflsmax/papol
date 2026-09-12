"""Seminar cohort membership, shared by the API and desktop sync, which both
refuse to hide a paper its reader is still discussing."""

from sqlalchemy.orm import Session

from models import Paper, Room, User


def paper_key_for(paper: Paper) -> str:
    """Canonical identity of a paper: its DOI, falling back to its title."""
    if paper.doi:
        return "doi:" + paper.doi.strip().lower()
    return "title:" + paper.title.strip().lower()


def in_active_cohort(db: Session, user: User, key: str) -> bool:
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
