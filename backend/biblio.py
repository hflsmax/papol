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

**Its title must be in the printed reference.** The reference contains the
title of the work it names, so a candidate whose title is not there is not
that work.

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

import logging
import re
from typing import Optional

import crossref
import openalex

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
_TITLE_AGREEMENT = 0.6

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


async def resolve(reference) -> tuple[str, Optional[dict]]:
    """Look up one reference. Returns (status, summary):

      ok    — a work was found, and `summary` describes it
      miss  — nothing convincing was found; the reader gets the raw string
      error — nobody could be asked just now; worth trying again later, so
              the caller should not remember this as an answer
    """
    raw = (reference.raw or "").strip()
    printed_year = getattr(reference, "year", None)
    throttled = False

    # An identifier the analyzer read off the page should settle it: the
    # author named the work. Checked all the same, because the record an
    # identifier lands on is not always the work it belongs to.
    for identifier, lookup in (
        (reference.doi, openalex.by_doi),
        (reference.arxiv_id, openalex.by_arxiv),
    ):
        if not identifier:
            continue
        try:
            work = await lookup(identifier)
        except openalex.Throttled:
            throttled = True
            continue
        if not work:
            continue
        summary = openalex.summarize(work)
        if _accepts(summary, raw, reference, printed_year):
            return "ok", summary

    crossref_candidates = []
    for rank, item in enumerate(await crossref.match_reference(raw) if raw else []):
        summary = crossref.summarize_crossref(item)
        if _title_matches(summary.get("title"), raw, getattr(reference, "title", None)):
            distance = _year_distance(summary.get("year"), printed_year)
            crossref_candidates.append((distance, 0, rank, summary, item))

    candidates = list(crossref_candidates)
    if not _confident(crossref_candidates):
        # Only now is a metered search worth spending: either CrossRef has
        # nothing that matches, or what it has is the wrong year and may
        # well be a later version of the paper under a similar title.
        try:
            candidates += await _searched(raw, reference, printed_year)
        except openalex.Throttled as spent:
            throttled = True
            logger.warning(f"OpenAlex search unavailable: {spent}{_KEY_HINT}")

    if not candidates:
        # Nothing found, but not for want of looking in the same places —
        # say so, rather than storing "no such paper" on a day the search
        # could not be run.
        return ("error" if throttled else "miss"), None

    # Closest year wins; CrossRef breaks a tie, being the better matcher of
    # a printed reference, and each index's own ranking breaks the rest.
    distance, _, _, best, item = min(candidates, key=lambda c: c[:3])
    if distance > _YEAR_LIMIT:
        return ("error" if throttled else "miss"), None

    if item is not None and best.get("doi"):
        # CrossRef found the work; OpenAlex knows what became of it — how
        # often it has been cited, and whether a copy is free. By DOI, so
        # this costs a singleton request rather than a search.
        try:
            work = await openalex.by_doi(best["doi"])
        except openalex.Throttled:
            work = None
        if work:
            merged = _merge(openalex.summarize(work), best, printed_year)
            # Only if the enrichment is still describing the same paper.
            if _accepts(merged, raw, reference, printed_year):
                return "ok", merged
    return "ok", best


def _confident(candidates: list[tuple]) -> bool:
    """Is CrossRef's answer good enough to stop here?

    Only an exact year counts. A near miss is exactly the case that needs a
    second opinion: a conference paper and its later journal version share
    a title and differ by a year or two."""
    return any(distance == 0 for distance, *_ in candidates)


async def _searched(raw: str, reference, printed_year: Optional[int]) -> list[tuple]:
    """What OpenAlex offers for this title.

    Worth the cost when CrossRef has faltered, because the two hold
    different things: whole conference series (USENIX, and with it OSDI
    and NSDI) have no CrossRef DOIs at all."""
    found = []
    title = getattr(reference, "title", None) or raw
    for rank, work in enumerate(await openalex.by_title(title)):
        summary = openalex.summarize(work)
        if _title_matches(summary.get("title"), raw, getattr(reference, "title", None)):
            found.append(
                (_year_distance(summary.get("year"), printed_year), 1, rank, summary, None)
            )
    return found


def _year_distance(candidate: Optional[int], printed: Optional[int]) -> float:
    if not _sane(candidate) or not _sane(printed):
        return _YEAR_UNKNOWN
    return float(abs(candidate - printed))


def _accepts(summary: dict, raw: str, reference, printed_year: Optional[int]) -> bool:
    """Is this really worth showing as the work the reference names?

    Used on what is about to be shown, rather than on the thing that was
    searched for — the two are not always the same record."""
    return (
        _title_matches(summary.get("title"), raw, getattr(reference, "title", None))
        and _year_distance(summary.get("year"), printed_year) <= _YEAR_LIMIT
    )


def _sane(year: Optional[int]) -> bool:
    """A year that could be a publication year. A misparse — a page range
    read as a date, say — must not be able to speak for the reference."""
    return bool(year) and 1500 <= year <= 2100


def _merge(primary: dict, secondary: dict, printed_year: Optional[int]) -> dict:
    """Prefer the richer record, but never lose a field it happens to lack.

    Except the year: where the two disagree, the one that agrees with the
    printed reference is the one the reader is looking at on the page."""
    merged = {k: (primary.get(k) or secondary.get(k)) for k in {*primary, *secondary}}
    if printed_year:
        for candidate in (primary.get("year"), secondary.get("year")):
            if candidate == printed_year:
                merged["year"] = candidate
                break
    return merged


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
    missing = len(words - haystack)
    if len(words) <= _SHORT_TITLE:
        return missing == 0
    return len(words & haystack) / len(words) >= _TITLE_AGREEMENT


def _content_words(text: Optional[str]) -> set[str]:
    if not text:
        return set()
    # Hyphenated line breaks in a PDF split words that should be whole.
    text = re.sub(r"-\s+", "", text.lower())
    return {
        w for w in re.findall(r"[a-z0-9]+", text)
        if len(w) > 1 and w not in _STOPWORDS
    }
