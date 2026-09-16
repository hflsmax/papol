"""Reference analysis and resolution that does not belong to a database row.

Production editions persist this state through SQLAlchemy in ``main.py``.
Demo editions deliberately disappear on restart, but should otherwise use
the same GROBID and bibliographic resolver. This module owns that ephemeral
state so the HTTP routes do not become a second reference engine.
"""

import hashlib
import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import biblio
import grobid
from pdf_parser import extract_arxiv_id
from schemas import CitationOut, DocumentLinkOut, EditionReferences, ReferenceOut, ResolvedWork

logger = logging.getLogger(__name__)


def reference_uuid(namespace: str, key: str) -> str:
    """A stable UUID for a reference that has no database row."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"papol-reference:{namespace}\n{key}"))


def reference_out(reference) -> ReferenceOut:
    resolution = None
    if reference.resolution:
        try:
            resolution = ResolvedWork(**json.loads(reference.resolution))
        except Exception:
            pass
    return ReferenceOut(
        uuid=reference.uuid,
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
            logger.warning("Could not resolve reference %s: %s", reference.uuid, exc)
            status, summary = "error", None
        if status in {"miss", "error"}:
            # Crossref/OpenAlex enrichment is useful, but it is not the
            # citation itself. GROBID has already read the bibliography, so
            # an unavailable index must not turn that local evidence into a
            # broken popup.
            status = "bibliography"
            summary = _bibliography_summary(reference)
        reference.resolved_status = status
        reference.resolution = json.dumps(summary) if summary else None
        reference.resolved_at = datetime.utcnow()
    return reference_out(reference)


def _bibliography_summary(reference) -> dict:
    """A useful, honest card when the citation is not an indexed paper."""
    raw = reference.raw or ""
    doi = getattr(reference, "doi", None)
    arxiv_id = getattr(reference, "arxiv_id", None) or extract_arxiv_id(raw)
    if doi:
        url = f"https://doi.org/{doi}"
    elif arxiv_id:
        arxiv_id = re.sub(r"^arxiv:\s*", "", arxiv_id, flags=re.IGNORECASE)
        url = f"https://arxiv.org/abs/{arxiv_id}"
    else:
        url = _cited_url(raw)
    title = reference.title or _url_title(url)
    if not title:
        title = raw[:240].strip().rstrip(".,") or "Cited reference"
    try:
        authors = json.loads(reference.authors) if reference.authors else []
    except (TypeError, ValueError):
        authors = []
    year = reference.year
    if year is None:
        years = re.findall(r"\b(?:19|20)\d{2}\b", raw)
        year = int(years[-1]) if years else None
    return {
        "title": title,
        "authors": authors,
        "year": year,
        "venue": reference.journal,
        "url": url,
        "source": "bibliography",
    }


def _cited_url(raw: str) -> str | None:
    match = re.search(
        r"(https?\s*:\s*//.*?)(?=,\s*(?:19|20)\d{2}[a-z]?\b|\.\s*\[?Accessed\b|$)",
        raw,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    url = re.sub(r"\s+", "", match.group(1)).rstrip(".,;)")
    return url if re.match(r"^https?://[^/\s]+", url) else None


def _url_title(url: str | None) -> str | None:
    if not url:
        return None
    match = re.match(r"https?://(?:www\.)?([^/]+)(?:/(.*))?", url)
    if not match:
        return None
    host, path = match.groups()
    parts = [part for part in (path or "").split("/") if part]
    if host == "github.com" and len(parts) >= 2:
        return "/".join(parts[:2])
    if host == "huggingface.co" and len(parts) >= 3 and parts[0] == "datasets":
        return "/".join(parts[1:3])
    return None


class EphemeralReferenceEngine:
    """Process-local counterpart of a persisted edition reference store."""

    def __init__(self):
        self._analyses: dict[str, dict] = {}
        self._references: dict[str, SimpleNamespace] = {}
        self._previews: dict[str, ReferenceOut] = {}

    def begin(self, digest: str) -> bool:
        """Annotation an unseen PDF pending; true means the caller should run it."""
        if digest in self._analyses:
            return False
        self._analyses[digest] = {
            "status": "pending", "references": [], "citations": [], "links": [],
        }
        return True

    def response(self, digest: str, edition_uuid: str) -> EditionReferences:
        state = self._analyses[digest]
        return EditionReferences(
            edition_uuid=edition_uuid,
            status=state["status"],
            detail=state.get("detail"),
            references=state.get("references", []),
            citations=state.get("citations", []),
            links=state.get("links", []),
        )

    async def analyze(self, digest: str, path: Path):
        try:
            result = await grobid.analyze(str(path))
            ids = {ref.key: reference_uuid(digest, ref.key) for ref in result.references}
            references = []
            for ref in result.references:
                row = SimpleNamespace(
                    uuid=ids[ref.key], key=ref.key, index=ref.index, raw=ref.raw,
                    title=ref.title,
                    authors=json.dumps(ref.authors) if ref.authors else None,
                    year=ref.year, journal=ref.journal, doi=ref.doi,
                    arxiv_id=ref.arxiv_id, page=ref.page, y=ref.y,
                    resolved_status=None, resolution=None, resolved_at=None,
                )
                self._references[row.uuid] = row
                references.append(reference_out(row))
            citations = [
                CitationOut(
                    reference_uuid=ids[cite.key], label=cite.label, page=cite.page,
                    x=cite.x, y=cite.y, w=cite.w, h=cite.h,
                    inferred=cite.inferred,
                )
                for cite in result.citations if cite.key in ids
            ]
            links = [
                DocumentLinkOut(
                    kind=link.kind, label=link.label,
                    page=link.page, x=link.x, y=link.y, w=link.w, h=link.h,
                    target_page=link.target_page, target_y=link.target_y,
                )
                for link in result.links
            ]
            self._analyses[digest] = {
                "status": "ready", "references": references,
                "citations": citations, "links": links,
            }
            logger.info(
                "Demo PDF %s: %d references, %d citation markers, %d document links",
                digest[:12], len(references), len(citations), len(links),
            )
        except Exception as exc:
            logger.warning("GROBID failed on demo PDF %s: %s", digest[:12], exc)
            self._analyses[digest] = {
                "status": "failed", "detail": str(exc)[:500],
                "references": [], "citations": [], "links": [],
            }

    async def open(self, reference_id_value: str) -> ReferenceOut | None:
        reference = self._references.get(reference_id_value)
        return await resolve(reference) if reference else None

    async def preview(self, key: str, raw: str) -> ReferenceOut:
        raw = " ".join(raw.split())
        cache_key = hashlib.sha256(f"{key}\n{raw}".encode()).hexdigest()
        if cache_key in self._previews:
            return self._previews[cache_key]
        row = SimpleNamespace(
            uuid=reference_uuid("preview", cache_key), key=key, index=0, raw=raw,
            title=None, year=None, doi=None, arxiv_id=None,
            page=None, y=None, resolved_status=None, resolution=None,
            resolved_at=None,
        )
        answer = await resolve(row)
        if answer.resolved_status != "error":
            self._previews[cache_key] = answer
        return answer
