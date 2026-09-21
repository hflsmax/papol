"""Bring one checkout's files across to another: production's into development.

    python scripts/pull-files.py /srv/papol/prod /path/to/development

Each side is a checkout, and each checkout's .env says where its files are:
a bucket (PAPOL_FILES_URL and the AWS_* variables beside it) or, saying
nothing, the uploads/ and board_uploads/ directories inside it. The two
sides need not agree — a bucket in production and directories here is the
usual pair — because the copy goes through the storage module's own
interface on both ends.

    python scripts/pull-files.py --from-directories /srv/papol/prod /srv/papol/prod

is the one-time move onto a bucket: the source is the checkout's
directories whatever its .env says, the destination is the store its .env
names, and the same checkout may stand on both sides.

Every file Papol stores is written once under a name that never comes
back: a paper's PDF and a board's blob are named after their contents, an
avatar and a board's upload after a UUID minted for that one write. So a
name both sides hold already holds the same bytes, and pulling is exactly
"copy across what the destination does not have". That is also why this is
quick on every pull after the first, with hundreds of megabytes of papers
on both sides: the listing is the expensive part, and it is one request
per thousand files.

Nothing is ever written to the source.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import storage  # noqa: E402


def dotenv(checkout: Path) -> dict:
    """The KEY=VALUE lines of a checkout's .env, and nothing inherited: what
    the other checkout's shell happens to export must not decide where this
    one's files are."""
    variables = {}
    path = checkout / ".env"
    if not path.is_file():
        return variables
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        variables[key.strip()] = value
    return variables


def stores(checkout: Path, directories: bool = False) -> tuple[storage.Files, storage.Files]:
    return storage.configure({} if directories else dotenv(checkout), base_dir=checkout)


def pull(source: storage.Files, destination: storage.Files) -> int:
    held = set(destination.keys())
    copied = 0
    for key in source.keys():
        if key in held:
            continue
        destination.copy_from(source, key, key)
        copied += 1
    return copied


def main(argv: list[str]) -> int:
    arguments = argv[1:]
    from_directories = "--from-directories" in arguments
    arguments = [argument for argument in arguments if argument != "--from-directories"]
    if len(arguments) != 2:
        print("usage: pull-files.py [--from-directories] SOURCE_CHECKOUT DESTINATION_CHECKOUT",
              file=sys.stderr)
        return 2
    source_dir, destination_dir = Path(arguments[0]).resolve(), Path(arguments[1]).resolve()
    if source_dir == destination_dir and not from_directories:
        print("pull-files: source and destination are the same checkout", file=sys.stderr)
        return 2
    source_areas = stores(source_dir, directories=from_directories)
    destination_areas = stores(destination_dir)
    for name, from_store, to_store in zip(
        (storage.UPLOADS_AREA, storage.BOARD_FILES_AREA), source_areas, destination_areas,
    ):
        copied = pull(from_store, to_store)
        if copied == 0:
            print(f"    {name} — development already had every file")
        else:
            print(f"    {name} — {copied} file(s) copied")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
