import hashlib

from sqlalchemy import create_engine, text

import database


def test_legacy_board_files_receive_content_hashes(tmp_path):
    original_engine = database.engine
    test_engine = create_engine(f"sqlite:///{tmp_path / 'board-files.db'}")
    files = tmp_path / "board-files"
    (files / "1").mkdir(parents=True)
    content = b"legacy board image"
    (files / "1" / "image.png").write_bytes(content)
    try:
        database.engine = test_engine
        with test_engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE board_items ("
                "id INTEGER PRIMARY KEY, file_path TEXT, sha256 TEXT, blob_sha256 TEXT)"
            ))
            connection.execute(text(
                "INSERT INTO board_items VALUES "
                "(1, '1/image.png', NULL, NULL), "
                "(2, '1/missing.png', NULL, NULL), "
                "(3, '1/legacy.png', NULL, 'legacy-digest')"
            ))

        database.backfill_board_file_hashes(files)

        with test_engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id, sha256 FROM board_items ORDER BY id"
            )).all()
        assert rows == [
            (1, hashlib.sha256(content).hexdigest()),
            (2, None),
            (3, "legacy-digest"),
        ]
    finally:
        database.engine = original_engine
        test_engine.dispose()
