# Client compatibility gate

How the server refuses a copy of Papol built for another schema, and how
that copy tells its user without losing their work.

## One number

`schema_version` in `schema/sync_registry.json` names the data model and
the wire that carries it. It is compiled into the desktop app and the
website, and the developer moves it when a change lands that an existing
database, replica or build cannot be read under. Nothing detects shape:
both ends compare the number they were given.

What each party does with it:

| party | check | consequence |
| --- | --- | --- |
| service | its database records the number | refuses to start otherwise, naming the statements that bring the database across by hand |
| desktop | its replica records the number | discards the replica otherwise and pulls the account again |
| service | every request carries `X-Papol-Schema` | answers `426 Upgrade Required` to any other number on `/api/sync/*` |

A caller that sends no `X-Papol-Schema` is not a Papol client and is not
gated. The website ships with the server and cannot be out of step with it.

## Transport

- **`GET /api/client-requirements`** — unauthenticated, checked at startup,
  answers `{verdict, schema_version, download_url}`. Unauthenticated because
  a user who is signed out, or whose token was rejected, still needs to be
  told.
- **`426`** from push, pull and snapshot, with
  `{error: "client_incompatible", schema_version, download_url}` — the
  authoritative answer, returned where the contract lives. The sync
  coordinator classifies 426 as `Incompatible`; every unrecognized status
  is retried, so this one has to be named.

The release version travels separately, as `User-Agent: Papol macOS/<version>`,
and is recorded on `_server_clients.app_version` so that who runs what can
be read off the table. It gates nothing.

## What the app does

| verdict | sync | local use | surface |
| --- | --- | --- | --- |
| supported | yes | yes | none |
| incompatible | **stopped** | **yes** | covering panel |

Incompatible never means "will not start". Unsynchronized work lives only
in `_local_outbox` and unsynced blobs, so the panel offers exactly the two
actions that help: **Download Papol**, which opens the releases page, and
**Save unsynced work**, which writes the recovery ZIP through
`local_recovery_export`.

Only a real HTTP answer sets the verdict. A network error, or offline mode,
leaves it as it was: being unreachable is not being obsolete. The verdict is
kept in `_local_settings` (`client_compatibility`), so a window opened
offline shows it; the next answer from the server replaces it.

## Non-goals

No remote deletion, no auto-quit, and no gating the viewer's open-from-disk
path, which needs neither an account nor a network.
