# backend/app/services/governance/drift_worker.py
import json
import uuid
import boto3
import threading
from datetime import datetime
from app.core.config import settings


# 심각도 분류 룰
CRITICAL_CHANGES = {
    "AWS::EC2::SecurityGroup": ["ipPermissions"],    # 인바운드 룰 변경
    "AWS::RDS::DBInstance":    ["PubliclyAccessible"],# 퍼블릭 노출
}
HIGH_CHANGES = {
    "AWS::IAM::Role":          ["AssumeRolePolicyDocument", "Policies"],
    "AWS::RDS::DBInstance":    ["StorageEncrypted"],
}


def classify_severity(resource_type: str, diff_detail: dict) -> str:
    """변경 내용 기반 심각도 분류"""
    changed_keys = set(diff_detail.get("changed_keys", []))

    if resource_type in CRITICAL_CHANGES:
        if changed_keys & set(CRITICAL_CHANGES[resource_type]):
            return "CRITICAL"

    if resource_type in HIGH_CHANGES:
        if changed_keys & set(HIGH_CHANGES[resource_type]):
            return "HIGH"

    # 인스턴스 타입 변경 등
    if "instanceType" in changed_keys or "dbInstanceClass" in changed_keys:
        return "MEDIUM"

    return "LOW"


def build_diff(baseline_config: dict, current_config: dict) -> dict:
    """Baseline vs 현재 설정 diff 계산"""
    changed_keys = []
    diff_detail  = {"before": {}, "after": {}}

    all_keys = set(baseline_config.keys()) | set(current_config.keys())
    for key in all_keys:
        b_val = baseline_config.get(key)
        c_val = current_config.get(key)
        if b_val != c_val:
            changed_keys.append(key)
            diff_detail["before"][key] = b_val
            diff_detail["after"][key]  = c_val

    diff_detail["changed_keys"] = changed_keys
    return diff_detail


def send_drift_slack(
    severity: str,
    resource_type: str,
    resource_id: str,
    diff_summary: str,
    changed_by: str,
    webhook_url: str,
):
    """Slack 알림 발송"""
    import httpx

    emoji = {"CRITICAL": "🔴", "HIGH": "🟡", "MEDIUM": "🟠", "LOW": "⚪"}.get(severity, "⚪")

    message = {
        "text": (
            f"{emoji} *{severity} Drift 감지*\n"
            f"리소스: `{resource_id}` ({resource_type})\n"
            f"변경자: `{changed_by}`\n"
            f"변경 내용:{diff_summary}"
        )
    }

    try:
        httpx.post(webhook_url, json=message, timeout=5)
    except Exception as e:
        print(f"[DriftWorker] Slack 발송 실패:{e}")


def process_drift_event(message_body: dict):
    """
    EventBridge → SQS로 수신된 AWS Config 변경 이벤트 처리.
    Baseline과 비교 → 심각도 분류 → drift_events 저장 → Slack 알림
    """
    from app.core.database import SessionLocal
    from app.models.governance import ResourceBaseline, DriftEvent
    from app.models.project import Project
    from app.models.user import User

    db = SessionLocal()
    try:
        # AWS Config 이벤트에서 리소스 정보 추출
        detail = message_body.get("detail", {})
        config_item = detail.get("configurationItem", {})

        resource_type   = config_item.get("resourceType", "")
        resource_id_aws = config_item.get("resourceId", "")
        changed_by      = detail.get("relatedEvents", [{}])[0].get("eventName", "unknown")
        current_config  = config_item.get("configuration", {})

        if not resource_id_aws or not resource_type:
            return

        # 해당 리소스의 Baseline 조회
        baselines = db.query(ResourceBaseline).filter(
            ResourceBaseline.resource_id_aws == resource_id_aws,
            ResourceBaseline.resource_type   == resource_type,
        ).all()

        if not baselines:
            # Baseline 없음 → 신규 리소스, 무시
            return

        for baseline in baselines:
            diff_detail  = build_diff(baseline.baseline_config, current_config)
            changed_keys = diff_detail.get("changed_keys", [])

            if not changed_keys:
                continue  # 실제 변경 없음

            severity    = classify_severity(resource_type, diff_detail)
            diff_summary = f"{len(changed_keys)}개 설정 변경 ({', '.join(changed_keys[:3])})"

            # drift_events 저장
            drift_event = DriftEvent(
                id              = str(uuid.uuid4()),
                project_id      = baseline.project_id,
                resource_id_aws = resource_id_aws,
                resource_type   = resource_type,
                changed_by      = changed_by,
                diff_summary    = diff_summary,
                diff_detail     = diff_detail,
                severity        = severity,
                status          = "detected",
            )
            db.add(drift_event)
            db.commit()
            db.refresh(drift_event)

            # 프로젝트 소유자 Slack Webhook 조회
            project = db.query(Project).filter(
                Project.project_id == baseline.project_id
            ).first()
            if project:
                user = db.query(User).filter(User.user_id == project.user_id).first()
                if user and user.slack_webhook_url:
                    send_drift_slack(
                        severity     = severity,
                        resource_type= resource_type,
                        resource_id  = resource_id_aws,
                        diff_summary = diff_summary,
                        changed_by   = changed_by,
                        webhook_url  = user.slack_webhook_url,
                    )

            # WebSocket drift_detected 이벤트 발행
            _publish_drift_websocket(
                project_id    = baseline.project_id,
                drift_event_id= drift_event.id,
                resource_id   = resource_id_aws,
                resource_type = resource_type,
                severity      = severity,
                diff_summary  = diff_summary,
            )

    except Exception as e:
        print(f"[DriftWorker] 처리 오류:{e}")
    finally:
        db.close()


def _publish_drift_websocket(
    project_id: str,
    drift_event_id: str,
    resource_id: str,
    resource_type: str,
    severity: str,
    diff_summary: str,
):
    """기존 WebSocket 채널에 drift_detected 이벤트 추가 발행"""
    # websocket.py의 active_connections 딕셔너리 활용
    from app.api.websocket import active_connections
    import asyncio

    payload = json.dumps({
        "type": "drift_detected",
        "data": {
            "drift_id":     drift_event_id,
            "resource_id":  resource_id,
            "resource_type": resource_type,
            "severity":     severity,
            "diff_summary": diff_summary,
            "detected_at":  datetime.utcnow().isoformat() + "Z",
        },
    })

    connections = active_connections.get(project_id, [])
    for ws in connections:
        try:
            asyncio.run(ws.send_text(payload))
        except Exception:
            pass

def _poll_drift_sqs():
    """Drift SQS 큐 롱폴링 (백그라운드 스레드)"""
    if not settings.drift_sqs_queue_url:
        print("[DriftWorker] DRIFT_SQS_QUEUE_URL 미설정 — Drift 폴링 스킵")
        return

    sqs = boto3.client("sqs", region_name=settings.aws_default_region)
    print("[DriftWorker] Drift SQS 폴링 시작")

    while True:
        try:
            response = sqs.receive_message(
                QueueUrl            = settings.drift_sqs_queue_url,
                MaxNumberOfMessages = 10,
                WaitTimeSeconds     = 20,
            )
            messages = response.get("Messages", [])

            for msg in messages:
                try:
                    body = json.loads(msg["Body"])
                    process_drift_event(body)
                except Exception as e:
                    print(f"[DriftWorker] 메시지 처리 오류: {e}")
                finally:
                    sqs.delete_message(
                        QueueUrl      = settings.drift_sqs_queue_url,
                        ReceiptHandle = msg["ReceiptHandle"],
                    )
        except Exception as e:
            print(f"[DriftWorker] SQS 폴링 오류: {e}")
            import time; time.sleep(5)



async def start_drift_worker():
    """main.py lifespan에서 호출되는 비동기 래퍼"""
    import asyncio
    loop = asyncio.get_event_loop()
    t = threading.Thread(target=_poll_drift_sqs, daemon=True)
    t.start()
    print("[DriftWorker] Drift SQS 폴링 시작")
    # 태스크가 cancel될 때까지 대기
    try:
        while True:
            await asyncio.sleep(60)
    except asyncio.CancelledError:
        print("[DriftWorker] Drift Worker 종료")