"""Turning a printed reference into a paper a reader can act on.

The analyzer gives Papol the string an author typed into their
bibliography. This turns that string into a work: its title, who wrote it,
where it appeared, what it is about, how often it has been cited, and
where a copy can be read. Nothing here is Papol's own knowledge — it is
CrossRef and OpenAlex — and both are asked only when a reader actually
opens a reference.

The judgment is in choosing between what they answer, because a
bibliographic search always returns *something*: it has no way to say
"that paper is not in my index". Two tests decide, and a candidate must
pass both.

**Its title normally must be in the printed reference.** When a compact
bibliography deliberately omits article titles, an exact Crossref match on
the structured authors, venue and year can identify the work instead.

**Its year should be the printed year.** This one matters more than it
looks. Titles are not unique across time: a conference paper often gets a
later journal version under nearly the same words, and CrossRef will
happily return the version it has. Asked for Gu et al.'s *CertiKOS: An
Extensible Architecture for Building Certified Concurrent OS Kernels*
(OSDI'16), CrossRef offers *Building certified concurrent OS kernels* —
the 2019 retrospective in CACM, which passes the title test comfortably
and is the wrong paper. The printed year is what tells them apart, and the
author wrote it down for us.

The year ranks rather than rejects, because either index may be the one
holding the right answer — OSDI is absent from CrossRef entirely, so its
best answer for CertiKOS was never going to be CertiKOS. Every candidate that passes the title test competes, and the one
whose year sits closest to the printed one wins. Rejecting outright on the
year would lose honest references instead: Hellman's is printed as
"submitted … Sept. 1975" and was published in 1977, and a reference two
years from its record is still that reference when nothing else is nearer.

Which index is asked, and when, is decided by cost as much as by quality.
CrossRef is free and is the better matcher of a printed reference, so it
goes first and is often the end of it. An OpenAlex *search* is metered —
without a key a day's allowance is about ten of them — so one is spent
only when CrossRef has not confidently answered. Looking a work up by DOI
costs practically nothing, so enrichment is never rationed.

Whatever comes back is checked again before it is shown. A record reached
by an identifier can still be the wrong record — OpenAlex's entry for
arXiv:1308.0850 is a different paper than the one Graves put there — and a
CrossRef match enriched from OpenAlex is only worth showing while the
enrichment is still describing the same work.
"""

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

import crossref
import openalex
from pdf_parser import extract_arxiv_id

logger = logging.getLogger(__name__)

# Said in the log rather than swallowed, and it names the file, because the
# usual reason for running out of OpenAlex searches is having no key at all.
_KEY_HINT = (
    ""
    if openalex.API_KEY
    else " — put PAPOL_OPENALEX_KEY=... in ~/.config/papol/secrets.env"
    " and restart the papol service"
)

# Words a title shares with everything, which say nothing about whether
# two titles are the same title.
_STOPWORDS = {
    "a", "an", "the", "of", "on", "in", "for", "and", "or", "to", "with",
    "by", "from", "at", "as", "is", "are", "be", "using", "via", "its",
}

# How much of a candidate's title must appear in the printed reference for
# the match to be believed. Not 1.0: OCR, line-break hyphens and subtitles
# dropped by one side or the other all cost a word or two honestly.
_TITLE_AGREEMENT = 0.75

# At or below this many words, a title has no room to lose one: the words
# it does have are all that distinguish it from its neighbours.
_SHORT_TITLE = 4

# How far a candidate's year may sit from the printed one before it is not
# credible at all. Generous, because this is only the backstop: the ranking
# has already preferred anything closer. Proceedings are dated to the year
# before their conference, and a paper printed as "submitted" may appear
# two years later.
_YEAR_LIMIT = 3

# What an unknown year counts as when ranking. Worse than agreeing, better
# than disagreeing: a record with no date should lose to an exact match and
# beat one that is plainly a different year.
_YEAR_UNKNOWN = 1.5


@dataclass(frozen=True)
class ReferenceContext:
    raw: str
    title: Optional[str]
    year: Optional[int]
    authors: tuple[str, ...] = ()
    journal: Optional[str] = None

    @classmethod
    def from_reference(cls, reference):
        try:
            encoded_authors = getattr(reference, "authors", None)
            authors = tuple(json.loads(encoded_authors)) if encoded_authors else ()
        except (TypeError, ValueError):
            authors = ()
        return cls(
            raw=(reference.raw or "").strip(),
            title=getattr(reference, "title", None),
            year=getattr(reference, "year", None),
            authors=authors,
            journal=getattr(reference, "journal", None),
        )

    def accepts(self, summary: dict) -> bool:
        return (
            _title_matches(summary.get("title"), self.raw, self.title)
            and _year_distance(summary.get("year"), self.year) <= _YEAR_LIMIT
        )


@dataclass(frozen=True)
class Candidate:
    summary: dict
    provider: str
    rank: int
    year_distance: float

    @property
    def sort_key(self) -> tuple[float, int, int]:
        provider_rank = 0 if self.provider == "crossref" else 1
        return self.year_distance, provider_rank, self.rank


async def resolve(reference) -> tuple[str, Optional[dict]]:
    """Look up one reference. Returns (status, summary):

      ok    — a work was found, and `summary` describes it
      miss  — nothing convincing was found; the reader gets the raw string
      error — nobody could be asked just now; worth trying again later, so
              the caller should not remember this as an answer
    """
    context = ReferenceContext.from_reference(reference)
    identified, lookup_failed = await _by_identifier(reference, context)
    if identified:
        return "ok", identified

    try:
        crossref_candidates = await _crossref_candidates(context)
    except crossref.Unavailable as unavailable:
        lookup_failed = True
        crossref_candidates = []
        logger.warning(f"CrossRef search unavailable: {unavailable}")
    candidates = list(crossref_candidates)
    if not _confident(crossref_candidates):
        try:
            candidates.extend(await _openalex_candidates(context))
        except (openalex.Throttled, openalex.Unavailable) as spent:
            lookup_failed = True
            logger.warning(f"OpenAlex search unavailable: {spent}{_KEY_HINT}")

    best = min(candidates, key=lambda candidate: candidate.sort_key, default=None)
    if best is None or best.year_distance > _YEAR_LIMIT:
        return ("error" if lookup_failed else "miss"), None
    return "ok", await _enrich(best, context)


async def _by_identifier(reference, context: ReferenceContext) -> tuple[Optional[dict], bool]:
    """Resolve identifiers GROBID read, tracking temporary lookup failure."""
    failed = False
    for identifier, lookup in (
        (reference.doi, openalex.by_doi),
        (reference.arxiv_id or extract_arxiv_id(reference.raw or ""), openalex.by_arxiv),
    ):
        if not identifier:
            continue
        try:
            work = await lookup(identifier)
        except (openalex.Throttled, openalex.Unavailable):
            failed = True
            continue
        if work:
            summary = openalex.summarize(work)
            if context.accepts(summary):
                return summary, failed
    return None, failed


async def _crossref_candidates(context: ReferenceContext) -> list[Candidate]:
    items = await crossref.match_reference(context.raw) if context.raw else []
    return _candidates(
        (crossref.summarize_crossref(item) for item in items),
        provider="crossref",
        context=context,
    )


async def _openalex_candidates(context: ReferenceContext) -> list[Candidate]:
    """Spend a metered title search only when CrossRef is inconclusive."""
    works = await openalex.by_title(context.title or context.raw)
    return _candidates(
        (openalex.summarize(work) for work in works),
        provider="openalex",
        context=context,
    )


def _candidates(summaries, provider: str, context: ReferenceContext) -> list[Candidate]:
    candidates = []
    for rank, summary in enumerate(summaries):
        title_match = _title_matches(summary.get("title"), context.raw, context.title)
        # Some compact bibliography styles omit article titles entirely.
        # Crossref's bibliographic search can still identify them from the
        # authors, venue, year, volume and page/article number in the raw
        # entry. Accept only its top result, and only when the structured
        # authors, venue and year all agree exactly enough to make that
        # inference unambiguous.
        metadata_match = (
            provider == "crossref"
            and rank == 0
            and not context.title
            and _metadata_matches_untitled(summary, context)
        )
        if not title_match and not metadata_match:
            continue
        candidates.append(Candidate(
            summary=summary,
            provider=provider,
            rank=rank,
            year_distance=_year_distance(summary.get("year"), context.year),
        ))
    return candidates


def _metadata_matches_untitled(summary: dict, context: ReferenceContext) -> bool:
    if (
        context.year is None
        or summary.get("year") != context.year
        or not context.journal
        or not context.authors
    ):
        return False
    venue_words = _content_words(context.journal)
    if not venue_words or not venue_words.issubset(_content_words(summary.get("venue") or "")):
        return False

    candidate_names = _name_words(" ".join(summary.get("authors") or []))
    surnames = {
        _name_words(parts[-1]).pop()
        for author in context.authors
        if (parts := re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", author))
    }
    return len(surnames) >= 2 and surnames.issubset(candidate_names)


def _name_words(text: str) -> set[str]:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return {word.lower() for word in re.findall(r"[A-Za-z]+", ascii_text) if len(word) > 1}


def _confident(candidates: list[Candidate]) -> bool:
    """An exact-year CrossRef match is enough to avoid metered search."""
    return any(candidate.year_distance == 0 for candidate in candidates)


async def _enrich(candidate: Candidate, context: ReferenceContext) -> dict:
    """Add OpenAlex data to a CrossRef winner without changing its identity."""
    summary = candidate.summary
    if candidate.provider != "crossref" or not summary.get("doi"):
        return summary
    try:
        work = await openalex.by_doi(summary["doi"])
    except (openalex.Throttled, openalex.Unavailable):
        return summary
    if not work:
        return summary
    merged = _merge(openalex.summarize(work), summary, context.year)
    return merged if context.accepts(merged) else summary


def _year_distance(candidate: Optional[int], printed: Optional[int]) -> float:
    if not _sane(candidate) or not _sane(printed):
        return _YEAR_UNKNOWN
    return float(abs(candidate - printed))


def _sane(year: Optional[int]) -> bool:
    """A year that could be a publication year. A misparse — a page range
    read as a date, say — must not be able to speak for the reference."""
    return bool(year) and 1500 <= year <= 2100


def _merge(primary: dict, secondary: dict, printed_year: Optional[int]) -> dict:
    """Prefer the richer record, but never lose a field it happens to lack.

    Except the year: where the two disagree, the one that agrees with the
    printed reference is the one the reader is looking at on the page."""
    merged = {
        key: primary.get(key) if _present(primary.get(key)) else secondary.get(key)
        for key in {*primary, *secondary}
    }
    if printed_year:
        for candidate in (primary.get("year"), secondary.get("year")):
            if candidate == printed_year:
                merged["year"] = candidate
                break
    # Enrichment should not shorten a correctly matched title. OpenAlex can
    # call the Emscripten paper merely "Emscripten" while Crossref retains
    # the identifying subtitle printed in the bibliography.
    titles = [primary.get("title"), secondary.get("title")]
    merged["title"] = max(
        (title for title in titles if title),
        key=lambda title: len(_content_words(title)),
        default=merged.get("title"),
    )
    return merged


def _present(value) -> bool:
    """Whether a provider supplied a value; numeric zero is meaningful."""
    return value is not None and value != "" and value != [] and value != {}


def _title_matches(
    candidate: Optional[str], raw: str, parsed_title: Optional[str]
) -> bool:
    """Is this candidate's title the one printed in the reference?

    The test is containment, not similarity: the printed reference is a
    superset of the title, so a real match's words are nearly all already
    on the page.

    How many may be missing depends on how many there are. A long title
    can lose a word to a line-break hyphen or a dropped subtitle and still
    obviously be itself. A short one cannot: *Graph Attention Networks* and
    *Structured attention networks* share two words of three, which is
    agreement enough by any ratio and is nevertheless a different paper by
    different authors. Below a handful of words, every one has to be
    there."""
    words = _content_words(candidate)
    if not words:
        return False
    haystack = _content_words(f"{raw} {parsed_title or ''}")
    if not haystack:
        return False
    if len(words) == 1:
        # A one-word search result contained somewhere in a long reference
        # has no identity: "MLC" and "LangChain" produced unrelated works.
        # It is usable only when the structural parser independently says
        # that exact word is the complete title.
        return words == _content_words(parsed_title)
    matched = words & haystack
    # PDF line-break recovery can join a real compound ("general- purpose"
    # becomes "generalpurpose"). Count both component words when their
    # concatenation is present, without relaxing the test for unrelated
    # words elsewhere in a long raw reference.
    for first in words:
        for second in words - {first}:
            if first + second in haystack:
                matched.update((first, second))
    missing = len(words - matched)
    if len(words) <= _SHORT_TITLE:
        return missing == 0
    return len(matched) / len(words) >= _TITLE_AGREEMENT


def _content_words(text: Optional[str]) -> set[str]:
    if not text:
        return set()
    # Hyphenated line breaks in a PDF split words that should be whole.
    text = re.sub(r"-\s+", "", text.lower())
    return {
        w for w in re.findall(r"[a-z0-9]+", text)
        if len(w) > 1 and w not in _STOPWORDS
    }
