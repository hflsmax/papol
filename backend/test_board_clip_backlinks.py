from sqlalchemy import create_engine, text

import database


def test_legacy_viewer_clip_gets_paper_and_page_source_label(tmp_path):
    original_engine = database.engine
    test_engine = create_engine(f"sqlite:///{tmp_path / 'clips.db'}")
    try:
        database.engine = test_engine
        with test_engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE papers (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"
            ))
            connection.execute(text(
                "CREATE TABLE paper_editions (id INTEGER PRIMARY KEY, paper_id INTEGER, sha256 TEXT)"
            ))
            connection.execute(text(
                "CREATE TABLE board_items (id INTEGER PRIMARY KEY, kind TEXT, source_url TEXT, source_label TEXT)"
            ))
            connection.execute(text(
                "INSERT INTO papers VALUES (1, 'A Useful Paper')"
            ))
            connection.execute(text(
                "INSERT INTO paper_editions VALUES (1, 1, 'pdf-digest')"
            ))
            connection.execute(text(
                "INSERT INTO board_items VALUES "
                "(1, 'image', 'https://papol.test/viewer/?pdf=pdf-digest&page=7&box=clip', 'Open source')"
            ))

        database.backfill_board_clip_source_labels()

        with test_engine.connect() as connection:
            label = connection.execute(text(
                "SELECT source_label FROM board_items WHERE id=1"
            )).scalar_one()
        assert label == "A Useful Paper, page 7"
    finally:
        database.engine = original_engine
        test_engine.dispose()
