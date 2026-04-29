# backend/app/api/craft.py
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.project import Project
from app.models.deployment import Deployment
from app.services.craftops.gemini_client import GeminiClient
from app.services.craftops.dag_engine import DAGEngine, create_initial_deployment
from app.services.craftops.hcl_generator import HCLGenerator
from app.services.craftops.validator import ValidationLoop

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
    """
    자연어 프롬프트를 Gemini 2.5 Flash로 분석해
    인프라 파라미터와 Step 2 폼 자동 채우기 데이터를 반환한다.
    §7-5 응답 포맷 준수.
    """
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
    """
    Step 2의 각 서브단계 설정값을 deployments.config_snapshot에 누적 저장한다.
    §7-5 응답 포맷 준수.
    """
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
    """
    config_snapshot 기반으로 HCL 생성 + Validation Loop 4단계를 실행한다.
    §7-5 응답 포맷 준수.
    """
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

    # ① Self-Correction 3회 실패
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

    # ② CRITICAL 보안 이슈
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

    # 전체 통과
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