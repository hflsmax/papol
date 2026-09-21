"""The GROBID pass over a whole paper, as a job.

A request never waits for it. Saving a paper, or opening one nobody has
opened before, marks the paper `pending` and queues `analyze_paper` in
the same transaction; a worker reads the PDF through GROBID and writes
the references, citation markers and document links back; the viewer
asks `/api/viewer-references` again until the paper says `ready`. What
follows is the bookkeeping that makes "ask again" cheap and "ask twice
at once" harmless: the job's key is the paper, so two viewers opening
one paper queue one pass, whichever web process each of them reached.
"""

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

import grobid
import storage
from app_limits import limit
from models import Paper, PaperCitation, PaperLink, PaperReference
from services import jobs

logger = logging.getLogger(__name__)

KIND = "analyze_paper"

# A pass that has been pending longer than this was interrupted — its
# worker died and the job was failed for it — and may be started again.
ANALYSIS_STALE = timedelta(minutes=15)


def job_key(paper_sha256: str) -> str:
    return f"analyze:{paper_sha256}"


def paper_pdf_key(paper: Paper) -> str | None:
    """The stored name of a paper's PDF, if the store holds it."""
    if not paper.file_path or not storage.valid_key(paper.file_path):
        return None
    return paper.file_path if storage.uploads.exists(paper.file_path) else None


def may_start_analysis(paper: Paper) -> bool:
    """Whether this paper wants a pass now. Never for a failure — a PDF
    GROBID could not read will not read differently on the next open, and
    a user refreshing should not queue a job each time."""
    if paper.references_status is None:
        return True
    if paper.references_status == "pending":
        stamped = paper.references_at
        return stamped is None or datetime.utcnow() - stamped > ANALYSIS_STALE
    return False


def request_analysis(db: Session, paper: Paper) -> bool:
    """Queue a pass over this paper if it wants one; True when queued.

    Written into the caller's transaction and committed with it: the
    paper says `pending` exactly when a job is on the queue to make it
    say something else. A pass already queued or running is left alone.
    """
    if not may_start_analysis(paper):
        return False
    if jobs.enqueue(db, KIND, {"paper_sha256": paper.sha256}, key=job_key(paper.sha256)) is None:
        return False
    paper.references_status = "pending"
    paper.references_error = None
    paper.references_at = datetime.utcnow()
    return True


def finish_analysis(db: Session, paper: Paper, status: str, detail: str | None):
    paper.references_status = status
    paper.references_error = detail
    paper.references_at = datetime.utcnow()
    db.commit()


async def analyze_paper(db: Session, payload: dict) -> dict:
    """Read one paper's references through GROBID and store them.

    Any failure is recorded on the paper rather than left as a job that
    failed somewhere: a PDF that cannot be analyzed says so to the viewer
    instead of being asked about forever.
    """
    paper_sha256 = payload["paper_sha256"]
    paper = db.get(Paper, paper_sha256)
    if paper is None:
        raise jobs.JobError("The paper is gone")
    key = paper_pdf_key(paper)
    if key is None:
        finish_analysis(db, paper, "failed", "The PDF for this paper is missing")
        raise jobs.JobError("The PDF for this paper is missing")
    try:
        with storage.uploads.local(key) as path:
            analysis = await grobid.analyze(str(path))
    except Exception as e:
        logger.warning(f"GROBID failed on paper {paper_sha256}: {e}")
        detail = str(e)[:limit("text", "analysis_error")]
        finish_analysis(db, paper, "failed", detail)
        raise jobs.JobError(detail) from e

    try:
        # A re-analysis replaces what was there. Resolutions are lost with
        # it, which is the honest thing: they were attached to references
        # read out of the PDF a different way.
        db.query(PaperCitation).filter(
            PaperCitation.paper_sha256 == paper_sha256
        ).delete()
        db.query(PaperLink).filter(
            PaperLink.paper_sha256 == paper_sha256
        ).delete()
        db.query(PaperReference).filter(
            PaperReference.paper_sha256 == paper_sha256
        ).delete()

        rows: dict[str, PaperReference] = {}
        for ref in analysis.references:
            row = PaperReference(
                paper_sha256=paper_sha256,
                key=ref.key,
                index=ref.index,
                raw=ref.raw,
                title=ref.title,
                authors=json.dumps(ref.authors) if ref.authors else None,
                year=ref.year,
                journal=ref.journal,
                doi=ref.doi,
                arxiv_id=ref.arxiv_id,
                page=ref.page,
                y=ref.y,
            )
            db.add(row)
            rows[ref.key] = row
        db.flush()  # the citations need the reference ids

        for cite in analysis.citations:
            row = rows.get(cite.key)
            if row is None:
                continue
            db.add(PaperCitation(
                paper_sha256=paper_sha256,
                reference_uuid=row.uuid,
                label=cite.label,
                page=cite.page,
                x=cite.x, y=cite.y, w=cite.w, h=cite.h,
                inferred=cite.inferred,
            ))

        for link in analysis.links:
            db.add(PaperLink(
                paper_sha256=paper_sha256,
                kind=link.kind,
                label=link.label,
                page=link.page,
                x=link.x, y=link.y, w=link.w, h=link.h,
                target_page=link.target_page,
                target_y=link.target_y,
            ))

        finish_analysis(db, paper, "ready", None)
    except Exception as e:
        # Whatever went wrong, the paper must not be left saying
        # "pending" forever: a viewer would poll a job that is over.
        logger.exception(f"Reference analysis of paper {paper_sha256} failed")
        db.rollback()
        paper = db.get(Paper, paper_sha256)
        if paper is not None:
            finish_analysis(db, paper, "failed", str(e)[:limit("text", "analysis_error")])
        raise
    summary = {
        "references": len(analysis.references),
        "citations": len(analysis.citations),
        "links": len(analysis.links),
    }
    logger.info(
        f"Paper {paper_sha256}: {summary['references']} references, "
        f"{summary['citations']} citation markers, {summary['links']} document links"
    )
    return summary
