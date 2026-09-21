from auth import get_optional_user
from database import get_db
from fastapi import APIRouter, Depends
from models import Feedback, Notification, User
from schemas import FeedbackCreate, FeedbackOut
from services.feedback import (
    feedback_notification_message,
    feedback_out,
    queue_feedback_emails,
)
from sqlalchemy.orm import Session

router = APIRouter()

# ---------------- Feedback ----------------

@router.post("/api/feedback", response_model=FeedbackOut)
async def submit_feedback(
    data: FeedbackCreate,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Report a bug or request a feature. Open to visitors too, so that a
    user who cannot sign in can still say so. The report is stored and
    every admin gets it as an inbox message and an email — the email as a
    job a worker sends, queued in the same transaction as the report."""
    fb = Feedback(
        user_uuid=current_user.uuid if current_user else None,
        content=data.content.strip(),
        page=(data.page or None),
        contact=(data.contact or "").strip() or None,
    )
    db.add(fb)
    db.flush()

    admins = db.query(User).filter(User.is_admin.is_(True)).all()
    message = feedback_notification_message(fb)
    notifications = [Notification(user_uuid=a.uuid, content=message) for a in admins]
    db.add_all(notifications)
    db.flush()
    queue_feedback_emails(db, fb, {a.uuid: n.uuid for a, n in zip(admins, notifications)})
    db.commit()
    db.refresh(fb)
    return feedback_out(fb)
