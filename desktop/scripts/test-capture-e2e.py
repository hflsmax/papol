#!/usr/bin/env python3
"""A board card's picture of a web page, taken by the real capture code.

src/capture.rs is WebKit end to end — a window nobody sees, a content rule
list compiled into it, a snapshot of what it drew — and `cargo test` can
reach none of that: the rule list is tested as regular expressions against
URLs, which says what the patterns match, not that WebKit took them, and
nothing at all says the picture is of the page. This takes pictures with
examples/capture_probe.rs, the app's own `snapshot` outside the app, of
pages served here, and asks five things of them:

  * a page is captured, and the JPEG is that page: the right shape, and the
    two colours the fixture paints where it paints them;
  * a page that pulls an image from this machine is still captured — the
    rules drop the image, not the page;
  * a page that redirects to this machine, and a page that frames it, are
    refused with the capture's own "local or private network" message;
  * a page that shows nothing — no words, nothing drawn, nothing painted —
    is refused rather than photographed as a white rectangle;
  * and the server standing in for this machine's network hears nothing
    in all of that, which is the claim the rules exist to make.

The fixture has to look public, because the capture refuses a local link
before WebKit sees it (checked_url) and the rules refuse any address that
spells a local one. So it is served on loopback under a name that is not
one of those spellings — capture-fixture.papol.test by default — which this
machine resolves to 127.0.0.1 through /etc/hosts. The rules match what an
address says, not where it resolves; that is the gap the pull request that
added them names, and here it is what lets the app's code run unchanged,
with no escape hatch in it for a test to use. The CI job writes the hosts
line; on a Mac of your own, add

    127.0.0.1 capture-fixture.papol.test

to /etc/hosts, or point PAPOL_CAPTURE_FIXTURE_HOST at a public name that
resolves to 127.0.0.1 — papol.localtest.me does, if its DNS is reachable.
Not 127.0.0.1.nip.io: the rules read a host that begins `127.` as the
address it spells, and the page never loads.

    npm run test:e2e:capture            # from desktop/, with mise.toml's tools

Pictures are kept in PAPOL_E2E_ARTIFACTS/capture, pass or fail.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).parents[2]
MANIFEST = ROOT / "desktop" / "src-tauri" / "Cargo.toml"
HOST = os.environ.get("PAPOL_CAPTURE_FIXTURE_HOST", "capture-fixture.papol.test")
ARTIFACTS = Path(os.environ.get("PAPOL_E2E_ARTIFACTS", tempfile.gettempdir())) / "capture"

# The fixture paints the top half of the viewport one colour and the bottom
# half another, so a picture of the wrong thing — a blank page, the page at
# the wrong size, a page scrolled or cropped — shows as a wrong colour at a
# known place rather than as a file that merely exists.
TOP = (200, 50, 30)
BOTTOM = (30, 100, 200)
# JPEG at quality 0.8 moves a flat colour by a few units; this is room for
# that and for a colour-managed display, not for a different colour.
TOLERANCE = 28
# The capture window is 1280 × 800 points; WebKit draws it at the screen's
# scale, which is 1 on some runners and 2 on a Retina Mac.
SIZES = {(1280, 800), (2560, 1600)}


def say(message):
    print(f"==> {message}", flush=True)


def page(body):
    css = (
        "html,body{margin:0;height:100%;overflow:hidden}"
        f".top,.bottom{{height:50vh}}.top{{background:rgb{TOP}}}.bottom{{background:rgb{BOTTOM}}}"
        "iframe,img{position:absolute;left:0;top:0;width:200px;height:200px;border:0}"
    )
    return (
        "<!doctype html><meta charset=utf-8><title>Capture fixture</title>"
        f"<style>{css}</style><div class=top></div><div class=bottom></div>{body}"
    ).encode()


class Quiet(BaseHTTPRequestHandler):
    def log_message(self, *arguments):
        pass


def serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def private_server():
    """This machine's network, as far as the capture can tell: anything that
    reaches it is a request the rules should have stopped."""
    heard = []

    class Private(Quiet):
        def do_GET(self):
            heard.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<!doctype html><title>private</title>secret")

    server = serve(Private)
    server.heard = heard
    return server


def fixture_server(private):
    local = f"http://127.0.0.1:{private.server_address[1]}"

    class Fixture(Quiet):
        def do_GET(self):
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", f"{local}/redirected")
                self.end_headers()
                return
            if self.path == "/blank":
                # A page that shows nothing at all: no words, nothing drawn
                # and nothing painted. A site answers a stranger with one of
                # these, and a picture of it is a white rectangle.
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<!doctype html><meta charset=utf-8><title>Nothing here</title>")
                return
            body = {
                "/": b"",
                "/image": f'<img src="{local}/image.png" alt="">'.encode(),
                "/frame": f'<iframe src="{local}/framed"></iframe>'.encode(),
            }.get(self.path)
            if body is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(page(body.decode()))

    return serve(Fixture)


def require_fixture_host():
    try:
        address = socket.gethostbyname(HOST)
    except OSError:
        address = None
    if address != "127.0.0.1":
        raise SystemExit(
            f"{HOST} must resolve to 127.0.0.1 for the fixture to be served "
            f"as a public page (it resolves to {address}); add "
            f"`127.0.0.1 {HOST}` to /etc/hosts or set PAPOL_CAPTURE_FIXTURE_HOST"
        )


def build_probe():
    subprocess.run(
        ["cargo", "build", "--quiet", "--locked", "--manifest-path", str(MANIFEST),
         "--example", "capture_probe"],
        check=True,
    )


def probe(url, output):
    """The probe's verdict: its exit status and everything it said."""
    completed = subprocess.run(
        ["cargo", "run", "--quiet", "--locked", "--manifest-path", str(MANIFEST),
         "--example", "capture_probe", "--", url, str(output)],
        capture_output=True, text=True, timeout=120,
    )
    return completed.returncode, (completed.stdout + completed.stderr).strip()


def pixels(jpeg):
    """Width, height and a pixel reader for a JPEG, decoded by sips.

    sips writes an uncompressed BMP, whose layout is a few fixed offsets;
    that keeps this to the standard library and the Mac's own decoder.
    """
    bitmap = jpeg.with_suffix(".bmp")
    subprocess.run(
        ["sips", "-s", "format", "bmp", str(jpeg), "--out", str(bitmap)],
        check=True, capture_output=True,
    )
    data = bitmap.read_bytes()
    bitmap.unlink()
    offset, = struct.unpack_from("<I", data, 10)
    width, height = struct.unpack_from("<ii", data, 18)
    bits, = struct.unpack_from("<H", data, 28)
    if bits not in (24, 32):
        raise RuntimeError(f"sips wrote a {bits}-bit bitmap, which this does not read")
    step = bits // 8
    stride = (width * step + 3) & ~3
    top_down = height < 0
    height = abs(height)

    def at(x, y):
        row = y if top_down else height - 1 - y
        blue, green, red = data[offset + row * stride + x * step:][:3]
        return red, green, blue

    return width, height, at


def near(actual, wanted):
    return all(abs(a - w) <= TOLERANCE for a, w in zip(actual, wanted))


def check_picture(jpeg):
    data = jpeg.read_bytes()
    if not data.startswith(b"\xff\xd8\xff"):
        raise RuntimeError(f"{jpeg.name} is not a JPEG ({len(data)} bytes)")
    width, height, at = pixels(jpeg)
    if (width, height) not in SIZES:
        raise RuntimeError(f"{jpeg.name} is {width}×{height}, not the capture window's size")
    # Away from the corner where the image or frame would sit, and away
    # from the seam, where JPEG blurs the two colours together.
    for (x, y), wanted in (
        ((width * 3 // 4, height // 4), TOP),
        ((width // 2, height // 3), TOP),
        ((width * 3 // 4, height * 3 // 4), BOTTOM),
        ((width // 2, height * 2 // 3), BOTTOM),
    ):
        seen = at(x, y)
        if not near(seen, wanted):
            raise RuntimeError(
                f"{jpeg.name} has rgb{seen} at ({x}, {y}) where the fixture paints rgb{wanted}"
            )
    return f"{len(data)} bytes, {width}×{height}"


def main():
    if sys.platform != "darwin":
        raise SystemExit("the page capture runs on macOS only")
    require_fixture_host()
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    say("Compiling the capture probe")
    build_probe()

    private = private_server()
    fixture = fixture_server(private)
    site = f"http://{HOST}:{fixture.server_address[1]}"
    try:
        for path, what in (("/", "the fixture page"), ("/image", "a page with an image from this machine")):
            output = ARTIFACTS / f"{path.strip('/') or 'page'}.jpg"
            status, said = probe(f"{site}{path}", output)
            if status:
                raise RuntimeError(f"{what} was not captured:\n{said}")
            say(f"Captured {what}: {check_picture(output)}")

        for path, what, why in (
            ("/redirect", "a page that redirects to this machine", "local or private network"),
            ("/frame", "a page that frames this machine", "local or private network"),
            ("/blank", "a page that shows nothing", "showed nothing to make a picture of"),
        ):
            output = ARTIFACTS / f"{path.strip('/')}.jpg"
            status, said = probe(f"{site}{path}", output)
            if status == 0 or output.exists():
                raise RuntimeError(f"{what} was captured:\n{said}")
            if why not in said:
                raise RuntimeError(f"{what} failed, but not for its own reason:\n{said}")
            say(f"Refused {what}: {said.splitlines()[-1]}")

        if private.heard:
            raise RuntimeError(f"this machine's network was reached: {private.heard!r}")
        say("and the server on this machine's network heard nothing")
        print("page capture, its picture, and its private-network guard: ok")
    finally:
        fixture.shutdown()
        private.shutdown()


if __name__ == "__main__":
    main()
