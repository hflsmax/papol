# In-memory metrics for database operations, collected via SQLAlchemy
# engine events and served on the admin page. Counters reset when the
# process restarts (or via the admin reset endpoint).

import re
import threading
import time
from datetime import datetime

_lock = threading.Lock()
_since = datetime.utcnow()
_stats = {}  # (operation, table) -> {count, total_ms, max_ms}
_slowest = []  # [{statement, ms, at}], kept sorted, capped
_SLOWEST_CAP = 10
_STATEMENT_PREVIEW = 300

_TABLE_PATTERNS = {
    "SELECT": re.compile(r'\bFROM\s+"?(\w+)', re.IGNORECASE),
    "INSERT": re.compile(r'\bINTO\s+"?(\w+)', re.IGNORECASE),
    "UPDATE": re.compile(r'\bUPDATE\s+(?:OR\s+\w+\s+)?"?(\w+)', re.IGNORECASE),
    "DELETE": re.compile(r'\bFROM\s+"?(\w+)', re.IGNORECASE),
}


def _classify(statement: str):
    head = statement.lstrip()
    operation = head.split(None, 1)[0].upper() if head else "OTHER"
    pattern = _TABLE_PATTERNS.get(operation)
    if pattern is None:
        return operation, "-"
    match = pattern.search(statement)
    return operation, match.group(1) if match else "-"


def _record(statement: str, elapsed_ms: float):
    operation, table = _classify(statement)
    with _lock:
        entry = _stats.setdefault(
            (operation, table), {"count": 0, "total_ms": 0.0, "max_ms": 0.0}
        )
        entry["count"] += 1
        entry["total_ms"] += elapsed_ms
        entry["max_ms"] = max(entry["max_ms"], elapsed_ms)

        _slowest.append({
            "statement": statement.strip()[:_STATEMENT_PREVIEW],
            "ms": round(elapsed_ms, 2),
            "at": datetime.utcnow().isoformat(),
        })
        _slowest.sort(key=lambda q: q["ms"], reverse=True)
        del _slowest[_SLOWEST_CAP:]


def init(engine):
    from sqlalchemy import event

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        conn.info["dbmetrics_start"] = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        start = conn.info.pop("dbmetrics_start", None)
        if start is None:
            return
        _record(statement, (time.perf_counter() - start) * 1000)


def snapshot():
    with _lock:
        operations = [
            {
                "operation": operation,
                "table": table,
                "count": entry["count"],
                "total_ms": round(entry["total_ms"], 2),
                "avg_ms": round(entry["total_ms"] / entry["count"], 2),
                "max_ms": round(entry["max_ms"], 2),
            }
            for (operation, table), entry in _stats.items()
        ]
        operations.sort(key=lambda r: r["total_ms"], reverse=True)
        return {
            "since": _since.isoformat(),
            "total_queries": sum(r["count"] for r in operations),
            "total_ms": round(sum(r["total_ms"] for r in operations), 2),
            "operations": operations,
            "slowest": list(_slowest),
        }


def reset():
    global _since
    with _lock:
        _stats.clear()
        _slowest.clear()
        _since = datetime.utcnow()
