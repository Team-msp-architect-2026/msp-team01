import boto3
import json
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.sync_history import DRPackage, SyncHistory
from app.models.project import Project


class DRPackager:
    """
    §5-3 DR Package 2단계 비동기 파이프라인을 담당한다.

    Phase 1 (즉시):
      ① Skopeo ECR → GCR 이미지 복사 (FR-B-009)
      ② RDS CreateSnapshot API 호출 (시작만)
      ③ S3 latest/ 저장 (Terraform HCL + image_ref.json + snapshot_ref.json:pending)
      → dr_packages.status: "preparing"

    Phase 2 (비동기 — RDS 스냅샷 완료 이벤트 수신 후):
      ④ RDS start_export_task() 실행
      ⑤ snapshot_ref.json export_status: "ready" 갱신
      → dr_packages.status: "ready"
    """

    S3_BUCKET = "autoops-dr-packages"

    def __init__(self, assumed_session: "boto3.Session"):
        """assumed_session: Cross-Account Role Assume 후 생성된 boto3 Session"""
        self.user_session = assumed_session
        self.s3           = boto3.client("s3", region_name="us-west-2")
        self.rds          = assumed_session.client("rds")
        self.ecr          = assumed_session.client("ecr")

    # ── Phase 1 ────────────────────────────────────────────────────

    def run_phase1(
        self,
        project_id: str,
        sync_id: str,
        prefix: str,
        environment: str,
        region: str,
        hcl_code: str,
        gcp_project: str,
        db: Session,
    ) -> DRPackage:
        """
        Phase 1을 실행한다. 즉시 완료되는 작업만 처리한다.
        RDS 스냅샷은 CreateSnapshot만 호출하고 Export는 Phase 2에서 처리한다.
        """
        s3_base = f"projects/{project_id}/latest"

        # ① Skopeo ECR → GCR 이미지 복사 (FR-B-009)
        gcr_uri, ecr_uri = self._copy_image_skopeo(
            prefix, environment, region, gcp_project
        )
        image_ref = {
            "source_ecr": ecr_uri,
            "dest_gcr":   gcr_uri,
            "copied_at":  datetime.now(timezone.utc).isoformat(),
        }
        self._upload_json(f"{s3_base}/application/image_ref.json", image_ref)

        # ② RDS CreateSnapshot 호출 (시작만) (FR-B-010)
        snapshot_id  = f"autoops-{project_id[:8]}-{int(datetime.now().timestamp())}"
        rds_id       = f"{prefix}-{environment}-rds"
        snapshot_arn = self._create_rds_snapshot(rds_id, snapshot_id)

        # snapshot_ref.json — pending 상태로 저장
        snapshot_ref = {
            "snapshot_id":     snapshot_id,
            "snapshot_arn":    snapshot_arn,
            "export_s3_path":  f"s3://{self.S3_BUCKET}/{s3_base}/data/exports/",
            "export_format":   "parquet",
            "export_status":   "pending",   # Phase 2 완료 시 "ready"로 갱신
            "exported_at":     None,
        }
        self._upload_json(f"{s3_base}/data/snapshot_ref.json", snapshot_ref)

        # ③ GCP Terraform HCL 저장
        # §5-3 DR Package 디렉토리 구조
        self._upload_text(f"{s3_base}/infrastructure/main.tf", hcl_code)

        # dr-report.json 생성 (FR-B-012)
        dr_report = {
            "rto_minutes": 12,   # §7-6 목표값
            "rpo_minutes": 3,    # §18 변경이력 ❽: RPO 3분 확정
            "confidence_summary": {"auto": 6, "review": 5, "manual": 0},
            "checklist": [
                {"item": "GCP Terraform 코드 생성",      "status": "done"},
                {"item": "컨테이너 이미지 GCR 복사",     "status": "done"},
                {"item": "RDS 스냅샷 생성 요청",         "status": "done"},
                {"item": "RDS 스냅샷 Export",            "status": "pending"},
                {"item": "Firewall Rule 수동 검토",      "status": "warning"},
            ],
        }
        self._upload_json(f"{s3_base}/dr-report.json", dr_report)

        # DR Package DB 레코드 생성
        package = DRPackage(
            project_id            = project_id,
            sync_id               = sync_id,
            s3_path               = f"s3://{self.S3_BUCKET}/{s3_base}",
            terraform_code_path   = f"s3://{self.S3_BUCKET}/{s3_base}/infrastructure/main.tf",
            image_ref_path        = f"s3://{self.S3_BUCKET}/{s3_base}/application/image_ref.json",
            gcr_image_uri         = gcr_uri,
            snapshot_ref_path     = f"s3://{self.S3_BUCKET}/{s3_base}/data/snapshot_ref.json",
            snapshot_status       = "pending",
            rto_minutes           = 12,
            rpo_minutes           = 3,
            confidence_auto       = 6,
            confidence_review     = 5,
            confidence_manual     = 0,
            checklist             = dr_report["checklist"],
            is_latest             = True,
            status                = "preparing",  # Phase 2 완료 시 "ready"
        )
        db.add(package)
        db.commit()
        db.refresh(package)

        return package

    # ── Phase 2 ────────────────────────────────────────────────────

    def run_phase2(
        self,
        project_id: str,
        package_id: str,
        snapshot_arn: str,
        export_role_arn: str,
        kms_key_id: str,
        db: Session,
    ) -> None:
        """
        RDS 스냅샷 완료 이벤트 수신 후 Phase 2를 실행한다.
        RDS snapshot → S3 Parquet Export Task를 시작한다. (FR-B-010)
        """
        s3_base = f"projects/{project_id}/latest"
        export_prefix = f"{s3_base}/data/exports/"

        # RDS start_export_task (§5-3 Phase 2)
        export_task_id = f"autoops-export-{project_id[:8]}-{int(datetime.now().timestamp())}"
        self.rds.start_export_task(
            ExportTaskIdentifier = export_task_id,
            SourceArn            = snapshot_arn,
            S3BucketName         = self.S3_BUCKET,
            S3Prefix             = export_prefix,
            IamRoleArn           = export_role_arn,
            KmsKeyId             = kms_key_id,
        )

        # snapshot_ref.json 갱신 — export_status: "ready"
        snapshot_ref = {
            "snapshot_arn":   snapshot_arn,
            "export_s3_path": f"s3://{self.S3_BUCKET}/{export_prefix}",
            "export_format":  "parquet",
            "export_status":  "ready",
            "exported_at":    datetime.now(timezone.utc).isoformat(),
        }
        self._upload_json(f"{s3_base}/data/snapshot_ref.json", snapshot_ref)

        # dr-report.json 체크리스트 갱신
        dr_report_key = f"{s3_base}/dr-report.json"
        try:
            obj = self.s3.get_object(Bucket=self.S3_BUCKET, Key=dr_report_key)
            dr_report = json.loads(obj["Body"].read())
            for item in dr_report.get("checklist", []):
                if item["item"] == "RDS 스냅샷 Export":
                    item["status"] = "done"
            self._upload_json(dr_report_key, dr_report)
        except Exception:
            pass

        # dr_packages.status → "ready"
        package = db.query(DRPackage).filter(
            DRPackage.package_id == package_id
        ).first()
        if package:
            package.status          = "ready"
            package.snapshot_status = "ready"
            package.snapshot_export_s3_path = (
                f"s3://{self.S3_BUCKET}/{export_prefix}"
            )
            db.commit()

    # ── Skopeo 이미지 복사 (FR-B-009) ──────────────────────────────

    def _copy_image_skopeo(
        self,
        prefix: str,
        environment: str,
        region: str,
        gcp_project: str,
    ) -> tuple[str, str]:
        """
        Skopeo로 ECR 이미지를 GCR(Artifact Registry)에 복사한다.
        Docker 데몬 없이 동작한다. (§5-3 Phase 1 ②)
        """
        account_id = self.user_session.client("sts").get_caller_identity()["Account"]
        ecr_uri = (
            f"{account_id}.dkr.ecr.{region}.amazonaws.com"
            f"/{prefix}-{environment}-app:latest"
        )
        gcr_uri = (
            f"us-west1-docker.pkg.dev/{gcp_project}"
            f"/autoops-repo/{prefix}-{environment}-app:latest"
        )

        # ECR 로그인 토큰 취득
        ecr_token = self.ecr.get_authorization_token()
        token_data = ecr_token["authorizationData"][0]
        import base64
        ecr_creds  = base64.b64decode(token_data["authorizationToken"]).decode()
        ecr_user, ecr_pass = ecr_creds.split(":", 1)

        # GCP 액세스 토큰 취득
        gcp_token_proc = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True, text=True,
        )
        gcp_token = gcp_token_proc.stdout.strip()

        # §5-3 Phase 1 ②: Skopeo 복사 명령어
        result = subprocess.run(
            [
                "skopeo", "copy",
                "--src-creds",  f"{ecr_user}:{ecr_pass}",
                "--dest-creds", f"oauth2accesstoken:{gcp_token}",
                f"docker://{ecr_uri}",
                f"docker://{gcr_uri}",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            raise RuntimeError(f"Skopeo 복사 실패:{result.stderr}")

        return gcr_uri, ecr_uri

    def _create_rds_snapshot(self, db_instance_id: str, snapshot_id: str) -> str:
        """RDS 스냅샷 생성을 시작하고 ARN을 반환한다. (§5-3 Phase 1 ③)"""
        try:
            resp = self.rds.create_db_snapshot(
                DBSnapshotIdentifier = snapshot_id,
                DBInstanceIdentifier = db_instance_id,
                Tags=[{"Key": "autoops", "Value": "dr-snapshot"}],
            )
            return resp["DBSnapshot"]["DBSnapshotArn"]
        except self.rds.exceptions.DBInstanceNotFoundFault:
            # RDS 인스턴스가 없는 경우 (dev 환경 등) — 빈 ARN 반환
            return ""

    # ── S3 업로드 헬퍼 ─────────────────────────────────────────────

    def _upload_json(self, key: str, data: dict) -> None:
        self.s3.put_object(
            Bucket      = self.S3_BUCKET,
            Key         = key,
            Body        = json.dumps(data, ensure_ascii=False, indent=2).encode(),
            ContentType = "application/json",
        )

    def _upload_text(self, key: str, text: str) -> None:
        self.s3.put_object(
            Bucket      = self.S3_BUCKET,
            Key         = key,
            Body        = text.encode("utf-8"),
            ContentType = "text/plain",
        )