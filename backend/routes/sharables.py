from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import Paper, Sharable, User
from schemas import SharableOut, SharedReading
from services.editions import edition_for
from services.sharables import open_sharable, revoke, share_reading, shared_reading
from sqlalchemy.orm import Session

router = APIRouter()

# ---------------- Sharables ----------------

@router.post("/api/papers/{paper_uuid}/sharable", response_model=SharableOut)
async def create_sharable(
    paper_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hand out this reader's reading of this paper.

    What is shared is the edition they are reading now, so the link opens
    the file their notes and ink are actually on. Adopting a newer edition
    later does not move the link: it was this reading that was given away.
    """
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
    return SharableOut.model_validate(share_reading(db, current_user, copy, edition))


@router.delete("/api/sharables/{sharable_uuid}", status_code=204)
async def revoke_sharable(
    sharable_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take a link back. Anyone still holding it is told it is no longer
    shared, rather than that it never existed."""
    sharable = db.query(Sharable).filter(Sharable.uuid == sharable_uuid).first()
    if sharable is None or sharable.user_uuid != current_user.uuid:
        raise HTTPException(status_code=404, detail="Sharable not found")
    revoke(db, sharable)


@router.get("/api/shared/{sharable_uuid}", response_model=SharedReading)
async def read_sharable(sharable_uuid: str, db: Session = Depends(get_db)):
    """The reading a link opens. Deliberately unauthenticated: the whole
    point of the link is that it works for someone who is not a reader
    here, and the UUID is what stands in for a permission."""
    sharable = open_sharable(db, sharable_uuid)
    if sharable is None:
        raise HTTPException(
            status_code=404, detail="This reading is no longer shared",
        )
    return shared_reading(db, sharable)
