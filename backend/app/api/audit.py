# backend/app/api/audit.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.governance import AuditLog

router = APIRouter(tags=["audit"])


@router.get("/api/projects/{project_id}/audit-logs")
def list_project_audit_logs(
    project_id: str,
    layer:  str = None,
    limit:  int = Query(default=50, le=200),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AuditLog).filter(AuditLog.project_id == project_id)
    if layer:
        query = query.filter(AuditLog.layer == layer)

    total = query.count()
    logs  = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "success": True,
        "data": {
            "total": total,
            "items": [
                {
                    "id":         log.id,
                    "layer":      log.layer,
                    "action":     log.action,
                    "actor":      log.actor,
                    "detail":     log.detail,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
        },
    }


@router.get("/api/audit-logs")
def list_all_audit_logs(
    layer:  str = None,
    limit:  int = Query(default=100, le=500),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(AuditLog)
    if layer:
        query = query.filter(AuditLog.layer == layer)

    total = query.count()
    logs  = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "success": True,
        "data": {
            "total": total,
            "items": [
                {
                    "id":         log.id,
                    "project_id": log.project_id,
                    "layer":      log.layer,
                    "action":     log.action,
                    "actor":      log.actor,
                    "detail":     log.detail,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
        },
    }