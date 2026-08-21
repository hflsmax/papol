"""OpenAlex: what a reference became after it was published.

CrossRef knows what a reference *is* — it is the registry publishers write
to, so it is the better matcher for a printed reference string. OpenAlex
knows what happened to it since: how often it has been cited, whether a
free copy exists, and an abstract. Papol asks each the question it is good
at, which is why both are here.

OpenAlex began metering in February 2026, and the shape of its charging
decides how it is used here. Looking a work up by its DOI is a singleton
request and costs almost nothing; *searching* for one costs ten times as
much, and without a key the whole daily allowance is about ten searches.
So DOI lookups are made freely and searches are a last resort, asked for
only when nothing cheaper has answered — see biblio.resolve.

A free key raises the allowance roughly a hundredfold and is worth having:
set PAPOL_OPENALEX_KEY. The mailto is separate and still worth sending —
it is how OpenAlex reaches you, and it is the polite pool.
"""

import os
from typing import Optional

import httpx

API = "https://api.openalex.org"
MAILTO = os.environ.get("PAPOL_CONTACT_EMAIL", "")
# Raises the daily allowance from roughly ten searches to roughly a
# thousand. Free, from openalex.org.
API_KEY = os.environ.get("PAPOL_OPENALEX_KEY", "")
USER_AGENT = f"Papol/1.0 (Spontaneous Seminar Paper Reading App{'; mailto:' + MAILTO if MAILTO else ''})"

TIMEOUT = 15.0


class Throttled(Exception):
    """The daily allowance is spent. Worth telling apart from "not found":
    one is a fact about the reference, the other is a fact about today, and
    only the first is worth remembering."""


def _params(extra: dict) -> dict:
    return {
        **extra,
        **({"mailto": MAILTO} if MAILTO else {}),
        **({"api_key": API_KEY} if API_KEY else {}),
    }


async def by_doi(doi: str) -> Optional[dict]:
    """The work with this DOI, or None."""
    doi = doi.strip().lower().replace("https://doi.org/", "")
    return await _get(f"{API}/works/doi:{doi}", {})


async def by_arxiv(arxiv_id: str) -> Optional[dict]:
    """arXiv preprints carry a DataCite DOI of a fixed shape, so an arXiv
    number is a DOI lookup in disguise."""
    number = arxiv_id.strip().replace("arXiv:", "")
    return await by_doi(f"10.48550/arXiv.{number}")


async def by_title(title: str, limit: int = 5) -> list[dict]:
    """Candidates matching a title, best first.

    Deliberately given a title and not a whole reference string:
    OpenAlex's `search` is a relevance search over title and abstract, and
    a raw reference — volume numbers, page ranges, "et al." — pulls it
    badly off course.

    Worth asking even when CrossRef has answered, because the two indexes
    hold different things: conference proceedings that never got a
    CrossRef DOI (USENIX, most of OSDI and NSDI) are in OpenAlex, and for
    those CrossRef can only offer something that is not the paper."""
    title = " ".join(title.split())
    if len(title) < 8:
        return []
    data = await _get(f"{API}/works", {"per-page": limit, "search": title})
    return (data or {}).get("results") or []


async def _get(url: str, params: dict) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.get(
                url, params=_params(params), headers={"User-Agent": USER_AGENT}
            )
            if response.status_code == 429:
                raise Throttled(_budget_message(response))
            if response.status_code != 200:
                return None
            return response.json()
    except Throttled:
        raise
    except Exception:
        return None


def _budget_message(response) -> str:
    try:
        return str(response.json().get("message") or "").strip() or "rate limited"
    except Exception:
        return "rate limited"


def abstract_of(work: dict) -> Optional[str]:
    """OpenAlex stores abstracts as an inverted index — word to the
    positions it occupies — because a publisher may licence the index when
    it will not licence the prose. Reading it back out is just a sort."""
    inverted = work.get("abstract_inverted_index")
    if not inverted:
        return None
    positions = [(i, word) for word, spots in inverted.items() for i in spots]
    positions.sort()
    text = " ".join(word for _, word in positions)
    return text or None


def summarize(work: dict) -> dict:
    """An OpenAlex work as the viewer's popup wants it."""
    location = work.get("best_oa_location") or work.get("primary_location") or {}
    source = (location.get("source") or {}) if isinstance(location, dict) else {}
    return {
        "title": work.get("display_name"),
        "authors": [
            a["author"]["display_name"]
            for a in work.get("authorships") or []
            if a.get("author", {}).get("display_name")
        ],
        "year": work.get("publication_year"),
        "venue": source.get("display_name"),
        "abstract": abstract_of(work),
        "citations": work.get("cited_by_count"),
        "doi": (work.get("doi") or "").replace("https://doi.org/", "") or None,
        "url": work.get("doi") or (work.get("primary_location") or {}).get("landing_page_url"),
        "pdf_url": (work.get("best_oa_location") or {}).get("pdf_url"),
        "source": "openalex",
    }
