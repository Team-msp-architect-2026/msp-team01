# backend/app/api/craft.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db, SessionLocal
from app.models.user import User
from app.models.project import Project
from app.models.deployment import Deployment
from app.services.craftops.gemini_client import GeminiClient
from app.services.craftops.dag_engine import DAGEngine, create_initial_deployment
from app.services.craftops.hcl_generator import HCLGenerator
from app.services.craftops.validator import ValidationLoop
from app.services.craftops.runner import TerraformRunnerService, upload_hcl_to_s3
from app.models.aws_account import AWSAccount
from datetime import datetime
from app.services.craftops.runner import TerraformRunnerService, upload_hcl_to_s3, EventBridgePublisher

router = APIRouter()


# ── §4-1 Intent Analysis ────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    project_id: str
    prompt: str


@router.post("/analyze")
def analyze_intent(
    request: AnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == request.project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    gemini = GeminiClient()
    dag    = DAGEngine()

    try:
        analysis = gemini.analyze_intent(
            prompt=request.prompt,
            project_context={
                "name":        project.name,
                "prefix":      project.prefix,
                "environment": project.environment,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": f"AI 분석 중 오류: {str(e)}"},
        )

    if not analysis.get("resources"):
        analysis["resources"] = [
            "vpc", "subnet", "security_group", "alb", "ecs_fargate", "rds"
        ]

    analysis_id = f"ana_{str(uuid.uuid4())[:8]}"

    return {
        "success": True,
        "data": {
            "analysis_id": analysis_id,
            "resources": analysis.get("resources", []),
            "recommended_config": analysis.get("recommended_config", {}),
        },
    }


# ── §5-1 Guided Configuration ───────────────────────────────────────

class ConfigRequest(BaseModel):
    project_id: str
    step: str
    config: dict


@router.post("/config")
def save_config(
    request: ConfigRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == request.project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    dag = DAGEngine()

    deployment = db.query(Deployment).filter(
        Deployment.project_id == request.project_id,
        Deployment.status == "created",
    ).order_by(Deployment.started_at.desc()).first()

    if not deployment:
        if request.step != "2-1":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Step 2-1부터 시작해야 합니다.",
                },
            )
        deployment = create_initial_deployment(
            project_id=request.project_id,
            prefix=project.prefix,
            environment=project.environment,
            db=db,
        )

    snapshot        = deployment.config_snapshot or {}
    completed_steps = snapshot.get("completed_steps", [])

    if not dag.validate_step_prerequisites(request.step, completed_steps):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": (
                    f"선행 단계가 완료되지 않았습니다. "
                    f"완료된 단계: {completed_steps}"
                ),
            },
        )

    computed = dag.compute_context_aware_values(
        request.step,
        {**snapshot, **request.config},
    )

    step_key_map = {
        "2-1": "basic",
        "2-2": "network",
        "2-3": "security",
        "2-4": "web_tier",
        "2-5": "app_tier",
        "2-6": "data_tier",
    }

    snapshot_key = step_key_map.get(request.step)
    if snapshot_key:
        snapshot[snapshot_key] = {**request.config, **computed}

    if request.step == "2-1":
        snapshot["project_id"]  = request.project_id
        snapshot["prefix"]      = request.config.get("prefix", project.prefix)
        snapshot["environment"] = request.config.get("environment", project.environment)
        snapshot["region"]      = request.config.get("region", project.region)

    if request.step not in completed_steps:
        completed_steps.append(request.step)
    snapshot["completed_steps"] = completed_steps

    deployment.config_snapshot = snapshot
    flag_modified(deployment, "config_snapshot")
    db.commit()

    step_order  = ["2-1", "2-2", "2-3", "2-4", "2-5", "2-6"]
    current_idx = step_order.index(request.step) if request.step in step_order else -1
    next_step   = (
        step_order[current_idx + 1]
        if current_idx < len(step_order) - 1
        else None
    )

    naming_preview = []
    if request.step == "2-1":
        naming_preview = dag.generate_naming_preview(
            snapshot.get("prefix", project.prefix),
            snapshot.get("environment", project.environment),
        )

    return {
        "success": True,
        "data": {
            "deployment_id":   deployment.deployment_id,
            "step":            request.step,
            "saved":           True,
            "naming_preview":  naming_preview,
            "next_step":       next_step,
            "completed_steps": completed_steps,
            "computed_values": computed,
        },
    }


# ── §8-1 Validation Loop ────────────────────────────────────────────

class ValidateRequest(BaseModel):
    project_id: str


@router.post("/validate")
def validate(
    request: ValidateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == request.project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    deployment = db.query(Deployment).filter(
        Deployment.project_id == request.project_id,
        Deployment.status == "created",
    ).order_by(Deployment.started_at.desc()).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Step 2 설정을 먼저 완료해야 합니다.",
            },
        )

    completed_steps = deployment.config_snapshot.get("completed_steps", [])
    required_steps  = ["2-1", "2-2", "2-3", "2-4", "2-5", "2-6"]
    missing_steps   = [s for s in required_steps if s not in completed_steps]

    if missing_steps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": f"미완료 단계가 있습니다: {missing_steps}",
            },
        )

    generator = HCLGenerator()
    validator = ValidationLoop()
    work_dir  = None

    try:
        hcl_code, work_dir = generator.generate(deployment.config_snapshot)
        result = validator.run(hcl_code, work_dir)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "INTERNAL_ERROR",
                "message": f"Validation 중 오류: {str(e)}",
            },
        )
    finally:
        if work_dir:
            generator.cleanup(work_dir)

    if result.validate_manual_edit_required:
        vr_data = {
            "validate": {
                "passed": False,
                "correction_attempts": result.validate_correction_attempts,
                "manual_edit_required": True,
            }
        }
        deployment.validation_result = vr_data
        flag_modified(deployment, "validation_result")
        db.commit()

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TERRAFORM_ERROR",
                "message": "자동 수정에 실패했습니다.",
                "details": {
                    "error_location": result.validate_error[:500],
                    "manual_edit_required": True,
                },
            },
        )

    if not result.security_passed:
        critical_issues = [
            i for i in result.security_issues
            if i.get("severity", "").upper() == "CRITICAL"
        ]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "TERRAFORM_ERROR",
                "message": (
                    f"보안 취약점이 발견되어 배포가 차단됩니다. "
                    f"(CRITICAL {result.security_critical_count}건)"
                ),
                "details": {
                    "critical_issues": critical_issues,
                    "fixed_code":      result.security_fixed_hcl,
                },
            },
        )

    validation_id = f"val_{str(uuid.uuid4())[:8]}"

    vr_data = {
        "validation_id": validation_id,
        "validate": {
            "passed":              True,
            "correction_attempts": result.validate_correction_attempts,
        },
        "security_scan": {
            "passed":   True,
            "critical": result.security_critical_count,
            "high":     result.security_high_count,
            "medium":   result.security_medium_count,
            "issues":   [
                i for i in result.security_issues
                if i.get("severity", "").upper() == "MEDIUM"
            ],
        },
        "cost_estimation": {
            "monthly_total": result.cost_monthly_total,
            "breakdown":     result.cost_breakdown,
        },
        "plan": {
            "add":     result.plan_add,
            "change":  result.plan_change,
            "destroy": result.plan_destroy,
        },
    }

    deployment.terraform_code    = result.final_hcl_code
    deployment.validation_result = vr_data
    flag_modified(deployment, "validation_result")
    db.commit()

    return {
        "success": True,
        "data": {
            "validation_id":      validation_id,
            "deployment_id":      deployment.deployment_id,
            "terraform_code":     result.final_hcl_code,
            "validation_results": {
                "validate":        vr_data["validate"],
                "security_scan":   vr_data["security_scan"],
                "cost_estimation": vr_data["cost_estimation"],
                "plan":            vr_data["plan"],
            },
        },
    }


# ── §5 Deploy ───────────────────────────────────────────────────────

class DeployRequest(BaseModel):
    project_id: str
    validation_id: str


@router.post("/deploy", status_code=202)
def deploy(
    request: DeployRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == request.project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    deployment = db.query(Deployment).filter(
        Deployment.project_id == request.project_id,
        Deployment.status == "created",
    ).order_by(Deployment.started_at.desc()).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "배포 대상 deployment를 찾을 수 없습니다."},
        )

    saved_validation_id = (
        deployment.validation_result or {}
    ).get("validation_id", "")

    if saved_validation_id != request.validation_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "validation_id가 일치하지 않습니다. Validation Loop를 먼저 실행하세요.",
            },
        )

    if not deployment.terraform_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Terraform 코드가 없습니다. /api/craft/validate를 먼저 실행하세요.",
            },
        )

    deploying = db.query(Deployment).filter(
        Deployment.project_id == request.project_id,
        Deployment.status == "deploying",
    ).first()

    if deploying:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "LOCK_CONFLICT",
                "message": "이미 배포가 진행 중입니다. 완료 후 다시 시도하세요.",
            },
        )

    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == project.account_id,
    ).first()

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "연동된 AWS 계정을 찾을 수 없습니다."},
        )

    # HCL S3 업로드 (로컬 모드 스킵)
    if settings.skip_ecs_task:
        hcl_s3_path = f"s3://autoops-terraform-state/projects/{request.project_id}/source/main.tf"
    else:
        try:
            hcl_s3_path = upload_hcl_to_s3(
                project_id=request.project_id,
                deployment_id=deployment.deployment_id,
                hcl_code=deployment.terraform_code,
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "INTERNAL_ERROR", "message": f"HCL S3 업로드 실패: {str(e)}"},
            )

    deployment.status = "deploying"
    db.commit()

    # Ephemeral ECS Task 생성 (로컬 모드 스킵)
    runner = TerraformRunnerService()
    try:
        if settings.skip_ecs_task:
            task_arn = f"local-test-task-{deployment.deployment_id}"
        else:
            task_arn = runner.spawn_apply_task(
                project_id=request.project_id,
                deployment_id=deployment.deployment_id,
                hcl_s3_path=hcl_s3_path,
                role_arn=account.role_arn,
                region=project.region,
                subnet_ids=settings.platform_subnet_ids.split(","),
                security_group_ids=settings.platform_sg_ids.split(","),
            )
    except Exception as e:
        deployment.status = "failed"
        deployment.error_message = str(e)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": f"ECS Task 생성 실패: {str(e)}"},
        )

    deployment.ecs_task_id = task_arn.split("/")[-1]
    db.commit()

    return {
        "success": True,
        "data": {
            "deployment_id": deployment.deployment_id,
            "status": "deploying",
            "websocket_url": f"wss://api.autoops.io/ws/events/{request.project_id}",
        },
    }


# ── §6-2 내부 콜백 (Terraform Runner 완료 알림) ─────────────────────

class DeployCompleteCallback(BaseModel):
    status: str
    project_id: str
    completed_resources: int = 0
    error_message: str = ""


@router.post("/internal/deployments/{deployment_id}/complete")
def deployment_complete_callback(
    deployment_id: str,
    body: DeployCompleteCallback,
    x_internal_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    if x_internal_secret != settings.internal_secret:
        raise HTTPException(status_code=403, detail="Forbidden")

    deployment = db.query(Deployment).filter(
        Deployment.deployment_id == deployment_id
    ).first()

    if not deployment:
        raise HTTPException(status_code=404, detail="Not found")

    deployment.status       = body.status
    deployment.completed_at = datetime.utcnow()

    if body.error_message:
        deployment.error_message = body.error_message
    if body.completed_resources:
        deployment.completed_resources = body.completed_resources

    project = db.query(Project).filter(
        Project.project_id == body.project_id
    ).first()

    if body.status == "completed" and project:
        project.status           = "completed"
        project.last_deployed_at = datetime.utcnow()
        db.commit()

        # §7-8 EventBridge 발행
        account = db.query(AWSAccount).filter(
            AWSAccount.account_id == project.account_id
        ).first()

        resources = {
            "vpc_id":             "",
            "subnet_ids":         [],
            "ecs_cluster":        f"{project.prefix}-{project.environment}-ecs-cluster",
            "rds_identifier":     f"{project.prefix}-{project.environment}-rds",
            "alb_arn":            "",
            "security_group_ids": {"alb": "", "app": "", "db": ""},
        }

        if not settings.skip_ecs_task:
            publisher = EventBridgePublisher()
            try:
                publisher.publish_deployment_completed(
                    project_id=body.project_id,
                    deployment_id=deployment_id,
                    user_id=project.user_id,
                    account_id=project.account_id,
                    aws_account_id=account.aws_account_id if account else "",
                    role_arn=account.role_arn if account else "",
                    region=project.region,
                    prefix=project.prefix,
                    environment=project.environment,
                    resources=resources,
                )
            except Exception:
                pass
    else:
        db.commit()

    return {"success": True}


# ── §8 Partial Failure 대응 ─────────────────────────────────────────

class ActionRequest(BaseModel):
    action: str
    fix_params: dict = {}


@router.post("/{project_id}/deployments/{deployment_id}/action", status_code=202)
def deployment_action(
    project_id: str,
    deployment_id: str,
    body: ActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    deployment = db.query(Deployment).filter(
        Deployment.deployment_id == deployment_id,
        Deployment.project_id == project_id,
    ).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "배포 이력을 찾을 수 없습니다."},
        )

    if deployment.status != "partial_failed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "partial_failed 상태의 배포에만 액션을 실행할 수 있습니다.",
            },
        )

    account = db.query(AWSAccount).filter(
        AWSAccount.account_id == project.account_id,
    ).first()

    runner = TerraformRunnerService()

    if body.action == "resume":
        deployment.status      = "deploying"
        deployment.error_message = None
        db.commit()

        if not settings.skip_ecs_task:
            hcl_s3_path = f"s3://autoops-terraform-state/projects/{project_id}/source/main.tf"
            runner.spawn_apply_task(
                project_id=project_id,
                deployment_id=deployment_id,
                hcl_s3_path=hcl_s3_path,
                role_arn=account.role_arn,
                region=project.region,
                subnet_ids=settings.platform_subnet_ids.split(","),
                security_group_ids=settings.platform_sg_ids.split(","),
            )

    elif body.action == "fix_retry":
        if body.fix_params:
            snapshot = deployment.config_snapshot or {}
            for k, v in body.fix_params.items():
                snapshot[k] = v
            deployment.config_snapshot = snapshot
            flag_modified(deployment, "config_snapshot")

        deployment.status        = "deploying"
        deployment.error_message = None
        db.commit()

        if not settings.skip_ecs_task:
            hcl_s3_path = f"s3://autoops-terraform-state/projects/{project_id}/source/main.tf"
            runner.spawn_apply_task(
                project_id=project_id,
                deployment_id=deployment_id,
                hcl_s3_path=hcl_s3_path,
                role_arn=account.role_arn,
                region=project.region,
                subnet_ids=settings.platform_subnet_ids.split(","),
                security_group_ids=settings.platform_sg_ids.split(","),
            )

    elif body.action == "full_destroy":
        deployment.status = "deploying"
        db.commit()

        if not settings.skip_ecs_task:
            runner.spawn_destroy_task(
                project_id=project_id,
                deployment_id=deployment_id,
                role_arn=account.role_arn,
                region=project.region,
                subnet_ids=settings.platform_subnet_ids.split(","),
                security_group_ids=settings.platform_sg_ids.split(","),
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "유효하지 않은 action입니다. resume / fix_retry / full_destroy 중 선택하세요.",
            },
        )

    return {
        "success": True,
        "data": {
            "deployment_id": deployment_id,
            "action":        body.action,
            "status":        "deploying",
            "websocket_url": f"wss://api.autoops.io/ws/events/{project_id}",
        },
    }


# ── §9 배포 이력 조회 ───────────────────────────────────────────────

@router.get("/{project_id}/deployments")
def list_deployments(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    deployments = db.query(Deployment).filter(
        Deployment.project_id == project_id,
    ).order_by(Deployment.started_at.desc()).all()

    return {
        "success": True,
        "data": [_deployment_to_dict(d) for d in deployments],
    }


@router.get("/{project_id}/deployments/{deployment_id}")
def get_deployment(
    project_id: str,
    deployment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == current_user.user_id,
    ).first()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    deployment = db.query(Deployment).filter(
        Deployment.deployment_id == deployment_id,
        Deployment.project_id == project_id,
    ).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "배포 이력을 찾을 수 없습니다."},
        )

    from app.models.deployment import DeploymentResource
    resources = db.query(DeploymentResource).filter(
        DeploymentResource.deployment_id == deployment_id,
    ).all()

    result = _deployment_to_dict(deployment)
    result["resources"] = [
        {
            "resource_type": r.resource_type,
            "resource_name": r.resource_name,
            "resource_arn":  r.resource_arn,
            "status":        r.status,
            "created_at":    r.created_at.isoformat(),
        }
        for r in resources
    ]

    return {"success": True, "data": result}


def _deployment_to_dict(deployment: Deployment) -> dict:
    return {
        "deployment_id":       deployment.deployment_id,
        "project_id":          deployment.project_id,
        "prefix":              deployment.prefix,
        "environment":         deployment.environment,
        "status":              deployment.status,
        "completed_resources": deployment.completed_resources,
        "total_resources":     deployment.total_resources,
        "error_message":       deployment.error_message,
        "started_at":          deployment.started_at.isoformat(),
        "completed_at":        deployment.completed_at.isoformat() if deployment.completed_at else None,
    }