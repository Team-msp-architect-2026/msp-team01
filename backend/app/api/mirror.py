from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.core.auth import get_current_user
from app.core.database import get_db, SessionLocal
from app.models.user import User
from app.models.project import Project
from app.models.aws_resource import AWSResource
from app.models.gcp_mapping import GCPMapping
from app.models.sync_history import SyncHistory, DRPackage
import asyncio
import boto3
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

router = APIRouter()


# ── GET /api/mirror/{project_id}/status ────────────────────────────

@router.get("/{project_id}/status")
def get_dr_status(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, current_user.user_id, db)

    latest_sync = db.query(SyncHistory).filter(
        SyncHistory.project_id == project_id
    ).order_by(SyncHistory.started_at.desc()).first()

    latest_package = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest  == True,
    ).first()

    return {
        "success": True,
        "data": {
            "dr_status":      project.dr_status,
            "last_synced_at": (
                project.last_synced_at.isoformat()
                if project.last_synced_at else None
            ),
            "sync_trigger": (
                latest_sync.trigger_type if latest_sync else None
            ),
            "aws_resource_count": db.query(AWSResource).filter(
                AWSResource.project_id == project_id
            ).count(),
            "gcp_resource_count": db.query(GCPMapping).filter(
                GCPMapping.project_id == project_id,
                GCPMapping.confidence.in_(['auto', 'review']),
            ).count(),
            "dr_package": {
                "status":          latest_package.status          if latest_package else None,
                "snapshot_status": latest_package.snapshot_status if latest_package else None,
                "rto_minutes":     latest_package.rto_minutes     if latest_package else None,
                "rpo_minutes":     latest_package.rpo_minutes     if latest_package else None,
            } if latest_package else None,
        },
    }


# ── GET /api/mirror/{project_id}/resources ─────────────────────────

@router.get("/{project_id}/resources")
def get_resources(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    aws_resources = db.query(AWSResource).filter(
        AWSResource.project_id == project_id
    ).all()

    result = []
    for res in aws_resources:
        mapping = db.query(GCPMapping).filter(
            GCPMapping.resource_id == res.resource_id
        ).order_by(GCPMapping.created_at.desc()).first()

        result.append({
            "resource_id":       res.resource_id,
            "aws_resource_type": res.resource_type,
            "aws_resource_name": res.resource_name,
            "aws_resource_id":   res.resource_id_aws,
            "gcp_resource_type": mapping.gcp_resource_type if mapping else None,
            "gcp_resource_name": mapping.gcp_resource_name if mapping else None,
            "confidence":        mapping.confidence        if mapping else "manual",
            "review_reason":     mapping.review_reason     if mapping else None,
            "user_confirmed":    mapping.user_confirmed    if mapping else False,
            "terraform_code":    mapping.terraform_code    if mapping else None,
        })

    return {"success": True, "data": result}


# ── POST /api/mirror/{project_id}/sync ─────────────────────────────
@router.post("/{project_id}/sync", status_code=202)
def manual_sync(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, current_user.user_id, db)
    
    # 인프라 배포 완료 상태가 아니면 동기화 차단
    if project.status != "completed":
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_STATE",
                "message": "인프라 배포가 완료된 프로젝트만 동기화할 수 있습니다."
            }
        )
    
    from app.services.mirrorops.pipeline import MirrorOpsPipelineService
    pipeline = MirrorOpsPipelineService()
    background_tasks.add_task(
        pipeline.run,
        project_id    = project_id,
        deployment_id = "",
        trigger_type  = "manual",
        db            = db,
    )
    return {
        "success": True,
        "data": {
            "status":        "running",
            "websocket_url": f"wss://api.autoops.io/ws/events/{project_id}",
        },
    }


# ── GET /api/mirror/{project_id}/package ───────────────────────────

@router.get("/{project_id}/package")
def get_dr_package(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    latest = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest  == True,
    ).first()

    history = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest  == False,
    ).order_by(DRPackage.created_at.desc()).limit(10).all()

    return {
        "success": True,
        "data": {
            "latest":  _package_to_dict(latest) if latest else None,
            "history": [_package_to_dict(p) for p in history],
        },
    }


# ── GET /api/mirror/{project_id}/sync-history ──────────────────────

@router.get("/{project_id}/sync-history")
def get_sync_history(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    history = db.query(SyncHistory).filter(
        SyncHistory.project_id == project_id
    ).order_by(SyncHistory.started_at.desc()).limit(20).all()

    return {
        "success": True,
        "data": [
            {
                "sync_id":                s.sync_id,
                "trigger_type":           s.trigger_type,
                "status":                 s.status,
                "snapshot_status":        s.snapshot_status,
                "aws_resources_detected": s.aws_resources_detected,
                "gcp_resources_mapped":   s.gcp_resources_mapped,
                "error_message":          s.error_message,
                "started_at":             s.started_at.isoformat(),
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            }
            for s in history
        ],
    }


# ── 헬퍼 ────────────────────────────────────────────────────────────

def _get_project_or_404(project_id: str, user_id: str, db: Session) -> Project:
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == user_id,
    ).first()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "프로젝트를 찾을 수 없습니다."},
        )
    return project


def _package_to_dict(p: DRPackage) -> dict:
    return {
        "package_id":      p.package_id,
        "status":          p.status,
        "snapshot_status": p.snapshot_status,
        "components": {
            "terraform_code": {
                "status":  "ready" if p.terraform_code_path else "pending",
                "s3_path": p.terraform_code_path,
            },
            "container_image": {
                "status":         "ready" if p.gcr_image_uri else "pending",
                "gcr_uri":        p.gcr_image_uri,
                "image_ref_path": p.image_ref_path,
            },
            "db_snapshot": {
                "status":            p.snapshot_status,
                "snapshot_ref_path": p.snapshot_ref_path,
                "export_s3_path":    p.snapshot_export_s3_path,
                "export_format":     "parquet",
            },
        },
        "dr_report": {
            "rto_minutes": p.rto_minutes,
            "rpo_minutes": p.rpo_minutes,
            "confidence_summary": {
                "auto":   p.confidence_auto,
                "review": p.confidence_review,
                "manual": p.confidence_manual,
            },
            "checklist": p.checklist,
        },
        "created_at": p.created_at.isoformat(),
    }


# ── Failover ────────────────────────────────────────────────────────

from app.models.failover_history import FailoverHistory


class FailoverRequest(BaseModel):
    mode: str
    confirm_project_name: Optional[str] = None


@router.post("/{project_id}/failover", status_code=202)
def failover(
    project_id: str,
    body: FailoverRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, current_user.user_id, db)

    if body.mode not in ("simulation", "actual"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "VALIDATION_ERROR", "message": "mode는 simulation 또는 actual이어야 합니다."},
        )

    latest_package = None

    if body.mode == "actual":
        expected_name = project.name
        if body.confirm_project_name != expected_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code":    "VALIDATION_ERROR",
                    "message": f"confirm_project_name이 일치하지 않습니다. '{expected_name}'을 입력하세요.",
                },
            )

        latest_package = db.query(DRPackage).filter(
            DRPackage.project_id == project_id,
            DRPackage.is_latest  == True,
        ).first()

        if not latest_package:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code":    "NOT_FOUND",
                    "message": "DR Package가 존재하지 않습니다. 동기화를 먼저 실행하세요.",
                },
            )

        if latest_package.status != "ready":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code":    "CONFLICT",
                    "message": (
                        "DR Package가 준비되지 않았습니다. "
                        "DB 스냅샷 Export 완료 후 페일오버를 실행하세요. "
                        f"현재 상태: {latest_package.status}"
                    ),
                },
            )

    failover_id = f"fo_{str(uuid.uuid4())[:8]}"

    sim_package = db.query(DRPackage).filter(
        DRPackage.project_id == project_id,
        DRPackage.is_latest  == True,
    ).first()

    fh = FailoverHistory(
        failover_id = failover_id,
        project_id  = project_id,
        package_id  = (
            latest_package.package_id if body.mode == "actual"
            else (sim_package.package_id if sim_package else None)
        ),
        mode       = body.mode,
        gcp_region = "us-west1",
        status     = "running",
        started_at = datetime.utcnow(),
    )
    db.add(fh)
    db.commit()

    # ── simulation 모드 ──────────────────────────────────────────────
    if body.mode == "simulation" and sim_package:
        hcl_content = ""
        s3_path = sim_package.terraform_code_path or ""
        if s3_path.startswith("s3://"):
            try:
                path_body   = s3_path.replace("s3://", "")
                bucket, key = path_body.split("/", 1)
                s3_client   = boto3.client("s3", region_name="us-west-2")
                obj         = s3_client.get_object(Bucket=bucket, Key=key)
                hcl_content = obj["Body"].read().decode("utf-8")
            except Exception as e:
                print(f"[Failover] HCL 파일 읽기 실패: {e}")

        background_tasks.add_task(
            _run_failover_simulation,
            project_id  = project_id,
            failover_id = failover_id,
            hcl_code    = hcl_content,
            db          = SessionLocal(),
        )

    # ── actual 모드 ──────────────────────────────────────────────────
    elif body.mode == "actual" and latest_package:
        from app.models.aws_account import AWSAccount
        account = db.query(AWSAccount).filter(
            AWSAccount.account_id == project.account_id
        ).first()

        background_tasks.add_task(
            _run_failover_actual,
            project_id  = project_id,
            failover_id = failover_id,
            package     = latest_package,
            project     = project,
            role_arn    = account.role_arn if account else "",
        )

    return {
        "success": True,
        "data": {
            "failover_id":   failover_id,
            "mode":          body.mode,
            "gcp_region":    "us-west1",
            "websocket_url": (
                f"wss://api.autoops.io/ws/events/{project_id}?failover_id={failover_id}"
                if body.mode == "actual"
                else f"wss://api.autoops.io/ws/events/{project_id}"
            ),
        },
    }


# ── Simulation 실행 ──────────────────────────────────────────────────

def _run_failover_simulation(
    project_id: str,
    failover_id: str,
    hcl_code: str,
    db: Session,
) -> None:
    work_dir = tempfile.mkdtemp(prefix=f"autoops-failover-{project_id[:8]}-")
    try:
        (Path(work_dir) / "main.tf").write_text(hcl_code, encoding="utf-8")

        subprocess.run(
            ["terraform", "init", "-backend=false"],
            cwd=work_dir, capture_output=True,
        )

        plan_result = subprocess.run(
            ["terraform", "plan", "-json"],
            cwd=work_dir, capture_output=True, text=True,
        )

        add_count = 0
        for line in plan_result.stdout.splitlines():
            try:
                obj = json.loads(line)
                if obj.get("type") == "change_summary":
                    add_count = obj.get("changes", {}).get("add", 0)
                    break
            except json.JSONDecodeError:
                continue

        fh = db.query(FailoverHistory).filter(
            FailoverHistory.failover_id == failover_id
        ).first()
        if fh:
            fh.status                = "completed"
            fh.gcp_resources_created = add_count if add_count > 0 else None
            fh.actual_rto_seconds    = 15 * 60
            fh.completed_at          = datetime.utcnow()
            db.commit()

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        db.close()


# ── Actual 실행 ──────────────────────────────────────────────────────

async def _run_failover_actual(
    project_id: str,
    failover_id: str,
    package:     "DRPackage",
    project:     "Project",
    role_arn:    str,
) -> None:
    """
    GCP actual 페일오버 실행. BackgroundTask로 동작한다.

    흐름:
    ① S3에서 main.tf 다운로드
    ② GCP 인증 설정 (Secrets Manager)
    ③ GCS State 버킷 자동 생성
    ④ terraform init → apply (CloudWatch 로그 스트리밍)
    ⑤ failover_history.status → completed + RTO 기록
    """
    from app.core.config import settings
    from app.services.mirrorops.gcp_auth import setup_gcp_auth

    started_at = datetime.utcnow()
    work_dir   = None
    db         = SessionLocal()
    log_group  = f"/autoops/failover/{failover_id}"

    cw = boto3.client("logs", region_name="us-west-2")

    def _log(msg: str):
        print(f"[Failover {failover_id}] {msg}")
        try:
            cw.put_log_events(
                logGroupName  = log_group,
                logStreamName = "failover",
                logEvents     = [{"timestamp": int(datetime.utcnow().timestamp() * 1000), "message": msg}],
            )
        except Exception:
            pass

    def _update_status(new_status: str, error_msg: str = "", rto_seconds: int = None, resources_created: int = None):
        fh = db.query(FailoverHistory).filter(
            FailoverHistory.failover_id == failover_id
        ).first()
        if fh:
            fh.status       = new_status
            fh.completed_at = datetime.utcnow()
            if error_msg:
                fh.error_message = error_msg
            if rto_seconds is not None:
                fh.actual_rto_seconds = rto_seconds
            if resources_created is not None:
                fh.gcp_resources_created = resources_created
            db.commit()

    try:
        # CloudWatch 로그 그룹 생성
        try:
            cw.create_log_group(logGroupName=log_group)
            cw.create_log_stream(logGroupName=log_group, logStreamName="failover")
        except cw.exceptions.ResourceAlreadyExistsException:
            pass

        # ① S3에서 main.tf 다운로드
        _log("S3에서 main.tf 다운로드 중...")
        s3       = boto3.client("s3", region_name="us-west-2")
        work_dir = tempfile.mkdtemp(prefix=f"autoops-failover-{project_id[:8]}-")
        tf_key   = f"projects/{project_id}/latest/infrastructure/main.tf"

        s3.download_file("autoops-dr-packages", tf_key, str(Path(work_dir) / "main.tf"))
        _log("main.tf 다운로드 완료")

        # ② GCP 인증
        _log("GCP 인증 설정 중...")
        setup_gcp_auth()
        _log(f"GCP 인증 완료 (프로젝트: {settings.gcp_project_id})")

        # ③ GCS State 버킷 생성
        bucket_name = f"autoops-dr-state-{project_id}"
        _log(f"GCS State 버킷 확인: {bucket_name}")
        try:
            from google.cloud import storage as gcs_storage
            gcs = gcs_storage.Client()
            if not gcs.bucket(bucket_name).exists():
                bucket = gcs.create_bucket(bucket_name, location="us-west1")
                bucket.versioning_enabled = True
                bucket.patch()
                _log(f"GCS 버킷 생성 완료: {bucket_name}")
            else:
                _log(f"GCS 버킷 이미 존재: {bucket_name}")
        except Exception as e:
            _log(f"⚠️ GCS 버킷 처리 중 오류 (계속 진행): {e}")

        # ④ terraform init
        _log("terraform init 실행 중...")
        env = {**os.environ, "TF_IN_AUTOMATION": "1"}

        init_result = subprocess.run(
            ["terraform", "init", "-no-color", "-reconfigure"],
            cwd=work_dir, capture_output=True, text=True, timeout=120, env=env,
        )
        for line in init_result.stdout.splitlines():
            if line.strip():
                _log(line)
        if init_result.returncode != 0:
            raise RuntimeError(f"terraform init 실패:\n{init_result.stderr}")
        _log("terraform init 완료")

        # ⑤ terraform apply
        _log("terraform apply 실행 중 (GCP 리소스 생성 시작)...")
        _log("Cloud SQL 생성에 약 10~15분 소요됩니다.")

        import re as _re
        resources_created = 0

        apply_proc = subprocess.Popen(
            ["terraform", "apply", "-auto-approve", "-no-color", "-json"],
            cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, env=env,
        )

        for line in apply_proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            try:
                event = json.loads(line)
                msg   = event.get("@message", "")
                if msg:
                    _log(msg)
                    if "Apply complete!" in msg:
                        match = _re.search(r'(\d+) added', msg)
                        if match:
                            resources_created = int(match.group(1))
            except json.JSONDecodeError:
                _log(line)

        apply_proc.wait(timeout=1200)
        if apply_proc.returncode != 0:
            raise RuntimeError(f"terraform apply 실패 (exit code {apply_proc.returncode})")

        _log("✅ terraform apply 완료 — GCP 리소스 생성 성공")

        # ── S3 parquet → Cloud SQL 데이터 복원 추가 ─────────────────────
        _log("Cloud SQL 데이터 복원 시작...")
        await _import_snapshot_to_cloud_sql(
            project_id  = project_id,
            package     = package,
            bucket_name = bucket_name,
            gcp_project = settings.gcp_project_id,
            log_fn      = _log,
        )
        _log("✅ Cloud SQL 데이터 복원 완료")


        # ⑥ RTO 계산 및 DB 업데이트
        rto_seconds = int((datetime.utcnow() - started_at).total_seconds())
        _log(f"실제 RTO: {rto_seconds // 60}분 {rto_seconds % 60}초")
        _update_status("completed", rto_seconds=rto_seconds, resources_created=resources_created)

    except Exception as e:
        err_msg = str(e)
        _log(f"❌ 페일오버 실패: {err_msg}")
        _update_status("failed", error_msg=err_msg[:1000])

    finally:
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)
        db.close()


# ── terraform_code PATCH ─────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel


class TerraformCodeUpdate(_BaseModel):
    terraform_code: str


@router.patch("/{project_id}/resources/{resource_id}/terraform-code")
def update_terraform_code(
    project_id: str,
    resource_id: str,
    body: TerraformCodeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    mapping = db.query(GCPMapping).filter(
        GCPMapping.resource_id == resource_id,
        GCPMapping.project_id  == project_id,
    ).first()

    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "매핑을 찾을 수 없습니다."},
        )

    mapping.terraform_code = body.terraform_code
    db.commit()

    return {"success": True, "data": {"resource_id": resource_id}}

async def _import_snapshot_to_cloud_sql(
    project_id:  str,
    package:     "DRPackage",
    bucket_name: str,
    gcp_project: str,
    log_fn,
) -> None:
    """
    S3 parquet → GCS CSV 변환 → Cloud SQL import

    흐름:
    ① S3 export 경로에서 parquet 파일 목록 수집
    ② 테이블별 parquet 읽기 → pandas DataFrame
    ③ GCS에 CSV 업로드
    ④ Cloud SQL Admin API로 import
    """
    import io
    import pandas as pd
    import boto3 as _boto3
    from google.cloud import storage as gcs_storage
    import googleapiclient.discovery
    import time

    s3         = _boto3.client("s3", region_name="us-west-2")
    gcs        = gcs_storage.Client()
    gcs_bucket = gcs.bucket(bucket_name)
    sqladmin   = googleapiclient.discovery.build("sqladmin", "v1beta4")

    export_prefix = f"projects/{project_id}/latest/data/exports/"
    s3_bucket     = "autoops-dr-packages"

    log_fn(f"S3 parquet 목록 조회:{export_prefix}")

    # ── ① parquet 파일 목록 수집 ──────────────────────────────
    paginator   = s3.get_paginator("list_objects_v2")
    table_files: dict[str, list[str]] = {}

    for page in paginator.paginate(Bucket=s3_bucket, Prefix=export_prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".parquet"):
                continue
            parts     = key.replace(export_prefix, "").split("/")
            table_key = parts[0] if parts else "unknown"
            table_files.setdefault(table_key, []).append(key)

    if not table_files:
        log_fn("⚠️ S3에 parquet 파일 없음 — 데이터 복원 스킵")
        return

    log_fn(f"복원 대상 테이블:{list(table_files.keys())}")

    # Cloud SQL 인스턴스명 추론
    sql_instance = None
    try:
        snap_ref_key = f"projects/{project_id}/latest/data/snapshot_ref.json"
        obj          = s3.get_object(Bucket=s3_bucket, Key=snap_ref_key)
        snap_ref     = json.loads(obj["Body"].read())
        sql_instance = snap_ref.get("sql_instance_name", "")
    except Exception:
        pass

    if not sql_instance:
        sql_instance = f"{project_id[:8]}-sql"
        log_fn(f"⚠️ Cloud SQL 인스턴스명 추론:{sql_instance}")

    # ── ② 테이블별 parquet → CSV 변환 → GCS 업로드 → import ──
    for table_key, parquet_keys in table_files.items():
        log_fn(f"테이블 처리 중:{table_key}")

        dfs = []
        for pk in parquet_keys:
            obj = s3.get_object(Bucket=s3_bucket, Key=pk)
            df  = pd.read_parquet(io.BytesIO(obj["Body"].read()))
            dfs.append(df)

        if not dfs:
            continue

        merged_df  = pd.concat(dfs, ignore_index=True)
        csv_buffer = io.StringIO()
        merged_df.to_csv(csv_buffer, index=False)

        gcs_csv_path = f"import/{table_key}.csv"
        blob         = gcs_bucket.blob(gcs_csv_path)
        blob.upload_from_string(csv_buffer.getvalue(), content_type="text/csv")
        log_fn(f"GCS 업로드 완료: gs://{bucket_name}/{gcs_csv_path}")

        table_name = table_key.split(".")[-1] if "." in table_key else table_key
        database   = table_key.split(".")[0] if "." in table_key else "public"

        try:
            op = sqladmin.instances().import_(
                project  = gcp_project,
                instance = sql_instance,
                body={
                    "importContext": {
                        "kind":     "sql#importContext",
                        "fileType": "CSV",
                        "uri":      f"gs://{bucket_name}/{gcs_csv_path}",
                        "database": database,
                        "csvImportOptions": {"table": table_name},
                    }
                }
            ).execute()

            # 완료 대기 (최대 10분)
            for _ in range(60):
                result = sqladmin.operations().get(
                    project   = gcp_project,
                    operation = op["name"].split("/")[-1],
                ).execute()
                if result.get("status") == "DONE":
                    break
                await asyncio.sleep(10)

            log_fn(f"✅{table_name} import 완료 ({len(merged_df)}행)")

        except Exception as e:
            log_fn(f"⚠️{table_name} import 실패 (계속 진행):{e}")

# ── GET /api/mirror/{project_id}/failover/{failover_id} ────────────

@router.get("/{project_id}/failover/{failover_id}")
def get_failover_status(
    project_id:  str,
    failover_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    fh = db.query(FailoverHistory).filter(
        FailoverHistory.failover_id == failover_id,
        FailoverHistory.project_id  == project_id,
    ).first()

    if not fh:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "페일오버 이력을 찾을 수 없습니다."},
        )

    return {
        "success": True,
        "data": {
            "failover_id":           fh.failover_id,
            "mode":                  fh.mode,
            "status":                fh.status,
            "gcp_region":            fh.gcp_region,
            "gcp_resources_created": fh.gcp_resources_created,
            "actual_rto_seconds":    fh.actual_rto_seconds,
            "error_message":         fh.error_message,
            "started_at":            fh.started_at.isoformat(),
            "completed_at":          fh.completed_at.isoformat() if fh.completed_at else None,
        },
    }

# ── GCP 리소스 삭제 엔드포인트 ──────────────────────────────────

@router.post("/{project_id}/failover/{failover_id}/destroy", status_code=202)
def destroy_gcp_resources(
    project_id:  str,
    failover_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    fh = db.query(FailoverHistory).filter(
        FailoverHistory.failover_id == failover_id,
        FailoverHistory.project_id  == project_id,
    ).first()

    if not fh:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "NOT_FOUND", "message": "페일오버 이력을 찾을 수 없습니다."},
        )

    if fh.mode != "actual":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "simulation 모드는 삭제할 GCP 리소스가 없습니다."},
        )

    if fh.status not in ("completed", "failed"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code":    "CONFLICT",
                "message": f"삭제 가능한 상태가 아닙니다. 현재 상태:{fh.status}",
            },
        )

    fh.status = "destroying"
    db.commit()

    background_tasks.add_task(
        _run_failover_destroy,
        project_id  = project_id,
        failover_id = failover_id,
    )

    return {
        "success": True,
        "data": {
            "failover_id": failover_id,
            "status":      "destroying",
        },
    }


async def _run_failover_destroy(
    project_id:  str,
    failover_id: str,
) -> None:
    """
    terraform destroy로 GCP 리소스 삭제.

    흐름:
    ① S3에서 main.tf 다운로드
    ② GCP 인증
    ③ terraform init → destroy
    ④ GCS import 파일 정리
    ⑤ failover_history.status → destroyed
    """
    from app.services.mirrorops.gcp_auth import setup_gcp_auth
    from app.core.config import settings

    db       = SessionLocal()
    work_dir = None
    cw       = boto3.client("logs", region_name="us-west-2")
    log_group = f"/autoops/failover/{failover_id}"

    def _log(msg: str):
        print(f"[Destroy{failover_id}]{msg}")
        try:
            cw.put_log_events(
                logGroupName  = log_group,
                logStreamName = "failover",
                logEvents     = [{"timestamp": int(datetime.utcnow().timestamp() * 1000), "message": msg}],
            )
        except Exception:
            pass

    def _update_status(new_status: str, error_msg: str = "", rto_seconds: int = None, resources_created: int = None):
        fh = db.query(FailoverHistory).filter(
            FailoverHistory.failover_id == failover_id
        ).first()
        if fh:
            fh.status       = new_status
            fh.completed_at = datetime.utcnow()
            if error_msg:
                fh.error_message = error_msg
            if rto_seconds is not None:
                fh.actual_rto_seconds    = rto_seconds
            if resources_created is not None:
                fh.gcp_resources_created = resources_created
            db.commit()

    try:
        # ① S3에서 main.tf 다운로드
        _log("S3에서 main.tf 다운로드 중...")
        s3       = boto3.client("s3", region_name="us-west-2")
        work_dir = tempfile.mkdtemp(prefix=f"autoops-destroy-{project_id[:8]}-")
        tf_key   = f"projects/{project_id}/latest/infrastructure/main.tf"
        s3.download_file("autoops-dr-packages", tf_key, str(Path(work_dir) / "main.tf"))
        _log("main.tf 다운로드 완료")

        # ② GCP 인증
        _log("GCP 인증 설정 중...")
        setup_gcp_auth()
        _log("GCP 인증 완료")

        env = {**os.environ, "TF_IN_AUTOMATION": "1"}

        # ③ terraform init
        _log("terraform init 실행 중...")
        init_result = subprocess.run(
            ["terraform", "init", "-no-color", "-reconfigure"],
            cwd=work_dir, capture_output=True, text=True, timeout=120, env=env,
        )
        if init_result.returncode != 0:
            raise RuntimeError(f"terraform init 실패:\n{init_result.stderr}")
        _log("terraform init 완료")

        # ③ terraform destroy
        _log("terraform destroy 실행 중 (GCP 리소스 삭제 시작)...")
        destroy_proc = subprocess.Popen(
            ["terraform", "destroy", "-auto-approve", "-no-color", "-json"],
            cwd=work_dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, env=env,
        )
        for line in destroy_proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            try:
                event = json.loads(line)
                msg   = event.get("@message", "")
                if msg:
                    _log(msg)
            except json.JSONDecodeError:
                _log(line)

        destroy_proc.wait(timeout=600)  # 최대 10분
        if destroy_proc.returncode != 0:
            raise RuntimeError(f"terraform destroy 실패 (exit code{destroy_proc.returncode})")
        _log("✅ terraform destroy 완료 — GCP 리소스 삭제 성공")

        # ④ GCS import 파일 정리
        bucket_name = f"autoops-dr-state-{project_id}"
        try:
            from google.cloud import storage as gcs_storage
            gcs    = gcs_storage.Client()
            bucket = gcs.bucket(bucket_name)
            blobs  = list(bucket.list_blobs(prefix="import/"))
            if blobs:
                bucket.delete_blobs(blobs)
                _log(f"GCS import 파일 정리 완료:{len(blobs)}개")
        except Exception as e:
            _log(f"⚠️ GCS 정리 중 오류 (무시):{e}")

        # ⑤ 상태 업데이트
        _update_status("destroyed")
        _log("✅ GCP 리소스 삭제 완료")

    except Exception as e:
        err_msg = str(e)
        _log(f"❌ GCP 리소스 삭제 실패:{err_msg}")
        _update_status("destroy_failed", error_msg=err_msg[:1000])

    finally:
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)
        db.close()

# ── GET /api/mirror/{project_id}/failover-history ──────────────────

@router.get("/{project_id}/failover-history")
def get_failover_history(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    history = db.query(FailoverHistory).filter(
        FailoverHistory.project_id == project_id,
    ).order_by(FailoverHistory.started_at.desc()).limit(10).all()

    return {
        "success": True,
        "data": [
            {
                "failover_id":           fh.failover_id,
                "mode":                  fh.mode,
                "status":                fh.status,
                "gcp_region":            fh.gcp_region,
                "gcp_resources_created": fh.gcp_resources_created,
                "actual_rto_seconds":    fh.actual_rto_seconds,
                "error_message":         fh.error_message,
                "started_at":            fh.started_at.isoformat(),
                "completed_at":          fh.completed_at.isoformat() if fh.completed_at else None,
            }
            for fh in history
        ],
    }