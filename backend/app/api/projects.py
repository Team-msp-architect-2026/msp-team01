# backend/app/api/projects.py
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.user import User

router = APIRouter()


class CreateProjectRequest(BaseModel):
    name: str
    account_id: str
    region: str
    prefix: str          # 네이밍 규칙 {prefix}-{env}-{resource}의 prefix
    environment: str     # prod / staging / dev


@router.get("")
def list_projects(
    status: Optional[str] = Query(None, description="completed/deploying/failed"),
    environment: Optional[str] = Query(None, description="prod/staging/dev"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로젝트 목록을 반환한다. status, environment 필터 지원."""
    query = db.query(Project).filter(Project.user_id == current_user.user_id)

    if status:
        query = query.filter(Project.status == status)
    if environment:
        query = query.filter(Project.environment == environment)

    projects = query.order_by(Project.created_at.desc()).all()

    return {
        "success": True,
        "data": [_project_to_dict(p) for p in projects],
    }


@router.post("", status_code=201)
def create_project(
    request: CreateProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    새 프로젝트를 생성한다.
    prefix + environment 필드는 필수다. (ERD NOT NULL 제약)
    네이밍 규칙 미리보기: {prefix}-{env}-{resource} (예: DD-prod-vpc)
    """
    # environment 유효성 검사
    if request.environment not in ("prod", "staging", "dev"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "VALIDATION_ERROR", "message": "environment는 prod, staging, dev 중 하나여야 합니다."},
        )

    # 연동된 AWS 계정 소유 확인
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

    return {
        "success": True,
        "data": _project_to_dict(project),
    }

@router.get("/{project_id}")
def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """프로젝트 상세 정보를 반환한다. aws_resources, dr_package 정보 포함."""
    project = _get_project_or_404(project_id, current_user.user_id, db)

    # 최신 DR Package 조회
    from app.models.sync_history import DRPackage
    latest_package = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest == True,
    ).first()

    result = _project_to_dict(project)
    result["dr_package"] = {
        "status": latest_package.status if latest_package else None,
        "snapshot_status": latest_package.snapshot_status if latest_package else None,
        "rto_minutes": latest_package.rto_minutes if latest_package else None,
        "rpo_minutes": latest_package.rpo_minutes if latest_package else None,
    } if latest_package else None

    return {"success": True, "data": result}


class DeleteProjectRequest(BaseModel):
    destroy_aws_resources: bool = False


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    request: DeleteProjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    프로젝트를 삭제한다.
    destroy_aws_resources=True 시 terraform destroy 실행 (Epic 4에서 구현).
    현재는 DB 레코드만 삭제한다.
    """
    project = _get_project_or_404(project_id, current_user.user_id, db)

    if request.destroy_aws_resources:
        # Epic 4 CraftOps 실행엔진 구현 후 연동
        # 현재는 플래그만 확인하고 추후 terraform destroy job 실행
        pass

    db.delete(project)
    db.commit()

    return {"success": True, "message": "프로젝트가 삭제되었습니다."}


# ── 헬퍼 함수 ──────────────────────────────────────────────────────
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
        "project_id": project.project_id,
        "name": project.name,
        "prefix": project.prefix,
        "environment": project.environment,
        "region": project.region,
        "status": project.status,
        "dr_status": project.dr_status,
        "last_deployed_at": project.last_deployed_at.isoformat() if project.last_deployed_at else None,
        "last_synced_at": project.last_synced_at.isoformat() if project.last_synced_at else None,
        "created_at": project.created_at.isoformat(),
    }