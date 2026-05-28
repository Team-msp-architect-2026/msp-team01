# backend/app/api/drift.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.governance import DriftEvent, AuditLog
import uuid
from datetime import datetime

router = APIRouter(tags=["drift"])


@router.get("/api/projects/{project_id}/drift")
def list_drift_events(
    project_id: str,
    severity: str = None,   # 필터: CRITICAL / HIGH / MEDIUM / LOW
    status: str   = None,   # 필터: detected / accepted / guided
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로젝트 Drift 이벤트 목록 조회"""
    _get_project_or_404(project_id, current_user.user_id, db)

    query = db.query(DriftEvent).filter(DriftEvent.project_id == project_id)
    if severity: query = query.filter(DriftEvent.severity == severity)
    if status:   query = query.filter(DriftEvent.status == status)

    events = query.order_by(DriftEvent.detected_at.desc()).limit(100).all()

    return {
        "success": True,
        "data": [
            {
                "drift_id":      e.id,
                "resource_id":   e.resource_id_aws,
                "resource_type": e.resource_type,
                "changed_by":    e.changed_by,
                "diff_summary":  e.diff_summary,
                "severity":      e.severity,
                "status":        e.status,
                "detected_at":   e.detected_at.isoformat() if e.detected_at else None,
            }
            for e in events
        ],
    }


@router.post("/api/drift/{drift_id}/approve")
def approve_drift(
    drift_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Drift 변경 승인 — 변경 유지, 감사 로그 기록"""
    event = db.query(DriftEvent).filter(DriftEvent.id == drift_id).first()
    if not event:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

    event.status      = "accepted"
    event.resolved_at = datetime.utcnow()

    # Audit Log 기록
    log = AuditLog(
        id         = str(uuid.uuid4()),
        project_id = event.project_id,
        user_id    = current_user.user_id,
        layer      = "platform",
        action     = "drift_approve",
        actor      = current_user.user_id,
        detail     = {"drift_id": drift_id, "resource_id": event.resource_id_aws},
    )
    db.add(log)
    db.commit()

    return {"success": True, "data": {"drift_id": drift_id, "status": "accepted"}}


@router.post("/api/drift/{drift_id}/reject")
def reject_drift(
    drift_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Drift 변경 거부.
    CraftOps/온보딩 모두 자동 롤백 없음 → Slack remediation 가이드 발송 후 guided 상태.
    """
    event = db.query(DriftEvent).filter(DriftEvent.id == drift_id).first()
    if not event:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

    event.status      = "guided"
    event.resolved_at = datetime.utcnow()

    # Audit Log 기록
    log = AuditLog(
        id         = str(uuid.uuid4()),
        project_id = event.project_id,
        user_id    = current_user.user_id,
        layer      = "platform",
        action     = "drift_reject",
        actor      = current_user.user_id,
        detail     = {"drift_id": drift_id, "resource_id": event.resource_id_aws},
    )
    db.add(log)
    db.commit()

    return {"success": True, "data": {"drift_id": drift_id, "status": "guided"}}


def _get_project_or_404(project_id: str, user_id: str, db: Session) -> Project:
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == user_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
    return project