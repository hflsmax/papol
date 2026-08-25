import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import biblio
import reference_engine


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

    async def test_arxiv_url_short_circuits_searches(self):
        ref = reference(
            raw="Jiang et al. Mistral 7B. URL https: //arxiv.org/abs/2310.06825.",
            title="Mistral",
            year=2023,
            resolved_status=None,
        )
        work = {"title": "Mistral 7B", "year": 2023}
        with (
            patch.object(biblio.openalex, "by_arxiv", AsyncMock(return_value=work)) as lookup,
            patch.object(biblio.openalex, "summarize", side_effect=lambda value: value),
            patch.object(biblio.crossref, "match_reference", AsyncMock()) as crossref,
        ):
            self.assertEqual(await biblio.resolve(ref), ("ok", work))
        lookup.assert_awaited_once_with("2310.06825")
        crossref.assert_not_awaited()

    async def test_new_arxiv_evidence_retries_cached_miss(self):
        ref = reference(
            raw="Mistral 7B. https://arxiv.org/abs/2310.06825",
            resolved_status="miss",
            resolution=None,
            resolved_at=None,
            id=17,
            key="b17",
            index=17,
            page=None,
            y=None,
        )
        with patch.object(
            reference_engine.biblio,
            "resolve",
            AsyncMock(return_value=("ok", {"title": "Mistral 7B", "year": 2023})),
        ) as resolver:
            answer = await reference_engine.resolve(ref)
        resolver.assert_awaited_once_with(ref)
        self.assertEqual(answer.resolved_status, "ok")

    async def test_unindexed_web_reference_gets_bibliography_card(self):
        ref = reference(
            raw="MLC team. WebLLM, 2023b. URL https://github. com/mlc-ai/web-llm.",
            title=None,
            year=2023,
            resolved_status="miss",
            resolution=None,
            resolved_at=None,
            authors=None,
            journal=None,
            id=27,
            key="b27",
            index=27,
            page=None,
            y=None,
        )
        answer = await reference_engine.resolve(ref)
        self.assertEqual(answer.resolved_status, "bibliography")
        self.assertEqual(answer.resolution.title, "mlc-ai/web-llm")
        self.assertEqual(answer.resolution.year, 2023)
        self.assertEqual(answer.resolution.url, "https://github.com/mlc-ai/web-llm")

    async def test_preview_reference_infers_year_and_repository(self):
        ref = reference(
            raw="Chaudhary, S. Code alpaca. https://github.com/ sahil280114/codealpaca , 2023.",
            title=None,
            year=None,
            resolved_status="miss",
            resolution=None,
            resolved_at=None,
            authors=None,
            journal=None,
            id=28,
            key="codealpaca",
            index=28,
            page=None,
            y=None,
        )
        answer = await reference_engine.resolve(ref)
        self.assertEqual(answer.resolution.title, "sahil280114/codealpaca")
        self.assertEqual(answer.resolution.year, 2023)

    async def test_unindexed_arxiv_reference_keeps_exact_paper_link(self):
        ref = reference(
            raw="Willard and Louf. Efficient guided generation. arXiv:2307.09702, 2023.",
            title="Efficient guided generation for LLMs",
            year=2023,
            arxiv_id="2307.09702",
            resolved_status="miss",
            resolution=None,
            resolved_at=None,
            authors=None,
            journal=None,
            id=44,
            key="b44",
            index=44,
            page=None,
            y=None,
        )
        answer = await reference_engine.resolve(ref)
        self.assertEqual(answer.resolved_status, "bibliography")
        self.assertEqual(answer.resolution.url, "https://arxiv.org/abs/2307.09702")

    async def test_provider_error_still_returns_bibliography_card(self):
        ref = reference(
            raw="Dubey et al. The Llama 3 Herd of Models. arXiv:2407.21783, 2024.",
            title="The Llama 3 Herd of Models",
            year=2024,
            arxiv_id="2407.21783",
            resolved_status=None,
            resolution=None,
            resolved_at=None,
            authors=None,
            journal=None,
            id=7,
            key="b7",
            index=7,
            page=None,
            y=None,
        )
        with patch.object(
            reference_engine.biblio,
            "resolve",
            AsyncMock(return_value=("error", None)),
        ):
            answer = await reference_engine.resolve(ref)
        self.assertEqual(answer.resolved_status, "bibliography")
        self.assertEqual(answer.resolution.title, "The Llama 3 Herd of Models")
        self.assertEqual(answer.resolution.url, "https://arxiv.org/abs/2407.21783")

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

    def test_generic_title_overlap_does_not_replace_reference(self):
        self.assertFalse(biblio._title_matches(
            "Code Generation: GPT vs Llama 4",
            "Chaudhary, S. Code alpaca: An instruction-following llama model "
            "for code generation. 2023.",
            None,
        ))
        self.assertFalse(biblio._title_matches(
            "Graph of Thoughts: Solving Elaborate Problems with Large Language Models",
            "Tree of thoughts: deliberate problem solving with large language models.",
            "Tree of thoughts: deliberate problem solving with large language models",
        ))

    def test_joined_pdf_compound_still_matches_title(self):
        self.assertTrue(biblio._title_matches(
            "A General-Purpose Algorithm for Constrained Sequential Inference",
            "A generalpurpose algorithm for constrained sequential inference.",
            "A generalpurpose algorithm for constrained sequential inference",
        ))

    def test_one_word_result_does_not_replace_longer_reference(self):
        self.assertFalse(biblio._title_matches(
            "LangChain",
            "LangChain. Tool Calling with LangChain - blog.langchain.dev.",
            "Tool Calling with LangChainblog.langchain",
        ))
        self.assertFalse(biblio._title_matches(
            "MLC",
            "MLC team. MLC-LLM, 2023.",
            None,
        ))

    def test_enrichment_keeps_more_informative_title(self):
        merged = biblio._merge(
            {"title": "Emscripten", "citations": 10},
            {"title": "Emscripten: An LLVM-to-JavaScript Compiler"},
            printed_year=2011,
        )
        self.assertEqual(
            merged["title"],
            "Emscripten: An LLVM-to-JavaScript Compiler",
        )


if __name__ == "__main__":
    unittest.main()
