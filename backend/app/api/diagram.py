# backend/app/api/diagram.py
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.governance import ProjectDocument, OnboardingScan

router = APIRouter(tags=["diagram"])


@router.get("/api/projects/{project_id}/documents")
def get_project_documents(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_project_or_404(project_id, current_user.user_id, db)

    doc = db.query(ProjectDocument).filter(
        ProjectDocument.project_id == project_id
    ).order_by(ProjectDocument.generated_at.desc()).first()

    if not doc:
        return {"success": True, "data": None}

    return {
        "success": True,
        "data": {
            "id":           doc.id,
            "source":       doc.source,
            "mermaid_code": doc.mermaid_code,
            "description":  doc.description,
            "generated_at": doc.generated_at.isoformat() if doc.generated_at else None,
        },
    }


@router.post("/api/projects/{project_id}/documents/regenerate")
def regenerate_diagram(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = _get_project_or_404(project_id, current_user.user_id, db)
    source = project.source or "craftops_deploy"  # 수정
    background_tasks.add_task(
        _generate_diagram_task,
        project_id = project_id,
        source     = source,  # 수정
    )
    return {"success": True, "data": {"message": "다이어그램 생성 시작됨"}}


def _generate_diagram_task(project_id: str, source: str):
    from app.core.database import SessionLocal
    from app.services.mirrorops.bedrock_client import BedrockMapper

    db = SessionLocal()
    try:
        resources = []

        if source == "craftops_deploy":
            from app.models.aws_resource import AWSResource
            aws_res = db.query(AWSResource).filter(
                AWSResource.project_id == project_id,
            ).all()
            resources = [
                {
                    "resource_type": r.resource_type,
                    "resource_name": r.resource_name,
                    "resource_id":   r.resource_id_aws,
                }
                for r in aws_res
            ]
        else:
            scan = db.query(OnboardingScan).filter(
                OnboardingScan.project_id == project_id,
                OnboardingScan.status     == "completed",
            ).order_by(OnboardingScan.confirmed_at.desc()).first()

            if scan and scan.scan_result:
                for group_data in scan.scan_result.values():
                    resources.extend(group_data.get("resources", []))

        if not resources:
            return

        client = BedrockMapper()
        result = client.generate_architecture_diagram(resources)

        doc = ProjectDocument(
            id           = str(uuid.uuid4()),
            project_id   = project_id,
            source       = source,
            mermaid_code = result.get("mermaid_code", ""),
            description  = result.get("description", ""),
            generated_at = datetime.utcnow(),
        )
        db.add(doc)
        db.commit()
        print(f"[Diagram] 생성 완료: project_id={project_id}")

    except Exception as e:
        print(f"[Diagram] 생성 실패: {e}")
    finally:
        db.close()


def _get_project_or_404(project_id: str, user_id: str, db: Session) -> Project:
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == user_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})
    return project