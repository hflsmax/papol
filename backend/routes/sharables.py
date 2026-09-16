from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import Paper, Sharable, User
from schemas import SharableCreate, SharableOut, SharedInNook, SharedReading
from services.editions import edition_for
from services.sharables import (
    LEAN, RICH, copy_in_nook, live_sharable_for, make_lean, open_sharable,
    revoke, share_reading, shared_reading, take_into_nook,
)
from sqlalchemy.orm import Session

router = APIRouter()

# ---------------- Sharables ----------------

@router.post("/api/papers/{paper_uuid}/sharable", response_model=SharableOut)
async def create_sharable(
    paper_uuid: str,
    data: SharableCreate | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hand out this paper, with or without this user's annotations on it.

    What is shared is the edition they are reading now, so the link opens
    the file their notes and ink are actually on. Adopting a newer edition
    later does not move the link: it was this reading that was given away.

    With the annotations, the answer is their own link, made once and found again
    on every later ask. Without them, it is the edition's link — the same
    URL whoever asks — and asking for it is how a user gets hold of it to
    pass on, not a thing that happens to the paper. Either ask may be made
    while the other link is out: they are different links to different
    things, and neither is in the other's way."""
    paper = db.query(Paper).filter(
        Paper.uuid == paper_uuid, Paper.deleted_at.is_(None),
    ).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    copy = next(
        (row for row in paper.copies
         if row.user_uuid == current_user.uuid and row.deleted_at is None),
        None,
    )
    if copy is None:
        raise HTTPException(
            status_code=403, detail="Add this paper to your nook first",
        )
    edition = edition_for(paper, copy)
    if edition is None:
        raise HTTPException(
            status_code=409, detail="This paper has no readable PDF to share",
        )
    kind = RICH if (data and data.include_annotations) else LEAN
    return SharableOut.model_validate(
        share_reading(db, current_user, copy, edition, kind),
    )


@router.get("/api/papers/{paper_uuid}/sharable", response_model=SharableOut | None)
async def my_sharable(
    paper_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The link this user already has out on this paper, asked for alone.

    The paper carries this with it when the whole paper comes from here. On
    the desktop it does not: the paper is read from the local replica, and a
    sharable has nowhere to live there — the link must open for someone who
    is not this user, on a machine that is not this one. Without asking
    separately, every shared paper on the desktop would read as unshared: no
    way to stop a link that is out, and an offer to move to a newer edition
    that would leave that link serving the old one.

    Only ever a link carrying their annotations, as everywhere else: the paper's
    own link is nobody's, so it is not theirs to be shown or held against
    them. Nothing to report is an answer rather than a refusal — a paper
    this user does not keep, or one with no readable PDF, simply has no
    link of theirs on it."""
    paper = db.query(Paper).filter(
        Paper.uuid == paper_uuid, Paper.deleted_at.is_(None),
    ).first()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    copy = next(
        (row for row in paper.copies
         if row.user_uuid == current_user.uuid and row.deleted_at is None),
        None,
    )
    if copy is None:
        return None
    edition = edition_for(paper, copy)
    if edition is None:
        return None
    sharable = live_sharable_for(db, current_user, edition.uuid)
    return SharableOut.model_validate(sharable) if sharable else None


@router.post("/api/sharables/{sharable_uuid}/lean", response_model=SharableOut)
async def lean_sharable(
    sharable_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Drop this user's annotations from a link they have already handed out.

    The link keeps working, so nobody is left holding a dead URL; what it
    opens is the paper alone from now on."""
    sharable = db.query(Sharable).filter(Sharable.uuid == sharable_uuid).first()
    if (sharable is None or sharable.user_uuid != current_user.uuid
            or sharable.revoked_at is not None):
        raise HTTPException(status_code=404, detail="Sharable not found")
    return SharableOut.model_validate(make_lean(db, sharable))


@router.delete("/api/sharables/{sharable_uuid}", status_code=204)
async def revoke_sharable(
    sharable_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take a link back. Anyone still holding it is told it is no longer
    shared, rather than that it never existed.

    Only a link that is someone's can be taken back, and only by them. A
    link to the paper alone is nobody's: there is no one it would be
    answering to, and no one it is out of place with."""
    sharable = db.query(Sharable).filter(Sharable.uuid == sharable_uuid).first()
    if sharable is None or sharable.user_uuid != current_user.uuid:
        raise HTTPException(status_code=404, detail="Sharable not found")
    revoke(db, sharable)


@router.get("/api/shared/{sharable_uuid}", response_model=SharedReading)
async def read_sharable(sharable_uuid: str, db: Session = Depends(get_db)):
    """The reading a link opens. Deliberately unauthenticated: the whole
    point of the link is that it works for someone who is not a user
    here, and the UUID is what stands in for a permission."""
    sharable = open_sharable(db, sharable_uuid)
    if sharable is None:
        raise HTTPException(
            status_code=404, detail="This reading is no longer shared",
        )
    return shared_reading(db, sharable)


@router.get("/api/shared/{sharable_uuid}/nook", response_model=SharedInNook | None)
async def shared_in_nook(
    sharable_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Whether whoever is reading this link already keeps the paper.

    Asked so the viewer can offer the right thing — their own copy, or the
    chance to make one — rather than making them find out by pressing. Signed
    in, because the answer is about their nook and nobody else can be told
    it."""
    sharable = open_sharable(db, sharable_uuid)
    if sharable is None:
        raise HTTPException(
            status_code=404, detail="This reading is no longer shared",
        )
    copy = copy_in_nook(db, current_user, sharable)
    if copy is None:
        return None
    return SharedInNook(
        paper_uuid=copy.paper_uuid, edition_sha256=copy.edition_sha256,
    )


@router.post("/api/shared/{sharable_uuid}/add-to-nook", response_model=SharedInNook)
async def add_shared_to_nook(
    sharable_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take the shared paper into the user's own nook, clean.

    Its own route rather than the ordinary add, because the ordinary one
    asks whether the paper is visible — and a paper nobody displays is
    exactly what a link is for. Here the link is the authorization, the same
    as it is for reading: holding it is what entitles you to the paper, so
    holding it is what entitles you to keep the paper.

    What lands carries none of the sharer's annotations, and sits on the PDF the
    link opened rather than the paper's newest."""
    sharable = open_sharable(db, sharable_uuid)
    if sharable is None:
        raise HTTPException(
            status_code=404, detail="This reading is no longer shared",
        )
    existing = copy_in_nook(db, current_user, sharable)
    if existing is not None:
        raise HTTPException(
            status_code=400, detail="This paper is already in your nook",
        )
    copy = take_into_nook(db, current_user, sharable)
    return SharedInNook(
        paper_uuid=copy.paper_uuid, edition_sha256=copy.edition_sha256,
    )
