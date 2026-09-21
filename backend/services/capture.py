"""A picture of a link, for a board card: a webpage or a YouTube frame.

The request checks the URL — a real host, a public address, a video id
it can read — writes the card at once, and queues the capture. The card
is a link without a preview until the worker has rendered the page in a
headless browser, or fetched the video's thumbnail or decoded the frame
at the timestamp asked for, and put the image beside the card. A capture
that fails leaves the card as the link it already was; the job says why.
"""

import hashlib
import ipaddress
import json
import logging
import os
import re
import socket
import subprocess
import tempfile
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

import storage
from app_limits import limit, mebibytes
from models import BoardItem
from services import jobs
from sync.changes import commit_sync

logger = logging.getLogger(__name__)

WEBPAGE, YOUTUBE = "capture_webpage", "capture_youtube"

BOARD_FILE_LIMIT = mebibytes("files", "board_file_mb")


# ------------------------------------------------------------ what a URL is

def youtube_id(url: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    candidate = None
    if host == "youtu.be":
        candidate = parsed.path.strip("/").split("/")[0]
    elif host in {"youtube.com", "m.youtube.com"}:
        if parsed.path == "/watch":
            candidate = urllib.parse.parse_qs(parsed.query).get("v", [None])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) == 2 and parts[0] in {"shorts", "embed", "live"}:
                candidate = parts[1]
    return candidate if candidate and re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate) else None


def youtube_time(url: str) -> float | None:
    parsed = urllib.parse.urlparse(url.strip())
    values = urllib.parse.parse_qs(parsed.query)
    raw = (values.get("t") or values.get("start") or [None])[0]
    if raw is None and parsed.fragment.startswith("t="):
        raw = parsed.fragment[2:]
    if not raw:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", raw):
        return float(raw)
    match = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?", raw)
    if not match or not any(match.groups()):
        raise ValueError("Invalid YouTube timestamp")
    hours, minutes, seconds = match.groups()
    return int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(seconds or 0)


def public_web_url(value: str) -> str:
    """Accept a browser URL without giving the capture process LAN access."""
    url = value.strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Paste a valid http or https URL")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not supported")
    try:
        addresses = {
            ipaddress.ip_address(row[4][0])
            for row in socket.getaddrinfo(parsed.hostname, parsed.port or 443)
        }
    except (OSError, ValueError) as exc:
        raise ValueError("The website address could not be resolved") from exc
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Local and private network addresses cannot be captured")
    return url


# ------------------------------------------------------------- the capturing

def fetch_youtube_thumbnail(url: str, video_id: str) -> tuple[bytes, str]:
    endpoint = "https://www.youtube.com/oembed?" + urllib.parse.urlencode(
        {"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}
    )
    request = urllib.request.Request(endpoint, headers={"User-Agent": "Papol/1.0"})
    with urllib.request.urlopen(request, timeout=limit("timeouts_ms", "youtube_metadata") / 1000) as response:
        metadata = json.loads(response.read(limit("files", "youtube_metadata_kb") * 1024))
    thumbnail = str(metadata.get("thumbnail_url") or "")
    host = (urllib.parse.urlparse(thumbnail).hostname or "").lower()
    if host != "i.ytimg.com" and not host.endswith(".ytimg.com"):
        raise ValueError("YouTube returned an invalid thumbnail location")
    image_request = urllib.request.Request(thumbnail, headers={"User-Agent": "Papol/1.0"})
    with urllib.request.urlopen(image_request, timeout=limit("timeouts_ms", "youtube_thumbnail") / 1000) as response:
        image = response.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("YouTube thumbnail is empty or too large")
    return image, str(metadata.get("title") or url)[:limit("text", "board_content")]


def capture_youtube_frame(url: str, timestamp: float) -> tuple[bytes, str]:
    """Resolve a constrained YouTube stream and decode the exact requested frame."""
    with tempfile.TemporaryDirectory(prefix="papol-youtube-") as directory:
        template = str(Path(directory) / "source.%(ext)s")
        extractor_args = "youtube:player_client=mweb"
        po_token = os.environ.get("PAPOL_YOUTUBE_PO_TOKEN", "").strip()
        if po_token:
            extractor_args += f";po_token=mweb.gvs+{po_token}"
        cookies = os.environ.get("PAPOL_YOUTUBE_COOKIES", "").strip()
        download_command = [
            "yt-dlp",
            "--no-playlist", "--no-warnings", "--quiet",
            # mweb with a GVS PO token exposes native adaptive formats. With
            # no token it still provides the public fallback used below.
            "--extractor-args", extractor_args,
        ]
        if cookies:
            if not Path(cookies).is_file():
                raise ValueError("PAPOL_YOUTUBE_COOKIES does not name a readable file")
            download_command += ["--cookies", cookies]
        download_command += [
            "--max-filesize", f'{limit("files", "youtube_source_mb")}M',
            "--write-info-json",
            "-f", "bestvideo[height<=1080]/bestvideo/best[height<=1080]/best",
            "-o", template,
            url,
        ]
        download_process = subprocess.run(
            download_command,
            capture_output=True,
            text=True,
            timeout=limit("timeouts_ms", "youtube_download") / 1000,
            check=False,
        )
        if download_process.returncode != 0:
            raise ValueError(download_process.stderr.strip() or "YouTube video could not be downloaded")
        metadata_files = list(Path(directory).glob("source.info.json"))
        media_files = [
            path for path in Path(directory).glob("source.*")
            if path.name != "source.info.json" and path.is_file()
        ]
        if not metadata_files or not media_files:
            raise ValueError("YouTube did not provide a playable video stream")
        metadata = json.loads(metadata_files[0].read_text())
        duration = metadata.get("duration")
        if duration is not None and timestamp > float(duration):
            raise ValueError("The timestamp is beyond the end of this video")

        with tempfile.NamedTemporaryFile(suffix=".png") as output:
            frame_process = subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error",
                    "-ss", f"{timestamp:.3f}",
                    "-i", str(media_files[0]),
                    "-frames:v", "1",
                    "-vf", "scale=1280:-2:flags=lanczos",
                    "-compression_level", "3",
                    "-y", output.name,
                ],
                capture_output=True,
                text=True,
                timeout=limit("timeouts_ms", "media_capture") / 1000,
                check=False,
            )
            if frame_process.returncode != 0:
                raise ValueError(frame_process.stderr.strip() or "Video frame could not be decoded")
            image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("Captured frame is empty or too large")
    return image, str(metadata.get("title") or url)[:limit("text", "board_content")]


def capture_webpage(url: str) -> bytes:
    """Render the visible part of a medium desktop viewport as a PNG."""
    safe_url = public_web_url(url)
    with tempfile.NamedTemporaryFile(suffix=".png") as output:
        process = subprocess.run(
            [
                "chromium", "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--no-first-run", "--disable-extensions", "--disable-background-networking",
                "--window-size=1280,800", "--force-device-scale-factor=1",
                "--virtual-time-budget=5000", f"--screenshot={output.name}",
                # Defense in depth after the DNS check above, including pages
                # that try to redirect the browser into Papol's own network.
                "--host-resolver-rules=MAP localhost ~NOTFOUND, MAP *.localhost ~NOTFOUND, MAP 127.* ~NOTFOUND, MAP 10.* ~NOTFOUND, MAP 192.168.* ~NOTFOUND, MAP 169.254.* ~NOTFOUND",
                safe_url,
            ],
            capture_output=True,
            text=True,
            timeout=limit("timeouts_ms", "media_capture") / 1000,
            check=False,
        )
        if process.returncode != 0:
            raise ValueError(process.stderr.strip() or "The website could not be rendered")
        output.seek(0)
        image = output.read(BOARD_FILE_LIMIT + 1)
    if not image or len(image) > BOARD_FILE_LIMIT:
        raise ValueError("The website screenshot is empty or too large")
    return image


def youtube_picture(url: str, video_id: str) -> tuple[bytes, str, str, str]:
    """The video's thumbnail, or the frame at the timestamp the link names:
    (image, title, file suffix, mime type)."""
    timestamp = youtube_time(url)
    if timestamp is None:
        image, title = fetch_youtube_thumbnail(url, video_id)
        return image, title, ".jpg", "image/jpeg"
    image, title = capture_youtube_frame(url, timestamp)
    return image, title, ".png", "image/png"


# ------------------------------------------------------ putting it on the card

def attach(db: Session, item: BoardItem, image: bytes, suffix: str, mime: str, original: str) -> dict:
    """The picture onto the card, in the board's files; committed."""
    key = f"{item.board_uuid}/{uuid.uuid4().hex}{suffix}"
    storage.board_files.put(key, image, mime)
    item.file_path = key
    item.sha256 = hashlib.sha256(image).hexdigest()
    item.original_filename = original
    item.mime_type = mime
    item.board.updated_at = datetime.utcnow()
    commit_sync(db)
    return {"file_path": key, "sha256": item.sha256}


def attach_webpage(db: Session, item: BoardItem, image: bytes, url: str) -> dict:
    hostname = urllib.parse.urlparse(url).hostname or url
    return attach(
        db, item, image, ".png", "image/png",
        f'webpage-{hostname[:limit("text", "display_name")]}.png',
    )


def attach_youtube(db: Session, item: BoardItem, image: bytes, title: str,
                   suffix: str, mime: str, video_id: str) -> dict:
    item.content = title
    return attach(db, item, image, suffix, mime, f"youtube-{video_id}{suffix}")


# ------------------------------------------------------------------ the jobs

def _card(db: Session, payload: dict) -> BoardItem:
    item = db.get(BoardItem, payload["item_uuid"])
    if item is None or item.deleted_at is not None:
        raise jobs.JobError("The card is gone")
    return item


async def capture_webpage_job(db: Session, payload: dict) -> dict:
    item = _card(db, payload)
    url = payload["url"]
    try:
        image = capture_webpage(url)
    except Exception as exc:
        logger.warning("Could not capture webpage %s: %s", url, exc)
        raise jobs.JobError(f"Could not capture the webpage: {exc}") from exc
    return attach_webpage(db, item, image, url)


async def capture_youtube_job(db: Session, payload: dict) -> dict:
    item = _card(db, payload)
    url, video_id = payload["url"], payload["video_id"]
    try:
        image, title, suffix, mime = youtube_picture(url, video_id)
    except Exception as exc:
        logger.warning("Could not capture YouTube frame for %s: %s", video_id, exc)
        raise jobs.JobError(f"Could not capture the YouTube frame: {exc}") from exc
    return attach_youtube(db, item, image, title, suffix, mime, video_id)
