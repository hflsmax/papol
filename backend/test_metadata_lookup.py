import unittest
from unittest.mock import AsyncMock, patch

import crossref
import metadata_lookup
import openalex


class MetadataLookupTests(unittest.IsolatedAsyncioTestCase):
    async def test_prefers_exact_crossref_metadata(self):
        item = {"DOI": "10.example/work", "title": ["Publisher title"]}
        with (
            patch.object(crossref, "by_doi", AsyncMock(return_value=item)),
            patch.object(
                crossref, "summarize_crossref", return_value={"title": "Publisher title"}
            ),
            patch.object(openalex, "by_doi", AsyncMock()) as openalex_lookup,
        ):
            result = await metadata_lookup.by_doi("10.example/work")
        self.assertEqual(result, {"title": "Publisher title"})
        openalex_lookup.assert_not_awaited()

    async def test_falls_back_to_openalex(self):
        work = {"display_name": "Indexed title"}
        with (
            patch.object(crossref, "by_doi", AsyncMock(return_value=None)),
            patch.object(openalex, "by_doi", AsyncMock(return_value=work)),
            patch.object(openalex, "summarize", return_value={"title": "Indexed title"}),
        ):
            result = await metadata_lookup.by_doi("10.example/work")
        self.assertEqual(result, {"title": "Indexed title"})

    async def test_reports_when_both_apis_are_unavailable(self):
        with (
            patch.object(
                crossref, "by_doi", AsyncMock(side_effect=crossref.Unavailable("offline"))
            ),
            patch.object(
                openalex, "by_doi", AsyncMock(side_effect=openalex.Unavailable("offline"))
            ),
            self.assertRaises(metadata_lookup.Unavailable),
        ):
            await metadata_lookup.by_doi("10.example/work")
