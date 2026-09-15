"""Everything a reader leaves on a paper, on the wire.

One row shape covers notes, ink and clips, because they were never three
kinds of thing — they are three ways of marking one page. What differs
between them is geometry, and geometry lives in `body` as JSON, which is
where a polyline and an anchor already lived before this module existed.

Reading a stored annotation back into the typed shape an application
understands is one job, done here, so that every surface handing annotations
out — a reader's own viewer, a link they shared, the desktop replica's
snapshot — hands out the same shapes.
"""

import json

from models import Annotation
from schemas import AnnotationOut, ClipBody, InkBody, NoteBody

NOTE = "note"
INK = "ink"
CLIP = "clip"
KINDS = (NOTE, INK, CLIP)

_BODIES = {NOTE: NoteBody, INK: InkBody, CLIP: ClipBody}


def body_of(annotation: Annotation):
    """The part of an annotation only its own kind has, typed.

    A body that will not parse is a bug on the way in, not something to hide
    on the way out, so it raises rather than returning a blank shape."""
    model = _BODIES[annotation.kind]
    return model.model_validate(json.loads(annotation.body or "{}"))


def body_text(kind: str, body) -> str:
    """One kind's geometry, ready to store."""
    if not isinstance(body, _BODIES[kind]):
        body = _BODIES[kind].model_validate(body)
    return body.model_dump_json(exclude_none=True)


def annotation_out(annotation: Annotation) -> AnnotationOut:
    return AnnotationOut(
        uuid=annotation.uuid,
        kind=annotation.kind,
        edition_uuid=annotation.edition_uuid,
        page=annotation.page,
        group_uuid=annotation.group_uuid,
        content=annotation.content,
        name=annotation.name,
        body=body_of(annotation),
        created_at=annotation.created_at,
    )


def annotations_of(db, user_uuid: str, *, paper_uuid=None, edition_uuid=None,
                   kinds=None) -> list[Annotation]:
    """One reader's annotations, oldest first.

    Oldest first is not a preference: later ink has to be drawn over earlier
    ink, so the order rows come back in is the order they are painted.

    Passing `paper_uuid` alone takes in a note written about the paper and
    never placed on a page, which has no edition to be found by.
    """
    query = db.query(Annotation).filter(
        Annotation.user_uuid == user_uuid,
        Annotation.deleted_at.is_(None),
    )
    if paper_uuid is not None:
        query = query.filter(Annotation.paper_uuid == paper_uuid)
    if edition_uuid is not None:
        query = query.filter(Annotation.edition_uuid == edition_uuid)
    if kinds is not None:
        query = query.filter(Annotation.kind.in_(tuple(kinds)))
    return query.order_by(Annotation.created_at, Annotation.uuid).all()
