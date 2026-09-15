from datetime import datetime

from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import AdminMessage, AdminMessageDelivery, Notification, User
from schemas import AdminMessageOut, NotificationList, NotificationOut
from services.notifications import start_digest_loop
from sqlalchemy.orm import Session
from app_limits import limit

router = APIRouter()


@router.on_event("startup")
def _start_digest_loop():
    start_digest_loop()

# ---------------- Notifications ----------------

@router.get("/api/admin-messages/pending", response_model=list[AdminMessageOut])
async def pending_admin_messages(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Messages broadcast to this reader that they have not dismissed."""
    rows = (
        db.query(AdminMessage)
        .join(AdminMessageDelivery)
        .filter(
            AdminMessageDelivery.user_uuid == current_user.uuid,
            AdminMessageDelivery.dismissed_at.is_(None),
        )
        .order_by(AdminMessage.created_at, AdminMessage.uuid)
        .limit(limit("counts", "notifications"))
        .all()
    )
    return [
        AdminMessageOut(uuid=row.uuid, content=row.content, created_at=row.created_at)
        for row in rows
    ]


@router.post("/api/admin-messages/{message_uuid}/dismiss")
async def dismiss_admin_message(
    message_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delivery = (
        db.query(AdminMessageDelivery)
        .filter(
            AdminMessageDelivery.message_uuid == message_uuid,
            AdminMessageDelivery.user_uuid == current_user.uuid,
        )
        .first()
    )
    if delivery is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if delivery.dismissed_at is None:
        delivery.dismissed_at = datetime.utcnow()
        db.commit()
    return {"message": "Admin message dismissed"}

def _notification_out(n: Notification) -> NotificationOut:
    return NotificationOut(
        uuid=n.uuid,
        content=n.content,
        room_uuid=n.room.uuid if n.room else None,
        read=n.read,
        created_at=n.created_at,
    )


@router.get("/api/notifications", response_model=NotificationList)
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Notification)
        .filter(Notification.user_uuid == current_user.uuid)
        .order_by(Notification.created_at.desc(), Notification.uuid.desc())
        .limit(limit("counts", "notifications"))
        .all()
    )
    unread = (
        db.query(Notification)
        .filter(Notification.user_uuid == current_user.uuid, Notification.read.is_(False))
        .count()
    )
    return NotificationList(
        unread_count=unread,
        notifications=[_notification_out(n) for n in rows],
    )


@router.post("/api/notifications/{notif_uuid}/read")
async def mark_notification_read(
    notif_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification read — reading happens by clicking."""
    n = (
        db.query(Notification)
        .filter(Notification.uuid == notif_uuid, Notification.user_uuid == current_user.uuid)
        .first()
    )
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.read = True
    db.commit()
    return {"message": "Notification marked read"}


@router.post("/api/notifications/read")
async def mark_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(
        Notification.user_uuid == current_user.uuid, Notification.read.is_(False)
    ).update({"read": True})
    db.commit()
    return {"message": "All notifications marked read"}
