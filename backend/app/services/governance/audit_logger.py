# backend/app/services/governance/audit_logger.py
import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.governance import AuditLog


def log_platform_action(
    db:         Session,
    action:     str,
    user_id:    str  = None,
    project_id: str  = None,
    detail:     dict = None,
):
    """
    레이어 1: AutoOps 플랫폼 행위 기록 (동기).

    사용 예:
        log_platform_action(db, "craftops_deploy", user_id=..., project_id=..., detail={...})
        log_platform_action(db, "drift_approve",   user_id=..., project_id=..., detail={...})
    """
    log = AuditLog(
        id         = str(uuid.uuid4()),
        project_id = project_id,
        user_id    = user_id,
        layer      = "platform",
        action     = action,
        actor      = user_id,
        detail     = detail or {},
        created_at = datetime.utcnow(),
    )
    db.add(log)


def log_aws_change(
    db:            Session,
    project_id:    str,
    actor_arn:     str,
    action:        str,
    resource_type: str,
    detail:        dict,
):
    """레이어 2: AWS 계정 변경 이력 (비동기 Worker에서 호출)"""
    log = AuditLog(
        id         = str(uuid.uuid4()),
        project_id = project_id,
        user_id    = None,
        layer      = "aws_change",
        action     = action,
        actor      = actor_arn,
        detail     = detail,
        created_at = datetime.utcnow(),
    )
    db.add(log)


def log_validation_block(
    db:         Session,
    project_id: str,
    tool:       str,
    rule_id:    str,
    resource:   str,
    message:    str,
):
    """레이어 3: Validation 차단 이력 (동기)"""
    log = AuditLog(
        id         = str(uuid.uuid4()),
        project_id = project_id,
        user_id    = None,
        layer      = "validation_block",
        action     = f"validation_blocked_{tool}",
        actor      = "system",
        detail     = {
            "tool":     tool,
            "rule_id":  rule_id,
            "resource": resource,
            "message":  message,
        },
        created_at = datetime.utcnow(),
    )
    db.add(log)