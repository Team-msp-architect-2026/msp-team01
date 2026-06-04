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
        trigger_type: str,
        db: Session,
    ) -> str:
        # 프로젝트 및 AWS 계정 조회
        project = db.query(Project).filter(
            Project.project_id == project_id
        ).first()
        account = db.query(AWSAccount).filter(
            AWSAccount.account_id == project.account_id
        ).first()

        # GCP 인증 설정 — project별 SA 키 사용 (폴백 없음)
        gcp_project_id = project.gcp_project_id
        setup_gcp_auth(project=project)

        # sync_history 레코드 생성
        sync = SyncHistory(
            project_id      = project_id,
            trigger_type    = trigger_type,
            status          = "running",
            snapshot_status = "pending",
            started_at      = datetime.utcnow(),
        )
        db.add(sync)
        db.commit()
        db.refresh(sync)

        # project.dr_status → "syncing"
        project.dr_status = "syncing"
        db.commit()

        try:
            from app.models.gcp_mapping import GCPMapping as GCPMappingModel
            from app.models.aws_resource import AWSResource as AWSResourceModel

            db.query(GCPMappingModel).filter(
                GCPMappingModel.project_id == project_id
            ).delete()
            db.query(AWSResourceModel).filter(
                AWSResourceModel.project_id == project_id
            ).delete()
            db.commit()

            # ① 리소스 감지
            assumed_session = boto3.Session(region_name=project.region)
            detector = ResourceDetector(
                role_arn    = account.role_arn,
                region      = project.region,
                external_id = project.user_id,
            )
            aws_resources = detector.detect_all(
                project_id  = project_id,
                prefix      = project.prefix,
                environment = project.environment,
                db          = db,
            )
            sync.aws_resources_detected = len(aws_resources)
            db.commit()

            # ② 매핑 엔진
            mapper   = MappingEngine()
            mappings = mapper.map_all(
                aws_resources = aws_resources,
                project_id    = project_id,
                sync_id       = sync.sync_id,
                db            = db,
            )
            sync.gcp_resources_mapped = len(mappings)
            db.commit()

            from app.models.sync_history import DRPackage as DRPackageModel

            previous_sync = db.query(SyncHistory).filter(
                SyncHistory.project_id == project_id,
                SyncHistory.status     == "completed",
                SyncHistory.sync_id    != sync.sync_id,
            ).order_by(SyncHistory.started_at.desc()).first()

            has_changes = True

            if previous_sync:
                prev_count = previous_sync.aws_resources_detected or 0
                curr_count = len(aws_resources)
                if prev_count == curr_count and curr_count > 0:
                    has_changes = False

            # ③ GCP Terraform HCL 생성 + DR Package
            if has_changes:
                db.query(DRPackageModel).filter(
                    DRPackageModel.project_id == project_id,
                    DRPackageModel.is_latest  == True,
                ).update({"is_latest": False})
                db.commit()

                generator          = GCPHCLGenerator()
                hcl_code, work_dir = generator.generate(
                    project_id  = project_id,
                    mappings    = mappings,
                    gcp_project = gcp_project_id,
                    gcp_region  = settings.gcp_region,
                )
                passed, error_msg = generator.validate(work_dir)
                generator.cleanup(work_dir)

                if not passed:
                    raise RuntimeError(f"GCP Terraform validate 실패:{error_msg}")

                assumed  = ResourceDetector(account.role_arn, project.region, project.user_id).session
                packager = DRPackager(assumed_session=assumed)
                package  = packager.run_phase1(
                    project_id  = project_id,
                    sync_id     = sync.sync_id,
                    prefix      = project.prefix,
                    environment = project.environment,
                    region      = project.region,
                    hcl_code    = hcl_code,
                    gcp_project = gcp_project_id,
                    db          = db,
                )
            else:
                print(f"[MirrorOps] 변경 없음 — DR Package 재생성 스킵 (project_id={project_id})")

                latest_pkg = db.query(DRPackageModel).filter(
                    DRPackageModel.project_id == project_id,
                    DRPackageModel.is_latest  == True,
                ).first()
                if latest_pkg and latest_pkg.status == "ready":
                    project.dr_status = "ready"
                    if latest_pkg.snapshot_status == "ready" and latest_pkg.checklist:
                        updated = []
                        for item in latest_pkg.checklist:
                            if item.get("item") == "RDS 스냅샷 Export":
                                updated.append({"item": item["item"], "status": "done"})
                            else:
                                updated.append(item)
                        latest_pkg.checklist = updated
                db.commit()

            sync.status       = "completed"
            sync.completed_at = datetime.utcnow()
            db.commit()

        except Exception as e:
            sync.status        = "failed"
            sync.error_message = str(e)
            project.dr_status  = "not_ready"
            db.commit()
            raise

        return sync.sync_id