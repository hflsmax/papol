import httpx
import os
import re
import json
from typing import Optional


# CrossRef reads the contact address out of the User-Agent — that is what
# puts these requests in its polite pool, which is faster and far less
# likely to be throttled. Without one this still works, anonymously.
CONTACT = os.environ.get("PAPOL_CONTACT_EMAIL", "")
CROSSREF_UA = (
    "Papol/1.0 (Spontaneous Seminar Paper Reading App"
    + (f"; mailto:{CONTACT}" if CONTACT else "")
    + ")"
)


async def fetch_metadata_from_doi(doi: str) -> Optional[dict]:
    """
    Fetch paper metadata from CrossRef API using DOI.
    Returns a dict with title, authors, journal, year, abstract.
    """
    url = f"https://api.crossref.org/works/{doi}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                url,
                headers={"User-Agent": CROSSREF_UA}
            )

            if response.status_code != 200:
                return None

            data = response.json()
            message = data.get("message", {})

            # Extract title
            title_list = message.get("title", [])
            title = title_list[0] if title_list else None

            # Extract authors
            author_list = message.get("author", [])
            authors = []
            for author in author_list:
                given = author.get("given", "")
                family = author.get("family", "")
                name = f"{given} {family}".strip()
                if name:
                    authors.append(name)

            # Extract journal
            container = message.get("container-title", [])
            journal = container[0] if container else None

            # Extract year
            year = None
            published = message.get("published-print") or message.get("published-online")
            if published:
                date_parts = published.get("date-parts", [[]])
                if date_parts and date_parts[0]:
                    year = date_parts[0][0]

            return {
                "doi": doi,
                "title": title,
                "authors": json.dumps(authors) if authors else None,
                "journal": journal,
                "year": year,
            }

    except Exception as e:
        print(f"Error fetching metadata from CrossRef: {e}")
        return None


# The matcher. Given a reference exactly as it is printed — authors,
# title, venue, volume, pages, year, run together in whatever style the
# author's bibliography used — CrossRef's `query.bibliographic` finds the
# work it names. This is the same move Google's Scholar PDF Reader makes
# when a reader clicks a citation: the printed string is the query, and
# the top hit is the answer.
# Enough of the string to be identifying; beyond that, longer queries only
# cost CrossRef time.
_MAX_QUERY = 500


async def match_reference(raw: str, rows: int = 5) -> list[dict]:
    """Candidates for the work a printed reference names, best first.

    Several, not one. CrossRef ranks by text similarity alone, and its top
    hit is sometimes a different paper with a near-identical title — a
    later journal version of a conference paper, say. The caller decides
    which of these is really the work, using what else it knows."""
    query = _query_for(raw)
    if not query:
        return []

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.crossref.org/works",
                params={
                    "query.bibliographic": query,
                    "rows": rows,
                    "select": "DOI,title,author,issued,container-title,is-referenced-by-count,abstract,link,score",
                },
                headers={"User-Agent": CROSSREF_UA},
            )
            if response.status_code != 200:
                return []
            return response.json().get("message", {}).get("items", [])
    except Exception as e:
        print(f"Error matching reference against CrossRef: {e}")
        return []


def _query_for(raw: str) -> str:
    """The reference, tidied into a query.

    Two things are worth removing. A trailing "arXiv preprint arXiv:1607.06450"
    is not in CrossRef at all, and left in it dominates the match — a
    reference to *Layer Normalization* comes back as an unrelated paper
    that happens to contain the words "arXiv preprint". Bare URLs do the
    same for less reason."""
    text = re.sub(r"arXiv\s*preprint\s*arXiv:\s*[\d.]+(v\d+)?", " ", raw, flags=re.I)
    text = re.sub(r"https?://\S+", " ", text)
    text = " ".join(text.split())
    return text[:_MAX_QUERY]


def summarize_crossref(item: dict) -> dict:
    """A CrossRef item as the viewer's popup wants it. Thinner than
    OpenAlex's — CrossRef often has no abstract, and its citation count is
    of works registered with CrossRef rather than of everything."""
    title = (item.get("title") or [None])[0]
    container = (item.get("container-title") or [None])[0]
    year = None
    issued = (item.get("issued") or {}).get("date-parts") or [[]]
    if issued and issued[0]:
        year = issued[0][0]
    abstract = item.get("abstract")
    if abstract:
        # CrossRef abstracts arrive as JATS XML fragments.
        abstract = " ".join(re.sub(r"<[^>]+>", " ", abstract).split()) or None
    doi = item.get("DOI")
    return {
        "title": title,
        "authors": [
            " ".join(p for p in (a.get("given"), a.get("family")) if p)
            for a in item.get("author") or []
        ],
        "year": year,
        "venue": container,
        "abstract": abstract,
        "citations": item.get("is-referenced-by-count"),
        "doi": doi,
        "url": f"https://doi.org/{doi}" if doi else None,
        "pdf_url": next(
            (l.get("URL") for l in item.get("link") or []
             if (l.get("content-type") or "").endswith("pdf")),
            None,
        ),
        "source": "crossref",
    }
