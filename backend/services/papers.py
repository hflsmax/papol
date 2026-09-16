"""Facts about a paper that hold for everyone, not for one reader.

A paper is one thing; what each reader keeps of it is a copy. The questions
here are about the paper as the Library shows it — above all whether its own
page opens for someone who is not signed in, which decides what there is to
hand out when a reader shares it.
"""

from models import Copy, Paper


def displayed_copies(paper: Paper) -> list[Copy]:
    """The copies whose readers display this paper publicly."""
    return [copy for copy in paper.copies if copy.is_public and copy.deleted_at is None]


def page_is_public(paper: Paper) -> bool:
    """Whether this paper's own page opens for a visitor with no account.

    One reader displaying it is enough: the page is the paper's, and it is
    public as soon as anyone stands behind it. Sharing asks this because a
    link to a page that answers "not found" is worse than no link at all.
    """
    return bool(displayed_copies(paper))
