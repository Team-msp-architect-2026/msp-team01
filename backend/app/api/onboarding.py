# backend/app/api/onboarding.py
import uuid
import json
import threading
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.governance import OnboardingScan, ResourceBaseline
from app.services.governance.audit_logger import log_platform_action

router = APIRouter(prefix="/api/accounts", tags=["onboarding"])


@router.post("/{account_id}/onboard")
def start_onboard(
    account_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == account_id,
        AWSAccount.user_id    == current_user.user_id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "계정을 찾을 수 없습니다."})

    project = Project(
        project_id  = str(uuid.uuid4()),
        user_id     = current_user.user_id,
        account_id  = account_id,
        name        = f"onboarding-{account.aws_account_id}",
        prefix      = "onboard",
        environment = "existing",
        region      = "us-west-2",
        status      = "created",
        dr_status   = "not_ready",
        source      = "onboarding",
    )
    db.add(project)

    scan = OnboardingScan(
        id         = str(uuid.uuid4()),
        project_id = project.project_id,
        account_id = account.aws_account_id,
        status     = "scanning",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    background_tasks.add_task(
        _run_scan,
        scan_id     = scan.id,
        role_arn    = account.role_arn,
        external_id = current_user.user_id,
    )

    return {
        "success": True,
        "data": {
            "scan_id":    scan.id,
            "project_id": project.project_id,
            "status":     "scanning",
        },
    }


def _run_scan(scan_id: str, role_arn: str, external_id: str):
    """백그라운드 스캔 실행"""
    from app.core.database import SessionLocal
    from app.services.mirrorops.detector import ResourceDetector

    db = SessionLocal()
    try:
        scan = db.query(OnboardingScan).filter(OnboardingScan.id == scan_id).first()
        if not scan:
            return

        detector    = ResourceDetector(role_arn=role_arn, region="us-west-2", external_id=external_id)
        scan_result = detector.scan_all(role_arn=role_arn, external_id=external_id)

        total = sum(len(g["resources"]) for g in scan_result.values())

        scan.scan_result     = scan_result
        scan.total_resources = total
        scan.scanned_regions = list({g["region"] for g in scan_result.values()})
        scan.status          = "pending_confirm"
        db.commit()

    except Exception as e:
        scan.status = "failed"
        db.commit()
        print(f"[Onboarding] 스캔 실패:{e}")
    finally:
        db.close()


@router.get("/{account_id}/onboard/status")
def get_onboard_status(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == account_id,
        AWSAccount.user_id    == current_user.user_id,
    ).first()
    if not account:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "계정을 찾을 수 없습니다."})

    project = db.query(Project).filter(
        Project.account_id == account_id,
        Project.source     == "onboarding",
    ).order_by(Project.created_at.desc()).first()

    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "진행 중인 온보딩이 없습니다."})

    scan = db.query(OnboardingScan).filter(
        OnboardingScan.project_id == project.project_id
    ).first()

    return {
        "success": True,
        "data": {
            "scan_id":         scan.id,
            "project_id":      project.project_id,
            "status":          scan.status,
            "total_resources": scan.total_resources,
            "scan_result":     scan.scan_result,
        },
    }


@router.post("/{account_id}/onboard/confirm")
def confirm_onboard(
    account_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scan = db.query(OnboardingScan).filter(
        OnboardingScan.id == body.get("scan_id")
    ).first()
    if not scan or scan.status != "pending_confirm":
        raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST", "message": "확정 가능한 스캔이 없습니다."})

    account = db.query(AWSAccount).filter(AWSAccount.account_id == account_id).first()
    groups  = body.get("groups", scan.scan_result)

    # 리전별로 리소스 묶기
    region_resources: dict[str, list] = {}
    for group_data in groups.values():
        region = group_data.get("region")
        if not region:
            continue
        region_resources.setdefault(region, []).extend(group_data.get("resources", []))

    created_projects = []
    total_baselines  = 0

    for region, resources in region_resources.items():
        if not resources:
            continue

        new_project = Project(
            project_id  = str(uuid.uuid4()),
            user_id     = current_user.user_id,
            account_id  = account_id,
            name        = f"onboard-{account.aws_account_id}-{region}",
            prefix      = "onboard",
            environment = "existing",
            region      = region,
            status      = "completed",
            dr_status   = "not_ready",
            source      = "onboarding",
        )
        db.add(new_project)
        db.flush()  # project_id 확보

        # 모니터링 게이트용 OnboardingScan
        new_scan = OnboardingScan(
            id              = str(uuid.uuid4()),
            project_id      = new_project.project_id,
            account_id      = account.aws_account_id,
            status          = "completed",
            confirmed_at    = datetime.utcnow(),
            total_resources = len(resources),
            scanned_regions = [region],
        )
        db.add(new_scan)

        for resource in resources:
            baseline = ResourceBaseline(
                id              = str(uuid.uuid4()),
                project_id      = new_project.project_id,
                source          = "onboarding",
                resource_type   = resource["resource_type"],
                resource_id_aws = resource["resource_id"],
                baseline_config = resource,
            )
            db.add(baseline)
            total_baselines += 1

        created_projects.append({
            "project_id":     new_project.project_id,
            "region":         region,
            "resource_count": len(resources),
        })

    # 원본 임시 scan → project 순으로 삭제 (FK 순서)
    original_project_id = scan.project_id
    db.delete(scan)
    db.flush()
    temp_project = db.query(Project).filter(Project.project_id == original_project_id).first()
    if temp_project:
        db.delete(temp_project)

    db.commit()

    log_platform_action(
        db         = db,
        action     = "onboarding_complete",
        user_id    = current_user.user_id,
        project_id = created_projects[0]["project_id"] if created_projects else original_project_id,
        detail     = {
            "baselines_created": total_baselines,
            "regions":           [p["region"] for p in created_projects],
        },
    )
    db.commit()

    return {
        "success": True,
        "data": {
            "projects":          created_projects,
            "baselines_created": total_baselines,
            "status":            "completed",
        },
    }

# ── CI/CD 트리거 ─────────────────────────────────────────────────────