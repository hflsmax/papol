"""What Papol requires of the installed clients that talk to it.

A floor rather than a switch: the server says which versions it can still
speak to, and the client decides what to do about being below it. Saying it
this way means a new release stops being blocked without anyone editing
anything, and there is no single flag that turns every user off.

Nothing here deletes or rebuilds anything. Being too old to sync is a
different fact from being wrong about what you hold, and they are kept
apart deliberately.
"""

from services.notifications import setting_value

MINIMUM_KEY = "desktop_minimum_version"
RECOMMENDED_KEY = "desktop_recommended_version"
DOWNLOAD_KEY = "desktop_download_url"

DEFAULT_DOWNLOAD_URL = "https://github.com/hflsmax/papol/releases"

SUPPORTED = "supported"
DEPRECATED = "deprecated"
INCOMPATIBLE = "incompatible"

# The client announces itself as "Papol macOS/0.1.2". Anything else is some
# other caller — a browser, curl, a proxy — and is never gated: the floor is
# about the installed application, and the web app ships with the server.
_AGENT_PREFIX = "Papol macOS/"


def parse_version(text: str | None) -> tuple[int, int, int] | None:
    """A dotted release as numbers, or None when it is not one.

    Unparseable is not "old": a version this server cannot read is one it
    has no business judging, so callers treat None as supported.
    """
    if not text:
        return None
    parts = text.strip().split(".")
    if len(parts) != 3:
        return None
    try:
        major, minor, patch = (int(part) for part in parts)
    except ValueError:
        return None
    if major < 0 or minor < 0 or patch < 0:
        return None
    return major, minor, patch


def client_version(user_agent: str | None) -> str | None:
    """The version Papol macOS announced, if this was Papol macOS at all.

    The product name has a space in it, so the agent cannot be read one
    whitespace-separated token at a time: the marker is found in the string
    and the version is whatever follows it up to the next space.
    """
    if not user_agent:
        return None
    start = user_agent.find(_AGENT_PREFIX)
    if start < 0:
        return None
    rest = user_agent[start + len(_AGENT_PREFIX):].split()
    return rest[0] if rest else None


def requirements(db) -> dict:
    """What the server asks of its clients, as the app is told it."""
    return {
        "minimum_version": setting_value(db, MINIMUM_KEY),
        "recommended_version": setting_value(db, RECOMMENDED_KEY),
        "download_url": setting_value(db, DOWNLOAD_KEY) or DEFAULT_DOWNLOAD_URL,
    }


def verdict(db, user_agent: str | None) -> str:
    """Where this caller stands against the floor.

    Every unknown answers "supported", and each for the same reason: a floor
    that has not been set, a caller that is not the application, and a
    version string nobody can read are all cases where refusing service
    would be the server inventing a rule it was never given.
    """
    version = parse_version(client_version(user_agent))
    if version is None:
        return SUPPORTED
    asked = requirements(db)
    minimum = parse_version(asked["minimum_version"])
    if minimum is not None and version < minimum:
        return INCOMPATIBLE
    recommended = parse_version(asked["recommended_version"])
    if recommended is not None and version < recommended:
        return DEPRECATED
    return SUPPORTED
