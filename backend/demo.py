"""Disposable demo storage around the ordinary application handlers.

Only audited handlers whose effects remain disposable are exposed. Durable files,
jobs, account management and external side effects have no demo implementation.
"""

import asyncio
import json
import secrets
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute, iter_route_contexts
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request
from starlette.responses import JSONResponse

from database import Base, PapolSession, get_db, set_request_session, reset_request_session
from models import (
    User, AuthToken, Paper, Copy, Tag, Shelf, CopyTagLink, Annotation,
    Room, RoomParticipant, RoomMessage, RoomAvailability, Notification,
)

# New routes fail closed until their effects have been reviewed. These are the
# real handlers, including their validation and response serialization.
SUPPORTED_HANDLERS = frozenset("""
    me update_profile list_users get_nook list_all_papers get_paper
    get_viewer_paper update_paper delete_paper add_to_nook
    create_tag list_tags delete_tag list_shelves create_shelf update_shelf delete_shelf
    list_annotations create_annotation update_annotation delete_annotation
    list_boards list_library_boards create_board get_board update_board delete_board
    add_board_comment stage_board_excerpt place_staged_board_item delete_board_item
    restore_board_item move_board_item create_board_group move_board_group
    update_board_group ungroup_board_group layout_board_group
    call_seminar get_room lead_room unhost_room uncall_seminar join_room leave_room
    post_room_message set_room_availability announce_room finish_room
    pending_admin_messages dismiss_admin_message list_notifications
    mark_notification_read mark_notifications_read
    create_sharable my_sharable lean_sharable revoke_sharable read_sharable
    shared_in_nook add_shared_to_nook client_requirements
    get_viewer_paper_info reextract_paper_metadata
    viewer_references viewer_reference preview_viewer_reference
""".split())

SEED_PATH = Path(__file__).resolve().parent.parent / "shared" / "demoSeed.json"
UNSUPPORTED = "Not supported in the demo."


def without_cache(send):
    async def send_response(message):
        if message["type"] == "http.response.start":
            headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"cache-control"]
            message = {**message, "headers": [*headers, (b"cache-control", b"no-store")]}
        await send(message)
    return send_response


def seed_database(db, token):
    world = json.loads(SEED_PATH.read_text())
    now = datetime.utcnow()

    def row(values):
        values = dict(values)
        if "created_at" in values:
            values["created_at"] = now - timedelta(days=values["created_at"])
        return values

    me = world["users"][0]["uuid"]
    db.add_all(User(**user, password_hash="demo-disabled") for user in world["users"])
    db.flush()
    db.add_all(Paper(**row(paper), references_status="unavailable") for paper in world["papers"])
    db.add_all(Tag(**tag, user_uuid=me) for tag in world["tags"])
    db.add_all(Shelf(**shelf, user_uuid=me) for shelf in world["shelves"])
    # Every fictional reader owns their own shelf, just like an ordinary user.
    other_shelves = {}
    for user in world["users"][1:]:
        shelf = Shelf(user_uuid=user["uuid"], name="Display", color="#7ba26c",
                      is_public=True, is_default=True, position=0)
        db.add(shelf)
        db.flush()
        other_shelves[user["uuid"]] = shelf.uuid
    db.flush()
    for copy in world["copies"]:
        values = row(copy)
        tags = values.pop("tag_uuids")
        if values["user_uuid"] != me:
            values["shelf_uuid"] = other_shelves[values["user_uuid"]]
        db.add(Copy(**values))
        db.flush()
        for tag in tags:
            db.add(CopyTagLink(copy_uuid=values["uuid"], tag_uuid=tag, user_uuid=me))
    for note in world["comments"]:
        values = row(note)
        values["body"] = json.dumps(values["body"])
        db.add(Annotation(**values))
    for key, model in (("rooms", Room), ("participants", RoomParticipant),
                       ("messages", RoomMessage), ("availabilities", RoomAvailability),
                       ("notifications", Notification)):
        db.add_all(model(**row(item)) for item in world[key])
        db.flush()
    db.add(AuthToken(token=token, user_uuid=me, platform="web"))
    db.commit()


class Workspace:
    def __init__(self, ttl):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                                    poolclass=StaticPool)
        self.sessions = sessionmaker(bind=self.engine, class_=PapolSession, autoflush=False)
        self.lock = asyncio.Lock()
        self.token = secrets.token_urlsafe(32)
        self.timer = None
        try:
            Base.metadata.create_all(self.engine)
            with self.sessions() as db:
                seed_database(db, self.token)
        except Exception:
            self.engine.dispose()
            raise
        self.expires = time.monotonic() + ttl

    def close(self):
        if self.timer:
            self.timer.cancel()
        self.engine.dispose()


class DemoApplication:
    def __init__(self, routes, ttl=3600, capacity=64):
        self.ttl, self.capacity = ttl, capacity
        self.workspaces = {}
        self.app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
        router = APIRouter()
        # Every route the application really serves, asked for the way FastAPI
        # asks itself. `include_router` does not copy a router's routes into
        # the list any more — it leaves a marker there and resolves it while
        # matching — so walking the list looking for APIRoute finds only the
        # handlers declared on the application directly, and a demo built from
        # those answers "unsupported" to everything that was moved into a
        # domain router. This is the whole reason supported() below is checked
        # against the names that arrived rather than the names that were asked
        # for: an empty demo must not be able to pass for a working one.
        router.routes.extend(
            context.route for context in iter_route_contexts(routes)
            if isinstance(context.route, APIRoute)
            and context.route.name in SUPPORTED_HANDLERS
        )
        self.app.include_router(router)
        self.exposed = frozenset(
            route.name for route in router.routes if isinstance(route, APIRoute)
        )
        # A missing request context must never fall back to the permanent DB.
        def demo_db():
            from database import current_request_session
            db = current_request_session()
            if db is None:
                raise RuntimeError("Demo database is unavailable")
            yield db
        self.app.dependency_overrides[get_db] = demo_db

        @self.app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
        async def unsupported(path: str):
            return JSONResponse({"detail": UNSUPPORTED}, status_code=501)

    def expire(self, key):
        workspace = self.workspaces.get(key)
        if workspace is None:
            return
        if workspace.lock.locked():
            workspace.timer = asyncio.get_running_loop().call_later(1, self.expire, key)
            return
        self.workspaces.pop(key).close()

    def close(self):
        for workspace in self.workspaces.values():
            workspace.close()
        self.workspaces.clear()

    async def __call__(self, scope, receive, send):
        send = without_cache(send)
        request = Request(scope)
        path = scope["path"].removeprefix(scope.get("root_path", ""))
        if path == "/session" and request.method == "POST":
            key = request.headers.get("x-papol-demo-session")
            existing = self.workspaces.get(key)
            if existing is not None and existing.expires > time.monotonic():
                response = JSONResponse({"session": key}, headers={"Cache-Control": "no-store"})
            elif len(self.workspaces) >= self.capacity:
                response = JSONResponse({"detail": "The demo is busy. Please try again later."}, status_code=503)
            else:
                key = secrets.token_urlsafe(32)
                workspace = Workspace(self.ttl)
                self.workspaces[key] = workspace
                workspace.timer = asyncio.get_running_loop().call_later(self.ttl, self.expire, key)
                response = JSONResponse({"session": key}, headers={"Cache-Control": "no-store"})
            await response(scope, receive, send)
            return
        workspace = self.workspaces.get(request.headers.get("x-papol-demo-session"))
        if workspace is None or workspace.expires <= time.monotonic():
            await JSONResponse({"detail": "Your demo session has ended. Reload to start a new visit."},
                               status_code=410)(scope, receive, send)
            return
        async with workspace.lock:
            if workspace.expires <= time.monotonic():
                await JSONResponse({"detail": "Your demo session has ended. Reload to start a new visit."},
                                   status_code=410)(scope, receive, send)
                return
            # Ignore real credentials and idempotency headers. This application
            # has its own exception handling and never runs production jobs.
            headers = [(k, v) for k, v in scope["headers"]
                       if k.lower() not in {b"authorization", b"x-papol-client-uuid", b"x-papol-mutation-uuid"}]
            headers.append((b"authorization", f"Bearer {workspace.token}".encode()))
            demo_scope = {**scope, "path": "/api" + path, "raw_path": ("/api" + path).encode(),
                          "root_path": "", "headers": headers}
            with workspace.sessions() as db:
                context = set_request_session(db)
                try:
                    await self.app(demo_scope, receive, send)
                finally:
                    reset_request_session(context)
