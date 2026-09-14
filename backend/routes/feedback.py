from auth import get_optional_user
from database import get_db
from fastapi import APIRouter, BackgroundTasks, Depends
from models import Feedback, Notification, User
from schemas import FeedbackCreate, FeedbackOut
from services.feedback import (
    email_admins_feedback,
    feedback_notification_message,
    feedback_out,
)
from sqlalchemy.orm import Session

router = APIRouter()

# ---------------- Feedback ----------------

@router.post("/api/feedback", response_model=FeedbackOut)
async def submit_feedback(
    data: FeedbackCreate,
    background: BackgroundTasks,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Report a bug or request a feature. Open to visitors too, so that a
    reader who cannot sign in can still say so. The report is stored and
    every admin gets it as an inbox message and an email."""
    fb = Feedback(
        user_uuid=current_user.uuid if current_user else None,
        content=data.content.strip(),
        page=(data.page or None),
        contact=(data.contact or "").strip() or None,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)

    admins = db.query(User).filter(User.is_admin.is_(True)).all()
    message = feedback_notification_message(fb)
    notifications = [Notification(user_uuid=a.uuid, content=message) for a in admins]
    db.add_all(notifications)
    db.commit()

    background.add_task(
        email_admins_feedback,
        fb.uuid,
        {a.uuid: n.uuid for a, n in zip(admins, notifications)},
    )
    return feedback_out(fb)
