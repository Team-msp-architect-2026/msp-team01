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
    failover_id: str   = Query(None),
):
    await websocket.accept()

    if failover_id:
        await _stream_failover_logs(websocket, project_id, failover_id)
        return

    if not deployment_id:
        await websocket.send_json({
            "event_type": "error",
            "project_id": project_id,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "data": {"message": "deployment_id가 필요합니다."},
        })
        await websocket.close()
        return

    log_group  = "/autoops/terraform-runner"
    next_token = None

    try:
        while True:
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
                        "limit":         100,
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
                                "log":           event["message"],
                                "timestamp":     event["timestamp"],
                            },
                        })
            except Exception:
                pass

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


# ── MirrorOps WebSocket ─────────────────────────────────────────────

@router.websocket("/ws/mirror/{project_id}")
async def websocket_mirror_events(
    websocket: WebSocket,
    project_id: str,
    sync_id: str     = Query(None),
    failover_id: str = Query(None),
):
    await websocket.accept()

    if not sync_id and not failover_id:
        await websocket.send_json({
            "event_type": "error",
            "project_id": project_id,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "data": {"message": "sync_id 또는 failover_id가 필요합니다."},
        })
        await websocket.close()
        return

    try:
        while True:
            db: Session = SessionLocal()
            try:
                if sync_id:
                    from app.models.sync_history import SyncHistory
                    sync = db.query(SyncHistory).filter(
                        SyncHistory.sync_id == sync_id
                    ).first()

                    if sync:
                        await websocket.send_json({
                            "event_type": "sync_progress",
                            "project_id": project_id,
                            "timestamp":  datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "sync_id":                sync_id,
                                "status":                 sync.status,
                                "aws_resources_detected": sync.aws_resources_detected,
                                "gcp_resources_mapped":   sync.gcp_resources_mapped,
                            },
                        })

                        if sync.status == "completed":
                            await websocket.send_json({
                                "event_type": "sync_completed",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "sync_id":                sync_id,
                                    "aws_resources_detected": sync.aws_resources_detected,
                                    "gcp_resources_mapped":   sync.gcp_resources_mapped,
                                },
                            })
                            break

                        elif sync.status == "failed":
                            await websocket.send_json({
                                "event_type": "sync_failed",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "sync_id":       sync_id,
                                    "error_message": sync.error_message,
                                },
                            })
                            break

                if failover_id:
                    from app.models.failover_history import FailoverHistory
                    fh = db.query(FailoverHistory).filter(
                        FailoverHistory.failover_id == failover_id
                    ).first()

                    if fh:
                        await websocket.send_json({
                            "event_type": "failover_progress",
                            "project_id": project_id,
                            "timestamp":  datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "failover_id":           failover_id,
                                "status":                fh.status,
                                "gcp_resources_created": fh.gcp_resources_created,
                            },
                        })

                        if fh.status == "completed":
                            await websocket.send_json({
                                "event_type": "failover_completed",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "failover_id":           failover_id,
                                    "gcp_resources_created": fh.gcp_resources_created,
                                    "actual_rto_seconds":    fh.actual_rto_seconds,
                                },
                            })
                            break

                        elif fh.status == "failed":
                            await websocket.send_json({
                                "event_type": "failover_failed",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "failover_id":   failover_id,
                                    "error_message": fh.error_message,
                                },
                            })
                            break

            finally:
                db.close()

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


# ── Failover 로그 스트리밍 ─────────────────────────────────────────

async def _stream_failover_logs(
    websocket: WebSocket,
    project_id: str,
    failover_id: str,
) -> None:
    log_group  = f"/autoops/failover/{failover_id}"
    next_token = None

    try:
        while True:
            # ── CloudWatch 로그 즉시 폴링 (초기 대기 없음) ────────────
            try:
                streams = cw.describe_log_streams(
                    logGroupName = log_group,
                    orderBy      = "LastEventTime",
                    descending   = True,
                    limit        = 1,
                )
                log_streams = streams.get("logStreams", [])

                if log_streams:
                    kwargs = {
                        "logGroupName":  log_group,
                        "logStreamName": log_streams[0]["logStreamName"],
                        "startFromHead": True,
                        "limit":         100,
                    }
                    if next_token:
                        kwargs["nextToken"] = next_token

                    resp       = cw.get_log_events(**kwargs)
                    events     = resp.get("events", [])
                    next_token = resp.get("nextForwardToken")

                    for event in events:
                        msg = event.get("message", "").strip()
                        if not msg:
                            continue
                        await websocket.send_json({
                            "event_type": "failover_progress",
                            "project_id": project_id,
                            "timestamp":  datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "failover_id":      failover_id,
                                "current_resource": msg,
                                "elapsed_seconds":  0,
                            },
                        })

            except Exception:
                # 로그 그룹 미생성, 일시 오류 등 — 무시하고 계속 폴링
                pass

            # ── DB 완료 여부 체크 ──────────────────────────────────
            db: Session = SessionLocal()
            try:
                from app.models.failover_history import FailoverHistory
                fh = db.query(FailoverHistory).filter(
                    FailoverHistory.failover_id == failover_id
                ).first()
                current_status = fh.status                if fh else None
                rto_seconds    = fh.actual_rto_seconds    if fh else None
                gcp_created    = fh.gcp_resources_created if fh else None
                error_msg      = fh.error_message         if fh else None
            finally:
                db.close()

            if current_status == "completed":
                await websocket.send_json({
                    "event_type": "failover_completed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "failover_id":           failover_id,
                        "gcp_resources_created": gcp_created,
                        "actual_rto_seconds":    rto_seconds,
                    },
                })
                break

            elif current_status == "failed":
                await websocket.send_json({
                    "event_type": "failover_failed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "failover_id":   failover_id,
                        "error_message": error_msg or "알 수 없는 오류",
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