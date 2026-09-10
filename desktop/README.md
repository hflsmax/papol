# Papol Desktop

Papol Desktop is a thin native Tauri shell for the hosted Papol application at
`https://mc-pony.com/papol`. The remote FastAPI deployment remains authoritative,
so the desktop and browser clients share accounts and data.

## Development

Install the Tauri prerequisites for your platform, then run:

```sh
cd desktop
npm install
npm run dev
```

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

This first release intentionally grants the remote page no Tauri commands or
native filesystem access. Local-first caching and sync can therefore be added as
a separately reviewed capability instead of exposing native APIs to hosted code.
