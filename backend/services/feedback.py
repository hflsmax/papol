import logging

from models import Feedback, User
from schemas import FeedbackOut, UserBase
from services import notifications
from services.notifications import site_url
from app_limits import limit

logger = logging.getLogger(__name__)

def _feedback_reporter(fb: Feedback) -> str:
    if fb.user:
        return f"{fb.user.display_name} <{fb.user.email}>"
    if fb.contact:
        return f"a visitor <{fb.contact}>"
    return "an anonymous visitor"


def feedback_out(fb: Feedback) -> FeedbackOut:
    return FeedbackOut(
        uuid=fb.uuid,
        content=fb.content,
        page=fb.page,
        contact=fb.contact,
        resolved=fb.resolved,
        created_at=fb.created_at,
        user=UserBase.model_validate(fb.user) if fb.user else None,
        user_email=fb.user.email if fb.user else None,
    )


def _feedback_message(fb: Feedback, reporter: str) -> str:
    where = f" (from {fb.page})" if fb.page else ""
    return f"Feedback from {reporter}{where}:\n\n{fb.content}"


def feedback_notification_message(fb: Feedback) -> str:
    return _feedback_message(fb, _feedback_reporter(fb))


def queue_feedback_emails(db, fb: Feedback, notification_uuids: dict) -> int:
    """Mail the admins a new report right away: one `send_email` job per
    admin, queued in the caller's transaction beside the report itself.

    Best effort, as the mail always was: a report that cannot be emailed
    is still in the database and in every admin's inbox, and an admin
    whose mail fails keeps the notification unemailed so the daily
    digest carries it. Returns how many were queued.
    """
    reporter = _feedback_reporter(fb)
    lines = [f"Feedback from {reporter}"]
    if fb.page:
        lines.append(f"Page: {fb.page}")
    lines += [
        "",
        fb.content,
        "",
        f"Reports are listed on the admin page: {site_url(db).rstrip('/')}/admin",
        "",
        "— Papol",
    ]
    body = "\n".join(lines)
    headline = fb.content.strip().splitlines()[0][:limit("text", "notification_email_headline")]
    subject = f"Papol feedback: {headline}"
    queued = 0
    for admin in db.query(User).filter(User.is_admin.is_(True)).all():
        notif_uuid = notification_uuids.get(admin.uuid)
        notifications.queue_email(
            db, admin.email, subject, body,
            notification_uuids=[notif_uuid] if notif_uuid else [],
        )
        queued += 1
    return queued
