from pathlib import Path
from urllib.request import Request, urlopen

import fitz


root = Path(__file__).parent
user_agent = {"User-Agent": "Papol tutorial asset preparation"}


def download(url: str) -> bytes:
    with urlopen(Request(url, headers=user_agent), timeout=30) as response:
        return response.read()


teapot_png = download("https://commons.wikimedia.org/wiki/Special:Redirect/file/Utah_teapot_2.png?width=1200")
teapot = fitz.open(stream=teapot_png, filetype="png")
teapot[0].get_pixmap(alpha=False).save(root / "utah-teapot.png")

bunny_jpeg = download("https://graphics.stanford.edu/data/3Dscanrep/stanford-bunny-cebal-ssh.jpg")
bunny = fitz.open(stream=bunny_jpeg, filetype="jpeg")
bunny[0].get_pixmap(alpha=False).save(root / "stanford-bunny.png")
