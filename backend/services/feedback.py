import logging

from database import SessionLocal
from emailer import send_email
from models import Feedback, Notification, User
from schemas import FeedbackOut, UserBase
from services.notifications import site_url, smtp_config

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


def email_admins_feedback(feedback_uuid: str, notification_uuids: dict):
    """Mail the admins a new report right away. Best effort: a report that
    cannot be emailed is still in the database and in every admin's inbox,
    and an admin whose mail fails keeps the notification unemailed so the
    daily digest carries it. Runs after the response, on its own session."""
    db = SessionLocal()
    try:
        fb = db.query(Feedback).filter(Feedback.uuid == feedback_uuid).first()
        cfg = smtp_config(db)
        if fb is None or cfg is None:
            return
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
        headline = fb.content.strip().splitlines()[0][:60]
        subject = f"Papol feedback: {headline}"
        for admin in db.query(User).filter(User.is_admin.is_(True)).all():
            try:
                send_email(cfg, admin.email, subject, body)
            except Exception:
                logger.exception("Feedback email to %s failed", admin.email)
                continue
            notif_uuid = notification_uuids.get(admin.uuid)
            if notif_uuid:
                notif = db.query(Notification).filter(Notification.uuid == notif_uuid).first()
                if notif:
                    notif.emailed = True
        db.commit()
    except Exception:
        logger.exception("Feedback notification email failed")
    finally:
        db.close()
