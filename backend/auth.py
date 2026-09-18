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
# purpose: a user clicking through the app costs one UPDATE a minute
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


WEB = "web"
MACOS = "macos"

# The client names itself in this header when it signs in.
PLATFORM_HEADER = "X-Papol-Platform"


def login_platform(request) -> str:
    """Which Papol this sign-in came from.

    An unfamiliar announcement is not an unfamiliar platform: everything that
    is not the installed application reaches Papol as a page, so "web" is what
    a caller gets for saying nothing, or for saying something this server does
    not know.
    """
    announced = (request.headers.get(PLATFORM_HEADER) or "").strip().lower()
    return MACOS if announced == MACOS else WEB


def create_token(db: Session, user: User, platform: str = WEB) -> str:
    token = secrets.token_hex(32)
    db.add(AuthToken(token=token, user_uuid=user.uuid, platform=platform))
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
        db.commit()
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
    """The signed-in user, or None — for endpoints open to visitors."""
    auth = _live_session(db, credentials)
    if not auth or auth.user is None or auth.user.is_deleted:
        return None
    return auth.user
