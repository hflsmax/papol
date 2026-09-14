import json
from pathlib import Path


APP_LIMITS = json.loads(
    (Path(__file__).parents[1] / "config" / "app_limits.json").read_text()
)


def limit(section: str, name: str):
    return APP_LIMITS[section][name]


def mebibytes(section: str, name: str) -> int:
    return int(limit(section, name)) * 1024 * 1024
