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
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(
                None,
                lambda: sqs.receive_message(
                    QueueUrl            = queue_url,
                    MaxNumberOfMessages = 1,
                    WaitTimeSeconds     = 20,
                    VisibilityTimeout   = 300,
                )
            )

            messages = resp.get("Messages", [])
            for msg in messages:
                receipt_handle = msg["ReceiptHandle"]
                body = json.loads(msg["Body"])

                detail_type = body.get("detail-type", "")
                detail      = body.get("detail", {})

                try:
                    if detail_type == "InfraDeploymentCompleted":
                        await _handle_deployment_completed(detail)

                    elif detail_type == "RDS DB Snapshot Event":
                        await _handle_rds_snapshot_completed(detail)

                    sqs.delete_message(
                        QueueUrl      = queue_url,
                        ReceiptHandle = receipt_handle,
                    )

                except Exception as e:
                    print(f"[MirrorOps Worker] 메시지 처리 실패:{e}")

        except Exception as e:
            print(f"[MirrorOps Worker] SQS 수신 오류:{e}")
            await asyncio.sleep(5)


async def _handle_deployment_completed(detail: dict):
    db = SessionLocal()
    try:
        from app.models.project import Project

        # GCP 미연동 시 DR 패키지 자동 생성 스킵
        # GCP 연동 후 사용자가 직접 MirrorOps 페이지에서 수동 실행
        project = db.query(Project).filter(
            Project.project_id == detail["project_id"]
        ).first()

        if not project or not project.gcp_project_id:
            print(f"[MirrorOps Worker] GCP 미연동 — DR 패키지 자동 생성 스킵 (project_id={detail['project_id']})")
            return

        pipeline = MirrorOpsPipelineService()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: pipeline.run(
                project_id    = detail["project_id"],
                deployment_id = detail["deployment_id"],
                trigger_type  = "deployment_completed",
                db            = db,
            )
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
            return

        parts = snapshot_id.split("-")
        if len(parts) < 2:
            return

        from app.models.sync_history import DRPackage
        from app.models.project import Project

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
        assumed = ResourceDetector(account.role_arn, project.region, project.user_id).session
        from app.services.mirrorops.dr_packager import DRPackager
        packager = DRPackager(assumed_session=assumed)
        packager.run_phase2(
            project_id      = package.project_id,
            package_id      = package.package_id,
            snapshot_arn    = snapshot_arn,
            export_role_arn = f"arn:aws:iam::{account.aws_account_id}:role/AutoOpsRDSExportRole",
            kms_key_id      = "alias/autoops-rds-export",
            db              = db,
        )

        if project:
            project.dr_status = "ready"
            db.commit()

    finally:
        db.close()