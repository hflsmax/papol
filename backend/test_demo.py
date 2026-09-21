"""Demo behavior uses real routes, with no permanent writes or credentials."""
import asyncio
import io
import time
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
import httpx

import main
import storage
from database import get_db
from demo import DEMO_PASSWORD, DemoApplication, SUPPORTED_HANDLERS
from storage import FilesystemFiles


class DemoTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.addCleanup(main.demo_app.close)
        self.headers = self.start()

    def start(self):
        response = self.client.post('/api/demo/session')
        self.assertEqual(response.status_code, 200, response.text)
        return {'X-Papol-Demo-Session': response.json()['session']}

    def call(self, method, path, headers=None, **kwargs):
        response = self.client.request(method, '/api/demo' + path,
                                       headers=headers or self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')
        return response.json() if response.content else None

    def test_seed_and_shared_annotation_handlers(self):
        papers = self.call('GET', '/papers')
        self.assertEqual(len(papers), 10)
        paper = papers[0]['sha256']
        name = paper[:32]
        # Add a library paper if the seed reader does not already own it.
        detail = self.call('GET', f'/papers/{name}')
        if not detail.get('copy_uuid'):
            self.call('POST', f'/papers/{name}/add-to-nook')
        made = self.call('POST', f'/papers/{name}/annotations', json={
            'kind': 'note', 'content': 'A temporary thought', 'page': 1,
            'body': {'anchor': {'type': 'point', 'x': 0.3, 'y': 0.4}},
        })
        viewer = self.call('GET', f'/viewer/{paper}')
        self.assertTrue(any(note['uuid'] == made['uuid'] for note in viewer['notes']))
        self.call('PUT', f"/annotations/{made['uuid']}", json={'content': 'Edited in viewer'})
        notes = self.call('GET', f'/papers/{name}/annotations')
        self.assertIn('Edited in viewer', [note['content'] for note in notes])

    def test_sessions_are_isolated_and_do_not_use_production_dependencies(self):
        other = self.start()
        def forbidden():
            raise AssertionError('Permanent database dependency used')
            yield
        main.app.dependency_overrides[get_db] = forbidden
        self.addCleanup(main.app.dependency_overrides.pop, get_db)
        with patch('main.SessionLocal', side_effect=AssertionError('Permanent session used')):
            self.call('PUT', '/auth/profile', json={'display_name': 'Temporary Name'})
            self.assertEqual(self.call('GET', '/auth/me')['display_name'], 'Temporary Name')
            self.assertEqual(self.call('GET', '/auth/me', headers=other)['display_name'],
                             'SpongeBob SquarePants')
            created = self.call('POST', '/tags', json={'name': 'temporary tag'})
            self.assertNotIn(created['uuid'], [tag['uuid'] for tag in self.call('GET', '/tags', headers=other)])

    def test_unsupported_operations_never_reach_real_handlers(self):
        # Uploads of any kind, and what leaves the boundary: mail, desktop
        # sync, admin, and the sign-in the demo replaces with its own session.
        cases = [('POST', '/papers'), ('POST', '/papers/extract'),
                 ('POST', '/auth/avatar'), ('DELETE', '/auth/avatar'),
                 ('POST', '/boards/abc/files'), ('POST', '/boards/abc/staging/clip'),
                 ('POST', '/auth/register'), ('POST', '/auth/login'), ('POST', '/auth/logout'),
                 ('POST', '/feedback'),
                 ('POST', '/sync/push'), ('GET', '/sync/pull'), ('GET', '/sync/snapshot'),
                 ('PUT', '/sync/blobs/' + 'a' * 64),
                 ('GET', '/admin/tables'), ('POST', '/admin/sql'),
                 ('POST', '/admin/send-digest'), ('GET', '/papers/abc/references')]
        with patch('main.SessionLocal', side_effect=AssertionError('Permanent session used')):
            for method, path in cases:
                with self.subTest(path=path):
                    response = self.client.request(method, '/api/demo' + path, headers={
                        **self.headers, 'Authorization': 'Bearer real-account-token',
                        'X-Papol-Client-UUID': '11111111-1111-4111-8111-111111111111',
                        'X-Papol-Mutation-UUID': '22222222-2222-4222-8222-222222222222',
                    })
                    self.assertEqual(response.status_code, 501, response.text)
                    self.assertEqual(response.json()['detail'], 'Not supported in the demo.')

    def test_sharing_is_writable_but_scoped_to_the_demo_session(self):
        paper = next(item for item in self.call('GET', '/papers') if item.get('file_path'))
        name = paper['sha256'][:32]
        if not self.call('GET', f'/papers/{name}').get('copy_uuid'):
            self.call('POST', f'/papers/{name}/add-to-nook')
        shared = self.call('POST', f'/papers/{name}/sharable', json={
            'include_annotations': True,
        })
        opened = self.call('GET', f"/shared/{shared['uuid']}")
        self.assertEqual(opened['paper']['sha256'], paper['sha256'])

        response = self.client.get(f"/api/demo/shared/{shared['uuid']}", headers=self.start())
        self.assertEqual(response.status_code, 404)

        self.call('POST', f"/sharables/{shared['uuid']}/lean")
        replacement = self.call('POST', f'/papers/{name}/sharable', json={
            'include_annotations': True,
        })
        self.call('DELETE', f"/sharables/{replacement['uuid']}")
        response = self.client.get(f"/api/demo/shared/{replacement['uuid']}", headers=self.headers)
        self.assertEqual(response.status_code, 404)

    def test_expired_session_cannot_write_and_fresh_visit_has_seed(self):
        self.call('PUT', '/auth/profile', json={'display_name': 'Gone'})
        workspace = main.demo_app.workspaces[self.headers['X-Papol-Demo-Session']]
        workspace.expires = time.monotonic() - 1
        response = self.client.put('/api/demo/auth/profile', headers=self.headers,
                                   json={'display_name': 'Too late'})
        self.assertEqual(response.status_code, 410)
        main.demo_app.expire(self.headers['X-Papol-Demo-Session'])
        self.assertNotIn(self.headers['X-Papol-Demo-Session'], main.demo_app.workspaces)
        self.assertEqual(self.call('GET', '/auth/me', headers=self.start())['display_name'],
                         'SpongeBob SquarePants')

    def test_board_operations_and_real_validation(self):
        board = self.call('POST', '/boards', json={'name': 'Temporary board'})
        self.call('PUT', f"/boards/{board['uuid']}", json={'name': 'Renamed'})
        self.assertEqual(self.call('GET', f"/boards/{board['uuid']}")['name'], 'Renamed')
        self.call('DELETE', f"/boards/{board['uuid']}")
        self.assertEqual(self.call('GET', '/boards'), [])
        response = self.client.post('/api/demo/tags', headers=self.headers, json={'name': ''})
        self.assertGreaterEqual(response.status_code, 400)

    def test_supported_handlers_all_exist(self):
        # What the demo actually exposes, not what it meant to: FastAPI's
        # include_router leaves a marker in the route list rather than the
        # routes, so reading names off that list says nothing about whether
        # a handler arrived.
        self.assertFalse(SUPPORTED_HANDLERS - main.demo_app.exposed)

    def test_a_handler_moved_into_a_domain_router_still_reaches_the_demo(self):
        # The demo is built by reading the application's routes, and a route
        # that lives in an included router is not in that list to be read —
        # it is resolved while matching. A demo that collects nothing answers
        # 501 to every path and looks, from the outside, like a demo whose
        # handlers are all merely unsupported.
        self.assertIn('pending_admin_messages', main.demo_app.exposed)
        self.assertIn('list_notifications', main.demo_app.exposed)

    def test_every_seeded_surface_uses_valid_real_models(self):
        people = self.call('GET', '/users')
        for person in people:
            self.call('GET', f"/users/{person['uuid']}/nook")
        for paper in self.call('GET', '/papers'):
            self.call('GET', f"/papers/{paper['sha256'][:32]}")
        for ordinal in range(1, 5):
            self.call('GET', f'/rooms/00000000-0000-4000-8000-e{ordinal:011d}')
        self.call('GET', '/notifications')
        self.call('GET', '/admin-messages/pending')

    def test_resume_keeps_edits_without_extending_lifetime(self):
        self.call('PUT', '/auth/profile', json={'display_name': 'Still here'})
        key = self.headers['X-Papol-Demo-Session']
        expires = main.demo_app.workspaces[key].expires
        response = self.client.post('/api/demo/session', headers=self.headers)
        self.assertEqual(response.json()['session'], key)
        self.assertEqual(main.demo_app.workspaces[key].expires, expires)
        self.assertEqual(self.call('GET', '/auth/me')['display_name'], 'Still here')

    def test_demo_errors_do_not_write_permanent_error_logs(self):
        with patch('main.SessionLocal', side_effect=AssertionError('Permanent session used')) as permanent:
            with patch('main._paper_detail', side_effect=RuntimeError('Demo error')):
                client = TestClient(main.app, raise_server_exceptions=False)
                self.addCleanup(client.close)
                response = client.get('/api/demo/papers/29752501fd100849ab7e9770510e6402',
                                      headers=self.headers)
                self.assertEqual(response.status_code, 500)
                permanent.assert_not_called()


# A bundled PDF the real store holds and the seed names.
SEED_PDF = "29752501fd100849ab7e9770510e64024f760ca1361d50dc35f04ff343d38d57.pdf"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(64)


class DemoFilesTests(unittest.TestCase):
    """What the app makes for a visitor — a captured page, the export —
    lives in their workspace, never in the store everyone shares, and goes
    with the visit. What a visitor sends as a file is refused."""

    def setUp(self):
        # The store everyone shares, stood in for behind the per-request
        # names — not in their place, which is what a demo request looks
        # past to reach its own workspace.
        real = TemporaryDirectory(prefix="papol-demo-real-store-")
        self.addCleanup(real.cleanup)
        self.original_stores = storage._configured
        storage._configured = (
            FilesystemFiles(Path(real.name) / "uploads"),
            FilesystemFiles(Path(real.name) / "board_uploads"),
        )
        self.addCleanup(self._restore_stores)
        storage.uploads.put(SEED_PDF, b"%PDF-1.4 bundled\n%%EOF", "application/pdf")
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.addCleanup(main.demo_app.close)
        self.headers = self.start()

    def _restore_stores(self):
        storage._configured = self.original_stores

    def start(self):
        response = self.client.post('/api/demo/session')
        self.assertEqual(response.status_code, 200, response.text)
        return {'X-Papol-Demo-Session': response.json()['session']}

    def call(self, method, path, headers=None, **kwargs):
        response = self.client.request(method, '/api/demo' + path,
                                       headers=headers or self.headers, **kwargs)
        self.assertLess(response.status_code, 400, response.text)
        return response.json() if response.content else None

    def real_store_keys(self):
        return sorted(storage.uploads.keys()), sorted(storage.board_files.keys())

    def capture_webpage(self, board_uuid, headers=None):
        with (
            patch.object(main, '_public_web_url', side_effect=lambda url: url),
            patch.object(main, '_capture_webpage', return_value=PNG),
        ):
            return self.call('POST', f'/boards/{board_uuid}/webpage', headers=headers,
                             json={'url': 'https://example.test/page', 'x': 0, 'y': 0})

    def test_uploads_are_refused_before_any_handler_runs(self):
        board = self.call('POST', '/boards', json={'name': 'Temporary board'})
        cases = [
            ('POST', '/papers/extract', {'files': {'file': ('mine.pdf', b'%PDF-1.4', 'application/pdf')}}),
            ('POST', '/papers', {'json': {'title': 'Mine', 'file_path': SEED_PDF}}),
            ('POST', f"/boards/{board['uuid']}/files", {'files': {'file': ('d.png', PNG, 'image/png')}}),
            ('POST', f"/boards/{board['uuid']}/staging/clip", {'files': {'file': ('c.png', PNG, 'image/png')}}),
            ('POST', '/auth/avatar', {'files': {'file': ('me.png', PNG, 'image/png')}}),
            ('DELETE', '/auth/avatar', {}),
        ]
        with patch('main.SessionLocal', side_effect=AssertionError('Permanent session used')):
            for method, path, extra in cases:
                with self.subTest(path=path):
                    response = self.client.request(method, '/api/demo' + path, headers=self.headers, **extra)
                    self.assertEqual(response.status_code, 501, response.text)
        self.assertEqual(self.real_store_keys(), ([SEED_PDF], []))

    def test_a_capture_lives_in_the_workspace_and_only_there(self):
        board = self.call('POST', '/boards', json={'name': 'Temporary board'})
        with patch('main.SessionLocal', side_effect=AssertionError('Permanent session used')):
            item = self.capture_webpage(board['uuid'])
        self.assertEqual(item['kind'], 'webpage')
        response = self.client.get(f"/api/demo/board-items/{item['uuid']}/file", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, PNG)
        self.assertEqual(response.headers['content-type'], 'image/png')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        # Another visitor has no such card, and the real store never saw the image.
        other = self.client.get(f"/api/demo/board-items/{item['uuid']}/file", headers=self.start())
        self.assertEqual(other.status_code, 404)
        self.assertEqual(self.real_store_keys(), ([SEED_PDF], []))

    def test_the_export_carries_the_bundled_pdf_and_the_files_die_with_the_visit(self):
        name = SEED_PDF[:32]
        if not self.call('GET', f'/papers/{name}').get('copy_uuid'):
            self.call('POST', f'/papers/{name}/add-to-nook')
        board = self.call('POST', '/boards', json={'name': 'Temporary board'})
        self.capture_webpage(board['uuid'])
        response = self.client.get('/api/demo/auth/export', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        names = zipfile.ZipFile(io.BytesIO(response.content)).namelist()
        self.assertTrue(any(n.endswith('.pdf') and '/pdfs/' in n for n in names), names)
        self.assertTrue(any('/board-files/' in n and n.endswith('.png') for n in names), names)

        key = self.headers['X-Papol-Demo-Session']
        files_dir = Path(main.demo_app.workspaces[key].files_dir.name)
        self.assertTrue(any(files_dir.rglob('*.png')))
        main.demo_app.workspaces[key].expires = 0
        main.demo_app.expire(key)
        self.assertFalse(files_dir.exists())

    def test_a_workspace_holds_only_so_much(self):
        main.demo_app.workspaces[self.headers['X-Papol-Demo-Session']].budget.limit = len(PNG) + 10
        board = self.call('POST', '/boards', json={'name': 'Full board'})
        self.capture_webpage(board['uuid'])
        with (
            patch.object(main, '_public_web_url', side_effect=lambda url: url),
            patch.object(main, '_capture_webpage', return_value=PNG),
        ):
            response = self.client.post(f"/api/demo/boards/{board['uuid']}/webpage", headers=self.headers,
                                        json={'url': 'https://example.test/again', 'x': 0, 'y': 0})
        self.assertEqual(response.status_code, 413, response.text)

    def test_the_reader_can_change_their_password_and_close_the_account(self):
        response = self.client.put('/api/demo/auth/password', headers=self.headers,
                                   json={'current_password': 'wrong', 'new_password': 'longer-one'})
        self.assertEqual(response.status_code, 401)
        self.call('PUT', '/auth/password',
                  json={'current_password': DEMO_PASSWORD, 'new_password': 'longer-one'})
        me = self.call('GET', '/auth/me')
        closed = self.call('DELETE', '/auth/account', json={'confirm_email': me['email']})
        self.assertIn('closed', closed['message'])
        # The visit is over; a reload starts a fresh one with the seed reader.
        self.assertEqual(self.client.get('/api/demo/auth/me', headers=self.headers).status_code, 410)
        self.assertEqual(self.call('GET', '/auth/me', headers=self.start())['display_name'],
                         'SpongeBob SquarePants')


class DemoLifetimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_timer_disposes_idle_workspaces_and_capacity_is_bounded(self):
        demo = DemoApplication(main.app.routes, ttl=0.1, capacity=1)
        self.addCleanup(demo.close)
        transport = httpx.ASGITransport(app=demo)
        async with httpx.AsyncClient(transport=transport, base_url='http://demo') as client:
            first = await client.post('/session')
            self.assertEqual(first.status_code, 200)
            key = first.json()['session']
            self.assertEqual((await client.post('/session')).status_code, 503)
            self.assertEqual((await client.post('/session', headers={
                'X-Papol-Demo-Session': key,
            })).status_code, 200)
            await asyncio.sleep(0.15)
            self.assertEqual(demo.workspaces, {})
            self.assertEqual((await client.post('/session')).status_code, 200)


if __name__ == '__main__':
    unittest.main()
