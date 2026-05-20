# backend/app/api/projects.py
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.user import User

router = APIRouter()


class CreateProjectRequest(BaseModel):
    name: str
    account_id: str
    region: str
    prefix: str
    environment: str


@router.get("")
def list_projects(
    status: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Project).filter(Project.user_id == current_user.user_id)
    if status:
        query = query.filter(Project.status == status)
    if environment:
        query = query.filter(Project.environment == environment)
    projects = query.order_by(Project.created_at.desc()).all()
    return {"success": True, "data": [_project_to_dict(p) for p in projects]}


@router.post("", status_code=201)
def create_project(
    request: CreateProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if request.environment not in ("prod", "staging", "dev"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "VALIDATION_ERROR", "message": "environment는 prod, staging, dev 중 하나여야 합니다."},
        )

    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == request.account_id,
        AWSAccount.user_id == current_user.user_id,
        AWSAccount.status == "connected",
    ).first()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "연동된 AWS 계정을 찾을 수 없습니다."},
        )

    project = Project(
        user_id=current_user.user_id,
        account_id=request.account_id,
        name=request.name,
        prefix=request.prefix,
        environment=request.environment,
        region=request.region,
        status="created",
        dr_status="not_ready",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"success": True, "data": _project_to_dict(project)}


@router.get("/{project_id}")
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, current_user.user_id, db)

    from app.models.sync_history import DRPackage
    latest_package = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest == True,
    ).first()

    result = _project_to_dict(project)
    result["dr_package"] = {
        "status":          latest_package.status          if latest_package else None,
        "snapshot_status": latest_package.snapshot_status if latest_package else None,
        "rto_minutes":     latest_package.rto_minutes     if latest_package else None,
        "rpo_minutes":     latest_package.rpo_minutes     if latest_package else None,
    } if latest_package else None

    return {"success": True, "data": result}


class DeleteProjectRequest(BaseModel):
    destroy_aws_resources: bool = False


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    request: DeleteProjectRequest = Body(default=DeleteProjectRequest()),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    # terraform destroy는 fire-and-forget — 콜백 기다리지 않음
    if request.destroy_aws_resources and project.status in (
        "completed", "partial_failed", "failed", "destroy_failed"
    ):
        from app.models.deployment import Deployment
        from app.services.craftops.runner import TerraformRunnerService

        latest_deployment = (
            db.query(Deployment)
            .filter(Deployment.project_id == project_id)
            .order_by(Deployment.started_at.desc())
            .first()
        )

        if latest_deployment:
            account = db.query(AWSAccount).filter(
                AWSAccount.account_id == project.account_id,
            ).first()

            if not account:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "AWS 계정 정보를 찾을 수 없습니다."},
                )

            runner = TerraformRunnerService()
            try:
                runner.spawn_destroy_task(
                    project_id=project_id,
                    deployment_id=latest_deployment.deployment_id,
                    role_arn=account.role_arn,
                    region=project.region,
                    user_id=project.user_id,
                    subnet_ids=settings.platform_subnet_ids.split(","),
                    security_group_ids=settings.platform_sg_ids.split(","),
                )
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={"code": "SPAWN_FAILED", "message": f"AWS 리소스 삭제 Task 실행에 실패했습니다: {str(e)}"},
                )

    # destroy_aws_resources 여부와 관계없이 DB + S3 즉시 삭제
    _delete_project_records(project_id, project, db)

    return {"success": True, "message": "프로젝트가 삭제됐습니다."}


def _delete_project_records(project_id: str, project: Project, db: Session) -> None:
    """프로젝트 관련 DB 레코드 전체 삭제 + S3 DR Package 클린업"""
    import boto3 as _boto3
    from app.models.deployment import Deployment, DeploymentResource
    from app.models.aws_resource import AWSResource
    from app.models.gcp_mapping import GCPMapping
    from app.models.sync_history import SyncHistory, DRPackage
    from app.models.failover_history import FailoverHistory

    # failover_history 먼저 (NOT NULL FK)
    db.query(FailoverHistory).filter(
        FailoverHistory.project_id == project_id
    ).delete(synchronize_session=False)

    # GCPMapping을 project_id로 직접 삭제
    db.query(GCPMapping).filter(
        GCPMapping.project_id == project_id
    ).delete(synchronize_session=False)

    db.query(AWSResource).filter(
        AWSResource.project_id == project_id
    ).delete(synchronize_session=False)

    # DeploymentResource → Deployment
    deployments = db.query(Deployment).filter(
        Deployment.project_id == project_id
    ).all()
    for d in deployments:
        db.query(DeploymentResource).filter(
            DeploymentResource.deployment_id == d.deployment_id
        ).delete(synchronize_session=False)
    db.query(Deployment).filter(
        Deployment.project_id == project_id
    ).delete(synchronize_session=False)

    db.query(DRPackage).filter(
        DRPackage.project_id == project_id
    ).delete(synchronize_session=False)
    db.query(SyncHistory).filter(
        SyncHistory.project_id == project_id
    ).delete(synchronize_session=False)

    db.delete(project)
    db.commit()

    # [수정] S3 DR Package 클린업 — Versioning 활성화 버킷 대응
    try:
        s3        = _boto3.client("s3", region_name="us-west-2")
        prefix    = f"projects/{project_id}/"
        s3_bucket = "autoops-dr-packages"

        paginator = s3.get_paginator("list_object_versions")
        for page in paginator.paginate(Bucket=s3_bucket, Prefix=prefix):
            objects = []
            for v in page.get("Versions", []):
                objects.append({"Key": v["Key"], "VersionId": v["VersionId"]})
            for m in page.get("DeleteMarkers", []):
                objects.append({"Key": m["Key"], "VersionId": m["VersionId"]})
            if objects:
                s3.delete_objects(
                    Bucket=s3_bucket,
                    Delete={"Objects": objects},
                )
        print(f"[Delete] S3 DR Package 클린업 완료: {prefix}")
    except Exception as e:
        print(f"[Delete] S3 클린업 실패 (무시): {e}")


# ── 헬퍼 ──────────────────────────────────────────────────────────
def _get_project_or_404(project_id: str, user_id: str, db: Session) -> Project:
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == user_id,
    ).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )
    return project


def _project_to_dict(project: Project) -> dict:
    return {
        "project_id":       project.project_id,
        "name":             project.name,
        "prefix":           project.prefix,
        "environment":      project.environment,
        "region":           project.region,
        "status":           project.status,
        "dr_status":        project.dr_status,
        "last_deployed_at": project.last_deployed_at.isoformat() if project.last_deployed_at else None,
        "last_synced_at":   project.last_synced_at.isoformat()   if project.last_synced_at   else None,
        "created_at":       project.created_at.isoformat(),
    }