"""What Papol requires of a client that talks to it: the schema it was built for.

One number, `schema_version` in schema/sync_registry.json, names the data
model and the wire that carries it. A Papol client sends the one it was
compiled with on every request, and the server compares. Equal is
supported; anything else is a build that cannot be talked to, and is told
so with a 426 and somewhere to get the build that can. A caller that sends
no number is not a Papol client — a browser at the website, curl, a proxy —
and is not gated: the website ships with the server.

One caller sends no number and is a Papol client all the same: a build
from before the header existed, which still names itself in its
User-Agent. Predating the header means predating this schema, so naming
itself is enough to refuse it — otherwise the oldest builds of all would
be the only ones the gate waves through.

Nothing here deletes or rebuilds anything. Being too old to sync is a
different fact from being wrong about what you hold, and they are kept
apart deliberately.
"""

from sync.registry import schema_version

SCHEMA_HEADER = "X-Papol-Schema"
# How the native app names itself. The one spelling, shared with the sync
# routes that record the version it carries.
AGENT_PREFIX = "Papol macOS/"
DOWNLOAD_URL = "https://github.com/hflsmax/papol/releases"

SUPPORTED = "supported"
INCOMPATIBLE = "incompatible"


def client_schema(request) -> int | None:
    """The schema this caller was built for, or None for a caller that says nothing."""
    value = request.headers.get(SCHEMA_HEADER)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return -1  # a Papol header nobody can read is not this build's


def verdict(request) -> str:
    announced = client_schema(request)
    if announced is None:
        if AGENT_PREFIX in (request.headers.get("user-agent") or ""):
            return INCOMPATIBLE  # a Papol build from before the header
        return SUPPORTED
    return SUPPORTED if announced == schema_version() else INCOMPATIBLE


def requirements() -> dict:
    """What the server asks of its clients, as the app is told it."""
    return {"schema_version": schema_version(), "download_url": DOWNLOAD_URL}


def refusal() -> dict:
    """The body of a 426: what was refused, and where to go."""
    return {"error": "client_incompatible", **requirements()}
