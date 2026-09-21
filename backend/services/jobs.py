"""The queue: jobs the web tier writes and a worker process runs.

Heavy work — a GROBID pass, a headless browser, an SMTP conversation —
does not belong in the process that answers HTTP. A request writes a
`Job` row and returns; `worker.py` claims the row and does the work; the
client asks `GET /api/jobs/{uuid}` how it went, or watches the row the
job was about (a paper's `references_status`, a board card's file).

The queue is a PostgreSQL table and nothing else. That is deliberate:
the job is committed in the same transaction as the row it concerns, a
claim is one `SELECT ... FOR UPDATE SKIP LOCKED`, and any number of
workers on any number of hosts share it without a broker to run. The
same shape ports to Go unchanged.

What a worker owes the queue: a claimed job is finished or failed. A
worker that dies mid-job leaves it `running`; the lease below lets the
next claim take it again, once, and fail it after that — so a paper
whose analysis was interrupted by a deploy is analyzed on the next
worker, and a job that kills its worker twice does not do so forever.
"""

import json
import logging
import os
import socket
from datetime import datetime, timedelta

from sqlalchemy import and_, or_, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from models import Job, new_uuid

logger = logging.getLogger(__name__)

# A job running longer than this was abandoned by its worker — nothing here
# takes longer than a GROBID pass, and that is bounded at five minutes.
LEASE = timedelta(minutes=15)

# A job is taken up twice: once, and once more after being abandoned.
MAX_ATTEMPTS = 2

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"
LIVE = (QUEUED, RUNNING)


class JobError(Exception):
    """A failure with a message for the person who asked for the job.

    Anything else a handler raises is a bug, logged with its traceback and
    reported as failed all the same; this one is reported as it is said.
    """


def worker_name() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def enqueue(
    db: Session, kind: str, payload: dict | None = None, *,
    key: str | None = None, user_uuid: str | None = None,
    run_at: datetime | None = None,
) -> str | None:
    """Queue a job in the caller's transaction; commit it with the rest.

    Returns the new job's uuid, or None when `key` names a job that is
    already queued or running — the work will happen, and once is enough.
    """
    now = datetime.utcnow()
    statement = insert(Job).values(
        uuid=new_uuid(), kind=kind, key=key, payload=json.dumps(payload or {}),
        status=QUEUED, user_uuid=user_uuid, attempts=0,
        run_at=run_at or now, created_at=now,
    )
    if key is not None:
        statement = statement.on_conflict_do_nothing(
            index_elements=["key"],
            index_where=text("status IN ('queued', 'running')"),
        )
    return db.execute(statement.returning(Job.uuid)).scalar()


def claim(db: Session, worker: str) -> Job | None:
    """The next job that is due, marked as this worker's; None when idle.

    Committed before returning, so the claim is visible to every other
    worker whatever the handler does with the session afterwards.
    """
    now = datetime.utcnow()
    while True:
        job = (
            db.query(Job)
            .filter(or_(
                and_(Job.status == QUEUED, Job.run_at <= now),
                and_(Job.status == RUNNING, Job.started_at < now - LEASE),
            ))
            .order_by(Job.run_at, Job.created_at)
            .with_for_update(skip_locked=True)
            .first()
        )
        if job is None:
            return None
        job.attempts += 1
        if job.attempts > MAX_ATTEMPTS:
            job.status = FAILED
            job.error = f"Abandoned by its worker {job.attempts - 1} times"
            job.finished_at = now
            db.commit()
            logger.error("Job %s (%s) abandoned twice; failed", job.uuid, job.kind)
            continue
        if job.status == RUNNING:
            logger.warning("Job %s (%s) was left running by %s; taking it up again",
                           job.uuid, job.kind, job.worker)
        job.status = RUNNING
        job.started_at = now
        job.worker = worker
        db.commit()
        db.refresh(job)
        return job


def finish(db: Session, job: Job, result=None):
    job.status = DONE
    job.result = json.dumps(result) if result is not None else None
    job.error = None
    job.finished_at = datetime.utcnow()
    db.commit()


def fail(db: Session, job: Job, error: str):
    job.status = FAILED
    job.error = error
    job.finished_at = datetime.utcnow()
    db.commit()


def payload_of(job: Job) -> dict:
    return json.loads(job.payload or "{}")


def result_of(job: Job):
    return json.loads(job.result) if job.result else None


def live(db: Session, key: str) -> Job | None:
    """The queued or running job under this key, if there is one."""
    return db.query(Job).filter(Job.key == key, Job.status.in_(LIVE)).first()
