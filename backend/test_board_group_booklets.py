import unittest

from pydantic import ValidationError

from schemas import BoardGroupCreate, BoardGroupOut


class BoardGroupKindTests(unittest.TestCase):
    def test_booklet_is_the_default_group_kind(self):
        self.assertEqual(BoardGroupCreate(item_uuids=["item-1", "item-2"]).kind, "booklet")

    def test_unknown_group_kinds_are_rejected(self):
        with self.assertRaises(ValidationError):
            BoardGroupCreate(kind="chapter", item_uuids=["item-1", "item-2"])

    def test_board_group_output_uses_booklet(self):
        output = BoardGroupOut(uuid="group-1", kind="booklet", title="", item_uuids=[])
        self.assertEqual(output.kind, "booklet")


if __name__ == "__main__":
    unittest.main()
