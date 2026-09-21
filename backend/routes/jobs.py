from auth import get_current_user
from database import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import Job, User
from schemas import JobOut
from services.jobs import result_of
from sqlalchemy.orm import Session

router = APIRouter()


def job_out(job: Job) -> JobOut:
    return JobOut(
        uuid=job.uuid, kind=job.kind, status=job.status,
        detail=job.error, result=result_of(job),
    )


@router.get("/api/jobs/{job_uuid}", response_model=JobOut)
async def get_job(
    job_uuid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """How a job the caller queued is getting on.

    The one polling endpoint for every kind of job: `queued` and `running`
    mean ask again, `done` carries the result the kind promised, `failed`
    carries a sentence for the user. A job belongs to the user whose
    request queued it; anyone else is told there is no such job.
    """
    job = db.get(Job, job_uuid)
    if job is None or job.user_uuid is None or job.user_uuid != current_user.uuid:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_out(job)
