"""Notifications, and the mail that carries them out of Papol.

Nothing here talks to an SMTP server in a request. A message to send is
a `send_email` job — one per recipient, so one refused address fails one
job — and the worker sends it. The daily digest is a job too, one that
queues the day's emails and then itself for tomorrow, so it runs once
however many web processes or workers there are, and a restart at any
hour does not lose the day.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

from emailer import send_email
from models import Notification, Setting, User
from services import jobs
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SEND_EMAIL, DAILY_DIGEST = "send_email", "daily_digest"
DEFAULT_DIGEST_HOUR = 21

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


# ------------------------------------------------------------------ sending

def queue_email(db: Session, to: str, subject: str, body: str, *, notification_uuids=()) -> str:
    """One email, to be sent by a worker. The notifications named are
    marked emailed once it has been — and stay unemailed if it never is,
    so the digest carries them."""
    return jobs.enqueue(db, SEND_EMAIL, {
        "to": to, "subject": subject, "body": body,
        "notification_uuids": list(notification_uuids),
    })


async def send_email_job(db: Session, payload: dict) -> dict:
    """The job. Configuration is read now, not when the mail was queued:
    the settings table is the admin's, and may have been fixed since."""
    cfg = smtp_config(db)
    if cfg is None:
        return {"sent": False, "skipped": "SMTP not configured"}
    try:
        send_email(cfg, payload["to"], payload["subject"], payload["body"])
    except Exception as exc:
        raise jobs.JobError(f"Email to {payload['to']} failed: {exc}") from exc
    uuids = payload.get("notification_uuids") or []
    if uuids:
        for notif in db.query(Notification).filter(Notification.uuid.in_(uuids)).all():
            notif.emailed = True
        db.commit()
    return {"sent": True}


# --------------------------------------------------------------- the digest

def send_daily_digest(db: Session) -> dict:
    """Queue each user an email of their unread notifications from the
    past day. A notification is emailed at most once."""
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

    if smtp_config(db) is None:
        return {"emails_queued": 0, "users_with_news": len(by_user), "skipped": "SMTP not configured"}

    queued = 0
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
        queue_email(
            db, user.email,
            f"Papol: {count} new message{'s' if count != 1 else ''} today",
            body,
            notification_uuids=[n.uuid for n in notifs],
        )
        queued += 1
    db.commit()
    return {"emails_queued": queued, "users_with_news": len(by_user)}


def digest_hour(db: Session) -> int:
    """The digest_hour setting (0-23, server time)."""
    try:
        return int(setting_value(db, "digest_hour") or DEFAULT_DIGEST_HOUR)
    except (TypeError, ValueError):
        return DEFAULT_DIGEST_HOUR


def next_digest_at(hour: int, now: datetime | None = None) -> datetime:
    """The next time the clock on this host reads `hour`, as the naive UTC
    the database keeps. A digest hour is set in the admin's own day."""
    local_now = now or datetime.now()
    target = local_now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= local_now:
        target += timedelta(days=1)
    return target.astimezone(timezone.utc).replace(tzinfo=None)


def schedule_daily_digest(db: Session) -> str | None:
    """See to it that a digest is on the queue for its next hour. Idle
    when one already is: the key allows one at a time, whichever worker
    asks. Committed here — nothing else is in flight when this is called."""
    queued = jobs.enqueue(
        db, DAILY_DIGEST, {}, key=DAILY_DIGEST, run_at=next_digest_at(digest_hour(db)),
    )
    db.commit()
    return queued


async def daily_digest_job(db: Session, payload: dict) -> dict:
    """The job: the day's emails onto the queue, and tomorrow's digest
    after them. The next one is queued only once this one is off the key,
    which is why it is queued by the worker after `finish`, not here — see
    worker.py; here the digest is simply sent."""
    outcome = send_daily_digest(db)
    logger.info("Daily digest: %s", outcome)
    return outcome
