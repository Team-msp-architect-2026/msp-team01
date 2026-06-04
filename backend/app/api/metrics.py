# backend/app/api/metrics.py

import os
import boto3
from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.models.project import Project
from app.models.aws_account import AWSAccount
from app.models.aws_resource import AWSResource

router = APIRouter()

# ─── 기간별 설정 ─────────────────────────────────────────────────────────────
PERIOD_CONFIG = {
    "1h":  {"stat_period": 60,   "lookback_seconds": 3600},
    "6h":  {"stat_period": 300,  "lookback_seconds": 21600},
    "24h": {"stat_period": 900,  "lookback_seconds": 86400},
    "7d":  {"stat_period": 3600, "lookback_seconds": 604800},
}


def _get_cloudwatch_client(role_arn: str, region: str):
    skip = os.getenv("SKIP_ASSUME_ROLE", "false").lower() == "true"
    try:
        sts_client = boto3.client("sts")
        current_account = sts_client.get_caller_identity()["Account"]
        target_account = role_arn.split(":")[4]
        if skip or current_account == target_account:
            return boto3.client("cloudwatch", region_name=region)
    except Exception:
        pass
    sts = boto3.client("sts")
    assumed = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName="autoops-metrics-session",
        DurationSeconds=900,
    )
    creds = assumed["Credentials"]
    return boto3.client(
        "cloudwatch",
        region_name=region,
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )


def _extract_alb_dimension(alb_arn: str) -> str:
    if not alb_arn:
        return ""
    parts = alb_arn.split(":loadbalancer/")
    return parts[1] if len(parts) == 2 else ""


def _build_metric_queries(resources: dict, stat_period: int) -> list:
    queries = []

    # ── ECS ──────────────────────────────────────────────────────────────────
    if resources.get("ecs_cluster") and resources.get("ecs_service"):
        ecs_dims = [
            {"Name": "ClusterName", "Value": resources["ecs_cluster"]},
            {"Name": "ServiceName", "Value": resources["ecs_service"]},
        ]
        queries += [
            {
                "Id": "ecs_cpu",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ECS",
                        "MetricName": "CPUUtilization",
                        "Dimensions": ecs_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
            {
                "Id": "ecs_memory",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ECS",
                        "MetricName": "MemoryUtilization",
                        "Dimensions": ecs_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
        ]

    # ── ALB ──────────────────────────────────────────────────────────────────
    if resources.get("alb_dimension"):
        alb_dims = [{"Name": "LoadBalancer", "Value": resources["alb_dimension"]}]
        queries += [
            {
                "Id": "alb_requests",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ApplicationELB",
                        "MetricName": "RequestCount",
                        "Dimensions": alb_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Sum",
                },
                "ReturnData": True,
            },
            {
                "Id": "alb_response_time",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ApplicationELB",
                        "MetricName": "TargetResponseTime",
                        "Dimensions": alb_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
            {
                "Id": "alb_5xx",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/ApplicationELB",
                        "MetricName": "HTTPCode_Target_5XX_Count",
                        "Dimensions": alb_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Sum",
                },
                "ReturnData": True,
            },
        ]

    # ── RDS ──────────────────────────────────────────────────────────────────
    if resources.get("rds_identifier"):
        rds_dims = [{"Name": "DBInstanceIdentifier", "Value": resources["rds_identifier"]}]
        queries += [
            {
                "Id": "rds_cpu",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/RDS",
                        "MetricName": "CPUUtilization",
                        "Dimensions": rds_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
            {
                "Id": "rds_connections",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/RDS",
                        "MetricName": "DatabaseConnections",
                        "Dimensions": rds_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
            {
                "Id": "rds_storage",
                "MetricStat": {
                    "Metric": {
                        "Namespace": "AWS/RDS",
                        "MetricName": "FreeStorageSpace",
                        "Dimensions": rds_dims,
                    },
                    "Period": stat_period,
                    "Stat": "Average",
                },
                "ReturnData": True,
            },
        ]

    return queries


def _parse_metric_result(results: list, metric_id: str) -> list:
    for r in results:
        if r["Id"] == metric_id:
            pairs = sorted(
                zip(r.get("Timestamps", []), r.get("Values", [])),
                key=lambda x: x[0],
            )
            return [
                {
                    "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "value": round(v, 4),
                }
                for ts, v in pairs
            ]
    return []


@router.get("/projects/{project_id}/metrics")
async def get_project_metrics(
    project_id: str,
    period: Literal["1h", "6h", "24h", "7d"] = "1h",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # ── 1. 프로젝트 조회 ──────────────────────────────────────────────────────
    project = db.query(Project).filter(
        Project.project_id == project_id,
        Project.user_id == current_user.user_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if project.status != "completed":
        raise HTTPException(status_code=400, detail="배포 완료된 프로젝트만 모니터링 가능합니다.")

    # ── 2. AWS 계정 → role_arn 조회 ───────────────────────────────────────────
    aws_account = db.query(AWSAccount).filter(
        AWSAccount.account_id == project.account_id
    ).first()
    if not aws_account:
        raise HTTPException(status_code=404, detail="연동된 AWS 계정을 찾을 수 없습니다.")

    # ── 3. aws_resources 테이블에서 리소스 조회 ───────────────────────────────
    aws_res_list = db.query(AWSResource).filter(
        AWSResource.project_id == project_id,
    ).all()

    if not aws_res_list:
        return {
            "project_id": project_id,
            "period": period,
            "region": project.region,
            "resources": {},
            "metrics": {},
            "message": "모니터링 가능한 리소스가 없습니다.",
        }

    def find_res(keywords: list):
        for r in aws_res_list:
            rt = r.resource_type.lower()
            if all(k in rt for k in keywords):
                return r
        return None

    ecs_cluster_res = find_res(["ecs", "cluster"])
    ecs_service_res = find_res(["ecs", "service"])
    alb_res         = find_res(["loadbalancer"]) or find_res(["elasticloadbalancing"])
    rds_res = find_res(["rds", "dbinstance"]) or find_res(["rds::dbinstance"])

    # ── 4. 리소스 식별자 정리 ─────────────────────────────────────────────────
    ecs_cluster_name = ecs_cluster_res.resource_name if ecs_cluster_res else None
    ecs_service_name = ecs_service_res.resource_name if ecs_service_res else None
    alb_arn          = alb_res.resource_id_aws        if alb_res         else None
    rds_identifier   = rds_res.resource_name.lower() if rds_res         else None
    alb_dimension    = _extract_alb_dimension(alb_arn) if alb_arn        else None

    cw_resources = {
        "ecs_cluster":    ecs_cluster_name,
        "ecs_service":    ecs_service_name,
        "alb_dimension":  alb_dimension,
        "rds_identifier": rds_identifier,
    }

    if not any([ecs_cluster_name, ecs_service_name, alb_dimension, rds_identifier]):
        return {
            "project_id": project_id,
            "period": period,
            "region": project.region,
            "resources": {},
            "metrics": {},
            "message": "모니터링 가능한 리소스가 없습니다.",
        }

    # ── 5. 기간 설정 ──────────────────────────────────────────────────────────
    cfg = PERIOD_CONFIG[period]
    now = datetime.now(timezone.utc)
    start_time = now - timedelta(seconds=cfg["lookback_seconds"])

    # ── 6. CloudWatch 배치 호출 ───────────────────────────────────────────────
    try:
        cw = _get_cloudwatch_client(aws_account.role_arn, project.region)
        queries = _build_metric_queries(cw_resources, cfg["stat_period"])

        if not queries:
            return {
                "project_id": project_id,
                "period": period,
                "region": project.region,
                "resources": cw_resources,
                "metrics": {},
            }

        response = cw.get_metric_data(
            MetricDataQueries=queries,
            StartTime=start_time,
            EndTime=now,
        )
        results = response.get("MetricDataResults", [])

    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"CloudWatch 조회 실패: {str(e)}",
        )

    # ── 7. 응답 구성 ──────────────────────────────────────────────────────────
    metrics = {}

    if ecs_cluster_name and ecs_service_name:
        metrics["ecs"] = {
            "cpu":    _parse_metric_result(results, "ecs_cpu"),
            "memory": _parse_metric_result(results, "ecs_memory"),
        }

    if alb_dimension:
        metrics["alb"] = {
            "request_count":  _parse_metric_result(results, "alb_requests"),
            "response_time":  _parse_metric_result(results, "alb_response_time"),
            "error_5xx":      _parse_metric_result(results, "alb_5xx"),
        }

    if rds_identifier:
        rds_storage_raw = _parse_metric_result(results, "rds_storage")
        rds_storage_gb = [
            {"timestamp": p["timestamp"], "value": round(p["value"] / (1024**3), 2)}
            for p in rds_storage_raw
        ]
        metrics["rds"] = {
            "cpu":             _parse_metric_result(results, "rds_cpu"),
            "connections":     _parse_metric_result(results, "rds_connections"),
            "storage_free_gb": rds_storage_gb,
        }

    return {
        "project_id": project_id,
        "period": period,
        "region": project.region,
        "resources": {
            "ecs_cluster": ecs_cluster_name,
            "ecs_service": ecs_service_name,
            "alb":         alb_dimension,
            "rds":         rds_identifier,
        },
        "metrics": metrics,
    }