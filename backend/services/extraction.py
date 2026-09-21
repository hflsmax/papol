"""What a PDF says about itself, for the upload form.

An upload stores the PDF and queues `extract_metadata`; the form polls
the job and fills itself in from the result. The reading itself — the
identifier printed near the front, the bibliographic APIs, and GROBID's
title block as a last resort — is the same whether it runs for the job
or for the edit form's "re-read the PDF" button, which still answers in
the request: it is a button, not an upload, and the demo answers it too.
"""

import json
import logging
from pathlib import Path

from fastapi import HTTPException

import grobid
import metadata_lookup
import storage
from pdf_parser import (
    arxiv_doi, extract_arxiv_id, extract_doi_from_pdf, get_title_from_filename,
)
from models import Paper
from schemas import ExtractedMetadata, ReextractedMetadata
from services import jobs

logger = logging.getLogger(__name__)

KIND = "extract_metadata"


async def printed_header(path: str) -> grobid.HeaderMetadata | None:
    """What the PDF says about itself, for fields nothing else could supply.

    An author's copy, a preprint, or a tech report often prints no DOI at
    all, and without an identifier the bibliographic APIs have nothing to
    answer. GROBID reads the title block off page one instead.

    It is strictly a last resort. Measured against CrossRef over the library,
    GROBID never names the venue, misses most years, and mistakes an
    affiliation for an author often enough that its answers are a starting
    point for the user to correct, not a result. It is therefore asked only
    about fields no API supplied, and never about the DOI: it finds no
    identifier the printed-text scan misses, and mangles those it does report
    into a PNAS supplement or an unparsed arXiv id.

    A fallback that fails leaves the user where they already were, with a
    filename for a title and every field open for typing, so an unreachable
    or unhappy analyzer is logged rather than raised.
    """
    if not grobid.configured():
        return None
    try:
        return await grobid.extract_header(path)
    except Exception:
        logger.exception("GROBID header extraction failed")
        return None


async def extracted_metadata(uploaded_name: str, filename: str, file_path: Path) -> ExtractedMetadata:
    """Raises metadata_lookup.Unavailable when no bibliographic API answers."""
    # Identifiers are normally printed near the front of a paper.
    doi, text = extract_doi_from_pdf(str(file_path))
    arxiv_id = extract_arxiv_id(text)

    # Default metadata from filename
    metadata = {
        "doi": doi,
        "title": get_title_from_filename(uploaded_name),
        "authors": None,
        "journal": None,
        "year": None,
        "file_path": filename
    }

    lookup_doi = arxiv_doi(arxiv_id) if arxiv_id else doi
    api_metadata = await metadata_lookup.by_doi(lookup_doi) if lookup_doi else None

    if api_metadata:
        metadata.update({
            "doi": api_metadata.get("doi") or lookup_doi,
            "title": api_metadata.get("title") or metadata["title"],
            "authors": (
                json.dumps(api_metadata["authors"])
                if api_metadata.get("authors") else None
            ),
            "journal": api_metadata.get("venue"),
            "year": api_metadata.get("year"),
        })
    else:
        # Nothing resolved this paper: it prints no identifier, or no API
        # knows the one it prints. Rather than hand back a filename, ask the
        # PDF what it calls itself.
        metadata["doi"] = lookup_doi
        header = await printed_header(str(file_path))
        if header:
            metadata.update({
                "title": header.title or metadata["title"],
                "authors": json.dumps(header.authors) if header.authors else None,
                "journal": header.journal,
                "year": header.year,
            })
    return ExtractedMetadata(**metadata)


async def extract_metadata(db, payload: dict) -> dict:
    """The job: read the stored PDF and answer with the form's fields."""
    filename = payload["file_path"]
    try:
        with storage.uploads.local(filename) as path:
            metadata = await extracted_metadata(payload.get("uploaded_name") or filename, filename, path)
    except FileNotFoundError:
        raise jobs.JobError("PDF file not found") from None
    except metadata_lookup.Unavailable as exc:
        logger.exception("Bibliographic metadata APIs are unavailable")
        raise jobs.JobError("Metadata lookup failed") from exc
    return metadata.model_dump()


async def reextracted_metadata(paper: Paper, path: Path) -> ReextractedMetadata:
    doi, text = extract_doi_from_pdf(str(path))
    arxiv_id = extract_arxiv_id(text)
    # This action promises to re-read the PDF. Prefer the identifier printed
    # in the file over possibly stale or incorrectly entered paper data.
    lookup_doi = (arxiv_doi(arxiv_id) if arxiv_id else doi) or paper.doi
    api_metadata = None
    if lookup_doi:
        try:
            api_metadata = await metadata_lookup.by_doi(lookup_doi)
        except metadata_lookup.Unavailable as exc:
            logger.exception("Bibliographic metadata APIs are unavailable")
            raise HTTPException(
                status_code=503,
                detail="Metadata lookup failed",
            ) from exc
    if api_metadata:
        return ReextractedMetadata(
            doi=api_metadata.get("doi") or lookup_doi,
            title=api_metadata.get("title"),
            authors=(
                json.dumps(api_metadata["authors"])
                if api_metadata.get("authors") else None
            ),
            journal=api_metadata.get("venue"),
            year=api_metadata.get("year"),
        )
    # The page itself still carries a title and an author list.
    header = await printed_header(str(path))
    if header and (header.title or header.authors):
        return ReextractedMetadata(
            doi=lookup_doi,
            title=header.title,
            authors=json.dumps(header.authors) if header.authors else None,
            journal=header.journal,
            year=header.year,
        )
    raise HTTPException(status_code=404, detail="Metadata was not found")
