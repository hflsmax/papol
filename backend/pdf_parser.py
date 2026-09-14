import re
from pathlib import Path

import fitz  # PyMuPDF

ARXIV_ID_PATTERN = re.compile(
    r"(?:arXiv\s*:\s*|arxiv\s*\.\s*org\s*/\s*abs\s*/\s*)"
    r"((?:\d{4}\s*\.\s*\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\s*/\s*\d{7})(?:v\d+)?)",
    re.IGNORECASE,
)

DOI_PATTERN = re.compile(
    r'10\.\d{4,9}/[^\s\]\)>"]+',
    re.IGNORECASE,
)


def extract_doi(text: str) -> str | None:
    """Return the first complete-looking DOI in extracted PDF text.

    PDF layout extraction can split a DOI across lines. In particular, PNAS
    papers print a supporting-information URL before the canonical footer DOI,
    and the former can be extracted as the incomplete ``10.1073/pnas.``. Skip
    suffixes without a digit when a later, complete identifier is available.
    """
    fallback = None
    for match in DOI_PATTERN.finditer(text):
        candidate = match.group(0).rstrip(".,;:")
        fallback = fallback or candidate
        if any(character.isdigit() for character in candidate.split("/", 1)[1]):
            return candidate
    return fallback


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

    return extract_doi(text), text


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
