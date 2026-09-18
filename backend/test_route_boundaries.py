import ast
from collections import Counter
from pathlib import Path

from fastapi.routing import iter_route_contexts

from main import app
from routes.admin import router as admin_router
from routes.feedback import router as feedback_router
from routes.notifications import router as notifications_router
from routes.sharables import router as sharables_router

EXPECTED_ROUTES = {
    ("GET", "/api/admin-messages/pending"): "routes.notifications",
    ("POST", "/api/admin-messages/{message_uuid}/dismiss"): "routes.notifications",
    ("GET", "/api/notifications"): "routes.notifications",
    ("POST", "/api/notifications/{notif_uuid}/read"): "routes.notifications",
    ("POST", "/api/notifications/read"): "routes.notifications",
    ("POST", "/api/feedback"): "routes.feedback",
    ("POST", "/api/papers/{paper_sha256}/sharable"): "routes.sharables",
    ("GET", "/api/papers/{paper_sha256}/sharable"): "routes.sharables",
    ("POST", "/api/sharables/{sharable_uuid}/lean"): "routes.sharables",
    ("DELETE", "/api/sharables/{sharable_uuid}"): "routes.sharables",
    ("GET", "/api/shared/{sharable_uuid}"): "routes.sharables",
    ("GET", "/api/shared/{sharable_uuid}/nook"): "routes.sharables",
    ("POST", "/api/shared/{sharable_uuid}/add-to-nook"): "routes.sharables",
    ("POST", "/api/admin/messages"): "routes.admin",
    ("GET", "/api/admin/message-recipients"): "routes.admin",
    ("GET", "/api/admin/db-metrics"): "routes.admin",
    ("POST", "/api/admin/db-metrics/reset"): "routes.admin",
    ("GET", "/api/admin/feedback"): "routes.admin",
    ("PUT", "/api/admin/feedback/{feedback_uuid}"): "routes.admin",
    ("GET", "/api/admin/tables"): "routes.admin",
    ("GET", "/api/admin/tables/{table_name}"): "routes.admin",
    ("PUT", "/api/admin/tables/{table_name}/rows/{pk_value}"): "routes.admin",
    ("DELETE", "/api/admin/tables/{table_name}/rows/{pk_value}"): "routes.admin",
    ("POST", "/api/admin/sql"): "routes.admin",
}


def test_extracted_routes_keep_their_contract_and_domain_owner():
    actual = {}
    for router in (notifications_router, feedback_router, admin_router, sharables_router):
        for route in router.routes:
            path = route.path
            for method in route.methods - {"HEAD", "OPTIONS"}:
                actual[(method, path)] = route.endpoint.__module__

    assert actual == EXPECTED_ROUTES


def test_domain_routers_are_registered_once():
    """Every extracted route reaches the app exactly once.

    Asked of the routes the app actually serves, because that is the thing
    that can go wrong: a router included twice, or a path a domain router
    owns also declared on `main`, shadows one handler with another and the
    request goes somewhere nobody meant.

    Asked the way FastAPI asks itself, too. `include_router` leaves a marker
    in the route list and resolves it while matching, rather than copying the
    routes in, so walking the list plainly sees none of the extracted routes
    and this counted every one of them zero. `iter_route_contexts` is what
    FastAPI's own schema generation walks.
    """
    served = Counter(
        (method, context.path)
        for context in iter_route_contexts(app.routes)
        for method in (context.methods or set()) - {"HEAD", "OPTIONS"}
    )
    duplicated = sorted(
        contract for contract in EXPECTED_ROUTES if served[contract] != 1
    )
    assert duplicated == []


def test_backend_layers_point_inward():
    backend = Path(__file__).parent
    violations = []
    for layer in ("routes", "services"):
        for source_path in (backend / layer).glob("*.py"):
            tree = ast.parse(source_path.read_text(), filename=str(source_path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module:
                    imported = node.module
                elif isinstance(node, ast.Import):
                    imported = node.names[0].name
                else:
                    continue
                if imported == "main" or imported.startswith("routes."):
                    violations.append(f"{source_path.relative_to(backend)} -> {imported}")

    assert violations == []
