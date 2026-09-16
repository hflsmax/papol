"""Sharables: one user's reading of one edition, given away by link.

A user's annotations are private. A sharable is the single, deliberate exception:
it names a reading — this user, this PDF — and whoever holds the link may
read it, signed in or not. The UUID in the link is the whole of the
permission, so everything here is about establishing that the UUID is live
and then answering with exactly the reading it names, and nothing else in
that user's nook.

A link carries one of two things, and whose it is follows from which. A
*rich* link carries the reading: the PDF with this user's annotations on
it. It is theirs — it sits on their paper page, and only they can take their
annotations out of it or close it. A *lean* link carries the PDF alone, and is
nobody's: one per edition, handed to whoever asks, naming no user and
implying none. Nothing about it is reported back to the user who first
asked for it, because there is nothing of theirs in it to report. Which one a
link is gets decided when it is made, and never rises afterwards.

The reading is named rather than copied, so what a visitor sees is what the
user has now. Take the paper out of the nook and the reading a rich link
named no longer exists, so the link becomes lean instead of dying: the paper
is what remains of it. Revoking is what closes a link altogether.
"""

from datetime import datetime

from models import Annotation, Copy, PaperEdition, Shelf, Sharable, User
from schemas import SharedPaper, SharedReading, UserPublic
from services.annotations import annotation_out, annotations_of
from sqlalchemy.orm import Session
from sync.changes import commit_sync


RICH = "rich"
LEAN = "lean"


def open_sharable(db: Session, sharable_uuid: str) -> Sharable | None:
    """The live sharable named by a link, or None if there is no such link
    or its maker has taken it back.

    Every link comes through here, which is why the demotion lives here too:
    a paper can leave a nook down two different roads — the web endpoint and
    a synchronized delete from the desktop — and only this one is common to
    both."""
    if not sharable_uuid:
        return None
    sharable = (
        db.query(Sharable)
        .filter(Sharable.uuid == sharable_uuid, Sharable.revoked_at.is_(None))
        .first()
    )
    if sharable is None:
        return None
    if sharable.kind == RICH:
        # A user who closed their account left their nook behind as a
        # tombstone; nothing of theirs is handed out under their name again.
        # Only a reading can be withdrawn this way — a link to the paper
        # alone was never theirs to take with them.
        if sharable.user is None or sharable.user.is_deleted:
            return None
        if not _still_in_their_nook(db, sharable):
            # Written down rather than worked out on each read, so that
            # putting the paper back cannot quietly re-enrich a link already
            # handed out. The user lets go of it in the same breath: what
            # is left is the paper, which is nobody's.
            _strip_to_the_paper(sharable)
            db.commit()
    return sharable


def live_sharable_for(db: Session, user: User, edition_uuid: str) -> Sharable | None:
    """The link this user has out for this edition, if any.

    Always one carrying their annotations: a link to the paper alone is nobody's,
    so it is not theirs to be shown, stopped, or held against them."""
    return (
        db.query(Sharable)
        .filter(
            Sharable.user_uuid == user.uuid,
            Sharable.kind == RICH,
            Sharable.edition_uuid == edition_uuid,
            Sharable.revoked_at.is_(None),
        )
        .order_by(Sharable.created_at.desc())
        .first()
    )


def live_paper_link_for(db: Session, edition_uuid: str) -> Sharable | None:
    """The link this edition already has out to the PDF alone, if any.

    Not keyed to whoever asks: the PDF has one address, and two users
    handing the same paper on hand on the same link."""
    return (
        db.query(Sharable)
        .filter(
            Sharable.kind == LEAN,
            Sharable.user_uuid.is_(None),
            Sharable.edition_uuid == edition_uuid,
            Sharable.revoked_at.is_(None),
        )
        .order_by(Sharable.created_at)
        .first()
    )


def share_reading(
    db: Session, user: User, copy: Copy, edition: PaperEdition, kind: str = LEAN,
) -> Sharable:
    """The link this ask calls for, made if there is not one already.

    Asking twice gives the same link back rather than a second one — a
    user asking again means "where is the link", not "give me another" —
    but what "already" means differs with the kind. A reading is theirs, so
    it is theirs that is found again. The paper's link is nobody's, so any
    live one for this edition is the answer, whoever first asked for it and
    whoever is asking now. A revoked link is not resurrected: taking one
    back is meant to be final, so the next ask mints a new UUID and the old
    link stays dead."""
    existing = (
        live_sharable_for(db, user, edition.uuid) if kind == RICH
        else live_paper_link_for(db, edition.uuid)
    )
    if existing is not None:
        return existing
    sharable = Sharable(
        kind=kind,
        # Nobody's, when what is handed over is the paper alone.
        user_uuid=user.uuid if kind == RICH else None,
        paper_uuid=copy.paper_uuid,
        edition_uuid=edition.uuid,
    )
    db.add(sharable)
    db.commit()
    db.refresh(sharable)
    return sharable


def make_lean(db: Session, sharable: Sharable) -> Sharable:
    """Take the user's annotations out of a link without closing it.

    The gentler half of stopping: whoever was given the link keeps the
    paper, and stops seeing what was written on it. The user lets go of
    the link in the same movement — what is left of it is the paper, which
    is nobody's — so it leaves their paper page and there is nothing more
    for them to do to it. Only ever downwards: a link that has been lean
    cannot be enriched again, because the people holding it were never
    promised the annotations."""
    if sharable.kind != LEAN:
        _strip_to_the_paper(sharable)
        db.commit()
    return sharable


def _strip_to_the_paper(sharable: Sharable) -> None:
    """What is left of a reading once the annotations are gone: the paper, held
    by nobody. Written down rather than worked out on each read, and the
    user is released from it in the same stroke."""
    sharable.kind = LEAN
    sharable.user_uuid = None


def revoke(db: Session, sharable: Sharable) -> None:
    if sharable.revoked_at is None:
        sharable.revoked_at = datetime.utcnow()
        db.commit()


def shared_reading(db: Session, sharable: Sharable) -> SharedReading:
    """Everything the link opens, and nothing else."""
    edition = sharable.edition
    paper = sharable.paper
    # A lean link was never carrying annotations, and a rich one that lost
    # its copy has already been demoted by open_sharable. Either way the
    # kind is the whole answer here.
    return SharedReading(
        uuid=sharable.uuid,
        kind=sharable.kind,
        created_at=sharable.created_at,
        # Named only by a reading. A link to the paper alone is nobody's,
        # and saying who asked for it would be inventing a claim it does
        # not make.
        user=(
            UserPublic.model_validate(sharable.user)
            if sharable.user is not None else None
        ),
        paper=SharedPaper(
            doi=paper.doi,
            title=paper.title,
            authors=paper.authors,
            journal=paper.journal,
            year=paper.year,
            file_path=edition.file_path,
            edition_uuid=edition.uuid,
            edition_sha256=edition.sha256,
        ),
        annotations=[
            annotation_out(row) for row in _shared_annotations(db, sharable)
        ],
    )


def _shared_annotations(db: Session, sharable: Sharable) -> list[Annotation]:
    """The user's annotations on this reading: the ones made on this PDF,
    and the notes they wrote about the paper without placing anywhere. Annotations
    made on a different edition are annotations on a different file and stay where
    they were made."""
    if sharable.kind != RICH:
        return []
    return [
        row for row in annotations_of(
            db, sharable.user_uuid, paper_uuid=sharable.paper_uuid,
        )
        if row.edition_uuid in (sharable.edition_uuid, None)
    ]


def _still_in_their_nook(db: Session, sharable: Sharable) -> bool:
    """Whether the user still keeps the paper they shared a reading of."""
    return db.query(Copy).filter(
        Copy.user_uuid == sharable.user_uuid,
        Copy.paper_uuid == sharable.paper_uuid,
        Copy.deleted_at.is_(None),
    ).first() is not None


def copy_in_nook(db: Session, user: User, sharable: Sharable) -> Copy | None:
    """This visitor's own copy of the shared paper, if they keep one.

    Asked of the paper rather than the edition: a user who adopted a
    different PDF of the same paper still has it, and pointing them at what
    they already keep is the honest answer to "is this mine yet".
    """
    return db.query(Copy).filter(
        Copy.user_uuid == user.uuid,
        Copy.paper_uuid == sharable.paper_uuid,
        Copy.deleted_at.is_(None),
    ).first()


def take_into_nook(db: Session, user: User, sharable: Sharable) -> Copy:
    """Give this visitor the shared paper, and none of the sharer's annotations.

    The paper comes across; the annotations stay with their author. A copied note
    would be indistinguishable from one of this user's own forever — no
    annotation records where it came from — and resharing would send the sharer's
    words out under a name that is not theirs. So what lands is a clean
    copy: the paper, on the exact PDF the link opened, with nothing written
    on it.

    The edition is the shared one, not the paper's newest. The link handed
    over a particular file, and the annotations its holder just read were on that
    file; landing them on a different PDF would be answering a question
    they did not ask. A newer edition is offered on the paper page
    afterwards, the same as for anyone else.
    """
    # Their default shelf, the same one the ordinary add uses: a paper that
    # arrives is a paper that arrives, and where it lands should not depend
    # on how it was found. Worth knowing that the default shelf is usually a
    # displayed one, so this can make public a paper nobody was displaying —
    # which the ordinary add never can, since it requires the paper to be
    # visible already. Chosen deliberately: one rule for where an added
    # paper goes, and moving it is a shelf away.
    #
    # Asked of the session doing the work rather than of the user object,
    # which may have been loaded somewhere else entirely.
    shelves = db.query(Shelf).filter(
        Shelf.user_uuid == user.uuid, Shelf.deleted_at.is_(None),
    ).order_by(Shelf.created_at).all()
    shelf = next((s for s in shelves if s.is_default), None) or shelves[0]
    copy = Copy(
        paper_uuid=sharable.paper_uuid,
        user_uuid=user.uuid,
        shelf=shelf,
        edition_uuid=sharable.edition_uuid,
        edition_sha256=sharable.edition.sha256,
    )
    db.add(copy)
    # Through the change log, like every other copy: a user who adds a
    # shared paper on the web must find it on their Mac too.
    commit_sync(db)
    db.refresh(copy)
    return copy
