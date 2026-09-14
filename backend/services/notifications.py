import asyncio
import logging
import os
from datetime import datetime, timedelta

from database import SessionLocal
from emailer import send_email
from models import Notification, Setting, User
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

def site_url(db: Session) -> str:
    return (
        os.environ.get("PAPOL_URL")
        or setting_value(db, "site_url")
        or "https://mc-pony.com/papol/"
    )


def setting_value(db: Session, key: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row and row.value else None


def smtp_config(db: Session):
    """SMTP configuration: environment variables win, then the settings
    table (keys smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from).
    Returns None when no host is configured anywhere."""
    def get(env, key, default=None):
        return os.environ.get(env) or setting_value(db, key) or default

    host = get("SMTP_HOST", "smtp_host")
    if not host:
        return None
    user = get("SMTP_USER", "smtp_user")
    return {
        "host": host,
        "port": int(get("SMTP_PORT", "smtp_port", "587")),
        "user": user,
        "password": get("SMTP_PASS", "smtp_pass"),
        "from_addr": get("SMTP_FROM", "smtp_from", user or "papol@localhost"),
        "starttls": get("SMTP_STARTTLS", "smtp_starttls", "1") != "0",
    }


def send_daily_digest(db: Session) -> dict:
    """Email each user their unread notifications from the past day.
    A notification is emailed at most once."""
    since = datetime.utcnow() - timedelta(days=1)
    rows = (
        db.query(Notification)
        .filter(
            Notification.read.is_(False),
            Notification.emailed.is_(False),
            Notification.created_at >= since,
        )
        .order_by(Notification.created_at)
        .all()
    )
    by_user = {}
    for n in rows:
        by_user.setdefault(n.user_uuid, []).append(n)

    cfg = smtp_config(db)
    if cfg is None:
        return {"emails_sent": 0, "users_with_news": len(by_user), "skipped": "SMTP not configured"}

    sent = 0
    for uid, notifs in by_user.items():
        user = db.query(User).filter(User.uuid == uid).first()
        if not user:
            continue
        lines = "\n".join(f"  - {n.content}" for n in notifs)
        count = len(notifs)
        body = (
            f"Hello {user.display_name},\n\n"
            f"You have {count} new message{'s' if count != 1 else ''} in Papol today:\n\n"
            f"{lines}\n\n"
            f"Read and reply in your inbox: {site_url(db).rstrip('/')}/inbox\n\n"
            "— Papol"
        )
        try:
            send_email(
                cfg,
                user.email,
                f"Papol: {count} new message{'s' if count != 1 else ''} today",
                body,
            )
        except Exception:
            logger.exception("Digest email to %s failed", user.email)
            continue
        for n in notifs:
            n.emailed = True
        sent += 1
    db.commit()
    return {"emails_sent": sent, "users_with_news": len(by_user)}


def _seconds_until(hour: int) -> float:
    now = datetime.now()
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()

def start_digest_loop():
    async def loop():
        while True:
            # Send hour is the digest_hour setting (0-23, server time)
            db = SessionLocal()
            try:
                hour = int(setting_value(db, "digest_hour") or 21)
            except (TypeError, ValueError):
                hour = 21
            finally:
                db.close()
            await asyncio.sleep(_seconds_until(hour))
            db = SessionLocal()
            try:
                logger.info("Daily digest: %s", send_daily_digest(db))
            except Exception:
                logger.exception("Daily digest failed")
            finally:
                db.close()

    return asyncio.create_task(loop())

