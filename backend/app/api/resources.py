# backend/app/api/resources.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.user import User
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.governance import OnboardingScan, DriftEvent

router = APIRouter(tags=["resources"])


@router.get("/api/projects/{project_id}/resources")
def get_project_resources(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    프로젝트 리소스 그룹 + Drift 현황.
    onboarding_scans.scan_result JSONB 활용.
    """
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id    == current_user.user_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND"})

    scan = db.query(OnboardingScan).filter(
        OnboardingScan.project_id == project_id,
        OnboardingScan.status     == "completed",
    ).order_by(OnboardingScan.confirmed_at.desc()).first()

    groups = scan.scan_result if scan else {}

    drift_counts = {}
    drift_events = db.query(DriftEvent).filter(
        DriftEvent.project_id == project_id,
        DriftEvent.status     == "detected",
    ).all()

    for event in drift_events:
        key = event.resource_id_aws
        if key not in drift_counts:
            drift_counts[key] = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        drift_counts[key][event.severity] += 1

    enriched_groups = {}
    for group_key, group_data in groups.items():
        group_drift = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        enriched_resources = []

        for resource in group_data.get("resources", []):
            rid     = resource.get("resource_id", "")
            r_drift = drift_counts.get(rid, {})
            resource["drift"] = r_drift

            for sev, cnt in r_drift.items():
                group_drift[sev] += cnt

            enriched_resources.append(resource)

        enriched_groups[group_key] = {
            **group_data,
            "resources":     enriched_resources,
            "drift_summary": group_drift,
        }

    return {
        "success": True,
        "data": {
            "project_id":      project_id,
            "source":          project.source,
            "total_resources": sum(len(g["resources"]) for g in enriched_groups.values()),
            "total_groups":    len(enriched_groups),
            "groups":          enriched_groups,
            "drift_summary": {
                "CRITICAL": sum(d["CRITICAL"] for d in drift_counts.values()),
                "HIGH":     sum(d["HIGH"]     for d in drift_counts.values()),
                "MEDIUM":   sum(d["MEDIUM"]   for d in drift_counts.values()),
                "LOW":      sum(d["LOW"]       for d in drift_counts.values()),
            },
        },
    }


@router.get("/api/accounts/{account_id}/resources")
def get_account_resources(
    account_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """계정 전체 온보딩 프로젝트 리소스 (리전별 그룹화)"""
    projects = db.query(Project).filter(
        Project.account_id == account_id,
        Project.user_id    == current_user.user_id,
        Project.source     == "onboarding",
    ).all()

    all_groups = {}
    for project in projects:
        scan = db.query(OnboardingScan).filter(
            OnboardingScan.project_id == project.project_id,
            OnboardingScan.status     == "completed",
        ).order_by(OnboardingScan.confirmed_at.desc()).first()

        if scan and scan.scan_result:
            for group_key, group_data in scan.scan_result.items():
                all_groups[group_key] = {
                    **group_data,
                    "project_id": project.project_id,
                }

    return {"success": True, "data": {"groups": all_groups}}