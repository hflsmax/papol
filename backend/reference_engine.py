"""Reference analysis and resolution that does not belong to a database row.

Production editions persist this state through SQLAlchemy in ``main.py``.
Demo editions deliberately disappear on restart, but should otherwise use
the same GROBID and bibliographic resolver. This module owns that ephemeral
state so the HTTP routes do not become a second reference engine.
"""

import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import biblio
import grobid
from schemas import CitationOut, EditionReferences, ReferenceOut, ResolvedWork

logger = logging.getLogger(__name__)


def reference_id(namespace: str, key: str) -> int:
    """A stable id small enough to remain exact in a JavaScript number."""
    return int(hashlib.sha256(f"{namespace}\n{key}".encode()).hexdigest()[:12], 16)


def reference_out(reference) -> ReferenceOut:
    resolution = None
    if reference.resolution:
        try:
            resolution = ResolvedWork(**json.loads(reference.resolution))
        except Exception:
            pass
    return ReferenceOut(
        id=reference.id,
        key=reference.key,
        index=reference.index,
        raw=reference.raw,
        title=reference.title,
        year=reference.year,
        page=getattr(reference, "page", None),
        y=getattr(reference, "y", None),
        resolved_status=reference.resolved_status,
        resolution=resolution,
    )


async def resolve(reference) -> ReferenceOut:
    """Resolve and cache metadata on a database row or ephemeral row."""
    if reference.resolved_status is None:
        try:
            status, summary = await biblio.resolve(reference)
        except Exception as exc:
            logger.warning("Could not resolve reference %s: %s", reference.id, exc)
            status, summary = "error", None
        if status == "error":
            answer = reference_out(reference)
            answer.resolved_status = "error"
            return answer
        reference.resolved_status = status
        reference.resolution = json.dumps(summary) if summary else None
        reference.resolved_at = datetime.utcnow()
    return reference_out(reference)


class EphemeralReferenceEngine:
    """Process-local counterpart of a persisted edition reference store."""

    def __init__(self):
        self._analyses: dict[str, dict] = {}
        self._references: dict[int, SimpleNamespace] = {}
        self._previews: dict[str, ReferenceOut] = {}

    def begin(self, digest: str) -> bool:
        """Mark an unseen PDF pending; true means the caller should run it."""
        if digest in self._analyses:
            return False
        self._analyses[digest] = {
            "status": "pending", "references": [], "citations": [],
        }
        return True

    def response(self, digest: str, edition_id: int) -> EditionReferences:
        state = self._analyses[digest]
        return EditionReferences(
            edition_id=edition_id,
            status=state["status"],
            detail=state.get("detail"),
            references=state.get("references", []),
            citations=state.get("citations", []),
        )

    async def analyze(self, digest: str, path: Path):
        try:
            result = await grobid.analyze(str(path))
            ids = {ref.key: reference_id(digest, ref.key) for ref in result.references}
            references = []
            for ref in result.references:
                row = SimpleNamespace(
                    id=ids[ref.key], key=ref.key, index=ref.index, raw=ref.raw,
                    title=ref.title,
                    authors=json.dumps(ref.authors) if ref.authors else None,
                    year=ref.year, journal=ref.journal, doi=ref.doi,
                    arxiv_id=ref.arxiv_id, page=ref.page, y=ref.y,
                    resolved_status=None, resolution=None, resolved_at=None,
                )
                self._references[row.id] = row
                references.append(reference_out(row))
            citations = [
                CitationOut(
                    reference_id=ids[cite.key], label=cite.label, page=cite.page,
                    x=cite.x, y=cite.y, w=cite.w, h=cite.h,
                    inferred=cite.inferred,
                )
                for cite in result.citations if cite.key in ids
            ]
            self._analyses[digest] = {
                "status": "ready", "references": references, "citations": citations,
            }
            logger.info(
                "Demo PDF %s: %d references, %d citation markers",
                digest[:12], len(references), len(citations),
            )
        except Exception as exc:
            logger.warning("GROBID failed on demo PDF %s: %s", digest[:12], exc)
            self._analyses[digest] = {
                "status": "failed", "detail": str(exc)[:500],
                "references": [], "citations": [],
            }

    async def open(self, reference_id_value: int) -> ReferenceOut | None:
        reference = self._references.get(reference_id_value)
        return await resolve(reference) if reference else None

    async def preview(self, key: str, raw: str) -> ReferenceOut:
        raw = " ".join(raw.split())
        cache_key = hashlib.sha256(f"{key}\n{raw}".encode()).hexdigest()
        if cache_key in self._previews:
            return self._previews[cache_key]
        row = SimpleNamespace(
            id=int(cache_key[:12], 16), key=key, index=0, raw=raw,
            title=None, year=None, doi=None, arxiv_id=None,
            page=None, y=None, resolved_status=None, resolution=None,
            resolved_at=None,
        )
        answer = await resolve(row)
        if answer.resolved_status != "error":
            self._previews[cache_key] = answer
        return answer
