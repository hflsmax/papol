"""Outgoing email. Configuration is resolved by the caller (environment
variables first, then the settings table) and passed in as a dict with
keys: host, port, user, password, from_addr, starttls."""
import smtplib
import logging
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def send_email(cfg: dict, to: str, subject: str, body: str):
    msg = EmailMessage()
    msg["From"] = cfg["from_addr"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
        if cfg.get("starttls", True):
            s.starttls()
        if cfg.get("user"):
            s.login(cfg["user"], cfg.get("password") or "")
        s.send_message(msg)
    logger.info("Sent email to %s: %s", to, subject)
