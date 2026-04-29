import asyncio
import boto3
import json
from app.core.config import settings
from app.core.database import SessionLocal
from app.services.mirrorops.pipeline import MirrorOpsPipelineService


async def start_sqs_worker():
    """
    FastAPI 시작 시 백그라운드에서 SQS 메시지를 수신하고
    MirrorOps 파이프라인을 실행한다.

    Long Polling (WaitTimeSeconds=20)으로 비용을 최소화한다.
    """
    sqs = boto3.client("sqs", region_name="us-west-2")
    queue_url = settings.mirrorops_queue_url

    print(f"[MirrorOps Worker] SQS 수신 시작:{queue_url}")

    while True:
        try:
            resp = sqs.receive_message(
                QueueUrl             = queue_url,
                MaxNumberOfMessages  = 1,
                WaitTimeSeconds      = 20,       # Long Polling
                VisibilityTimeout    = 300,      # 5분 디바운싱 (§5-1)
            )

            messages = resp.get("Messages", [])
            for msg in messages:
                receipt_handle = msg["ReceiptHandle"]
                body = json.loads(msg["Body"])

                # EventBridge 이벤트 파싱
                detail_type = body.get("detail-type", "")
                detail      = body.get("detail", {})

                try:
                    if detail_type == "InfraDeploymentCompleted":
                        # §7-8 CraftOps → MirrorOps 트리거
                        await _handle_deployment_completed(detail)

                    elif detail_type == "RDS DB Snapshot Event":
                        # Phase 2 트리거
                        await _handle_rds_snapshot_completed(detail)

                    # 처리 완료 → 큐에서 삭제
                    sqs.delete_message(
                        QueueUrl      = queue_url,
                        ReceiptHandle = receipt_handle,
                    )

                except Exception as e:
                    print(f"[MirrorOps Worker] 메시지 처리 실패:{e}")
                    # 실패 시 VisibilityTimeout 후 재처리

        except Exception as e:
            print(f"[MirrorOps Worker] SQS 수신 오류:{e}")
            await asyncio.sleep(5)


async def _handle_deployment_completed(detail: dict):
    """§7-8 InfraDeploymentCompleted 이벤트 처리"""
    db = SessionLocal()
    try:
        pipeline = MirrorOpsPipelineService()
        pipeline.run(
            project_id    = detail["project_id"],
            deployment_id = detail["deployment_id"],
            trigger_type  = "deployment_completed",
            db            = db,
        )
    finally:
        db.close()


async def _handle_rds_snapshot_completed(detail: dict):
    """RDS 스냅샷 완료 이벤트 → Phase 2 실행"""
    db = SessionLocal()
    try:
        snapshot_id  = detail.get("SourceIdentifier", "")
        snapshot_arn = detail.get("SourceArn", "")

        if "autoops" not in snapshot_id:
            return  # AutoOps가 생성한 스냅샷이 아니면 무시

        # snapshot_id에서 project_id 추출 (형식: autoops-{project_id_8자리}-{timestamp})
        parts = snapshot_id.split("-")
        if len(parts) < 2:
            return

        from app.models.sync_history import DRPackage
        from app.models.project import Project

        # snapshot_ref.json에서 package_id 조회
        package = db.query(DRPackage).filter(
            DRPackage.snapshot_status == "pending",
        ).order_by(DRPackage.created_at.desc()).first()

        if not package:
            return

        project = db.query(Project).filter(
            Project.project_id == package.project_id
        ).first()
        account = db.query(__import__('app.models.aws_account', fromlist=['AWSAccount']).AWSAccount).filter_by(
            account_id=project.account_id
        ).first()

        from app.services.mirrorops.detector import ResourceDetector
        assumed = ResourceDetector(account.role_arn, project.region).session
        from app.services.mirrorops.dr_packager import DRPackager
        packager = DRPackager(assumed_session=assumed)
        packager.run_phase2(
            project_id      = package.project_id,
            package_id      = package.package_id,
            snapshot_arn    = snapshot_arn,
            export_role_arn = f"arn:aws:iam::{account.aws_account_id}:role/AutoOpsRDSExportRole",
            kms_key_id      = "alias/aws/rds",   # 기본 KMS 키
            db              = db,
        )

        # project.dr_status → "ready"
        if project:
            project.dr_status = "ready"
            db.commit()

    finally:
        db.close()