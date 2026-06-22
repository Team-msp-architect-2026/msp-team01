#!/bin/bash
set -e

echo "[Failover Runner] 시작: FAILOVER_ID=${FAILOVER_ID}, ACTION=${ACTION}"

# ── CloudWatch 로그 그룹/스트림 생성 ────────────────────────────────
LOG_GROUP="/autoops/failover/${FAILOVER_ID}"
LOG_STREAM="failover"

aws logs create-log-group --log-group-name "${LOG_GROUP}" --region us-west-2 2>/dev/null || true
aws logs create-log-stream --log-group-name "${LOG_GROUP}" --log-stream-name "${LOG_STREAM}" --region us-west-2 2>/dev/null || true

_log() {
    local msg="$1"
    local ts=$(date +%s%3N)
    echo "[Failover Runner] ${msg}"
    aws logs put-log-events \
        --log-group-name "${LOG_GROUP}" \
        --log-stream-name "${LOG_STREAM}" \
        --log-events "[{\"timestamp\":${ts},\"message\":\"${msg}\"}]" \
        --region us-west-2 2>/dev/null || true
}

# ── S3에서 main.tf 다운로드 ─────────────────────────────────────────
mkdir -p /workspace/tf
_log "S3에서 main.tf 다운로드 중..."
aws s3 cp "${HCL_S3_PATH}" /workspace/tf/main.tf
_log "main.tf 다운로드 완료"

cd /workspace/tf

# ── GCP 인증 ────────────────────────────────────────────────────────
_log "GCP SA 키 로드 중..."
SA_KEY=$(aws secretsmanager get-secret-value \
  --secret-id "${GCP_SECRET_ARN}" \
  --region us-west-2 \
  --query SecretString \
  --output text)

echo "${SA_KEY}" > /tmp/gcp-sa-key.json
gcloud auth activate-service-account \
  --key-file=/tmp/gcp-sa-key.json \
  --project="${GCP_PROJECT_ID}"
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp-sa-key.json
_log "GCP 인증 완료 (프로젝트: ${GCP_PROJECT_ID})"

# ── GCS State 버킷 생성 ─────────────────────────────────────────────
BUCKET_NAME="autoops-dr-state-${PROJECT_ID}"
_log "GCS State 버킷 확인: ${BUCKET_NAME}"
if gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="${GCP_PROJECT_ID}" 2>/dev/null; then
    _log "GCS 버킷 이미 존재: ${BUCKET_NAME}"
else
    gcloud storage buckets create "gs://${BUCKET_NAME}" --location=us-west1 --project="${GCP_PROJECT_ID}" && _log "GCS 버킷 생성 완료: ${BUCKET_NAME}"
fi

# ── terraform init ──────────────────────────────────────────────────
_log "terraform init 실행 중..."
terraform init -no-color -reconfigure 2>&1 | while read line; do
    _log "${line}"
done
_log "terraform init 완료"

# ── terraform apply 또는 destroy ────────────────────────────────────
if [ "${ACTION}" = "destroy" ]; then
    _log "terraform destroy 실행 중 (GCP 리소스 삭제 시작)..."
    terraform destroy -auto-approve -no-color -json 2>&1 | while read line; do
        msg=$(echo "${line}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('@message',''))" 2>/dev/null || echo "${line}")
        [ -n "${msg}" ] && _log "${msg}"
    done
    TF_EXIT=${PIPESTATUS[0]}
else
    _log "terraform apply 실행 중 (GCP 리소스 생성 시작)..."
    _log "Cloud SQL 생성에 약 10~15분 소요됩니다."
    echo "0" > /tmp/tf_resources_added
    terraform apply -auto-approve -no-color -json 2>&1 | while read line; do
        msg=$(echo "${line}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('@message',''))" 2>/dev/null || echo "${line}")
        echo "${line}" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
    if d.get('type')=='change_summary':
        count=d.get('changes',{}).get('add',0)
        if count: open('/tmp/tf_resources_added','w').write(str(count))
except: pass
" 2>/dev/null || true
        [ -n "${msg}" ] && _log "${msg}"
    done
    TF_EXIT=${PIPESTATUS[0]}
    RESOURCES_ADDED=$(cat /tmp/tf_resources_added 2>/dev/null || echo "0")
fi

# ── 완료 상태 백엔드로 전송 ─────────────────────────────────────────
if [ "${TF_EXIT}" -eq 0 ]; then
    _log "✅ terraform ${ACTION} 완료"
    if [ "${ACTION}" = "destroy" ]; then
        curl -s -X POST "${BACKEND_API_URL}/api/mirror/${PROJECT_ID}/failover/${FAILOVER_ID}/internal-complete" \
          -H "Content-Type: application/json" \
          -H "X-Internal-Secret: ${INTERNAL_SECRET}" \
          -d "{\"action\":\"${ACTION}\",\"status\":\"success\"}"
    else
        curl -s -X POST "${BACKEND_API_URL}/api/mirror/${PROJECT_ID}/failover/${FAILOVER_ID}/internal-complete" \
          -H "Content-Type: application/json" \
          -H "X-Internal-Secret: ${INTERNAL_SECRET}" \
          -d "{\"action\":\"${ACTION}\",\"status\":\"success\",\"resources_created\":${RESOURCES_ADDED}}"
    fi
else
    _log "❌ terraform ${ACTION} 실패 (exit code: ${TF_EXIT})"
    curl -s -X POST "${BACKEND_API_URL}/api/mirror/${PROJECT_ID}/failover/${FAILOVER_ID}/internal-complete" \
      -H "Content-Type: application/json" \
      -H "X-Internal-Secret: ${INTERNAL_SECRET}" \
      -d "{\"action\":\"${ACTION}\",\"status\":\"failed\"}"
fi

echo "[Failover Runner] 완료"