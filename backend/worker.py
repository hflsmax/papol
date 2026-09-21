"""The worker: the process that does what the web tier only queues.

    python worker.py            # in backend/, the same environment as uvicorn
    python worker.py --reload   # development: restart itself when a file changes

It shares the database and the file store with the web tier and nothing
else — no HTTP, no imports from main. One job at a time per process; more
throughput is more processes, on this host or another. Each job runs on
a session of its own, is finished or failed whatever its handler does,
and a SIGTERM lets the job in hand end before the process does.

Every kind of job Papol has is named in HANDLERS. A row of a kind nobody
here knows is failed, not left for a worker that does know it: that
worker is a deploy away, and the row would say "queued" until then.
"""

import argparse
import asyncio
import logging
import os
import signal
import sys
import time
import traceback
from pathlib import Path

import database
from app_limits import limit
from models import Job
from services import analysis, capture, extraction, jobs, notifications

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker")

HANDLERS = {
    analysis.KIND: analysis.analyze_paper,
    extraction.KIND: extraction.extract_metadata,
    capture.WEBPAGE: capture.capture_webpage_job,
    capture.YOUTUBE: capture.capture_youtube_job,
    notifications.SEND_EMAIL: notifications.send_email_job,
    notifications.DAILY_DIGEST: notifications.daily_digest_job,
}

# How long an idle worker waits before asking the queue again. The viewer
# asks after its references no more often than this, so a job never waits
# longer than the client would have anyway.
POLL_SECONDS = 1.0


async def run_one(job_uuid: str, session_factory=None) -> bool:
    """Run a claimed job to its recorded outcome. True when it succeeded.

    On a session of its own, and the outcome is written whatever the
    handler left the session in: a handler's exception rolls its work
    back and the job is failed on a clean transaction.
    """
    db = (session_factory or database.SessionLocal)()
    try:
        job = db.get(Job, job_uuid)
        kind, payload = job.kind, jobs.payload_of(job)
        handler = HANDLERS.get(kind)
        if handler is None:
            jobs.fail(db, job, f"No worker knows the job kind {kind!r}")
            return False
        try:
            result = await handler(db, payload)
        except jobs.JobError as exc:
            db.rollback()
            jobs.fail(db, db.get(Job, job_uuid), str(exc)[:limit("text", "analysis_error")])
            logger.warning("Job %s (%s) failed: %s", job_uuid, kind, exc)
            return False
        except Exception as exc:
            db.rollback()
            detail = str(exc) or exc.__class__.__name__
            jobs.fail(db, db.get(Job, job_uuid), detail[:limit("text", "analysis_error")])
            logger.error("Job %s (%s) crashed: %s\n%s", job_uuid, kind, exc, traceback.format_exc())
            return False
        jobs.finish(db, db.get(Job, job_uuid), result)
        logger.info("Job %s (%s) done", job_uuid, kind)
        if kind == notifications.DAILY_DIGEST:
            # Tomorrow's, now that today's has left the key free.
            notifications.schedule_daily_digest(db)
        return True
    finally:
        db.close()


async def drain(session_factory=None, worker: str | None = None) -> int:
    """Run every job that is due, then stop. What the suite calls, and
    what one tick of the loop below is. Returns how many ran."""
    factory = session_factory or database.SessionLocal
    name = worker or jobs.worker_name()
    ran = 0
    while True:
        db = factory()
        try:
            job = jobs.claim(db, name)
            job_uuid = None if job is None else job.uuid
        finally:
            db.close()
        if job_uuid is None:
            return ran
        await run_one(job_uuid, factory)
        ran += 1


class _Sources:
    """The .py files beside this one, for --reload: the newest mtime, so an
    edit anywhere in the backend restarts the worker between jobs."""

    def __init__(self, root: Path):
        self.root = root
        self.stamp = self.now()

    def now(self) -> float:
        newest = 0.0
        for path in self.root.rglob("*.py"):
            try:
                newest = max(newest, path.stat().st_mtime)
            except OSError:
                continue
        return newest

    def changed(self) -> bool:
        return self.now() != self.stamp


async def run(reload: bool = False, stopping: asyncio.Event | None = None):
    """The loop. `stopping` is what SIGTERM sets; the suite passes its own
    to stop the loop without a signal."""
    if stopping is None:
        stopping = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stopping.set)

    database.migrate()
    with database.SessionLocal() as db:
        notifications.schedule_daily_digest(db)
    name = jobs.worker_name()
    sources = _Sources(Path(__file__).parent) if reload else None
    logger.info("Worker %s up; %d kinds of job", name, len(HANDLERS))

    while not stopping.is_set():
        ran = await drain(worker=name)
        if stopping.is_set():
            break
        if sources is not None and sources.changed():
            logger.info("Source changed; restarting")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        if ran == 0:
            try:
                await asyncio.wait_for(stopping.wait(), POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
    logger.info("Worker %s stopping", name)


def main():
    parser = argparse.ArgumentParser(description="Run Papol's queued jobs.")
    parser.add_argument("--reload", action="store_true",
                        help="restart when a backend source file changes (development)")
    args = parser.parse_args()
    asyncio.run(run(reload=args.reload))


if __name__ == "__main__":
    main()
