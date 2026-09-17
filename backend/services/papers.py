"""Facts about a paper that hold for everyone, not for one user.

A paper is one thing; what each user keeps of it is a copy. Nobody owns the
paper, so nothing here asks whose it is.

What display still answers is narrower and belongs to the copy, not the
paper: which users are shown standing against it.
"""

import re

from models import Copy, Paper
from sqlalchemy.orm import Session

# The length of a paper's name in a URL: the first half of its digest, which is
# the same size as the UUID every other row goes by. Kept beside
# shared/paperName.js, which writes the links this reads.
PAPER_NAME_LENGTH = 32

_NAME = re.compile(rf"[0-9a-f]{{{PAPER_NAME_LENGTH}}}")


def paper_name(sha256: str) -> str:
    """The name a paper goes by in a URL and on the wire.

    The mirror of shared/paperName.js, which writes what this reads.
    """
    return (sha256 or "")[:PAPER_NAME_LENGTH].lower()


class AmbiguousPaperName(Exception):
    """One name, more than one paper. See paper_by_name."""


def paper_by_name(name: str, db: Session) -> Paper | None:
    """The paper a name refers to, or None.

    One shape of name and no other, so there is nothing here to decide. The
    stored identity is untouched by this — every row, foreign key, blob and
    integrity check is still the full digest, and the name has become one
    again by the time this returns. Nothing past this function holds half of
    one.

    Two papers cannot quietly share a name. 128 bits is enough that a clash
    would be a bug rather than a coincidence, so the ambiguous case is refused
    out loud instead of being settled by picking one.
    """
    name = (name or "").strip().lower()
    if not _NAME.fullmatch(name):
        return None
    # A prefix range rather than LIKE: it reads straight off the primary key,
    # and no character of a digest can be a wildcard.
    matches = db.query(Paper).filter(
        Paper.sha256 >= name, Paper.sha256 < name + "g",
    ).limit(2).all()
    if len(matches) > 1:
        raise AmbiguousPaperName(name)
    return matches[0] if matches else None


def displayed_copies(paper: Paper) -> list[Copy]:
    """The copies whose users display this paper publicly."""
    return [copy for copy in paper.copies if copy.is_public and copy.deleted_at is None]
