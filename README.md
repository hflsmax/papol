# Papol

Papers, and everything you think about them. **[papol.io](https://papol.io)**:
try it on its front page, no account needed. Free, on the web and on Mac, and
its source is all here.

## Viewer

Click a citation and see what it is, and every place the paper cites it.
Click "Fig. 1a" and the figure comes to you. Paint what matters.

![The viewer with a painted passage](docs/screenshots/viewer.png)

## Board

What a paper sets off, side by side: its passages, videos, web pages, files
and your own thoughts, on a canvas with room to spread out.

![A board of cards](docs/screenshots/board.png)

## Library

Every paper, and who reads it. Your nook holds your papers on shelves you
make public or keep private.

![A nook listing papers](docs/screenshots/nook.png)

## Papol for Mac

The same Papol, with your papers there when the Wi-Fi is not.
[Download](https://github.com/hflsmax/papol/releases).

![Papol running on macOS](docs/screenshots/macos.png)

# Develop

Papol is a Cloudflare Worker (`cloudflare/`: the API and the jobs, on D1,
R2 and a Queue) serving three Vite apps (`frontend/`, `viewer/`, `board/`)
as its static assets, with a native macOS shell (`desktop/`) around the same
pages. Every tool is listed in `mise.toml`: `mise install`, then `mise activate`
in your shell (or `direnv allow`). Google Chrome is the browser the smokes drive.

```sh
./deploy.sh dev                       # the Worker on :8787, the apps live-reloading on :5173
```

Or the Worker alone:

```sh
cd cloudflare && npm ci --legacy-peer-deps && npx wrangler dev
```

Its suite is `npm test` there, in the Workers runtime against a local
database; each app's is `npm test` in its directory. Main deploys
itself to dev.papol.io; `./deploy.sh prod` runs the same workflow for
https://papol.io, and `deploy.sh`'s header lists the rest. How
the system came to be shaped this way is in `docs/cloud-migration.md`.
