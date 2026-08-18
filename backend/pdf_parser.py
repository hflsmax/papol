import fitz  # PyMuPDF
import re
from pathlib import Path


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
        doi = doi.rstrip('.,;:')

    return doi, text


def get_title_from_filename(file_path: str) -> str:
    """Extract a title from the filename."""
    path = Path(file_path)
    # Remove extension and replace underscores/hyphens with spaces
    title = path.stem.replace('_', ' ').replace('-', ' ')
    return title.title()
