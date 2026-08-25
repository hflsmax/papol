import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import biblio


def reference(**overrides):
    values = {
        "raw": "Vaswani et al. Attention Is All You Need. 2017.",
        "title": "Attention Is All You Need",
        "year": 2017,
        "doi": None,
        "arxiv_id": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class BibliographyResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_identifier_match_short_circuits_searches(self):
        summary = {"title": "Attention Is All You Need", "year": 2017}
        with (
            patch.object(biblio.openalex, "by_doi", AsyncMock(return_value=summary)),
            patch.object(biblio.openalex, "summarize", side_effect=lambda work: work),
            patch.object(biblio.crossref, "match_reference", AsyncMock()) as crossref,
        ):
            result = await biblio.resolve(reference(doi="10.example/paper"))
        self.assertEqual(result, ("ok", summary))
        crossref.assert_not_awaited()

    async def test_versioned_arxiv_id_uses_work_level_doi(self):
        with patch.object(biblio.openalex, "by_doi", AsyncMock()) as by_doi:
            await biblio.openalex.by_arxiv("arXiv:1705.07354v3")
        by_doi.assert_awaited_once_with("10.48550/arXiv.1705.07354")

    async def test_exact_crossref_match_skips_search_and_is_enriched(self):
        crossref_summary = {
            "title": "Attention Is All You Need",
            "authors": ["A. Vaswani"],
            "year": 2017,
            "doi": "10.example/paper",
            "source": "crossref",
        }
        openalex_summary = {
            "title": "Attention Is All You Need",
            "year": 2017,
            "abstract": "Transformer abstract",
            "citations": 42,
            "source": "openalex",
        }
        with (
            patch.object(
                biblio.crossref, "match_reference", AsyncMock(return_value=[crossref_summary])
            ),
            patch.object(
                biblio.crossref, "summarize_crossref", side_effect=lambda item: item
            ),
            patch.object(biblio.openalex, "by_title", AsyncMock()) as title_search,
            patch.object(
                biblio.openalex, "by_doi", AsyncMock(return_value=openalex_summary)
            ),
            patch.object(biblio.openalex, "summarize", side_effect=lambda work: work),
        ):
            status, result = await biblio.resolve(reference())
        self.assertEqual(status, "ok")
        self.assertEqual(result["abstract"], "Transformer abstract")
        self.assertEqual(result["authors"], ["A. Vaswani"])
        title_search.assert_not_awaited()

    async def test_openalex_search_beats_wrong_year_crossref_result(self):
        later = {"title": "Attention Is All You Need", "year": 2019}
        exact = {"title": "Attention Is All You Need", "year": 2017}
        with (
            patch.object(biblio.crossref, "match_reference", AsyncMock(return_value=[later])),
            patch.object(
                biblio.crossref, "summarize_crossref", side_effect=lambda item: item
            ),
            patch.object(biblio.openalex, "by_title", AsyncMock(return_value=[exact])),
            patch.object(biblio.openalex, "summarize", side_effect=lambda work: work),
        ):
            self.assertEqual(await biblio.resolve(reference()), ("ok", exact))

    async def test_mismatched_enrichment_does_not_replace_crossref_identity(self):
        crossref_summary = {
            "title": "Attention Is All You Need",
            "year": 2017,
            "doi": "10.example/paper",
        }
        wrong = {"title": "Structured Attention Networks", "year": 2017}
        with (
            patch.object(
                biblio.crossref, "match_reference", AsyncMock(return_value=[crossref_summary])
            ),
            patch.object(
                biblio.crossref, "summarize_crossref", side_effect=lambda item: item
            ),
            patch.object(biblio.openalex, "by_doi", AsyncMock(return_value=wrong)),
            patch.object(biblio.openalex, "by_title", AsyncMock()),
            patch.object(biblio.openalex, "summarize", side_effect=lambda work: work),
        ):
            self.assertEqual(
                await biblio.resolve(reference()), ("ok", crossref_summary)
            )

    async def test_throttled_last_resort_is_retryable_error(self):
        with (
            patch.object(biblio.crossref, "match_reference", AsyncMock(return_value=[])),
            patch.object(
                biblio.openalex,
                "by_title",
                AsyncMock(side_effect=biblio.openalex.Throttled("spent")),
            ),
        ):
            self.assertEqual(await biblio.resolve(reference()), ("error", None))

    async def test_provider_failure_is_not_cached_as_miss(self):
        with (
            patch.object(
                biblio.crossref,
                "match_reference",
                AsyncMock(side_effect=biblio.crossref.Unavailable("offline")),
            ),
            patch.object(biblio.openalex, "by_title", AsyncMock(return_value=[])),
        ):
            self.assertEqual(await biblio.resolve(reference()), ("error", None))

    def test_consolidation_preserves_meaningful_zero(self):
        self.assertEqual(
            biblio._merge(
                {"title": "Paper", "citations": 0},
                {"title": "Paper", "citations": 12},
                printed_year=None,
            )["citations"],
            0,
        )


if __name__ == "__main__":
    unittest.main()
