import re
from pathlib import Path

import fitz  # PyMuPDF

ARXIV_ID_PATTERN = re.compile(
    r"(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*/\s*abs\s*/\s*)"
    r"((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*/\s*\d{7})(?:v\d+)?)",
    re.IGNORECASE,
)


def extract_doi_from_pdf(file_path: str) -> tuple[str | None, str]:
    """
    Extract DOI and text from a PDF file.
    Returns (doi, extracted_text) tuple.
    """
    doc = fitz.open(file_path)
    text = ""

    # Extract text from first 3 pages (where DOI usually appears)
    pages_to_check = min(3, len(doc))
    for page_num in range(pages_to_check):
        page = doc[page_num]
        text += page.get_text()

    doc.close()

    # Search for DOI pattern
    doi_pattern = r'10\.\d{4,}/[^\s\]\)>"]+'
    match = re.search(doi_pattern, text)

    doi = None
    if match:
        doi = match.group(0)
        # Clean up trailing punctuation
        doi = doi.rstrip(".,;:")

    return doi, text


def extract_arxiv_id(text: str) -> str | None:
    """Return an arXiv id printed explicitly or in an arxiv.org URL."""
    match = ARXIV_ID_PATTERN.search(text)
    return re.sub(r"\s+", "", match.group(1)) if match else None


def arxiv_doi(arxiv_id: str) -> str:
    """Return the stable DataCite DOI for a versioned arXiv identifier."""
    identifier = re.sub(r"v\d+$", "", arxiv_id, flags=re.IGNORECASE)
    return f"10.48550/arXiv.{identifier}"


def get_title_from_filename(file_path: str) -> str:
    """Extract a title from the filename."""
    path = Path(file_path)
    # Remove extension and replace underscores/hyphens with spaces
    title = path.stem.replace("_", " ").replace("-", " ")
    return title.title()
