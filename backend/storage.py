"""Where Papol keeps the files users give it: PDFs, avatars, board files.

Two areas, each a `Files`. `uploads` holds a paper's PDF under its digest
and an avatar under a UUID; `board_files` holds a board's files under the
board's uuid and the desktop's content-addressed blobs under `blobs/`. A
key is the relative path the database already stores in `file_path`, so
this module decides where bytes live and changes nothing about how rows
name them.

Two backends. The filesystem is what development, the suite and a single
host use: a directory per area, as it always was. Object storage is what
lets two instances share one set of files: a bucket, reached through any
S3-compatible API, with an area as a key prefix. Whichever is configured,
a file is written once under a name that never comes back — a digest, or
a UUID minted for that one write — so every area is a set of immutable
objects, and "copy across what the other side lacks" is a complete sync.

Configured from the environment, once, when this module is imported:

  PAPOL_FILES_URL         unset: the filesystem — PAPOL_UPLOADS_DIR and
                          PAPOL_BOARD_FILES_DIR, defaulting to uploads/ and
                          board_uploads/ in the checkout.
                          s3://bucket[/prefix]: object storage. The endpoint
                          and credentials are boto3's own variables:
                          AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID,
                          AWS_SECRET_ACCESS_KEY and AWS_DEFAULT_REGION
                          ("auto" for Cloudflare R2).
  PAPOL_FILES_PUBLIC_URL  optional: where the bucket is served to the world,
                          a CDN or the bucket's public domain. Uploads —
                          PDFs and avatars, public by URL today — are linked
                          there. Without it every link is presigned.

Serving follows from the backend. A file in a bucket is handed to the
client as a redirect to a URL the bucket answers itself, presigned for a
while or public through the CDN; the web tier never carries the bytes. A
file on the filesystem is served by the process, as before. `serve` is
that decision, made once for every route that hands out a file.
"""
from __future__ import annotations

import contextvars
import mimetypes
import os
import shutil
import tempfile
import urllib.parse
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Iterator, Mapping

from fastapi import HTTPException
from fastapi.responses import FileResponse, RedirectResponse, Response

REPO_ROOT = Path(__file__).resolve().parent.parent

# How long a presigned link stays good, and how long a client may keep the
# redirect that led to it. The second is well inside the first, so a
# cached redirect never points at a link that has already expired.
PRESIGN_SECONDS = 3600
REDIRECT_CACHE_SECONDS = 600


class InvalidKey(ValueError):
    """A key that does not name a file inside its area."""


def check_key(key: str) -> str:
    """A key is a relative POSIX path with no way out of its area.

    Keys come from the database, from clients (`file_path` on a paper being
    saved, the tail of a /uploads URL), and from this module's own naming,
    and every one is looked up in the same store. Anything that could step
    outside an area — an absolute path, a `..`, an empty segment, a
    backslash a Windows-minded caller might mean as a separator — is
    refused here, once, rather than checked by each backend."""
    if not isinstance(key, str) or not key or key.startswith("/") or "\\" in key:
        raise InvalidKey(key)
    parts = key.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise InvalidKey(key)
    return key


def valid_key(key) -> bool:
    try:
        check_key(key)
    except InvalidKey:
        return False
    return True


def content_type_for(key: str) -> str:
    """The media type a key's name suggests, for bytes that arrive without
    one: a pull from another store, a demo PDF from the checkout."""
    guessed, _ = mimetypes.guess_type(key)
    return guessed or "application/octet-stream"


class Files:
    """One area of files. The operations are the whole interface; the two
    subclasses are the two places bytes can live."""

    def put(self, key: str, data: bytes, content_type: str) -> None:
        raise NotImplementedError

    def get(self, key: str) -> bytes:
        """The bytes, or FileNotFoundError."""
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        """Gone afterwards, whether or not it was there before."""
        raise NotImplementedError

    def delete_prefix(self, prefix: str) -> int:
        """Delete every key under the prefix; returns how many went."""
        raise NotImplementedError

    def keys(self, prefix: str = "") -> Iterator[str]:
        raise NotImplementedError

    def copy_from(self, source: "Files", source_key: str, key: str) -> None:
        """Make `key` hold what `source_key` holds in `source`."""
        self.put(key, source.get(source_key), source.content_type(source_key))

    def content_type(self, key: str) -> str:
        return content_type_for(key)

    def url(self, key: str, *, filename: str | None = None,
            content_type: str | None = None) -> str | None:
        """Where a client can fetch the file itself, or None when only this
        process can serve it. `filename` and `content_type` shape the
        response the store will give, for stores that let a link say so."""
        raise NotImplementedError

    def path(self, key: str) -> Path | None:
        """The file on this machine's disk, or None when it is not here."""
        return None

    @contextmanager
    def local(self, key: str) -> Iterator[Path]:
        """A path on disk holding the file for the duration of the block —
        the file itself, or a scratch copy fetched for the purpose. What
        needs a path is what reads PDFs: PyMuPDF and the GROBID upload."""
        raise NotImplementedError


class FilesystemFiles(Files):
    """An area as a directory. Writes land in a scratch name and are renamed
    into place, so a reader never sees half a file, and the content-
    addressed names two racing writers would share are written once."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def __repr__(self):
        return f"FilesystemFiles({str(self.root)!r})"

    def _path(self, key: str) -> Path:
        return self.root / check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(
            dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp",
            delete=False,
        )
        try:
            with handle:
                handle.write(data)
            os.replace(handle.name, destination)
        except BaseException:
            Path(handle.name).unlink(missing_ok=True)
            raise

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> int:
        removed = 0
        for key in list(self.keys(prefix)):
            self.delete(key)
            removed += 1
        # A board's directory, emptied, has no reason to stay.
        if prefix and prefix.endswith("/"):
            directory = self.root / prefix.rstrip("/")
            if directory.is_dir() and not any(directory.iterdir()):
                shutil.rmtree(directory, ignore_errors=True)
        return removed

    def keys(self, prefix: str = "") -> Iterator[str]:
        for path in sorted(self.root.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue  # scratch files mid-write are nobody's key
            key = path.relative_to(self.root).as_posix()
            if key.startswith(prefix):
                yield key

    def copy_from(self, source: Files, source_key: str, key: str) -> None:
        if isinstance(source, FilesystemFiles):
            destination = self._path(key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            scratch = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
            shutil.copyfile(source._path(source_key), scratch)
            os.replace(scratch, destination)
            return
        super().copy_from(source, source_key, key)

    def url(self, key, *, filename=None, content_type=None):
        return None

    def path(self, key: str) -> Path | None:
        return self._path(key)

    @contextmanager
    def local(self, key: str) -> Iterator[Path]:
        path = self._path(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        yield path


class S3Files(Files):
    """An area as a key prefix in a bucket, through boto3.

    `public_url` is where the bucket is served to the world — a CDN, or the
    bucket's own public domain. An area given one links there; an area
    without one links by presigned URL, which is how a private area stays
    private: the link is the credential, and it lapses."""

    def __init__(self, client, bucket: str, prefix: str = "",
                 public_url: str | None = None):
        self.client = client
        self.bucket = bucket
        self.prefix = prefix
        self.public_url = public_url.rstrip("/") if public_url else None

    def __repr__(self):
        return f"S3Files(bucket={self.bucket!r}, prefix={self.prefix!r})"

    def _object(self, key: str) -> str:
        return self.prefix + check_key(key)

    def _missing(self, error) -> bool:
        code = str(error.response.get("Error", {}).get("Code", ""))
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"404", "NoSuchKey", "NotFound"} or status == 404

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            Bucket=self.bucket, Key=self._object(key), Body=data,
            ContentType=content_type,
        )

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError
        try:
            answer = self.client.get_object(Bucket=self.bucket, Key=self._object(key))
        except ClientError as error:
            if self._missing(error):
                raise FileNotFoundError(key) from error
            raise
        return answer["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._object(key))
        except ClientError as error:
            if self._missing(error):
                return False
            raise
        return True

    def content_type(self, key: str) -> str:
        from botocore.exceptions import ClientError
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=self._object(key))
        except ClientError as error:
            if self._missing(error):
                raise FileNotFoundError(key) from error
            raise
        return head.get("ContentType") or content_type_for(key)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._object(key))

    def delete_prefix(self, prefix: str) -> int:
        removed = 0
        batch = []
        for key in self.keys(prefix):
            batch.append({"Key": self.prefix + key})
            if len(batch) == 1000:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": batch, "Quiet": True})
                removed += len(batch)
                batch = []
        if batch:
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": batch, "Quiet": True})
            removed += len(batch)
        return removed

    def keys(self, prefix: str = "") -> Iterator[str]:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.prefix + prefix):
            for entry in page.get("Contents", []):
                yield entry["Key"][len(self.prefix):]

    def copy_from(self, source: Files, source_key: str, key: str) -> None:
        if isinstance(source, S3Files) and source.client is self.client:
            self.client.copy_object(
                Bucket=self.bucket, Key=self._object(key),
                CopySource={"Bucket": source.bucket, "Key": source._object(source_key)},
            )
            return
        super().copy_from(source, source_key, key)

    def url(self, key, *, filename=None, content_type=None):
        object_key = self._object(key)
        if self.public_url:
            return f"{self.public_url}/{urllib.parse.quote(object_key)}"
        params = {"Bucket": self.bucket, "Key": object_key}
        if content_type:
            params["ResponseContentType"] = content_type
        if filename:
            params["ResponseContentDisposition"] = _content_disposition(filename)
        return self.client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=PRESIGN_SECONDS,
        )

    @contextmanager
    def local(self, key: str) -> Iterator[Path]:
        from botocore.exceptions import ClientError
        suffix = PurePosixPath(key).suffix
        handle = tempfile.NamedTemporaryFile(prefix="papol-file-", suffix=suffix, delete=False)
        path = Path(handle.name)
        try:
            with handle:
                try:
                    self.client.download_fileobj(self.bucket, self._object(key), handle)
                except ClientError as error:
                    if self._missing(error):
                        raise FileNotFoundError(key) from error
                    raise
            yield path
        finally:
            path.unlink(missing_ok=True)


class LayeredFiles(Files):
    """A writable area in front of a read-only one.

    Writes and deletes touch only the front; reads look in the front and
    then the back, so the pair presents one set of files. This is how a
    demo workspace sees the bundled PDFs the real store holds together with
    what its visitor uploaded, and can never write to, or delete from, the
    store everyone shares."""

    def __init__(self, front: Files, back: Files):
        self.front, self.back = front, back

    def __repr__(self):
        return f"LayeredFiles(front={self.front!r}, back={self.back!r})"

    def _holder(self, key: str) -> Files:
        return self.front if self.front.exists(key) else self.back

    def put(self, key, data, content_type):
        self.front.put(key, data, content_type)

    def get(self, key):
        return self._holder(key).get(key)

    def exists(self, key):
        return self.front.exists(key) or self.back.exists(key)

    def content_type(self, key):
        return self._holder(key).content_type(key)

    def delete(self, key):
        self.front.delete(key)

    def delete_prefix(self, prefix):
        return self.front.delete_prefix(prefix)

    def keys(self, prefix=""):
        seen = set()
        for source in (self.front, self.back):
            for key in source.keys(prefix):
                if key not in seen:
                    seen.add(key)
                    yield key

    def copy_from(self, source, source_key, key):
        self.front.copy_from(unwrap(source), source_key, key)

    def url(self, key, *, filename=None, content_type=None):
        return self._holder(key).url(key, filename=filename, content_type=content_type)

    def path(self, key):
        return self._holder(key).path(key)

    @contextmanager
    def local(self, key):
        with self._holder(key).local(key) as path:
            yield path


def _content_disposition(filename: str) -> str:
    """The header Starlette's FileResponse would send for this filename,
    spelled the same so a redirect and a direct answer save under one name."""
    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "")
    quoted = urllib.parse.quote(filename, safe="")
    if ascii_name == filename:
        return f'attachment; filename="{ascii_name}"'
    return f"attachment; filename*=utf-8''{quoted}"


def serve(files: Files, key: str, *, media_type: str | None = None,
          filename: str | None = None, cache_control: str) -> Response:
    """The response that hands a client this file: a redirect to where the
    store serves it, or the bytes from the process when the store is a
    directory here. Missing files are 404 either way — for a bucket, the
    bucket says so at the redirected URL, so no round trip is spent asking
    it first."""
    if not valid_key(key):
        raise HTTPException(status_code=404, detail="File not found")
    location = files.url(key, filename=filename, content_type=media_type)
    if location is not None:
        return RedirectResponse(
            location, status_code=307,
            headers={"Cache-Control": f"private, max-age={REDIRECT_CACHE_SECONDS}"},
        )
    path = files.path(key)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path, media_type=media_type, filename=filename,
        headers={"Cache-Control": cache_control},
    )


# ---------------------------------------------------------------- configure

UPLOADS_AREA = "uploads"
BOARD_FILES_AREA = "board_uploads"


def s3_client(environ: Mapping[str, str] = os.environ):
    """A boto3 S3 client from the standard variables. Path-style addressing,
    which every S3-compatible endpoint answers and a bucket-as-hostname
    endpoint on localhost cannot."""
    import boto3
    from botocore.config import Config
    return boto3.client(
        "s3",
        endpoint_url=environ.get("AWS_ENDPOINT_URL_S3") or environ.get("AWS_ENDPOINT_URL") or None,
        region_name=environ.get("AWS_DEFAULT_REGION") or "auto",
        aws_access_key_id=environ.get("AWS_ACCESS_KEY_ID") or None,
        aws_secret_access_key=environ.get("AWS_SECRET_ACCESS_KEY") or None,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def configure(environ: Mapping[str, str] = os.environ,
              base_dir: Path = REPO_ROOT) -> tuple[Files, Files]:
    """The two areas this environment describes: (uploads, board_files)."""
    files_url = (environ.get("PAPOL_FILES_URL") or "").strip()
    if not files_url:
        uploads = FilesystemFiles(Path(environ.get("PAPOL_UPLOADS_DIR") or base_dir / UPLOADS_AREA))
        boards = FilesystemFiles(Path(environ.get("PAPOL_BOARD_FILES_DIR") or base_dir / BOARD_FILES_AREA))
        return uploads, boards
    parsed = urllib.parse.urlparse(files_url)
    if parsed.scheme != "s3" or not parsed.netloc:
        raise RuntimeError(
            f"PAPOL_FILES_URL is {files_url!r}; it must be s3://bucket[/prefix], "
            "or unset for the filesystem"
        )
    base = parsed.path.strip("/")
    base = f"{base}/" if base else ""
    public = (environ.get("PAPOL_FILES_PUBLIC_URL") or "").strip() or None
    client = s3_client(environ)
    uploads = S3Files(client, parsed.netloc, f"{base}{UPLOADS_AREA}/", public_url=public)
    boards = S3Files(client, parsed.netloc, f"{base}{BOARD_FILES_AREA}/")
    return uploads, boards


_configured: tuple[Files, Files] = configure()

# A request may be served from other areas than the configured ones: the
# demo hands each visitor a disposable pair. The override is a context
# variable, so it follows the request through `await` and `to_thread` and
# is invisible to every other request on the loop.
_override: contextvars.ContextVar[tuple[Files, Files] | None] = contextvars.ContextVar(
    "papol_files_override", default=None,
)


class Area(Files):
    """`storage.uploads` and `storage.board_files`: the configured area, or
    the one the current request was given. Every method is the target's."""

    def __init__(self, slot: int):
        self.slot = slot

    def _target(self) -> Files:
        override = _override.get()
        return (override or _configured)[self.slot]

    def __repr__(self):
        return f"Area({self._target()!r})"

    def put(self, key, data, content_type):
        return self._target().put(key, data, content_type)

    def get(self, key):
        return self._target().get(key)

    def exists(self, key):
        return self._target().exists(key)

    def content_type(self, key):
        return self._target().content_type(key)

    def delete(self, key):
        return self._target().delete(key)

    def delete_prefix(self, prefix):
        return self._target().delete_prefix(prefix)

    def keys(self, prefix=""):
        return self._target().keys(prefix)

    def copy_from(self, source, source_key, key):
        return self._target().copy_from(unwrap(source), source_key, key)

    def url(self, key, *, filename=None, content_type=None):
        return self._target().url(key, filename=filename, content_type=content_type)

    def path(self, key):
        return self._target().path(key)

    @contextmanager
    def local(self, key):
        with self._target().local(key) as path:
            yield path


def unwrap(files: Files) -> Files:
    """The configured store behind a name, ignoring any request override —
    what a disposable layer is put in front of, never the layer itself."""
    if isinstance(files, Area):
        return _configured[files.slot]
    return files


@contextmanager
def use(uploads_area: Files, board_files_area: Files):
    """Serve the block's requests from these two areas instead."""
    token = _override.set((uploads_area, board_files_area))
    try:
        yield
    finally:
        _override.reset(token)


uploads: Files = Area(0)
board_files: Files = Area(1)
