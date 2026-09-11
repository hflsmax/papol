# Papol Desktop

Papol Desktop is a thin native Tauri shell for the hosted Papol application at
`https://mc-pony.com/papol`. The remote FastAPI deployment remains authoritative,
so the desktop and browser clients share accounts and data.

## Development

### Run the native app against local code

Use two terminals. From the repository root, run:

```sh
./deploy.sh dev
```

Then, in the second terminal, run:

```sh
cd desktop
npm install
npm run dev:local
```

Keep both terminals running. Quit any other copy of Papol first. `npm run dev`
without `:local` opens the hosted web UI instead.

## Window chrome

The pages notice they are inside the app (Tauri defines `window.isTauri`) and
swap the website masthead for a native reference-manager layout: a source-list
sidebar of shelves, tags, boards and the library, a list of papers, and the
selected paper beside it. See "Desktop shell" in `frontend/DESIGN.md`. On macOS
the window uses an overlay title bar, so those toolbars sit where the title bar
would be and the traffic lights float over their left edge.

A webview is not a browser, and three things a web page takes for granted need
the app's help. The window is declared in `tauri.conf.json` with `create: false`
and built in `src-tauri/src/lib.rs`, so handlers can be attached to it:

- Links that ask for a new tab or window (a DOI, a publisher's PDF) open in the
  default browser. Only `http`, `https` and `mailto` links are handed on.
- Downloads (a paper's PDF, an account export) are allowed, and saved to the
  Downloads folder without overwriting.
- The macOS webview shows no JavaScript dialogs, so `window.confirm` silently
  answers "no". Every confirmation goes through `shared/confirmAction.js`, which
  asks with an in-app sheet inside the app and with `confirm()` in a browser.

## macOS release

The final macOS build must run on macOS. The repository release workflow builds,
signs, notarizes, and attaches a DMG to a GitHub release when a tag matching
`desktop-v*` is pushed.

Configure these GitHub Actions secrets first:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password for that `.p12`
- `APPLE_SIGNING_IDENTITY`: certificate identity, such as `Developer ID Application: Name (TEAMID)`
- `APPLE_ID`: Apple Account used for notarization
- `APPLE_PASSWORD`: app-specific password for that Apple Account
- `APPLE_TEAM_ID`: Apple Developer team identifier

Then update the version in both `package.json` and `src-tauri/tauri.conf.json`,
commit it, and push a matching tag, for example `desktop-v0.1.0`.

The remote page is granted exactly two Tauri permissions, in the `window-chrome`
capability: starting a window drag and toggling zoom, which is what
`data-tauri-drag-region` needs to make a page toolbar behave like a title bar.
The capability names the hosted site and localhost, so a debug build pointed at
a local Papol behaves the same.
It has no other Tauri commands and no native filesystem access. Local-first
caching and sync can therefore be added as a separately reviewed capability
instead of exposing native APIs to hosted code.
