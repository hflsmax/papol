"""Which paper a seminar is about, and who is in its cohort.

A seminar is about a *work*, not about a file. Two PDFs printing one DOI —
a preprint and the published version — are two papers, each with its own
copies and annotations, and there is still only one conversation to be had
about them. So a seminar names its paper by the work's identity rather
than by the digest that names the paper itself.

That identity is read off metadata a user may correct, which is the thing
to be careful about: a seminar remembers the key it was called under, so
whenever the metadata behind a key changes, the seminars standing on it
have to be carried over. `rekey_rooms` is that carry, and `update_paper`
is the one place a paper's metadata changes.

Shared by the API and desktop sync, which both refuse to hide a paper its
user is still discussing.
"""

from sqlalchemy.orm import Session

from models import Copy, Paper, Room, User


def paper_key_for(paper: Paper) -> str:
    """Canonical identity of a paper: its DOI, falling back to its title."""
    if paper.doi:
        return "doi:" + paper.doi.strip().lower()
    return "title:" + paper.title.strip().lower()


def key_of(doi, title) -> str:
    """The same answer, from the two columns rather than from a whole row.

    Kept beside `paper_key_for` and checked against it, so that reading the
    two columns a key is made of cannot drift from reading the paper.

    Written in Python rather than as SQL, deliberately: SQLite's `lower()`
    folds ASCII and leaves every other letter alone, so a title with an
    accent in it would key one way in a query and another way here. A key
    that is right for most papers is worse than a scan."""
    if doi:
        return "doi:" + doi.strip().lower()
    return "title:" + (title or "").strip().lower()


def papers_with_key(db: Session, key: str) -> list[str]:
    """The digests of the papers answering to this key.

    Reads the two columns the key is made of rather than loading every
    paper as a row with its copies hanging off it — which is what this was,
    and it cost a query per paper on every seminar request."""
    return [
        sha256
        for sha256, doi, title in db.query(Paper.sha256, Paper.doi, Paper.title)
        if key_of(doi, title) == key
    ]


def cohort_user_uuids(db: Session, key: str, public_only: bool = True) -> set[str]:
    """Everyone who keeps a paper answering to this key.

    `public_only` narrows it to those displaying it, which is who may call
    or host a seminar; everyone else is still told one was called."""
    digests = papers_with_key(db, key)
    if not digests:
        return set()
    copies = db.query(Copy).filter(Copy.paper_sha256.in_(digests)).all()
    return {copy.user_uuid for copy in copies if copy.is_public or not public_only}


def rekey_rooms(db: Session, paper: Paper, was: str) -> None:
    """Keep a paper's seminars attached to it when its metadata is corrected.

    A seminar stores the key it was called under, and any signed-in user
    may fix a paper's title or DOI for everyone. Before this, fixing one
    left every seminar on that paper behind at a key nothing answered to:
    the paper's page stopped listing them, the cohort could not be worked
    out, so nobody could be handed the hosting — and the guard that stops a
    user hiding a paper they are still discussing stopped firing, because
    it asks whether they are in the cohort of *this* paper's key.

    A key no longer naming this paper may still name another — the preprint
    to its published version — and the seminars there are that paper's.
    They stay.
    """
    now = paper_key_for(paper)
    if now == was:
        return
    if any(digest != paper.sha256 for digest in papers_with_key(db, was)):
        return
    for room in db.query(Room).filter(Room.paper_key == was).all():
        room.paper_key = now
        # The seminar was named after the paper. Corrected with it, rather
        # than left showing the title somebody has just said was wrong.
        room.paper_title = paper.title


def in_active_cohort(db: Session, user: User, key: str) -> bool:
    """True if the user is in the cohort of a still-active seminar (anything
    but finished) on this paper."""
    rooms = (
        db.query(Room)
        .filter(Room.paper_key == key, Room.status != "finished")
        .all()
    )
    return any(
        p.user_uuid == user.uuid for room in rooms for p in room.participants
    )
