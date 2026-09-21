#!/usr/bin/env python3
"""Bring the PostgreSQL data across into D1, once.

The inverse of migrate-sqlite-to-postgres.py, over the same schema. Reads
a data-only dump made with column inserts:

    sudo -u papol pg_dump -d papol --data-only --column-inserts --no-owner \
        -f /tmp/papol-data.sql

and writes the same rows as SQLite statements for `wrangler d1 execute`:

    python scripts/migrate-postgres-to-d1.py /tmp/papol-data.sql > papol-d1.sql
    (cd cloudflare && npx wrangler d1 execute papol --remote --file ../papol-d1.sql)

What changes on the way: `true`/`false` become 1/0; a value in a column
the schema declares DATETIME becomes the ISO-8601 UTC form the Worker
writes (`2026-09-21T14:03:05.123Z`), since Python stored naive UTC
timestamps; the `public.` prefix goes; rows are inserted with OR REPLACE
so the settings the schema migration seeded give way to production's;
foreign keys are deferred to the end of the batch, so the dump's own
table order is good enough. Only tables the D1 schema declares are
carried; anything else in the dump is named on stderr and left behind,
as is `applied_mutations`: a replay cache whose shape the Worker changed
(migration 0002), and which a replica simply refills.
"""
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCHEMA = REPO / "cloudflare" / "migrations" / "0001_schema.sql"

TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:[+-]\d{2}(?::?\d{2})?|Z)?$")


def schema_columns():
    """{table: {column: declared type}} from the D1 schema."""
    tables = {}
    current = None
    for line in SCHEMA.read_text().splitlines():
        made = re.match(r'^CREATE TABLE "?(\w+)"? \($', line)
        if made:
            current = tables.setdefault(made.group(1), {})
            continue
        if line.startswith(")"):
            current = None
            continue
        if current is None:
            continue
        column = re.match(r'^\s*"?(\w+)"?\s+([A-Z]+)', line)
        if column and column.group(2) not in {"PRIMARY", "FOREIGN", "UNIQUE", "CONSTRAINT", "CHECK"}:
            current[column.group(1)] = column.group(2)
    return tables


def statements(text):
    """Each statement of the dump, split on the semicolons outside quotes."""
    buffer, quoted, dollar = [], False, None
    i = 0
    while i < len(text):
        char = text[i]
        if dollar:
            if text.startswith(dollar, i):
                buffer.append(dollar)
                i += len(dollar)
                dollar = None
                continue
        elif quoted:
            if char == "'":
                quoted = False
        elif char == "'":
            quoted = True
        elif char == "$":
            tag = re.match(r"\$[A-Za-z_]*\$", text[i:])
            if tag:
                dollar = tag.group(0)
                buffer.append(dollar)
                i += len(dollar)
                continue
        elif char == "-" and text.startswith("--", i):
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
            continue
        elif char == ";":
            yield "".join(buffer).strip()
            buffer = []
            i += 1
            continue
        buffer.append(char)
        i += 1
    rest = "".join(buffer).strip()
    if rest:
        yield rest


def values(text):
    """The literals of a VALUES (...) list, each as raw SQL text."""
    out, buffer, quoted, depth = [], [], False, 0
    for char in text:
        if quoted:
            buffer.append(char)
            if char == "'":
                quoted = False
            continue
        if char == "'":
            quoted = True
            buffer.append(char)
        elif char == "(":
            depth += 1
            if depth > 1:
                buffer.append(char)
        elif char == ")":
            depth -= 1
            if depth >= 1:
                buffer.append(char)
        elif char == "," and depth == 1:
            out.append("".join(buffer).strip())
            buffer = []
        else:
            buffer.append(char)
    if buffer and "".join(buffer).strip():
        out.append("".join(buffer).strip())
    return out


def iso(literal):
    """A Postgres timestamp literal as the Worker writes one."""
    match = TIMESTAMP.match(literal.strip("'"))
    if not match:
        return literal
    date, clock, fraction = match.groups()
    millis = (fraction or "0")[:3].ljust(3, "0")
    return f"'{date}T{clock}.{millis}Z'"


def convert(literal, declared):
    if literal == "true":
        return "1"
    if literal == "false":
        return "0"
    if literal.upper() == "NULL":
        return "NULL"
    if literal.startswith("E'"):
        sys.exit(f"an escaped string literal is not handled: {literal[:40]}")
    if literal.startswith("'\\x"):
        return "X'" + literal[3:-1] + "'"
    if declared == "DATETIME" and literal.startswith("'"):
        return iso(literal)
    return literal


# Not data: the desktop's mutation replay cache, in the shape the Worker no
# longer uses. A replica that re-sends a mutation after the move has it
# applied once more instead of answered from the cache, which is harmless.
LEFT_BEHIND = {"applied_mutations"}

INSERT = re.compile(r'^INSERT INTO (?:public\.)?"?(\w+)"? \((.*?)\) VALUES \((.*)\)$', re.DOTALL)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    dump = Path(sys.argv[1]).read_text()
    tables = schema_columns()
    skipped, counts = set(), {}
    print("PRAGMA defer_foreign_keys = true;")
    for statement in statements(dump):
        if not statement.startswith("INSERT INTO"):
            continue
        match = INSERT.match(statement)
        if not match:
            sys.exit(f"unrecognised insert: {statement[:80]}")
        table, columns, rest = match.groups()
        if table not in tables or table in LEFT_BEHIND:
            skipped.add(table)
            continue
        names = [c.strip().strip('"') for c in columns.split(",")]
        literals = values(f"({rest})")
        if len(literals) != len(names):
            sys.exit(f"{table}: {len(names)} columns but {len(literals)} values in {statement[:80]}")
        converted = [convert(lit, tables[table].get(name)) for name, lit in zip(names, literals)]
        quoted = ", ".join(f'"{n}"' for n in names)
        print(f'INSERT OR REPLACE INTO "{table}" ({quoted}) VALUES ({", ".join(converted)});')
        counts[table] = counts.get(table, 0) + 1
    for table, n in sorted(counts.items()):
        print(f"{table}: {n}", file=sys.stderr)
    for table in sorted(skipped):
        print(f"left behind: {table}", file=sys.stderr)


if __name__ == "__main__":
    main()
