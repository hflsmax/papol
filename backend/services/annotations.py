"""The marks a reader leaves on a paper, on the wire.

Notes, ink and clips are stored with their geometry as JSON text, because
SQLite has nowhere better to put a list of points. Turning that back into the
typed shapes the reader's apps understand is one job, and it is done here so
that every route which hands out marks — a reader's own viewer, and a link
they shared — hands out the same shapes.
"""

import json

from models import Comment, InkStroke, PaperClip
from schemas import Comment as CommentSchema
from schemas import InkStrokeOut, PaperClipOut, PointAnchor, UserPublic


def anchor_of(comment: Comment) -> PointAnchor | None:
    """The place a note is fixed to, or None for a note that is not placed.

    The anchor is stored as JSON text and its kind in its own column;
    together they become the typed anchor."""
    if not (comment.anchor and comment.anchor_type):
        return None
    payload = json.loads(comment.anchor)
    payload["type"] = comment.anchor_type
    return PointAnchor(**payload)


def note_out(comment: Comment) -> CommentSchema:
    return CommentSchema(
        uuid=comment.uuid,
        paper_uuid=comment.paper.uuid,
        content=comment.content,
        created_at=comment.created_at,
        user=UserPublic.model_validate(comment.user) if comment.user else None,
        page=comment.page,
        anchor_type=comment.anchor_type,
        anchor=anchor_of(comment),
        edition_uuid=comment.edition.uuid if comment.edition else None,
        name=comment.name,
    )


def stroke_out(stroke: InkStroke) -> InkStrokeOut:
    return InkStrokeOut(
        uuid=stroke.uuid,
        group_uuid=stroke.group_uuid,
        page=stroke.page,
        points=json.loads(stroke.points),
        color=stroke.color,
        width=stroke.width,
        opacity=stroke.opacity,
        shape=stroke.shape,
    )


def clip_out(clip: PaperClip) -> PaperClipOut:
    return PaperClipOut(
        uuid=clip.uuid,
        page=clip.page,
        source=json.loads(clip.source),
        frame=json.loads(clip.frame),
        floating=clip.floating,
    )
