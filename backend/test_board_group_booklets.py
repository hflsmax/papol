from sqlalchemy import create_engine, text

import database
from schemas import BoardGroupCreate, BoardGroupOut


def test_booklet_is_the_default_group_kind():
    assert BoardGroupCreate(item_ids=[1, 2]).kind == "booklet"


def test_legacy_chapter_requests_are_normalized():
    assert BoardGroupCreate(kind="chapter", item_ids=[1, 2]).kind == "booklet"


def test_board_group_output_uses_booklet():
    output = BoardGroupOut(id=1, kind="booklet", title="", item_ids=[])
    assert output.kind == "booklet"


def test_legacy_saved_groups_are_migrated(tmp_path):
    original_engine = database.engine
    test_engine = create_engine(f"sqlite:///{tmp_path / 'booklets.db'}")
    try:
        database.engine = test_engine
        with test_engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE board_groups (id INTEGER PRIMARY KEY, kind VARCHAR(20))"
            ))
            connection.execute(text(
                "INSERT INTO board_groups (id, kind) VALUES (1, 'chapter'), (2, 'collection')"
            ))

        database.normalize_board_group_kinds()

        with test_engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id, kind FROM board_groups ORDER BY id"
            )).all()
        assert rows == [(1, "booklet"), (2, "collection")]
    finally:
        database.engine = original_engine
        test_engine.dispose()
