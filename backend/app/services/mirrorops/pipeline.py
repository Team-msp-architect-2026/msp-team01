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
            # 기존 GCPMapping, AWSResource 삭제 (UUID 불일치 방지)
            from app.models.gcp_mapping import GCPMapping as GCPMappingModel
            from app.models.aws_resource import AWSResource as AWSResourceModel

            db.query(GCPMappingModel).filter(
                GCPMappingModel.project_id == project_id
            ).delete()
            db.query(AWSResourceModel).filter(
                AWSResourceModel.project_id == project_id
            ).delete()
            db.commit()
            
            # ① 리소스 감지 (FR-B-003)
            assumed_session = boto3.Session(
                region_name=project.region,
            )
            detector = ResourceDetector(
                role_arn=account.role_arn,
                region=project.region,
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

            # ── [추가] 변경 감지 — 이전 동기화와 리소스 수 비교 ──────────────
            from app.models.sync_history import DRPackage as DRPackageModel

            previous_sync = db.query(SyncHistory).filter(
                SyncHistory.project_id == project_id,
                SyncHistory.status     == "completed",
                SyncHistory.sync_id    != sync.sync_id,
            ).order_by(SyncHistory.started_at.desc()).first()

            has_changes = True  # 기본값: 변경 있음으로 간주

            if previous_sync:
                prev_count = previous_sync.aws_resources_detected or 0
                curr_count = len(aws_resources)
                if prev_count == curr_count and curr_count > 0:
                    has_changes = False  # 리소스 수 동일 → 변경 없음으로 간주

            # ③ GCP Terraform HCL 생성 + DR Package — 변경 있을 때만 실행
            if has_changes:
                # 기존 is_latest 패키지 False로 변경
                db.query(DRPackageModel).filter(
                    DRPackageModel.project_id == project_id,
                    DRPackageModel.is_latest  == True,
                ).update({"is_latest": False})
                db.commit()

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

                assumed  = ResourceDetector(account.role_arn, project.region, project.user_id).session
                packager = DRPackager(assumed_session=assumed)
                package  = packager.run_phase1(
                    project_id  = project_id,
                    sync_id     = sync.sync_id,
                    prefix      = project.prefix,
                    environment = project.environment,
                    region      = project.region,
                    hcl_code    = hcl_code,
                    gcp_project = settings.gcp_project_id,
                    db          = db,
                )
            else:
                # 변경 없음 → DR Package 재생성 스킵
                print(f"[MirrorOps] 변경 없음 — DR Package 재생성 스킵 (project_id={project_id})")
                
                # [추가] 변경 없음: 최신 패키지가 ready면 dr_status 복원
                latest_pkg = db.query(DRPackageModel).filter(
                    DRPackageModel.project_id == project_id,
                    DRPackageModel.is_latest  == True,
                ).first()
                if latest_pkg and latest_pkg.status == "ready":
                    project.dr_status = "ready"
                    # [추가] 스냅샷 Export 완료 시 체크리스트도 동기화
                    if latest_pkg.snapshot_status == "ready" and latest_pkg.checklist:
                        updated = []
                        for item in latest_pkg.checklist:
                            if item.get("item") == "RDS 스냅샷 Export":
                                updated.append({"item": item["item"], "status": "done"})
                            else:
                                updated.append(item)
                        latest_pkg.checklist = updated
                db.commit()

            # [추가] Phase 1 완료 → sync 상태 업데이트
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