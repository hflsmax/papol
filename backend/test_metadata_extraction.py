import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

import crossref
import fitz
import grobid
import main
import metadata_lookup
from pdf_parser import arxiv_doi, extract_arxiv_id, extract_doi, extract_doi_from_pdf

GROBID_HEADER = """<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader>
<fileDesc><sourceDesc><biblStruct><analytic>
<title level="a" type="main">The Meaning of Memory Safety</title>
<author><persName><forename>Arthur</forename><surname>Amorim</surname></persName></author>
<author><persName><forename>Benjamin C.</forename><surname>Pierce</surname></persName></author>
</analytic><monogr><title level="j">LNCS</title><imprint>
<date type="published" when="2018-04-06"/></imprint></monogr>
<idno type="arXiv">arXiv:1705.07354v3</idno>
</biblStruct></sourceDesc></fileDesc></teiHeader></TEI>"""

GROBID_FIGURE_LINK = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<facsimile><surface n="2" lrx="600" lry="800"/></facsimile>
<text><body><p>See Figure <ref type="figure" target="#fig_0"
coords="2,120,160,12,10">2</ref>.</p></body>
<back><figure xml:id="fig_0" coords="2,100,400,300,20">
<head>Figure 2:</head><label>2</label></figure></back></text>
</TEI>"""

GROBID_BOX_LINK = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<facsimile>
<surface n="1" lrx="600" lry="800"/><surface n="2" lrx="600" lry="800"/>
</facsimile><text><body><p>See <hi>BOX </hi><ref type="figure" target="#fig_1"
coords="1,300,160,12,10">1</ref>.</p>
<figure xml:id="fig_1" coords="1,100,400,300,20"><head>Figure 1</head><label>1</label></figure>
<figure xml:id="box_1" coords="2,100,240,300,20"><head>Box 1 | Methods</head><label>1</label></figure>
</body></text></TEI>"""

GROBID_JOURNAL_ONLY_REFERENCE = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<text><back><listBibl><biblStruct xml:id="b7">
<analytic><author><persName><forename>M.</forename><surname>Schenk</surname></persName></author></analytic>
<monogr><title level="j">Proceedings of the National Academy of Sciences</title>
<imprint><date when="2013"/></imprint></monogr>
<note type="raw_reference">M. Schenk, Proceedings of the National Academy of Sciences 110, 3276 (2013).</note>
</biblStruct></listBibl></back></text></TEI>"""

# An Elsevier paper cites in brackets and numbers its display equations at
# the right margin; GROBID reads "(7)" beside one of them as a citation of
# reference 7.
GROBID_EQUATION_NUMBER = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<facsimile><surface n="4" lrx="600" lry="800"/></facsimile>
<text><body>
<p>Inspired by prior work <ref type="bibr" coords="4,100,100,12,10" target="#b0">[1]</ref>
and by linkages <ref type="bibr" coords="4,200,100,12,10" target="#b6">[7]</ref>.</p>
<p>A out-plane = (b 0 , b 1 ) <ref type="bibr" coords="4,552,308,11,8" target="#b6">(7)</ref> where</p>
</body><back><listBibl>
<biblStruct xml:id="b0" coords="4,60,700,200,10"><note type="raw_reference">Yao L. Pneui.</note></biblStruct>
<biblStruct xml:id="b6" coords="4,60,712,200,10"><note type="raw_reference">Iwafune M. Coded skeleton.</note></biblStruct>
</listBibl></back></text></TEI>"""

# Science and the journals that follow it really do cite as "(7)".
GROBID_PARENTHESIZED_CITATIONS = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<facsimile><surface n="1" lrx="600" lry="800"/></facsimile>
<text><body>
<p>As reported <ref type="bibr" coords="1,100,100,12,10" target="#b0">(1)</ref>
and later confirmed <ref type="bibr" coords="1,200,100,12,10" target="#b6">(7)</ref>.</p>
</body><back><listBibl>
<biblStruct xml:id="b0" coords="1,60,700,200,10"><note type="raw_reference">Yao L. Pneui.</note></biblStruct>
<biblStruct xml:id="b6" coords="1,60,712,200,10"><note type="raw_reference">Iwafune M. Coded skeleton.</note></biblStruct>
</listBibl></back></text></TEI>"""


class MetadataExtractionTests(unittest.TestCase):
    def test_skips_line_wrapped_doi_fragment_for_complete_footer_doi(self):
        text = (
            "Supporting information at https://www.pnas.org/lookup/suppl/"
            "doi:10.1073/pnas.\n2423301122/-/DCSupplemental.\n"
            "2 of 8 https://doi.org/10.1073/pnas.2423301122 pnas.org"
        )

        self.assertEqual(extract_doi(text), "10.1073/pnas.2423301122")

    def test_extracts_complete_footer_doi_from_pnas_pdf_layout(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "countersnapping.pdf"
            document = fitz.open()
            first_page = document.new_page()
            first_page.insert_text((72, 72), "doi:10.1073/pnas.")
            first_page.insert_text((72, 90), "2423301122/-/DCSupplemental.")
            second_page = document.new_page()
            second_page.insert_text(
                (72, 72), "https://doi.org/10.1073/pnas.2423301122"
            )
            document.save(path)
            document.close()

            doi, text = extract_doi_from_pdf(str(path))

        self.assertIn("10.1073/pnas.", text)
        self.assertEqual(doi, "10.1073/pnas.2423301122")

    def test_keeps_a_non_numeric_doi_suffix_as_a_fallback(self):
        self.assertEqual(extract_doi("doi:10.1000/xyz."), "10.1000/xyz")

    def test_finds_versioned_arxiv_id_in_pdf_text(self):
        self.assertEqual(
            extract_arxiv_id("arXiv:1705.07354v3  [cs.PL]  6 Apr 2018"),
            "1705.07354v3",
        )

    def test_finds_arxiv_id_in_spaced_reference_url(self):
        self.assertEqual(
            extract_arxiv_id("URL https: //arxiv.org/abs/2310. 06825."),
            "2310.06825",
        )

    def test_pdf_arxiv_doi_identifies_the_uploaded_work(self):
        self.assertEqual(arxiv_doi("1705.07354v3"), "10.48550/arXiv.1705.07354")

    def test_parses_grobid_header_metadata(self):
        header = grobid.parse_header(GROBID_HEADER)
        self.assertEqual(header.title, "The Meaning of Memory Safety")
        self.assertEqual(header.authors, ["Arthur Amorim", "Benjamin C. Pierce"])
        self.assertEqual(header.journal, "LNCS")
        self.assertEqual(header.year, 2018)

    def test_crossref_metadata_decodes_journal_entities(self):
        summary = crossref.summarize_crossref({
            "title": ["KinetiX"],
            "container-title": ["Computers &amp; Graphics"],
        })
        self.assertEqual(summary["venue"], "Computers & Graphics")

    def test_crossref_metadata_includes_the_subtitle(self):
        summary = crossref.summarize_crossref({
            "DOI": "10.1145/3354166.3354181",
            "title": ["Under Control"],
            "subtitle": [
                "Compositionally Correct Closure Conversion with Mutable State"
            ],
        })
        self.assertEqual(
            summary["title"],
            "Under Control: Compositionally Correct Closure Conversion with Mutable State",
        )

    def test_parses_figure_reference_as_document_link(self):
        analysis = grobid.parse_tei(GROBID_FIGURE_LINK)
        self.assertEqual(len(analysis.links), 1)
        link = analysis.links[0]
        self.assertEqual((link.kind, link.label), ("figure", "2"))
        self.assertEqual((link.page, link.y), (2, 0.2))
        self.assertAlmostEqual(link.x, 0.15)
        self.assertAlmostEqual(link.w, 0.07)
        self.assertEqual((link.target_page, link.target_y), (2, 0.5))

    def test_uses_cross_reference_kind_to_disambiguate_numbered_targets(self):
        analysis = grobid.parse_tei(GROBID_BOX_LINK)
        self.assertEqual(len(analysis.links), 1)
        link = analysis.links[0]
        self.assertEqual((link.kind, link.label), ("box", "1"))
        self.assertEqual((link.target_page, link.target_y), (2, 0.3))

    def test_recovers_figure_links_omitted_from_tei_from_pdf_layout(self):
        document = fitz.open()
        source = document.new_page()
        source.insert_text((72, 100), "See FIG. 2 for the mechanism.")
        target = document.new_page()
        target.insert_text((72, 200), "Figure 2 | Mechanism-based metamaterials")

        links = grobid._layout_links(document)

        self.assertEqual(len(links), 1)
        self.assertEqual((links[0].kind, links[0].label), ("figure", "2"))
        self.assertEqual((links[0].page, links[0].target_page), (1, 2))
        document.close()

    def test_does_not_read_a_display_equation_number_as_a_citation(self):
        analysis = grobid.parse_tei(GROBID_EQUATION_NUMBER)

        self.assertEqual([c.label for c in analysis.citations], ["[1]", "[7]"])

    def test_keeps_parenthesized_markers_where_that_is_how_the_paper_cites(self):
        analysis = grobid.parse_tei(GROBID_PARENTHESIZED_CITATIONS)

        self.assertEqual([c.label for c in analysis.citations], ["(1)", "(7)"])

    def test_does_not_use_journal_as_missing_article_title(self):
        reference = grobid.parse_tei(GROBID_JOURNAL_ONLY_REFERENCE).references[0]
        self.assertIsNone(reference.title)
        self.assertEqual(
            reference.journal,
            "Proceedings of the National Academy of Sciences",
        )

    def test_normalizes_display_only_all_caps_title(self):
        self.assertEqual(
            grobid.normalize_title(
                "XGRAMMAR: FLEXIBLE AND EFFICIENT STRUCTURED GENERATION "
                "ENGINE FOR LARGE LANGUAGE MODELS"
            ),
            "XGrammar: Flexible and Efficient Structured Generation "
            "Engine for Large Language Models",
        )

    def test_preserves_mixed_case_title_and_short_acronyms(self):
        self.assertEqual(
            grobid.normalize_title("An API for SQL: Mixed-Case Titles"),
            "An API for SQL: Mixed-Case Titles",
        )
        self.assertEqual(
            grobid.normalize_title("AN API FOR SQL"),
            "An API for SQL",
        )


class _Upload:
    """The parts of an UploadFile that the extract endpoint touches."""

    def __init__(self, path: Path):
        self.filename = path.name
        self._data = path.read_bytes()

    async def read(self) -> bytes:
        return self._data


def _identifierless_pdf(directory: str, name: str) -> Path:
    """A PDF printing a title and authors but no DOI, as an author's
    camera-ready copy does."""
    path = Path(directory) / name
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "Metamaterial Mechanisms")
    page.insert_text((72, 96), "Alexandra Ion, Patrick Baudisch")
    page.insert_text((72, 120), "Hasso Plattner Institute, Potsdam, Germany")
    document.save(path)
    document.close()
    return path


PRINTED_HEADER = grobid.HeaderMetadata(
    title="Metamaterial Mechanisms",
    authors=["Alexandra Ion", "Patrick Baudisch"],
)


class PrintedHeaderFallbackTests(unittest.IsolatedAsyncioTestCase):
    """What Papol makes of a paper that prints no identifier at all.

    Without a DOI or an arXiv id there is nothing for CrossRef or OpenAlex to
    answer, and a filename is not a title."""

    async def test_reads_the_page_when_no_identifier_resolves_the_paper(self):
        with TemporaryDirectory() as directory:
            path = _identifierless_pdf(directory, "2016UIST-Metamaterial-AuthorsCopy.pdf")
            with (
                patch.object(main, "UPLOADS_DIR", Path(directory)),
                patch.object(metadata_lookup, "by_doi", AsyncMock()) as lookup,
                patch.object(grobid, "configured", return_value=True),
                patch.object(
                    grobid, "extract_header", AsyncMock(return_value=PRINTED_HEADER)
                ),
            ):
                metadata = await main.extract_paper_metadata(
                    file=_Upload(path), current_user=None
                )

        # Nothing was printed to look up, so no API was asked.
        lookup.assert_not_awaited()
        self.assertEqual(metadata.title, "Metamaterial Mechanisms")
        self.assertEqual(metadata.authors, '["Alexandra Ion", "Patrick Baudisch"]')

    async def test_an_api_answer_is_never_overwritten_by_the_page(self):
        with TemporaryDirectory() as directory:
            path = _identifierless_pdf(directory, "resolved.pdf")
            resolved = {
                "doi": "10.1145/2984511.2984540",
                "title": "Metamaterial Mechanisms",
                "authors": ["Alexandra Ion", "Patrick Baudisch"],
                "venue": "Proceedings of UIST '16",
                "year": 2016,
            }
            with (
                patch.object(main, "UPLOADS_DIR", Path(directory)),
                patch.object(main, "_printed_header", AsyncMock()) as header,
                patch.object(
                    metadata_lookup, "by_doi", AsyncMock(return_value=resolved)
                ),
                patch.object(
                    main,
                    "extract_doi_from_pdf",
                    return_value=("10.1145/2984511.2984540", ""),
                ),
                patch.object(main, "extract_arxiv_id", return_value=None),
            ):
                metadata = await main.extract_paper_metadata(
                    file=_Upload(path), current_user=None
                )

        # GROBID never names a venue and rarely a year; asking it here could
        # only lose what CrossRef already knew.
        header.assert_not_awaited()
        self.assertEqual(metadata.journal, "Proceedings of UIST '16")
        self.assertEqual(metadata.year, 2016)

    async def test_an_unreachable_analyzer_still_yields_an_editable_form(self):
        """A fallback that fails leaves the user where they already were."""
        with TemporaryDirectory() as directory:
            path = _identifierless_pdf(directory, "Some-Paper-Name.pdf")
            with (
                patch.object(main, "UPLOADS_DIR", Path(directory)),
                patch.object(metadata_lookup, "by_doi", AsyncMock()),
                patch.object(grobid, "configured", return_value=True),
                patch.object(
                    grobid,
                    "extract_header",
                    AsyncMock(side_effect=RuntimeError("GROBID returned 503")),
                ),
            ):
                metadata = await main.extract_paper_metadata(
                    file=_Upload(path), current_user=None
                )

        self.assertEqual(metadata.title, "Some Paper Name")
        self.assertIsNone(metadata.authors)


if __name__ == "__main__":
    unittest.main()
