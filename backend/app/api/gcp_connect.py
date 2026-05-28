# backend/app/api/gcp_connect.py

import boto3
import json
import os
import subprocess
import tempfile
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.project import Project
from app.models.user import User

router = APIRouter()


class GCPConnectRequest(BaseModel):
    gcp_project_id: str
    service_account_key: dict


@router.post("/{project_id}/gcp/connect")
def connect_gcp(
    project_id: str,
    body: GCPConnectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    GCP 서비스 계정 JSON 키를 업로드하여 AutoOps에 연동한다.

    흐름:
    1. 서비스 계정 JSON 키 유효성 검증 (실제 GCP API 호출)
    2. Artifact Registry autoops-repo 자동 생성 (없으면 생성, 있으면 스킵)
    3. AWS Secrets Manager 저장
    4. projects 테이블 업데이트
    """
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == current_user.user_id,
    ).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    key_dict = body.service_account_key

    # ① 키 유효성 검증
    sa_email = _validate_gcp_credentials(key_dict, body.gcp_project_id)

    # ② Artifact Registry 자동 생성
    _ensure_artifact_registry(key_dict, body.gcp_project_id)

    # ③ Secrets Manager 저장
    secret_arn = _store_gcp_secret(project_id, key_dict)

    # ④ DB 업데이트
    project.gcp_project_id   = body.gcp_project_id
    project.gcp_secret_arn   = secret_arn
    project.gcp_sa_email     = sa_email
    project.gcp_connected_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "data": {
            "gcp_project_id": body.gcp_project_id,
            "sa_email":       sa_email,
            "connected_at":   project.gcp_connected_at.isoformat(),
        },
    }


@router.get("/{project_id}/gcp/status")
def get_gcp_status(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """GCP 연동 상태를 반환한다."""
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == current_user.user_id,
    ).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    return {
        "success": True,
        "data": {
            "is_connected":   bool(project.gcp_connected_at),
            "gcp_project_id": project.gcp_project_id,
            "sa_email":       project.gcp_sa_email,
            "connected_at":   (
                project.gcp_connected_at.isoformat()
                if project.gcp_connected_at else None
            ),
        },
    }


@router.delete("/{project_id}/gcp/disconnect")
def disconnect_gcp(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """GCP 연동을 해제한다. Secrets Manager 시크릿도 삭제한다."""
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == current_user.user_id,
    ).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )

    # Secrets Manager 시크릿 삭제
    if project.gcp_secret_arn:
        try:
            sm = boto3.client("secretsmanager", region_name="us-west-2")
            sm.delete_secret(
                SecretId=project.gcp_secret_arn,
                ForceDeleteWithoutRecovery=True,
            )
        except Exception as e:
            print(f"[GCP Disconnect] Secrets Manager 삭제 실패 (무시):{e}")

    # DB 초기화
    project.gcp_project_id   = None
    project.gcp_secret_arn   = None
    project.gcp_sa_email     = None
    project.gcp_connected_at = None
    db.commit()

    return {"success": True, "message": "GCP 연동이 해제되었습니다."}


# ── 내부 함수 ────────────────────────────────────────────────────────

def _validate_gcp_credentials(key_dict: dict, gcp_project_id: str) -> str:
    """
    서비스 계정 JSON 키로 gcloud auth를 실행하여 유효성을 검증한다.
    성공 시 서비스 계정 이메일을 반환한다.
    """
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(key_dict, f)
        key_path = f.name

    try:
        # gcloud auth 실행
        result = subprocess.run(
            [
                "gcloud", "auth", "activate-service-account",
                "--key-file", key_path,
                "--project", gcp_project_id,
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code":    "GCP_AUTH_ERROR",
                    "message": f"GCP 인증 실패:{result.stderr.strip()}",
                },
            )

        # 프로젝트 접근 권한 확인
        check = subprocess.run(
            ["gcloud", "projects", "describe", gcp_project_id],
            capture_output=True, text=True, timeout=30,
        )
        if check.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code":    "GCP_AUTH_ERROR",
                    "message": "GCP 프로젝트 접근 권한 없음. 서비스 계정 권한을 확인하세요.",
                },
            )

        return key_dict.get("client_email", "")

    finally:
        os.unlink(key_path)


def _ensure_artifact_registry(key_dict: dict, gcp_project_id: str) -> None:
    """
    autoops-repo Artifact Registry가 없으면 자동 생성한다.
    이미 있으면 스킵한다.
    """
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        json.dump(key_dict, f)
        key_path = f.name

    try:
        subprocess.run(
            [
                "gcloud", "auth", "activate-service-account",
                "--key-file", key_path,
                "--project", gcp_project_id,
            ],
            check=True, capture_output=True,
        )

        # 존재 여부 확인
        check = subprocess.run(
            [
                "gcloud", "artifacts", "repositories", "describe", "autoops-repo",
                "--location=us-west1",
                f"--project={gcp_project_id}",
            ],
            capture_output=True, text=True,
        )

        if check.returncode != 0:
            # 없으면 생성
            subprocess.run(
                [
                    "gcloud", "artifacts", "repositories", "create", "autoops-repo",
                    "--repository-format=docker",
                    "--location=us-west1",
                    f"--project={gcp_project_id}",
                    "--description=AutoOps DR container registry",
                ],
                check=True, capture_output=True,
            )
            print(f"[GCP Connect] Artifact Registry 생성 완료:{gcp_project_id}")
        else:
            print(f"[GCP Connect] Artifact Registry 이미 존재:{gcp_project_id}")

    finally:
        os.unlink(key_path)


def _store_gcp_secret(project_id: str, key_dict: dict) -> str:
    """
    AWS Secrets Manager에 프로젝트별 GCP SA 키를 저장한다.
    이미 존재하면 값을 업데이트하고, 없으면 새로 생성한다.
    반환: 시크릿 ARN
    """
    sm          = boto3.client("secretsmanager", region_name="us-west-2")
    secret_name = f"autoops/gcp/{project_id}/service-account"

    try:
        resp = sm.put_secret_value(
            SecretId     = secret_name,
            SecretString = json.dumps(key_dict),
        )
        return resp["ARN"]
    except sm.exceptions.ResourceNotFoundException:
        resp = sm.create_secret(
            Name         = secret_name,
            SecretString = json.dumps(key_dict),
            Tags         = [{"Key": "autoops", "Value": "gcp-sa"}],
        )
        return resp["ARN"]