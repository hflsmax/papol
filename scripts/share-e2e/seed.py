"""Seed a fresh sharing fixture: two users, a marked-up paper, both links.

Run before `run.mjs`. Every run makes a new paper and a new recipient, so the
suite can assert that the recipient has not got the paper yet — which it could
not do twice against the same one.

    python3 scripts/share-e2e/seed.py

PAPOL_BASE     where the development server is (default http://127.0.0.1:8010)
PAPOL_E2E_PDF  an upload already in the backend's uploads directory
PAPOL_E2E_FIXTURE  where to write the fixture (default: a file in the temp dir)
"""
import json
import os
import tempfile
import urllib.error
import urllib.request

BASE = os.environ.get("PAPOL_BASE", "http://127.0.0.1:8010")
PASSWORD = "papol-test-pw"
PDF = os.environ.get(
    "PAPOL_E2E_PDF",
    "6e4e3411984f3edf99dbfe8b941cb5e8a321379ff0cae6ae5c1f592ad8882ca8.pdf",
)
FIXTURE = os.environ.get(
    "PAPOL_E2E_FIXTURE", os.path.join(tempfile.gettempdir(), "papol-share-e2e.json"))


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode()
            return response.status, (json.loads(text) if text.strip() else None)
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        return error.code, (json.loads(text) if text.strip() else None)
    except urllib.error.URLError as error:
        raise SystemExit(
            f"No Papol at {BASE} ({error.reason}). Start one with "
            f"PAPOL_DEV_PORT=8010 ./deploy.sh dev") from error


def account(email, name):
    """Register, or sign in if this run has been made before."""
    status, out = call("POST", "/api/auth/register",
                       body={"email": email, "display_name": name, "password": PASSWORD})
    if status != 200:
        status, out = call("POST", "/api/auth/login",
                           body={"email": email, "password": PASSWORD})
        if status != 200:
            raise SystemExit(f"could not sign {email} in: {out}")
    return out["token"], out["user"]["uuid"], out["user"]["display_name"]


suffix = os.urandom(3).hex()
sharer_token, sharer_uuid, sharer_name = account("sharer@papol.test", "Alice Sharer")
user_token, user_uuid, user_name = account(f"user-{suffix}@papol.test", "Bob User")

title = f"A Reading Worth Handing Over {suffix}"
status, paper = call("POST", "/api/papers", token=sharer_token, body={
    "title": title, "file_path": PDF, "authors": "A. Sharer", "year": 2026})
if status != 200:
    raise SystemExit(
        f"could not make a paper from {PDF}: {paper}\n"
        "Name an upload this server already holds with PAPOL_E2E_PDF.")
paper_uuid, edition_uuid = paper["uuid"], paper["edition_uuid"]

# A note and a stroke, so the suite can tell a rich link from a lean one by
# what reaches the page rather than by what the API says.
note = f"Alice's note {suffix} — this should reach whoever follows the link"
assert call("POST", f"/api/papers/{paper_uuid}/annotations", token=sharer_token, body={
    "kind": "note", "edition_uuid": edition_uuid, "page": 1, "content": note,
    "body": {"anchor": {"type": "point", "x": 0.3, "y": 0.4}}})[0] == 200
assert call("POST", f"/api/papers/{paper_uuid}/annotations", token=sharer_token, body={
    "kind": "ink", "edition_uuid": edition_uuid, "page": 1,
    "body": {"points": [{"x": 0.15, "y": 0.25}, {"x": 0.55, "y": 0.28}],
             "color": "#b3923d", "width": 0.006, "opacity": 0.9, "shape": "round"}})[0] == 200

_, rich = call("POST", f"/api/papers/{paper_uuid}/sharable", token=sharer_token,
               body={"include_marks": True})
_, lean = call("POST", f"/api/papers/{paper_uuid}/sharable", token=sharer_token,
               body={"include_marks": False})

with open(FIXTURE, "w") as written:
    json.dump({
        "base": BASE, "title": title, "note": note,
        "sharer": {"token": sharer_token, "uuid": sharer_uuid, "name": sharer_name},
        "user": {"token": user_token, "uuid": user_uuid, "name": user_name},
        "paper_uuid": paper_uuid, "edition_uuid": edition_uuid,
        "rich": rich["uuid"], "lean": lean["uuid"],
        "rich_url": f"{BASE}/viewer/?share={rich['uuid']}",
        "lean_url": f"{BASE}/viewer/?share={lean['uuid']}",
    }, written, indent=1)

print(f"seeded {title}")
print(f"  rich {rich['uuid'][:8]}  lean {lean['uuid'][:8]}  recipient {user_name}")
print(f"  fixture at {FIXTURE}")
