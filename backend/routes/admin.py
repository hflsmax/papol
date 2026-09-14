from datetime import datetime

import dbmetrics
from auth import get_current_user
from database import Base, get_db
from fastapi import APIRouter, Depends, HTTPException
from models import Feedback, User
from schemas import AdminSQL, FeedbackOut, FeedbackUpdate
from services.feedback import feedback_out
from services.notifications import send_daily_digest, smtp_config
from sqlalchemy import text
from sqlalchemy.orm import Session
from app_limits import limit

router = APIRouter()

def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


def _admin_table(table_name: str):
    table = Base.metadata.tables.get(table_name)
    if table is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return table


def _admin_single_pk(table):
    pk_cols = list(table.primary_key.columns)
    if len(pk_cols) != 1:
        raise HTTPException(status_code=400, detail="Table has no single-column primary key")
    return pk_cols[0]


def _coerce_value(column, value):
    """Coerce a JSON value from the admin UI to the column's Python type."""
    if value is None or value == "":
        return None
    try:
        python_type = column.type.python_type
    except NotImplementedError:
        return value
    if python_type is datetime and isinstance(value, str):
        return datetime.fromisoformat(value)
    if python_type in (int, bool, float) and isinstance(value, str):
        try:
            return python_type(int(value)) if python_type is bool else python_type(value)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid value for {column.name}")
    return value


def _coerce_pk(table, pk_value: str):
    pk_col = _admin_single_pk(table)
    try:
        if pk_col.type.python_type is int:
            return pk_col, int(pk_value)
    except NotImplementedError:
        pass
    return pk_col, pk_value


@router.post("/api/admin/send-digest")
async def admin_send_digest(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run the daily email digest immediately (admin only)."""
    if smtp_config(db) is None:
        raise HTTPException(
            status_code=400,
            detail="SMTP is not configured — fill the settings table "
            "(smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from) "
            "or set SMTP_* environment variables",
        )
    return send_daily_digest(db)


@router.get("/api/admin/db-metrics")
async def admin_db_metrics(admin: User = Depends(require_admin)):
    """Aggregated timings of database operations since startup (or reset)."""
    return dbmetrics.snapshot()


@router.post("/api/admin/db-metrics/reset")
async def admin_reset_db_metrics(admin: User = Depends(require_admin)):
    dbmetrics.reset()
    return dbmetrics.snapshot()


@router.get("/api/admin/feedback", response_model=list[FeedbackOut])
async def admin_list_feedback(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every bug report and feature request, newest first."""
    rows = (
        db.query(Feedback)
        .order_by(Feedback.resolved, Feedback.created_at.desc(), Feedback.uuid.desc())
        .all()
    )
    return [feedback_out(fb) for fb in rows]


@router.put("/api/admin/feedback/{feedback_uuid}", response_model=FeedbackOut)
async def admin_update_feedback(
    feedback_uuid: str,
    data: FeedbackUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Mark a report done, or reopen it."""
    fb = db.query(Feedback).filter(Feedback.uuid == feedback_uuid).first()
    if not fb:
        raise HTTPException(status_code=404, detail="Report not found")
    fb.resolved = data.resolved
    db.commit()
    db.refresh(fb)
    return feedback_out(fb)


@router.get("/api/admin/tables")
async def admin_list_tables(admin: User = Depends(require_admin)):
    return {"tables": sorted(Base.metadata.tables.keys())}


@router.get("/api/admin/tables/{table_name}")
async def admin_get_table(
    table_name: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    rows = db.execute(table.select().limit(limit("counts", "admin_table_rows"))).mappings().all()
    return {
        "columns": [c.name for c in table.columns],
        "primary_key": [c.name for c in table.primary_key.columns],
        "rows": [dict(r) for r in rows],
    }


@router.put("/api/admin/tables/{table_name}/rows/{pk_value}")
async def admin_update_row(
    table_name: str,
    pk_value: str,
    data: dict,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    pk_col, pkv = _coerce_pk(table, pk_value)
    values = {
        k: _coerce_value(table.columns[k], v)
        for k, v in data.items()
        if k in table.columns.keys() and k != pk_col.name
    }
    if not values:
        raise HTTPException(status_code=400, detail="No editable columns in payload")
    result = db.execute(table.update().where(pk_col == pkv).values(**values))
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Row not found")
    return {"updated": result.rowcount}


@router.delete("/api/admin/tables/{table_name}/rows/{pk_value}")
async def admin_delete_row(
    table_name: str,
    pk_value: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    table = _admin_table(table_name)
    pk_col, pkv = _coerce_pk(table, pk_value)
    result = db.execute(table.delete().where(pk_col == pkv))
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Row not found")
    return {"deleted": result.rowcount}


@router.post("/api/admin/sql")
async def admin_run_sql(
    payload: AdminSQL,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run one raw SQL statement against the database. Admin only."""
    try:
        result = db.execute(text(payload.query))
        if result.returns_rows:
            rows = [dict(r) for r in result.mappings().fetchmany(500)]
            db.commit()
            return {"rows": rows, "columns": list(rows[0].keys()) if rows else []}
        db.commit()
        return {"rowcount": result.rowcount}
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
