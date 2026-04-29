import boto3
from datetime import datetime
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.sync_history import SyncHistory, DRPackage
from app.services.mirrorops.detector import ResourceDetector
from app.services.mirrorops.mapper import MappingEngine
from app.services.mirrorops.gcp_hcl_generator import GCPHCLGenerator
from app.services.mirrorops.dr_packager import DRPackager
from app.services.mirrorops.gcp_auth import setup_gcp_auth


class MirrorOpsPipelineService:
    """
    MirrorOps 전체 파이프라인을 순서대로 실행한다.
    SQS 메시지 수신 후 호출된다.
    """

    def run(
        self,
        project_id: str,
        deployment_id: str,
        trigger_type: str,       # "deployment_completed" | "infra_changed" | "manual"
        db: Session,
    ) -> str:
        """
        파이프라인을 실행하고 sync_id를 반환한다.
        Phase 1이 완료되면 즉시 반환한다 (Phase 2는 비동기).
        """
        # GCP 인증 설정 (§5-4)
        setup_gcp_auth()

        # 프로젝트 및 AWS 계정 조회
        project = db.query(Project).filter(
            Project.project_id == project_id
        ).first()
        account = db.query(AWSAccount).filter(
            AWSAccount.account_id == project.account_id
        ).first()

        # sync_history 레코드 생성
        sync = SyncHistory(
            project_id   = project_id,
            trigger_type = trigger_type,
            status       = "running",
            snapshot_status = "pending",
            started_at   = datetime.utcnow(),
        )
        db.add(sync)
        db.commit()
        db.refresh(sync)

        # project.dr_status → "syncing"
        project.dr_status = "syncing"
        db.commit()

        try:
            # ① 리소스 감지 (FR-B-003)
            assumed_session = boto3.Session(
                region_name=project.region,
            )
            detector = ResourceDetector(
                role_arn=account.role_arn,
                region=project.region,
            )
            aws_resources = detector.detect_all(
                project_id  = project_id,
                prefix      = project.prefix,
                environment = project.environment,
                db          = db,
            )
            sync.aws_resources_detected = len(aws_resources)
            db.commit()

            # ② 매핑 엔진 (FR-B-004, FR-B-005)
            mapper   = MappingEngine()
            mappings = mapper.map_all(
                aws_resources = aws_resources,
                project_id    = project_id,
                sync_id       = sync.sync_id,
                db            = db,
            )
            sync.gcp_resources_mapped = len(mappings)
            db.commit()

            # ③ GCP Terraform HCL 생성 + validate (FR-B-007)
            generator          = GCPHCLGenerator()
            hcl_code, work_dir = generator.generate(
                project_id  = project_id,
                mappings    = mappings,
                gcp_project = settings.gcp_project_id,
            )
            passed, error_msg = generator.validate(work_dir)
            generator.cleanup(work_dir)

            if not passed:
                raise RuntimeError(f"GCP Terraform validate 실패:{error_msg}")

            # ④ ~ ⑤ DR Package Phase 1 (Skopeo + RDS Snapshot + S3 저장)
            assumed = ResourceDetector(account.role_arn, project.region).session
            packager = DRPackager(assumed_session=assumed)
            package  = packager.run_phase1(
                project_id      = project_id,
                sync_id         = sync.sync_id,
                prefix          = project.prefix,
                environment     = project.environment,
                region          = project.region,
                hcl_code        = hcl_code,
                gcp_project     = settings.gcp_project_id,
                db              = db,
            )

            # Phase 1 완료
            sync.status         = "completed"
            sync.snapshot_status = "pending"   # Phase 2 대기 중
            sync.completed_at   = datetime.utcnow()
            project.last_synced_at = datetime.utcnow()
            db.commit()

            # §7-7 sync_completed 이벤트: Phase 1 완료
            # (WebSocket은 Epic 4에서 구현한 핸들러 재사용)
            # sync_progress → sync_completed 순으로 전송

        except Exception as e:
            sync.status        = "failed"
            sync.error_message = str(e)
            project.dr_status  = "not_ready"
            db.commit()
            raise

        return sync.sync_id