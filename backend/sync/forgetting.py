"""What synchronization may stop remembering, and why it is safe to.

Two tables here exist to make synchronization cheap, and neither is where
anything actually lives. Both grew without bound anyway, which is the kind
of thing nobody notices until the database is mostly bookkeeping: an
account was the only thing that ever emptied them, and only by closing.

`_server_change_log` is the incremental half of a pull. The authoritative
half is the snapshot, which every reconciliation fetches first and which is
the complete server mirror of exactly these tables — so a replica that
misses a change learns the same state from the snapshot a moment earlier.
The log is an optimization over that, and an entry every one of an
account's replicas has already acknowledged is an optimization nobody will
use again. The cursor only has to grow, so the gap costs nothing; this is
the same reasoning a schema migration already relies on when it drops
entries no replica could read.

`applied_mutations` is what makes a lost response safe to retry: the reply
is kept under the caller's own mutation UUID and handed back if the request
comes again. Retrying is a thing a client does while it still believes the
request is outstanding — across a dropped connection, or a laptop closed
mid-push — so the window is generous rather than tight, and an entry older
than it is one no client is still holding a request for.
"""

from datetime import datetime, timedelta

from sqlalchemy import func

from app_limits import limit
from models import AppliedMutation, ServerChange, SyncClient


def replay_window() -> timedelta:
    return timedelta(days=limit("retention_days", "replay_cache"))


def forget_acknowledged_changes(db, user_uuid: str) -> int:
    """Drop this account's change log up to what every replica has taken.

    Conservative on purpose. The lowest cursor any registered replica has
    acknowledged is the last point all of them are known to be past; an
    account with no replica registered is left alone rather than emptied,
    because the cheap thing to be wrong about here is keeping too much.
    """
    floor = db.query(func.min(SyncClient.acknowledged_cursor)).filter(
        SyncClient.user_uuid == user_uuid,
    ).scalar()
    if not floor:
        return 0
    return db.query(ServerChange).filter(
        ServerChange.user_uuid == user_uuid,
        ServerChange.sequence <= floor,
    ).delete(synchronize_session=False)


def forget_old_replays(db, user_uuid: str) -> int:
    """Drop replies to mutations no client can still be retrying."""
    return db.query(AppliedMutation).filter(
        AppliedMutation.user_uuid == user_uuid,
        AppliedMutation.created_at < datetime.utcnow() - replay_window(),
    ).delete(synchronize_session=False)
