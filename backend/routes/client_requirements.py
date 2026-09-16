from database import get_db
from fastapi import APIRouter, Depends, Request
from services.client_requirements import requirements, verdict
from sqlalchemy.orm import Session

router = APIRouter()


@router.get("/api/client-requirements")
async def client_requirements(request: Request, db: Session = Depends(get_db)):
    """What this server asks of the app asking.

    Deliberately unauthenticated. A user who is signed out, or whose
    credential has just been refused, is exactly the user most likely to
    be holding a build that can no longer sign in — and they still need to
    be told to go and get a new one.
    """
    asked = requirements(db)
    asked["verdict"] = verdict(db, request.headers.get("user-agent"))
    return asked
