"""GROBID: the analyzer that turns a PDF into a reference list.

A PDF says nothing about its own bibliography. pdf.js can tell us where
every glyph sits, but not that "[12]" on page 3 is a citation, nor which
line of the reference list it points at. GROBID (Apache-2.0) is a trained
model that does exactly that job, and it hands back both halves:

  * the works cited, each with the raw string the author typed, which is
    what a bibliographic search can match against; and
  * a box on the page for every in-text marker, which is what makes the
    marker clickable.

It runs as its own service — a JVM, so a container beside Papol rather
than an import. Papol requires it both for upload metadata and references.
"""

import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Optional

import httpx

from pdf_parser import extract_arxiv_id

TEI = "{http://www.tei-c.org/ns/1.0}"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"

# GROBID's figure-reference tag contains only the label: ``Figure `` is
# outside the tag. In the source font that prefix occupies about three ems.
FIGURE_PREFIX_EMS = 3.0

# Where the required analyzer lives. Production always sets this; keeping the
# empty default makes a misconfigured development process fail explicitly.
GROBID_URL = os.environ.get("GROBID_URL", "").rstrip("/")

# GROBID reads the whole document with a CRF cascade; ten to sixty seconds
# for a long paper is normal. This is a background job, so it can wait.
ANALYZE_TIMEOUT = float(os.environ.get("GROBID_TIMEOUT", "300"))


@dataclass
class Reference:
    """One entry in the bibliography."""

    key: str  # GROBID's xml:id, e.g. "b11" — what markers target
    index: int  # position in the list, 0-based
    raw: Optional[str]  # the reference exactly as printed, for matching
    title: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    year: Optional[int] = None
    journal: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    # Where the entry itself is printed, so a PDF's own citation links —
    # which point at a place, not at an id — can be matched to it.
    page: Optional[int] = None
    y: Optional[float] = None


@dataclass
class Citation:
    """One in-text marker, and the box it occupies on the page."""

    key: str  # the reference it points at
    label: str  # what is printed, e.g. "[13]" or "35,"
    # True when the analyzer found the marker but could not say which
    # entry it meant, and Papol read the number instead. Worth keeping
    # apart: it is a guess, and a bibliography numbered differently from
    # the order it is printed in would make it a wrong one.
    inferred: bool = False
    page: int = 0  # 1-based
    # Fractions of the page, from its top-left corner. Stored this way
    # because the viewer draws at whatever zoom the reader chose, and a
    # fraction is the one form that survives that.
    x: float = 0.0
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0


@dataclass
class DocumentLink:
    """An in-text cross-reference and the document position it names."""

    kind: str
    label: str
    page: int
    x: float
    y: float
    w: float
    h: float
    target_page: int
    target_y: float


@dataclass
class Analysis:
    references: list[Reference]
    citations: list[Citation]
    links: list[DocumentLink] = field(default_factory=list)


@dataclass
class HeaderMetadata:
    title: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    journal: Optional[str] = None
    year: Optional[int] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None


def configured() -> bool:
    return bool(GROBID_URL)


async def alive() -> bool:
    if not GROBID_URL:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{GROBID_URL}/api/isalive")
            return r.status_code == 200 and r.text.strip() == "true"
    except Exception:
        return False


async def extract_header(pdf_path: str) -> HeaderMetadata:
    """Extract bibliographic metadata directly from a PDF with GROBID."""
    if not GROBID_URL:
        raise RuntimeError("No GROBID service configured")

    with open(pdf_path, "rb") as fh:
        payload = fh.read()
    files = {"input": (os.path.basename(pdf_path), payload, "application/pdf")}
    async with httpx.AsyncClient(timeout=ANALYZE_TIMEOUT) as client:
        response = await client.post(
            f"{GROBID_URL}/api/processHeaderDocument",
            files=files,
            data={"consolidateHeader": "0"},
        )
    if response.status_code == 204:
        raise RuntimeError("GROBID could not read this PDF header")
    if response.status_code != 200:
        raise RuntimeError(f"GROBID returned {response.status_code}")
    return parse_header(response.text)


def parse_header(xml: str) -> HeaderMetadata:
    """Parse GROBID's TEI header response into upload metadata."""
    root = ET.fromstring(xml)
    bibl = root.find(f".//{TEI}sourceDesc/{TEI}biblStruct")
    if bibl is None:
        raise RuntimeError("GROBID returned no bibliographic header")

    title = normalize_title(_text(bibl.find(f"{TEI}analytic/{TEI}title[@type='main']")))
    authors = []
    for author in bibl.findall(f"{TEI}analytic/{TEI}author"):
        person = author.find(f"{TEI}persName")
        if person is None:
            continue
        parts = [
            _text(part)
            for part in person
            if part.tag in {f"{TEI}forename", f"{TEI}surname"}
        ]
        name = " ".join(part for part in parts if part)
        if name:
            authors.append(name)

    journal = _text(bibl.find(f"{TEI}monogr/{TEI}title[@level='j']"))
    date = bibl.find(f"{TEI}monogr/{TEI}imprint/{TEI}date")
    when = date.get("when") if date is not None else None
    year = int(when[:4]) if when and when[:4].isdigit() else None
    identifiers = {
        (node.get("type") or "").lower(): _text(node)
        for node in bibl.findall(f"{TEI}idno")
    }
    return HeaderMetadata(
        title=title,
        authors=authors,
        journal=journal,
        year=year,
        doi=identifiers.get("doi"),
        arxiv_id=identifiers.get("arxiv"),
    )


_TITLE_SMALL_WORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in",
    "into", "nor", "of", "on", "or", "over", "per", "the", "to", "via",
    "with", "without", "yet",
}


def normalize_title(title: str | None) -> str | None:
    """Undo display-only all-caps styling in a GROBID header title.

    Mixed-case titles are authoritative and pass through untouched. For an
    all-caps heading, use ordinary title casing while retaining short
    acronyms. A leading X-name is common in systems papers (XGrammar,
    XLA, XGBoost); its X remains a prefix rather than becoming "Xgrammar".
    """
    if not title:
        return title
    letters = "".join(char for char in title if char.isalpha())
    if not letters or letters != letters.upper():
        return title

    parts = re.findall(r"[A-Za-z]+|[^A-Za-z]+", title)
    word_indexes = [index for index, part in enumerate(parts) if part.isalpha()]
    first = word_indexes[0]
    last = word_indexes[-1]
    after_colon = False
    for index, part in enumerate(parts):
        if not part.isalpha():
            if ":" in part:
                after_colon = True
            continue
        lower = part.lower()
        if lower in _TITLE_SMALL_WORDS and index not in {first, last} and not after_colon:
            parts[index] = lower
        elif len(part) <= 4 and lower not in _TITLE_SMALL_WORDS:
            parts[index] = part
        elif index == first and part.startswith("X") and len(part) > 5:
            parts[index] = "X" + lower[1:].capitalize()
        else:
            parts[index] = lower.capitalize()
        after_colon = False
    return "".join(parts)


async def analyze(pdf_path: str) -> Analysis:
    """Read a PDF through GROBID and return its references and markers.

    Raises on anything that went wrong, so the caller can record why a
    paper has no references rather than silently showing none."""
    if not GROBID_URL:
        raise RuntimeError("No GROBID service configured")

    # Read the file in full rather than handing httpx the handle: a file
    # object is a synchronous stream, and an async client refuses to send
    # one.
    with open(pdf_path, "rb") as fh:
        payload = fh.read()

    files = {"input": (os.path.basename(pdf_path), payload, "application/pdf")}
    # teiCoordinates is repeated once per element we want boxes for;
    # without it GROBID returns the structure but not the geometry.
    data = {
        # A list is how httpx spells a repeated form field. It has to be a
        # dict: given a list of pairs, httpx reads `data` as a raw request
        # body instead of a form, and an async client cannot send one.
        "teiCoordinates": ["ref", "biblStruct", "figure"],
        "includeRawCitations": "1",
        # Consolidation would have GROBID call CrossRef itself, one
        # reference at a time, inside this request. Papol does its own
        # lookup later and lazily, so this stays off.
        "consolidateCitations": "0",
        "consolidateHeader": "0",
    }
    async with httpx.AsyncClient(timeout=ANALYZE_TIMEOUT) as client:
        response = await client.post(
            f"{GROBID_URL}/api/processFulltextDocument", files=files, data=data
        )

    if response.status_code == 204:
        raise RuntimeError("GROBID could not read this PDF (no text extracted)")
    if response.status_code != 200:
        raise RuntimeError(f"GROBID returned {response.status_code}")

    return parse_tei(response.text)


def parse_tei(xml: str) -> Analysis:
    """Pull the reference list and the in-text markers out of TEI.

    Kept separate from the request so it can be tested against a saved
    document without a service running."""
    root = ET.fromstring(xml)

    # Page sizes, to turn GROBID's points into fractions. GROBID measures
    # from the top-left of the page in PDF points, which is the same space
    # pdf.js lays its text layer out in.
    pages: dict[int, tuple[float, float]] = {}
    for surface in root.iter(f"{TEI}surface"):
        try:
            n = int(surface.get("n"))
            pages[n] = (float(surface.get("lrx")), float(surface.get("lry")))
        except (TypeError, ValueError):
            continue

    references: list[Reference] = []
    by_key: dict[str, Reference] = {}
    for bibl in root.iter(f"{TEI}biblStruct"):
        key = bibl.get(XML_ID)
        if not key:
            continue  # the header's own biblStruct, describing this paper
        # Counted over the entries themselves, so the first reference is 0
        # rather than 1: the header's biblStruct comes first and is not one
        # of them.
        ref = _reference_from(bibl, key, len(references), pages)
        references.append(ref)
        by_key[key] = ref

    citations: list[Citation] = []
    for marker in root.iter(f"{TEI}ref"):
        if marker.get("type") != "bibr":
            continue
        label = "".join(marker.itertext()).strip()
        target = (marker.get("target") or "").lstrip("#")
        inferred = False
        if target not in by_key:
            # GROBID marked something as a citation without deciding which
            # work it cites — common in older papers, where it recognises
            # "[8]" on the page but cannot tie it to the bibliography. In a
            # numbered bibliography the marker says which entry it is, so
            # read the number and count.
            target = _numbered_target(label, references)
            inferred = target is not None
        if not target:
            continue  # nothing to open: not clickable
        for box in _boxes(marker.get("coords"), pages):
            citations.append(
                Citation(key=target, label=label, inferred=inferred, **box)
            )

    figures = {}
    for figure in root.iter(f"{TEI}figure"):
        key = figure.get(XML_ID)
        boxes = _boxes(figure.get("coords"), pages)
        if key and boxes:
            figures[key] = boxes[0]

    links: list[DocumentLink] = []
    for marker in root.iter(f"{TEI}ref"):
        if marker.get("type") != "figure":
            continue
        target = figures.get((marker.get("target") or "").lstrip("#"))
        if target is None:
            continue
        label = "".join(marker.itertext()).strip()
        for box in _boxes(marker.get("coords"), pages):
            # Extend left over the prefix so the complete phrase is one
            # pointer target rather than making only the numeral clickable.
            page_width, page_height = pages[box["page"]]
            prefix = min(
                box["x"],
                box["h"] * page_height / page_width * FIGURE_PREFIX_EMS,
            )
            box = {**box, "x": box["x"] - prefix, "w": box["w"] + prefix}
            links.append(DocumentLink(
                kind="figure", label=label, **box,
                target_page=target["page"], target_y=target["y"],
            ))

    return Analysis(references=references, citations=citations, links=links)


# A citation marker's number, as printed: "[8]", "(3)", "[9," or the "[2]"
# in "Curry [2]". The bracket is required — without it every year and
# section number in the text would look like a citation.
_MARKER_NUMBER = re.compile(r"[\[(]\s*(\d{1,3})")


def _numbered_target(label: str, references: list[Reference]) -> Optional[str]:
    """The reference a numeric marker points at, counting from one.

    Only trustworthy where the bibliography is numbered in the order it is
    printed, which is what the numbers in the text refer to. A number past
    the end of the list is a sign that this bibliography is not numbered
    that way at all, so it is left alone rather than pointed somewhere
    plausible-looking."""
    match = _MARKER_NUMBER.search(label)
    if not match:
        return None
    n = int(match.group(1))
    if not 1 <= n <= len(references):
        return None
    return references[n - 1].key


def _reference_from(bibl, key: str, index: int, pages) -> Reference:
    raw = _text(bibl.find(f'{TEI}note[@type="raw_reference"]'))

    # The title lives under <analytic> for a paper in a journal and under
    # <monogr> for anything standalone; prefer the former.
    title = _text(bibl.find(f'{TEI}analytic/{TEI}title[@level="a"]'))
    if not title:
        title = _text(bibl.find(f'{TEI}monogr/{TEI}title[@level="m"]'))
    if not title:
        title = _text(bibl.find(f"{TEI}monogr/{TEI}title"))

    journal = _text(bibl.find(f'{TEI}monogr/{TEI}title[@level="j"]'))

    authors = []
    for person in bibl.iter(f"{TEI}persName"):
        parts = [
            _text(p)
            for p in person.iter()
            if p.tag in (f"{TEI}forename", f"{TEI}surname")
        ]
        name = " ".join(p for p in parts if p)
        if name:
            authors.append(name)

    date = bibl.find(f"{TEI}monogr/{TEI}imprint/{TEI}date")
    if date is None:
        date = bibl.find(f".//{TEI}date")
    # The @when attribute first, then what the element actually says. They
    # differ when the analyzer has taken something else for the date: a
    # reference ending "178ś190" comes back as when="0190" with the text
    # still reading "2016. 190", and the text is the one to believe.
    year = _year_in(date.get("when"), _text(date)) if date is not None else None

    doi = arxiv = None
    for idno in bibl.iter(f"{TEI}idno"):
        kind = (idno.get("type") or "").lower()
        value = _text(idno)
        if not value:
            continue
        if kind == "doi":
            doi = value.lower().replace("https://doi.org/", "")
        elif kind == "arxiv":
            arxiv = value.replace("arXiv:", "").strip()
    if not arxiv:
        arxiv = extract_arxiv_id(raw or "")

    # Only the first box matters here: an entry may wrap over several
    # lines, and where it *starts* is what a link into it points at.
    boxes = _boxes(bibl.get("coords"), pages)
    first = boxes[0] if boxes else None

    return Reference(
        key=key,
        index=index,
        raw=raw,
        title=title,
        authors=authors,
        year=year,
        journal=journal,
        doi=doi,
        arxiv_id=arxiv,
        page=first["page"] if first else None,
        y=first["y"] if first else None,
    )


# A publication year, as opposed to a page number, a volume, or whatever
# else a mis-read date leaves behind. Nothing in a bibliography predates
# printing; nothing in it is in the future.
_EARLIEST_YEAR, _LATEST_YEAR = 1500, 2100


def _year_in(*sources: Optional[str]) -> Optional[int]:
    """The first plausible year among these, in the order given."""
    for text in sources:
        for match in re.finditer(r"\d{4}", text or ""):
            year = int(match.group(0))
            if _EARLIEST_YEAR <= year <= _LATEST_YEAR:
                return year
    return None


def _boxes(coords: Optional[str], pages) -> list[dict]:
    """GROBID's "page,x,y,width,height;…" as fractions of each page."""
    out = []
    for box in (coords or "").split(";"):
        parts = box.split(",")
        if len(parts) != 5:
            continue
        try:
            page = int(parts[0])
            x, y, w, h = (float(v) for v in parts[1:])
        except ValueError:
            continue
        width, height = pages.get(page, (0, 0))
        if not width or not height:
            continue
        out.append(
            {
                "page": page,
                "x": x / width,
                "y": y / height,
                "w": w / width,
                "h": h / height,
            }
        )
    return out


def _text(node) -> Optional[str]:
    if node is None:
        return None
    text = " ".join("".join(node.itertext()).split())
    return text or None
