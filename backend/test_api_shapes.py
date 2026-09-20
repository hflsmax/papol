"""The list fields every API view carries, pinned to their declaration.

The library app trusts the shape the API declares and dereferences these
lists without guards, and the desktop replica completes locally-served
rows against the same declaration (schema/api_shapes.json). A response
model growing or losing a list must move the declaration — and with it
every producer — rather than drift past one of them: that drift is how
macOS v0.3.1 blanked on a jacket whose replica paper had no
`also_read_by` to count.
"""
import json
import typing
import unittest
from pathlib import Path

import schemas

DECLARATION = Path(__file__).resolve().parent.parent / "schema" / "api_shapes.json"

# Which response model each declared view names. A view listed here and
# not in the declaration, or the reverse, is itself a failure: the two
# files describe the same set of views or they describe nothing.
VIEW_MODELS = {
    "board": schemas.BoardOut,
    "nook": schemas.Nook,
    "paper": schemas.Paper,
    "paper_list": schemas.PaperList,
}


def declared_lists(model) -> list[str]:
    return sorted(
        name
        for name, field in model.model_fields.items()
        if typing.get_origin(field.annotation) is list
    )


class ApiShapes(unittest.TestCase):
    def test_every_view_declares_exactly_its_models_lists(self):
        declaration = json.loads(DECLARATION.read_text())["views"]
        self.assertEqual(sorted(declaration), sorted(VIEW_MODELS))
        for view, model in VIEW_MODELS.items():
            self.assertEqual(
                declaration[view], declared_lists(model),
                f"schema/api_shapes.json '{view}' must list {model.__name__}'s "
                "list fields — update the declaration and every replica "
                "adapter that completes this view",
            )


if __name__ == "__main__":
    unittest.main()
