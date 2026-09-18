from fastapi import APIRouter, Request
from services.client_requirements import requirements, verdict

router = APIRouter()


@router.get("/api/client-requirements")
async def client_requirements(request: Request):
    """What this server asks of the app asking.

    Deliberately unauthenticated. A user who is signed out, or whose
    credential has just been refused, is exactly the user most likely to
    be holding a build that can no longer sign in — and they still need to
    be told to go and get a new one.
    """
    return {**requirements(), "verdict": verdict(request)}
