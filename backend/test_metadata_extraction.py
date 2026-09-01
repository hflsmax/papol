import unittest

import grobid
from pdf_parser import arxiv_doi, extract_arxiv_id

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

GROBID_JOURNAL_ONLY_REFERENCE = """<TEI xmlns="http://www.tei-c.org/ns/1.0">
<text><back><listBibl><biblStruct xml:id="b7">
<analytic><author><persName><forename>M.</forename><surname>Schenk</surname></persName></author></analytic>
<monogr><title level="j">Proceedings of the National Academy of Sciences</title>
<imprint><date when="2013"/></imprint></monogr>
<note type="raw_reference">M. Schenk, Proceedings of the National Academy of Sciences 110, 3276 (2013).</note>
</biblStruct></listBibl></back></text></TEI>"""


class MetadataExtractionTests(unittest.TestCase):
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
        self.assertEqual(header.arxiv_id, "arXiv:1705.07354v3")

    def test_parses_figure_reference_as_document_link(self):
        analysis = grobid.parse_tei(GROBID_FIGURE_LINK)
        self.assertEqual(len(analysis.links), 1)
        link = analysis.links[0]
        self.assertEqual((link.kind, link.label), ("figure", "2"))
        self.assertEqual((link.page, link.y), (2, 0.2))
        self.assertAlmostEqual(link.x, 0.15)
        self.assertAlmostEqual(link.w, 0.07)
        self.assertEqual((link.target_page, link.target_y), (2, 0.5))

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


if __name__ == "__main__":
    unittest.main()
