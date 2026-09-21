"""Where files live, and how they reach a client from there.

The contract is one set of tests run against both backends: a directory,
and a bucket. The bucket is a small S3 server started in this process —
enough of the protocol for boto3 to put, get, head, list, copy and delete
against it over real HTTP, with the signatures it computes ignored. It is
not a mock of boto3: the client code, the URL encoding of keys, the
pagination and the error shapes are the real ones.

Then the routes. With a bucket behind the server, a file is handed to a
client as a redirect to a URL the bucket answers; the tests follow that
redirect to the fake bucket and read the bytes from there, which is what a
browser or the desktop does.
"""
import hashlib
import http.server
import io
import re
import threading
import unittest
import urllib.parse
import urllib.request
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from xml.sax.saxutils import escape

import boto3
from botocore.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

import main
import storage
import testdb
from auth import get_current_user
from database import get_db
from models import Board, BoardItem, Copy, Paper, Shelf, User
from storage import FilesystemFiles, InvalidKey, S3Files


# ------------------------------------------------------------ a fake bucket

class FakeS3(http.server.BaseHTTPRequestHandler):
    """Path-style S3 over plain HTTP: /bucket/key."""

    objects: dict = {}
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def _split(self):
        parsed = urllib.parse.urlparse(self.path)
        parts = parsed.path.lstrip("/").split("/", 1)
        bucket = parts[0]
        key = urllib.parse.unquote(parts[1]) if len(parts) > 1 else ""
        return bucket, key, urllib.parse.parse_qs(parsed.query, keep_blank_values=True)

    def _send(self, status, body=b"", content_type="application/octet-stream", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _no_such_key(self):
        body = b'<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>gone</Message></Error>'
        self._send(404, body, "application/xml")

    def do_PUT(self):
        bucket, key, _ = self._split()
        source = self.headers.get("x-amz-copy-source")
        if source:
            source_bucket, source_key = urllib.parse.unquote(source.lstrip("/")).split("/", 1)
            with self.lock:
                held = self.objects.get((source_bucket, source_key))
                if held is None:
                    return self._no_such_key()
                self.objects[(bucket, key)] = held
            body = b"<CopyObjectResult><ETag>\"copied\"</ETag></CopyObjectResult>"
            return self._send(200, body, "application/xml")
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length)
        if self.headers.get("x-amz-content-sha256") == "STREAMING-UNSIGNED-PAYLOAD-TRAILER":
            data = _unchunk(data)
        content_type = self.headers.get("Content-Type") or "binary/octet-stream"
        with self.lock:
            self.objects[(bucket, key)] = (data, content_type)
        self._send(200, b"", extra={"ETag": '"%s"' % hashlib.md5(data).hexdigest()})

    def do_GET(self):
        bucket, key, query = self._split()
        if not key:
            return self._list(bucket, query)
        with self.lock:
            held = self.objects.get((bucket, key))
        if held is None:
            return self._no_such_key()
        data, content_type = held
        extra = {}
        if "response-content-disposition" in query:
            extra["Content-Disposition"] = query["response-content-disposition"][0]
        if "response-content-type" in query:
            content_type = query["response-content-type"][0]
        self._send(200, data, content_type, extra)

    def do_HEAD(self):
        bucket, key, _ = self._split()
        with self.lock:
            held = self.objects.get((bucket, key))
        if held is None:
            return self._send(404, b"", "application/xml")
        self._send(200, held[0], held[1])

    def do_DELETE(self):
        bucket, key, _ = self._split()
        with self.lock:
            self.objects.pop((bucket, key), None)
        self._send(204)

    def do_POST(self):
        bucket, _, query = self._split()
        if "delete" not in query:
            return self._send(400)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode()
        keys = [urllib.parse.unquote(k) for k in re.findall(r"<Key>(.*?)</Key>", body)]
        with self.lock:
            for key in keys:
                self.objects.pop((bucket, key), None)
        self._send(200, b"<DeleteResult></DeleteResult>", "application/xml")

    def _list(self, bucket, query):
        prefix = query.get("prefix", [""])[0]
        with self.lock:
            keys = sorted(k for (b, k) in self.objects if b == bucket and k.startswith(prefix))
        entries = "".join(
            f"<Contents><Key>{escape(k)}</Key><Size>{len(self.objects[(bucket, k)][0])}</Size></Contents>"
            for k in keys
        )
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f"<ListBucketResult><Name>{bucket}</Name><Prefix>{escape(prefix)}</Prefix>"
            f"<KeyCount>{len(keys)}</KeyCount><IsTruncated>false</IsTruncated>{entries}"
            "</ListBucketResult>"
        ).encode()
        self._send(200, body, "application/xml")


def _unchunk(data: bytes) -> bytes:
    """boto3 may send an aws-chunked body; recover the payload."""
    out, view = io.BytesIO(), io.BytesIO(data)
    while True:
        line = view.readline()
        if not line:
            break
        size = int(line.split(b";")[0].strip() or b"0", 16)
        if size == 0:
            break
        out.write(view.read(size))
        view.readline()
    return out.getvalue()


class FakeBucket:
    """The server and a boto3 client pointed at it."""

    def __init__(self):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeS3)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}"
        self.client = boto3.client(
            "s3", endpoint_url=self.endpoint, region_name="auto",
            aws_access_key_id="test", aws_secret_access_key="test",
            config=Config(
                signature_version="s3v4", s3={"addressing_style": "path"},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def clear(self):
        with FakeS3.lock:
            FakeS3.objects.clear()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def fetch(url: str) -> tuple[int, bytes, dict]:
    request = urllib.request.Request(url)
    with urllib.request.urlopen(request) as response:
        return response.status, response.read(), dict(response.headers)


# ---------------------------------------------------------- the contract

class FilesContract:
    """What every backend promises. Mixed into a case per backend."""

    files: storage.Files

    def test_put_get_exists_delete(self):
        self.assertFalse(self.files.exists("a/b.txt"))
        self.files.put("a/b.txt", b"hello", "text/plain")
        self.assertTrue(self.files.exists("a/b.txt"))
        self.assertEqual(self.files.get("a/b.txt"), b"hello")
        self.assertEqual(self.files.content_type("a/b.txt"), "text/plain")
        self.files.delete("a/b.txt")
        self.assertFalse(self.files.exists("a/b.txt"))
        self.files.delete("a/b.txt")  # gone is gone
        with self.assertRaises(FileNotFoundError):
            self.files.get("a/b.txt")

    def test_keys_and_prefixes(self):
        self.files.put("one/x.png", b"1", "image/png")
        self.files.put("one/y.png", b"2", "image/png")
        self.files.put("two/z.png", b"3", "image/png")
        self.assertEqual(list(self.files.keys()), ["one/x.png", "one/y.png", "two/z.png"])
        self.assertEqual(list(self.files.keys("one/")), ["one/x.png", "one/y.png"])
        self.assertEqual(self.files.delete_prefix("one/"), 2)
        self.assertEqual(list(self.files.keys()), ["two/z.png"])

    def test_local_is_a_readable_path_for_the_block(self):
        self.files.put("paper.pdf", b"%PDF-1.4", "application/pdf")
        with self.files.local("paper.pdf") as path:
            self.assertEqual(Path(path).read_bytes(), b"%PDF-1.4")
            self.assertEqual(Path(path).suffix, ".pdf")
        with self.assertRaises(FileNotFoundError):
            with self.files.local("missing.pdf"):
                pass

    def test_copy_from_the_other_area(self):
        self.files.put("blobs/abc", b"bytes", "image/png")
        self.other.copy_from(self.files, "blobs/abc", "abc.png")
        self.assertEqual(self.other.get("abc.png"), b"bytes")
        self.assertEqual(self.other.content_type("abc.png"), "image/png")

    def test_keys_that_leave_the_area_are_refused(self):
        for bad in ("../x", "a/../../x", "/etc/passwd", "", "a//b", "a\\b", "./a"):
            with self.subTest(key=bad):
                with self.assertRaises(InvalidKey):
                    self.files.put(bad, b"x", "text/plain")
                self.assertFalse(storage.valid_key(bad))


class FilesystemContractTests(FilesContract, unittest.TestCase):
    def setUp(self):
        self.workspace = TemporaryDirectory()
        root = Path(self.workspace.name)
        self.files = FilesystemFiles(root / "boards")
        self.other = FilesystemFiles(root / "uploads")

    def tearDown(self):
        self.workspace.cleanup()

    def test_no_url_and_a_path(self):
        self.files.put("a.txt", b"x", "text/plain")
        self.assertIsNone(self.files.url("a.txt"))
        self.assertEqual(self.files.path("a.txt"), self.files.root / "a.txt")

    def test_a_write_in_progress_is_not_a_key(self):
        (self.files.root / ".a.txt.123.tmp").write_bytes(b"half")
        self.assertEqual(list(self.files.keys()), [])


class S3ContractTests(FilesContract, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bucket = FakeBucket()

    @classmethod
    def tearDownClass(cls):
        cls.bucket.close()

    def setUp(self):
        self.bucket.clear()
        self.files = S3Files(self.bucket.client, "papol", "board_uploads/")
        self.other = S3Files(self.bucket.client, "papol", "uploads/")

    def test_areas_are_prefixes_in_one_bucket(self):
        self.files.put("a.txt", b"x", "text/plain")
        self.assertEqual(set(FakeS3.objects), {("papol", "board_uploads/a.txt")})
        self.assertIsNone(self.files.path("a.txt"))

    def test_presigned_url_serves_the_bytes_with_the_asked_headers(self):
        self.files.put("b/c d.png", b"png", "image/png")
        url = self.files.url("b/c d.png", filename="Figure 1.png", content_type="image/png")
        self.assertTrue(url.startswith(self.bucket.endpoint))
        self.assertIn("X-Amz-Signature", url)
        status, body, headers = fetch(url)
        self.assertEqual(status, 200)
        self.assertEqual(body, b"png")
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="Figure 1.png"')

    def test_a_public_area_links_to_the_public_host(self):
        public = S3Files(self.bucket.client, "papol", "uploads/", public_url="https://files.example.test/")
        self.assertEqual(public.url("ab cd.pdf"), "https://files.example.test/uploads/ab%20cd.pdf")

    def test_configure_reads_the_environment(self):
        uploads, boards = storage.configure({
            "PAPOL_FILES_URL": "s3://papol/prod",
            "AWS_ENDPOINT_URL_S3": self.bucket.endpoint,
            "AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test",
            "PAPOL_FILES_PUBLIC_URL": "https://files.example.test",
        })
        self.assertEqual((uploads.bucket, uploads.prefix), ("papol", "prod/uploads/"))
        self.assertEqual((boards.bucket, boards.prefix), ("papol", "prod/board_uploads/"))
        self.assertEqual(uploads.public_url, "https://files.example.test")
        self.assertIsNone(boards.public_url)
        uploads.put("x.pdf", b"x", "application/pdf")
        self.assertIn(("papol", "prod/uploads/x.pdf"), FakeS3.objects)

    def test_configure_refuses_a_url_that_is_not_a_bucket(self):
        with self.assertRaises(RuntimeError):
            storage.configure({"PAPOL_FILES_URL": "gs://elsewhere"})

    def test_configure_defaults_to_directories(self):
        with TemporaryDirectory() as directory:
            uploads, boards = storage.configure({}, base_dir=Path(directory))
            self.assertEqual(uploads.root, Path(directory) / "uploads")
            self.assertEqual(boards.root, Path(directory) / "board_uploads")


# ------------------------------------------------------------- the routes

class ServingFromABucketTests(unittest.TestCase):
    """Every route that hands out a file, with the files in a bucket."""

    @classmethod
    def setUpClass(cls):
        cls.bucket = FakeBucket()
        cls.engine = testdb.fresh_engine()
        cls.Session = sessionmaker(bind=cls.engine)
        cls.original_stores = (storage.uploads, storage.board_files)
        storage.uploads = S3Files(cls.bucket.client, "papol", "uploads/")
        storage.board_files = S3Files(cls.bucket.client, "papol", "board_uploads/")

        def test_db():
            db = cls.Session()
            try:
                yield db
            finally:
                db.close()

        def test_user(db=None):
            with cls.Session() as session:
                return session.get(User, cls.user_uuid)

        main.app.dependency_overrides[get_db] = test_db
        main.app.dependency_overrides[get_current_user] = test_user
        cls.client = TestClient(main.app, follow_redirects=False)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        main.app.dependency_overrides.clear()
        storage.uploads, storage.board_files = cls.original_stores
        cls.engine.dispose()
        cls.bucket.close()

    def setUp(self):
        self.bucket.clear()
        with self.Session() as db:
            db.query(BoardItem).delete()
            db.query(Board).delete()
            db.query(Copy).delete()
            db.query(Paper).delete()
            db.query(Shelf).delete()
            db.query(User).delete()
            user = User(email="reader@example.test", display_name="Reader", password_hash="x")
            db.add(user)
            db.commit()
            type(self).user_uuid = user.uuid

    def test_an_upload_redirects_to_the_bucket_and_the_bytes_are_there(self):
        storage.uploads.put("ab.pdf", b"%PDF-1.4 stored", "application/pdf")
        response = self.client.get("/uploads/ab.pdf")
        self.assertEqual(response.status_code, 307, response.text)
        self.assertIn("max-age=", response.headers["Cache-Control"])
        status, body, headers = fetch(response.headers["Location"])
        self.assertEqual((status, body), (200, b"%PDF-1.4 stored"))
        self.assertEqual(headers["Content-Type"], "application/pdf")

    def test_an_upload_url_cannot_leave_the_area(self):
        # Sent encoded, so it reaches the route as a key with `..` in it
        # rather than being folded away by the client.
        self.assertEqual(self.client.get("/uploads/a%2F..%2F..%2Fx").status_code, 404)

    def test_a_board_file_redirects_with_its_name_and_type(self):
        with self.Session() as db:
            board = Board(user_uuid=self.user_uuid, name="B", description=None)
            db.add(board)
            db.flush()
            key = f"{board.uuid}/1234.png"
            item = BoardItem(
                board_uuid=board.uuid, kind="image", file_path=key,
                sha256="0" * 64, original_filename="diagram.png", mime_type="image/png",
            )
            db.add(item)
            db.commit()
            item_uuid = item.uuid
        storage.board_files.put(key, b"png bytes", "image/png")
        response = self.client.get(f"/api/board-items/{item_uuid}/file")
        self.assertEqual(response.status_code, 307, response.text)
        status, body, headers = fetch(response.headers["Location"])
        self.assertEqual((status, body), (200, b"png bytes"))
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="diagram.png"')

    def test_an_uploaded_pdf_is_stored_in_the_bucket_once(self):
        pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"
        with patch.object(main, "extract_doi_from_pdf", return_value=(None, "")), \
                patch.object(main, "_printed_header", return_value=None):
            first = self.client.post(
                "/api/papers/extract",
                files={"file": ("paper.pdf", pdf, "application/pdf")},
            )
            again = self.client.post(
                "/api/papers/extract",
                files={"file": ("paper.pdf", pdf, "application/pdf")},
            )
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(again.status_code, 200, again.text)
        digest = hashlib.sha256(pdf).hexdigest()
        self.assertEqual(first.json()["file_path"], f"{digest}.pdf")
        self.assertEqual(list(storage.uploads.keys()), [f"{digest}.pdf"])
        self.assertEqual(storage.uploads.get(f"{digest}.pdf"), pdf)

    def test_a_synced_blob_becomes_the_paper_it_names(self):
        pdf = b"%PDF-1.4 from the desktop"
        digest = hashlib.sha256(pdf).hexdigest()
        self.assertEqual(self.client.head(f"/api/sync/blobs/{digest}").status_code, 404)
        put = self.client.put(
            f"/api/sync/blobs/{digest}", content=pdf,
            headers={"Content-Type": "application/pdf"},
        )
        self.assertEqual(put.status_code, 204, put.text)
        self.assertEqual(self.client.head(f"/api/sync/blobs/{digest}").status_code, 200)
        self.assertEqual(storage.board_files.content_type(f"blobs/{digest}"), "application/pdf")

        from sync.api import _receive_paper_file
        self.assertEqual(_receive_paper_file(digest), f"{digest}.pdf")
        self.assertEqual(storage.uploads.get(f"{digest}.pdf"), pdf)

        with self.Session() as db:
            paper = Paper(sha256=digest, title="Synced", file_path=f"{digest}.pdf")
            db.add(paper)
            db.flush()
            db.add(Copy(user_uuid=self.user_uuid, paper_sha256=digest))
            db.commit()
        response = self.client.get(f"/api/sync/blobs/{digest}")
        self.assertEqual(response.status_code, 307, response.text)
        status, body, headers = fetch(response.headers["Location"])
        self.assertEqual((status, body), (200, pdf))
        self.assertEqual(headers["Content-Type"], "application/pdf")


if __name__ == "__main__":
    unittest.main()
