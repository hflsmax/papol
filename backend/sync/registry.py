import json
from functools import lru_cache
from pathlib import Path

from models import (
    Board, BoardGroup, BoardItem, Comment, Copy, CopyTagLink, InkStroke, Paper, PaperClip,
    PaperEdition, Shelf, Tag,
)


WRITABLE_MODELS = {
    "boards": Board,
    "board_groups": BoardGroup,
    "board_items": BoardItem,
    "comments": Comment,
    "ink_strokes": InkStroke,
    "paper_clips": PaperClip,
    "shelves": Shelf,
    "tags": Tag,
    "copies": Copy,
    "copy_tags": CopyTagLink,
}

DEPENDENCY_MODELS = {"papers": Paper, "paper_editions": PaperEdition}
MODELS = WRITABLE_MODELS | DEPENDENCY_MODELS


@lru_cache(maxsize=1)
def registry():
    path = Path(__file__).parents[2] / "schema" / "sync_registry.json"
    return json.loads(path.read_text())


def table_rule(table_name: str):
    return registry()["tables"].get(table_name)


def validate_registry():
    """Fail startup/tests when registry names drift from mapped columns."""
    for table_name, rule in registry()["tables"].items():
        model = MODELS.get(table_name)
        if model is None:
            raise RuntimeError(f"Sync registry has no model for {table_name}")
        columns = set(model.__table__.columns.keys())
        exposed = columns - set(rule.get("server_columns", []))
        missing = set(rule.get("client_writable", [])) - exposed
        if missing:
            raise RuntimeError(
                f"Sync registry fields missing from {table_name}: {sorted(missing)}"
            )
    return True
