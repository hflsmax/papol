"""Exact bibliographic metadata lookup for uploaded papers."""

import crossref
import openalex


class Unavailable(Exception):
    """Neither bibliographic API could answer the lookup."""


async def by_doi(doi: str) -> dict | None:
    """Resolve a DOI through CrossRef, falling back to OpenAlex."""
    failures = []
    try:
        item = await crossref.by_doi(doi)
        if item:
            return crossref.summarize_crossref(item)
    except crossref.Unavailable as exc:
        failures.append(exc)

    try:
        work = await openalex.by_doi(doi)
        if work:
            return openalex.summarize(work)
    except (openalex.Throttled, openalex.Unavailable) as exc:
        failures.append(exc)

    if len(failures) == 2:
        raise Unavailable("CrossRef and OpenAlex are unavailable") from failures[-1]
    return None
