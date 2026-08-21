import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models import AuthToken, User

_PBKDF2_ITERATIONS = 200_000

# How stale last_used_at may get before a request rewrites it. Coarse on
# purpose: a reader clicking through the app costs one UPDATE a minute
# rather than one per request.
_LAST_USED_RESOLUTION = timedelta(minutes=1)

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ITERATIONS
    ).hex()
    return secrets.compare_digest(candidate, digest)


def create_token(db: Session, user: User) -> str:
    token = secrets.token_hex(32)
    db.add(AuthToken(token=token, user_id=user.id))
    db.commit()
    return token


def _live_session(db: Session, credentials) -> AuthToken | None:
    """The unrevoked session for these credentials, its last use stamped."""
    if credentials is None:
        return None
    auth = (
        db.query(AuthToken)
        .filter(
            AuthToken.token == credentials.credentials,
            AuthToken.revoked_at.is_(None),
        )
        .first()
    )
    if auth is None:
        return None
    now = datetime.utcnow()
    if auth.last_used_at is None or now - auth.last_used_at >= _LAST_USED_RESOLUTION:
        auth.last_used_at = now
        try:
            db.commit()
        except Exception:
            # Losing a last-seen stamp must never cost the reader the request.
            db.rollback()
    return auth


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    auth = _live_session(db, credentials)
    if not auth:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return auth.user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """The signed-in reader, or None — for endpoints open to visitors."""
    auth = _live_session(db, credentials)
    return auth.user if auth else None
