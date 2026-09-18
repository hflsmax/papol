"""The one description of what synchronizes, and what each column is.

`schema/sync_registry.json` is read by three programs: this service, the
desktop replica (which compiles it in), and the tests on both sides. It is
worth something only while it says the truth about every column, so this
module refuses to start when it does not.

Every column of a synchronized table falls into exactly one of four
categories, and the registry has to place it:

  the row's own bookkeeping   its primary key, created_at, updated_at,
                              revision, deleted_at — the same on every table,
                              so no table restates them
  `client_writable`           a replica may write it and push it here
  `server_owned`              it travels to the replica, which shows it and
                              cannot change it; the service writes it
  `server_columns`            it never leaves the service at all

A column placed nowhere is the failure this checks for. Left alone, it reads
as `server_owned` by accident: the push path rejects it, so the desktop
quietly loses the ability to edit a field the website has — which is a
decision, and it should be one somebody made.

`owner` says which user a row belongs to, as a path from the row: a column
of this table, or a relationship and then a column. It is not documentation
— `sync.changes` files every change under the user it names, which is who
will be sent it. `null` is a row belonging to nobody, which a paper is.
"""

import json
from functools import lru_cache
from pathlib import Path

from models import (
    Annotation, Board, BoardGroup, BoardItem, Copy, CopyTagLink, Paper,
    Shelf, Tag,
)


WRITABLE_MODELS = {
    "boards": Board,
    "board_groups": BoardGroup,
    "board_items": BoardItem,
    "annotations": Annotation,
    "shelves": Shelf,
    "tags": Tag,
    "copies": Copy,
    "copy_tags": CopyTagLink,
}

DEPENDENCY_MODELS = {"papers": Paper}
MODELS = WRITABLE_MODELS | DEPENDENCY_MODELS

# What every synchronized row carries, whatever table it is in: when it was
# made, when it last changed, which version it is at, and whether it is a
# tombstone. Named once here rather than repeated under every table.
ROW_BOOKKEEPING = frozenset({"created_at", "updated_at", "revision", "deleted_at"})

# The keys a table rule may use. Anything else is a setting that nothing
# reads, which is worse than no setting at all: it looks like it is in force.
TABLE_KEYS = frozenset({
    "owner", "client_writable", "server_owned", "server_columns", "create_only",
})


@lru_cache(maxsize=1)
def registry():
    path = Path(__file__).parents[2] / "schema" / "sync_registry.json"
    return json.loads(path.read_text())


def schema_version() -> int:
    """Which schema this build is written for.

    A number the developer moves, not one anything works out. When a change
    lands that an existing database or replica cannot be read under, the
    person making it says so here, and both ends act on having been told:
    the service refuses to start, and a replica is thrown away and pulled
    again. Neither of them tries to recognize the shape it is looking at.

    That is the whole point of declaring it. A program comparing schemas can
    see that something differs; it cannot see whether the difference matters,
    and every rule it could use is wrong in one direction or the other — a
    digest of the DDL calls a new nullable column a break, and a list of the
    tables some old release had goes quietly out of date the moment the next
    change lands. Whether a change is breaking is a judgement, and the person
    making the change is the one holding it.
    """
    return registry()["schema_version"]


def owner_uuid(db, record) -> str | None:
    """Which user this row belongs to, by the path the registry gives.

    The registry is the rule rather than a note beside it, so a table added
    without an owner cannot be filed under the wrong user — it cannot be
    filed at all until somebody says whose its rows are."""
    rule = registry()["tables"][record.__table__.name]
    path = rule["owner"]
    if path is None:
        return None
    *steps, column = path.split(".")
    for step in steps:
        parent = getattr(record, step)
        if parent is None:
            # The relationship is not loaded and the key is all we have —
            # which is the ordinary case for a row a replica just pushed.
            related = record.__mapper__.relationships[step].mapper.class_
            parent = db.get(related, getattr(record, f"{step}_uuid", None))
        if parent is None:
            raise RuntimeError(
                f"{record.__table__.name} row has no {step} to belong to"
            )
        record = parent
    return getattr(record, column)


def validate_registry():
    """Fail startup/tests when the registry stops describing the models."""
    for table_name, rule in registry()["tables"].items():
        model = MODELS.get(table_name)
        if model is None:
            raise RuntimeError(f"Sync registry has no model for {table_name}")
        unknown_keys = set(rule) - TABLE_KEYS
        if unknown_keys:
            # Every table merges the same way — the writer restates the whole
            # row and the last write wins — so naming a conflict strategy
            # would be a setting that silently does nothing. The same is true
            # of any other key nothing reads.
            raise RuntimeError(
                f"Sync registry declares {sorted(unknown_keys)} for {table_name}, "
                f"which nothing reads; the keys in use are {sorted(TABLE_KEYS)}"
            )
        if "owner" not in rule:
            raise RuntimeError(
                f"Sync registry does not say whose a {table_name} row is; "
                "give it an owner path, or null if it belongs to nobody"
            )

        columns = set(model.__table__.columns.keys())
        keys = {column.name for column in model.__table__.primary_key}
        client_writable = set(rule.get("client_writable", []))
        server_owned = set(rule.get("server_owned", []))
        server_columns = set(rule.get("server_columns", []))

        exposed = columns - server_columns
        missing = (client_writable | server_owned) - exposed
        if missing:
            raise RuntimeError(
                f"Sync registry fields missing from {table_name}: {sorted(missing)}"
            )
        both = client_writable & server_owned
        if both:
            raise RuntimeError(
                f"Sync registry has {table_name} {sorted(both)} as both "
                "client-writable and server-owned"
            )
        # A row's own owner column is placed by `owner` naming it. It is
        # never client-writable: whose a row is follows from who pushed it,
        # and a replica that could set it could file a row under somebody
        # else.
        owned_by = rule["owner"] if rule["owner"] and "." not in rule["owner"] else None
        if owned_by in client_writable:
            raise RuntimeError(
                f"Sync registry lets a client write {table_name}.{owned_by}, "
                "which is whose the row is"
            )
        placed = (
            client_writable | server_owned | server_columns | keys | ROW_BOOKKEEPING
            | ({owned_by} if owned_by else set())
        )
        unplaced = columns - placed
        if unplaced:
            raise RuntimeError(
                f"Sync registry does not say what {table_name} "
                f"{sorted(unplaced)} is: add each to client_writable if a "
                "replica may write it, to server_owned if the service owns "
                "it, or to server_columns if it should not leave the service"
            )
        _validate_owner_path(table_name, model, rule["owner"])
    return True


def _validate_owner_path(table_name: str, model, path) -> None:
    """The owner path has to resolve against the model, or it is a wrong
    answer waiting for the first row that takes it."""
    if path is None:
        return
    *steps, column = path.split(".")
    mapper = model.__mapper__
    for step in steps:
        relationship = mapper.relationships.get(step)
        if relationship is None:
            raise RuntimeError(
                f"Sync registry owner path {path!r} for {table_name} names "
                f"{step!r}, which is not a relationship of {model.__name__}"
            )
        mapper = relationship.mapper
    if column not in mapper.class_.__table__.columns:
        raise RuntimeError(
            f"Sync registry owner path {path!r} for {table_name} ends at "
            f"{column!r}, which {mapper.class_.__name__} has not got"
        )
