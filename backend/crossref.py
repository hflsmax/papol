import httpx
import json
from typing import Optional


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
                headers={"User-Agent": "Papol/1.0 (Paper Documentation App)"}
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
