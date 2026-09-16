# Client compatibility gate

How the server tells an installed copy of Papol macOS that it is too old to
talk to, and how that copy tells its user — without losing their work.

## What it is

A **version floor**, not a kill switch. The server states a fact about
itself; the app decides what to do about it. A floor is self-maintaining —
new releases stop being blocked automatically — and there is no
"apply to everyone" button to press by accident.

It is deliberately separate from anything that deletes data. A gate that
also purges is a gate nobody dares use.

## The floor

Two rows in `settings`, editable from the admin tables page, so moving the
floor needs no deploy:

| key | meaning |
| --- | --- |
| `desktop_minimum_version` | below this, incompatible |
| `desktop_recommended_version` | below this, deprecated |
| `desktop_download_url` | where "Download Papol" goes |

## What the client sends

`User-Agent: Papol macOS/<version>`, from `CARGO_PKG_VERSION`. The version
is recorded on `_server_clients.app_version` beside the cursor that row
already keeps.

That record is the part to build first even if nothing else ships: **a floor
cannot be raised safely without knowing who is below it.**

## Transport

- **`GET /api/client-requirements`** — unauthenticated, checked at startup.
  Unauthenticated because a user who is signed out, or whose token was
  rejected, still needs to be told.
- **`426 Upgrade Required`** from `/api/sync/push` and `/api/sync/pull` —
  the authoritative answer, returned where the contract actually lives.

`classify_status` in the sync coordinator treats any unrecognized status as
transient, so 426 must be classified explicitly as `Incompatible`.
Otherwise the gate does nothing but retry forever.

## What the app does

| state | sync | local use | surface |
| --- | --- | --- | --- |
| supported | yes | yes | none |
| deprecated | yes | yes | dismissable notice |
| incompatible | **stopped** | **yes** | persistent bar |

**Incompatible never means "will not start."** A rejected credential already
removes network access without removing the user's identity or their local
work; a version floor has no business being harsher. Unsynchronized work
lives only in `_local_outbox`, `_local_annotations` and `unsynced` blobs, so
an app that refuses to open strands all three.

Only a real HTTP answer sets the state. A network error, or offline mode,
leaves it exactly as it was — being unreachable is not being obsolete. The
verdict is cached in `_local_settings` against the version that observed it,
so it survives a relaunch while offline and lapses after a reinstall.

## The surface

A bar in all three windows — library, viewer and board — with one sentence
and two actions:

> This version of Papol can't sync any more. Download the latest to continue.

- **Download Papol** opens the releases page. There is no updater by design,
  so this is a deliberate hand-off.
- **Save unsynced work** writes the recovery ZIP through
  `local_recovery_export`.

## Rollout

1. Ship a release that understands 426 and the requirements endpoint.
2. Watch `app_version` on `_server_clients` until old builds drain.
3. Broadcast a heads-up through admin messages.
4. Raise the floor.

## The limit worth stating

**The gate only helps builds that already contain it.** Against anything
released earlier, a floor produces an ordinary "Sync failed". It pays off
from the next release onward, and is never a substitute for writing a
migration.

## Non-goals

No remote deletion, no auto-quit, and no gating the viewer's open-from-disk
path — that needs neither an account nor a network, and stays that way.
