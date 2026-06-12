#!/bin/bash

echo "[AutoOps Runner] 시작: DEPLOYMENT_ID=${DEPLOYMENT_ID}, ACTION=${ACTION}"

# ── 콜백 함수 ──────────────────────────────────────────────────────
send_callback() {
  local status=$1
  local error_msg=$2

  if [ -z "${BACKEND_API_URL}" ] || [ -z "${INTERNAL_SECRET}" ]; then
    echo "[AutoOps Runner] 콜백 URL 미설정 — 콜백 생략"
    return
  fi

  if [ -z "${error_msg}" ]; then
    BODY="{\"status\": \"${status}\", \"project_id\": \"${PROJECT_ID}\"}"
  else
    ESCAPED=$(echo "${error_msg}" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo "\"오류 발생\"")
    BODY="{\"status\": \"${status}\", \"project_id\": \"${PROJECT_ID}\", \"error_message\": ${ESCAPED}}"
  fi

  echo "[AutoOps Runner] 콜백 전송: status=${status}"
  curl -s -X POST "${BACKEND_API_URL}/api/craft/internal/deployments/${DEPLOYMENT_ID}/complete" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Secret: ${INTERNAL_SECRET}" \
    -d "${BODY}" || echo "[AutoOps Runner] 콜백 전송 실패 (무시)"
}

# ── S3에서 main.tf 다운로드 ─────────────────────────────────────────
mkdir -p /workspace/tf
aws s3 cp "${HCL_S3_PATH}" /workspace/tf/main.tf
if [ $? -ne 0 ]; then
  echo "[AutoOps Runner] main.tf 다운로드 실패"
  send_callback "failed" "main.tf S3 다운로드 실패: ${HCL_S3_PATH}"
  exit 1
fi
echo "[AutoOps Runner] main.tf 다운로드 완료: ${HCL_S3_PATH}"

cd /workspace/tf

# ── Cross-Account Role Assume 검증 (자격증명 교체 없음) ─────────────
# provider 블록의 assume_role이 terraform apply 시점에 처리
# backend(S3/DynamoDB)는 AutoOpsTaskRole 자격증명 그대로 사용
aws sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "autoops-verify-${DEPLOYMENT_ID}" \
  --external-id "${EXTERNAL_ID}" \
  --duration-seconds 900 \
  > /dev/null
if [ $? -ne 0 ]; then
  echo "[AutoOps Runner] Cross-Account Role Assume 검증 실패"
  send_callback "failed" "IAM Role Assume 실패: ${ROLE_ARN}"
  exit 1
fi
echo "[AutoOps Runner] Cross-Account Role Assume 완료"

# ── terraform init ──────────────────────────────────────────────────
# 이 시점 자격증명 = AutoOpsTaskRole (플랫폼 계정)
# → S3/DynamoDB backend 접근 정상
terraform init -input=false
if [ $? -ne 0 ]; then
  echo "[AutoOps Runner] terraform init 실패"
  if [ "${ACTION}" = "destroy" ]; then
    send_callback "destroy_failed" "terraform init 실패 (destroy)"
  else
    send_callback "failed" "terraform init 실패"
  fi
  exit 1
fi
echo "[AutoOps Runner] terraform init 완료"

# ── terraform apply 또는 destroy ────────────────────────────────────
# provider 블록의 assume_role이 사용자 계정으로 전환
# → 리소스 생성/삭제는 사용자 계정에서 실행
if [ "${ACTION}" = "destroy" ]; then
  terraform destroy -auto-approve -input=false
  TF_EXIT=$?
  if [ $TF_EXIT -ne 0 ]; then
    echo "[AutoOps Runner] terraform destroy 실패"
    send_callback "destroy_failed" "terraform destroy 실패 (exit code: ${TF_EXIT})"
    exit 1
  fi
  echo "[AutoOps Runner] terraform destroy 완료"
  send_callback "destroyed" ""

else
  terraform apply -auto-approve -input=false
  TF_EXIT=$?
  if [ $TF_EXIT -ne 0 ]; then
    echo "[AutoOps Runner] terraform apply 실패"
    send_callback "partial_failed" "terraform apply 실패 (exit code: ${TF_EXIT})"
    exit 1
  fi
  echo "[AutoOps Runner] terraform apply 완료"
  send_callback "completed" ""
fi

echo "[AutoOps Runner] 완료"