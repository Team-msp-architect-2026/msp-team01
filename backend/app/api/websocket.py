# backend/app/api/websocket.py
import asyncio
import boto3
from datetime import datetime, timezone
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import SessionLocal
from app.models.deployment import Deployment

router = APIRouter()

cw = boto3.client("logs", region_name="us-west-2")


@router.websocket("/ws/events/{project_id}")
async def websocket_events(
    websocket: WebSocket,
    project_id: str,
    deployment_id: str = Query(None),
):
    """
    CloudWatch Logs를 2초 간격으로 폴링해 배포 로그를 실시간 스트리밍한다.
    §7-7 WebSocket 서버 구현 방식: CloudWatch Polling (2초 간격)

    §7-7 Log Group 명명 규칙:
    /autoops/terraform-runner/{deployment_id}  ← CraftOps apply 로그

    §7-7 이벤트 공통 포맷:
    { "event_type": "...", "project_id": "...", "timestamp": "...", "data": {...} }
    """
    await websocket.accept()

    if not deployment_id:
        await websocket.send_json({
            "event_type": "error",
            "project_id": project_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {"message": "deployment_id가 필요합니다."},
        })
        await websocket.close()
        return

    log_group  = f"/autoops/terraform-runner/{deployment_id}"
    next_token = None

    try:
        while True:
            # ── CloudWatch 로그 폴링 (로컬 테스트 모드 스킵) ──────────
            if not settings.skip_ecs_task:
                try:
                    streams = cw.describe_log_streams(
                        logGroupName=log_group,
                        orderBy="LastEventTime",
                        descending=True,
                        limit=1,
                    )
                    log_streams = streams.get("logStreams", [])

                    if log_streams:
                        kwargs: dict = {
                            "logGroupName":  log_group,
                            "logStreamName": log_streams[0]["logStreamName"],
                            "startFromHead": True,
                            "limit": 100,
                        }
                        if next_token:
                            kwargs["nextToken"] = next_token

                        resp       = cw.get_log_events(**kwargs)
                        events     = resp.get("events", [])
                        next_token = resp.get("nextForwardToken")

                        for event in events:
                            await websocket.send_json({
                                "event_type": "deploy_progress",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "deployment_id": deployment_id,
                                    "log":       event["message"],
                                    "timestamp": event["timestamp"],
                                },
                            })

                except cw.exceptions.ResourceNotFoundException:
                    pass

            # ── 배포 완료/실패 여부 DB 체크 (매 polling 시) ──────────
            db: Session = SessionLocal()
            try:
                deployment = db.query(Deployment).filter(
                    Deployment.deployment_id == deployment_id
                ).first()
                current_status = deployment.status if deployment else None
            finally:
                db.close()

            if current_status == "completed":
                await websocket.send_json({
                    "event_type": "deploy_completed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "deployment_id":     deployment_id,
                        "resources_created": 16,
                        "mirror_triggered":  True,
                    },
                })
                break

            elif current_status in ("failed", "partial_failed"):
                db = SessionLocal()
                try:
                    dep = db.query(Deployment).filter(
                        Deployment.deployment_id == deployment_id
                    ).first()
                    completed_count = dep.completed_resources or 0
                finally:
                    db.close()

                await websocket.send_json({
                    "event_type": "deploy_failed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "deployment_id":       deployment_id,
                        "completed_resources": completed_count,
                        "state_saved":         True,
                        "available_actions":   ["resume", "fix_retry", "full_destroy"],
                    },
                })
                break

            await asyncio.sleep(2)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({
                "event_type": "error",
                "project_id": project_id,
                "timestamp":  datetime.now(timezone.utc).isoformat(),
                "data": {"message": str(e)},
            })
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass