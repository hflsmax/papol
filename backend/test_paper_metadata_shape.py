"""What a paper's own record may say, and who agrees about it.

A paper's metadata can be edited two ways — the form on the website, and a
push from the Mac — and the two used to hold it to different rules. The
website took a title of any length and a year of any size; the push path
refused a title over 500 characters and never looked at the year. An edit
made on the website could therefore be one the Mac would not synchronize,
which reads as a save that worked and then quietly did not.

`PaperMetadata` is the one shape now, and both paths are asked it. These
tests are what stops them drifting apart again.
"""

import unittest

from pydantic import ValidationError

from app_limits import limit
from models import Paper
from schemas import PaperMetadata, PaperUpdate


def a_paper(**changes) -> Paper:
    values = {
        "sha256": "1" * 64, "title": "A Paper", "file_path": "a.pdf",
        "doi": None, "authors": None, "journal": None, "year": 2020,
    }
    values.update(changes)
    return Paper(**values)


class TheShapeAPaperRecordTakesTests(unittest.TestCase):
    def test_a_paper_must_have_a_title(self):
        for title in ("", "   "):
            with self.subTest(title=title):
                with self.assertRaises(ValidationError):
                    PaperMetadata.of(a_paper(title=title.strip()))

    def test_a_title_has_the_same_ceiling_on_both_paths(self):
        ceiling = limit("text", "paper_title")
        PaperMetadata.of(a_paper(title="t" * ceiling))
        with self.assertRaises(ValidationError):
            PaperMetadata.of(a_paper(title="t" * (ceiling + 1)))
        with self.assertRaises(ValidationError):
            PaperUpdate(title="t" * (ceiling + 1))

    def test_a_year_has_to_be_one_a_paper_could_have(self):
        for year in (limit("publication_year", "min") - 1,
                     limit("publication_year", "max") + 1):
            with self.subTest(year=year):
                with self.assertRaises(ValidationError):
                    PaperMetadata.of(a_paper(year=year))
                with self.assertRaises(ValidationError):
                    PaperUpdate(year=year)

    def test_a_paper_may_have_no_year_at_all(self):
        self.assertIsNone(PaperMetadata.of(a_paper(year=None)).year)

    def test_the_edit_form_and_the_record_agree_field_by_field(self):
        """Whatever PaperUpdate will accept, the record will hold."""
        for name, field in PaperMetadata.model_fields.items():
            with self.subTest(field=name):
                self.assertIn(name, PaperUpdate.model_fields)
                self.assertEqual(
                    [str(rule) for rule in field.metadata],
                    [str(rule) for rule in PaperUpdate.model_fields[name].metadata],
                )


class EveryFieldOfAnEditIsActedOnTests(unittest.TestCase):
    """An edit names fields, and `update_paper` sorts them into two piles.

    A field in neither pile is read off the request and then dropped: the
    save answers 200 and nothing changed. Nothing said so, which is why
    this asks."""

    def test_update_paper_acts_on_every_field_the_form_may_send(self):
        import main

        handled = (
            main._METADATA_FIELDS
            | main._PERSONAL_FIELDS
            # Taken out of the payload before the two piles are made,
            # because neither is a column of the paper or of the copy.
            | {"tag_uuids", "shelf_uuid"}
        )
        self.assertEqual(set(PaperUpdate.model_fields), handled)


if __name__ == "__main__":
    unittest.main()
