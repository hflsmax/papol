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


def opens_without_account(paper: Paper) -> bool:
    """Whether this paper's page opens for someone with no account.

    The edge of the Library, not a fact about the paper: a signed-in user
    may open any paper; a visitor may open one only where someone displays
    it (US-1.4).

    Sharing asks because a sharable is deliberately unauthenticated and
    cannot know whether the person holding it has an account. Offering a
    link that answers "not found" is worse than offering none, so the
    answer given is the one that holds for a visitor.
    """
    return bool(displayed_copies(paper))
