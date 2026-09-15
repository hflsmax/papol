"""Which PDF of a paper a given reader is reading.

A paper's editions are its files, oldest first, and a reader's copy names
the one they chose. One rule answers "which file", and every surface that
has to agree on it — the paper page, the viewer, a shared link — asks here.
"""

from models import Copy, Paper, PaperEdition


def latest_edition(paper: Paper) -> PaperEdition | None:
    return paper.editions[-1] if paper.editions else None


def edition_for(paper: Paper, user_copy: Copy | None) -> PaperEdition | None:
    """The edition a viewer opens: the one their copy is pinned to, or the
    latest when they have no copy or their copy names none."""
    if user_copy is not None:
        if user_copy.edition_sha256:
            selected = next(
                (edition for edition in paper.editions if edition.sha256 == user_copy.edition_sha256),
                None,
            )
            if selected is not None:
                return selected
        if user_copy.edition is not None:
            return user_copy.edition
    return latest_edition(paper)
