import pytest
from pydantic import ValidationError

from schemas import BoardGroupCreate, BoardGroupOut


def test_booklet_is_the_default_group_kind():
    assert BoardGroupCreate(item_uuids=["item-1", "item-2"]).kind == "booklet"


def test_unknown_group_kinds_are_rejected():
    with pytest.raises(ValidationError):
        BoardGroupCreate(kind="chapter", item_uuids=["item-1", "item-2"])


def test_board_group_output_uses_booklet():
    output = BoardGroupOut(uuid="group-1", kind="booklet", title="", item_uuids=[])
    assert output.kind == "booklet"
