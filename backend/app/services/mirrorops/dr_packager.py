import boto3
import json
import subprocess
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.sync_history import DRPackage

class DRPackager:
    """
    §5-3 DR Package 2단계 비동기 파이프라인을 담당한다.
    """

    S3_BUCKET = "autoops-dr-packages"

    def __init__(self, assumed_session: "boto3.Session"):
        self.user_session = assumed_session
        self.s3           = assumed_session.client("s3", region_name="us-west-2")
        self.rds          = assumed_session.client("rds", region_name="us-west-2")
        self.ecr          = assumed_session.client("ecr", region_name="us-west-2")

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
        s3_base = f"projects/{project_id}/latest"

        # ① Skopeo ECR → GCR 이미지 복사
        gcr_uri, ecr_uri = self._copy_image_skopeo(
            prefix, environment, region, gcp_project
        )
        image_ref = {
            "source_ecr": ecr_uri,
            "dest_gcr":   gcr_uri,
            "copied_at":  datetime.now(timezone.utc).isoformat(),
        }
        self._upload_json(f"{s3_base}/application/image_ref.json", image_ref)

        # ② RDS CreateSnapshot 호출
        snapshot_id  = f"autoops-{project_id[:8]}-{int(datetime.now().timestamp())}"
        rds_id       = f"{prefix}-{environment}-rds".lower()
        snapshot_arn = self._create_rds_snapshot(rds_id, snapshot_id)

        snapshot_ref = {
            "snapshot_id":     snapshot_id,
            "snapshot_arn":    snapshot_arn,
            "export_s3_path":  f"s3://{self.S3_BUCKET}/{s3_base}/data/exports/",
            "export_format":   "parquet",
            "export_status":   "pending",
            "exported_at":     None,
        }
        self._upload_json(f"{s3_base}/data/snapshot_ref.json", snapshot_ref)

        # ③ GCP Terraform HCL 저장
        import re as _re
        hcl_patched = _re.sub(
            r'image\s*=\s*"[^"]*"',
            f'image = "{gcr_uri}"',
            hcl_code
        )
        self._upload_text(f"{s3_base}/infrastructure/main.tf", hcl_patched)

        # dr-report.json 생성 (RTO 15, RPO 0)
        dr_report = {
            "rto_minutes": 15,
            "rpo_minutes": 0,
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
            rto_minutes           = 15,
            rpo_minutes           = 0,
            confidence_auto       = 6,
            confidence_review     = 5,
            confidence_manual     = 0,
            checklist             = dr_report["checklist"],
            is_latest             = True,
            status                = "preparing",
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
        s3_base = f"projects/{project_id}/latest"
        export_prefix = f"{s3_base}/data/exports/"
        # [추가] 스냅샷 available 상태 대기 (최대 20분)
        snapshot_id = snapshot_arn.split(":")[-1]
        print(f"[DRPackager] 스냅샷 완료 대기 중: {snapshot_id}")
        waiter = self.rds.get_waiter("db_snapshot_available")
        waiter.wait(
            DBSnapshotIdentifier = snapshot_id,
            WaiterConfig         = {"Delay": 30, "MaxAttempts": 40},
        )
        print(f"[DRPackager] 스냅샷 사용 가능 — Export 시작")

        export_task_id = f"autoops-export-{project_id[:8]}-{int(datetime.now().timestamp())}"
        self.rds.start_export_task(
            ExportTaskIdentifier = export_task_id,
            SourceArn            = snapshot_arn,
            S3BucketName         = self.S3_BUCKET,
            S3Prefix             = export_prefix,
            IamRoleArn           = export_role_arn,
            KmsKeyId             = kms_key_id,
        )

        snapshot_ref = {
            "snapshot_arn":   snapshot_arn,
            "export_s3_path": f"s3://{self.S3_BUCKET}/{export_prefix}",
            "export_format":  "parquet",
            "export_status":  "ready",
            "exported_at":    datetime.now(timezone.utc).isoformat(),
        }
        self._upload_json(f"{s3_base}/data/snapshot_ref.json", snapshot_ref)

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

        package = db.query(DRPackage).filter(
            DRPackage.package_id == package_id
        ).first()
        if package:
            package.status          = "ready"
            package.snapshot_status = "ready"
            package.snapshot_export_s3_path = (
                f"s3://{self.S3_BUCKET}/{export_prefix}"
            )
            # [추가] DB 체크리스트 업데이트 (S3 dr-report.json과 동기화)
            updated_checklist = []
            for item in (package.checklist or []):
                if item.get("item") == "RDS 스냅샷 Export":
                    updated_checklist.append({
                        "item":   item["item"],
                        "status": "done",
                    })
                else:
                    updated_checklist.append(item)
            package.checklist = updated_checklist
            db.commit()

    # ── Skopeo 이미지 복사 (FR-B-009) ──────────────────────────────

    def _copy_image_skopeo(
            self,
            prefix: str,
            environment: str,
            region: str,
            gcp_project: str,
        ) -> tuple[str, str]:
            import base64
            import os

            account_id = self.user_session.client("sts").get_caller_identity()["Account"]

            ecr_uri = f"611058323802.dkr.ecr.us-west-2.amazonaws.com/autoops-sample-app:latest"
            gcr_uri = (
                f"us-west1-docker.pkg.dev/{gcp_project}"
                f"/autoops-repo/autoops-sample-app:latest"
            ).lower()

            # ECR 로그인 토큰 취득
            ecr_token = self.ecr.get_authorization_token()
            token_data = ecr_token["authorizationData"][0]
            ecr_creds  = base64.b64decode(token_data["authorizationToken"]).decode()
            ecr_user, ecr_pass = ecr_creds.split(":", 1)

            # [수정] gcloud 서비스 계정 인증 후 액세스 토큰 취득
            # GOOGLE_APPLICATION_CREDENTIALS만 설정하면 gcloud가 인식 못함
            # → activate-service-account로 명시적 인증 필요
            key_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
            if key_path:
                activate_result = subprocess.run(
                    ["gcloud", "auth", "activate-service-account",
                    "--key-file", key_path],
                    capture_output=True, text=True,
                )
                if activate_result.returncode != 0:
                    raise RuntimeError(
                        f"GCP 서비스 계정 인증 실패: {activate_result.stderr}"
                    )

            gcp_token_proc = subprocess.run(
                ["gcloud", "auth", "print-access-token"],
                capture_output=True, text=True,
            )
            gcp_token = gcp_token_proc.stdout.strip()

            if not gcp_token:
                raise RuntimeError("GCP 액세스 토큰 취득 실패 — gcloud 인증 상태 확인 필요")

            # Skopeo 복사 실행
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
        try:
            resp = self.rds.create_db_snapshot(
                DBSnapshotIdentifier = snapshot_id,
                DBInstanceIdentifier = db_instance_id,
                Tags=[{"Key": "autoops", "Value": "dr-snapshot"}],
            )
            return resp["DBSnapshot"]["DBSnapshotArn"]
        except self.rds.exceptions.DBInstanceNotFoundFault:
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