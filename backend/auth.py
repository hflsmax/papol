import hashlib
import secrets

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
from models import AuthToken, User

_PBKDF2_ITERATIONS = 200_000

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


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    auth = db.query(AuthToken).filter(AuthToken.token == credentials.credentials).first()
    if not auth:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return auth.user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """The signed-in reader, or None — for endpoints open to visitors."""
    if credentials is None:
        return None
    auth = db.query(AuthToken).filter(AuthToken.token == credentials.credentials).first()
    return auth.user if auth else None
