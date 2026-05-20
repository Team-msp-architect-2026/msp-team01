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
    """
    CloudWatch Logs를 2초 간격으로 폴링해 배포 로그를 실시간 스트리밍한다.
    §7-7 WebSocket 서버 구현 방식: CloudWatch Polling (2초 간격)

    §7-7 Log Group 명명 규칙:
    /autoops/terraform-runner/{deployment_id}  ← CraftOps apply 로그

    §7-7 이벤트 공통 포맷:
    { "event_type": "...", "project_id": "...", "timestamp": "...", "data": {...} }
    """
    await websocket.accept()

    # failover_id가 있으면 페일오버 로그 스트리밍 분기
    if failover_id:
        await _stream_failover_logs(websocket, project_id, failover_id)
        return

    if not deployment_id:
        await websocket.send_json({
            "event_type": "error",
            "project_id": project_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {"message": "deployment_id가 필요합니다."},
        })
        await websocket.close()
        return

    log_group  = "/autoops/terraform-runner"
    next_token = None

    try:
        while True:
            # 항상 CloudWatch 폴링
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
                                "log":           event["message"],
                                "timestamp":     event["timestamp"],
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

# ── MirrorOps WebSocket ─────────────────────────────────────────────

@router.websocket("/ws/mirror/{project_id}")
async def websocket_mirror_events(
    websocket: WebSocket,
    project_id: str,
    sync_id: str = Query(None),
    failover_id: str = Query(None),
):
    """
    MirrorOps 동기화 및 페일오버 진행 상황을 실시간 스트리밍한다.
    DB 폴링 방식 (2초 간격)
    """
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
                # ── 동기화 이벤트 ──
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

                # ── 페일오버 이벤트 ──
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
                                "failover_id":         failover_id,
                                "status":              fh.status,
                                "gcp_resources_created": fh.gcp_resources_created,
                            },
                        })

                        if fh.status == "completed":
                            await websocket.send_json({
                                "event_type": "failover_completed",
                                "project_id": project_id,
                                "timestamp":  datetime.now(timezone.utc).isoformat(),
                                "data": {
                                    "failover_id":         failover_id,
                                    "gcp_resources_created": fh.gcp_resources_created,
                                    "actual_rto_seconds":  fh.actual_rto_seconds,
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

# backend/app/api/websocket.py — 파일 하단에 추가

async def _stream_failover_logs(
    websocket: WebSocket,
    project_id: str,
    failover_id: str,
) -> None:
    """
    /autoops/failover/{failover_id} CloudWatch 로그를 2초 polling.
    failover_history.status가 completed/failed가 되면 종료.
    """
    log_group  = f"/autoops/failover/{failover_id}"
    next_token = None

    try:
        while True:
            # CloudWatch 로그 폴링
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
                        await websocket.send_json({
                            "event_type": "failover_progress",
                            "project_id": project_id,
                            "timestamp":  datetime.now(timezone.utc).isoformat(),
                            "data": {
                                "failover_id":      failover_id,
                                "current_resource": event["message"],
                                "elapsed_seconds":  0,
                            },
                        })

            except cw.exceptions.ResourceNotFoundException:
                pass  # 로그 그룹 아직 생성 안 됨

            # DB에서 완료 여부 체크
            db: Session = SessionLocal()
            try:
                from app.models.failover_history import FailoverHistory
                fh = db.query(FailoverHistory).filter(
                    FailoverHistory.failover_id == failover_id
                ).first()
                current_status = fh.status if fh else None
                rto_seconds    = fh.actual_rto_seconds if fh else None
                gcp_created    = fh.gcp_resources_created if fh else None
            finally:
                db.close()

            if current_status == "completed":
                await websocket.send_json({
                    "event_type": "failover_completed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "failover_id":          failover_id,
                        "gcp_resources_created": gcp_created,
                        "actual_rto_seconds":    rto_seconds,
                    },
                })
                break

            elif current_status == "failed":
                db2 = SessionLocal()
                try:
                    from app.models.failover_history import FailoverHistory as FH2
                    fh2 = db2.query(FH2).filter(FH2.failover_id == failover_id).first()
                    err = fh2.error_message if fh2 else "알 수 없는 오류"
                finally:
                    db2.close()

                await websocket.send_json({
                    "event_type": "failover_failed",
                    "project_id": project_id,
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "data": {
                        "failover_id":   failover_id,
                        "error_message": err,
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