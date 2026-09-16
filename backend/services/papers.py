"""Facts about a paper that hold for everyone, not for one user.

A paper is one thing; what each user keeps of it is a copy. Nobody owns the
paper, so nothing here asks whose it is.

What display still answers is narrower and belongs to the copy, not the
paper: which users are shown standing against it.
"""

from models import Copy, Paper


def displayed_copies(paper: Paper) -> list[Copy]:
    """The copies whose users display this paper publicly."""
    return [copy for copy in paper.copies if copy.is_public and copy.deleted_at is None]
