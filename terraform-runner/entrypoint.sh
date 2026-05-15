#!/bin/bash
# terraform-runner/entrypoint.sh
# set -e 제거 — 오류 발생 시 콜백 전송 후 종료하기 위해

# ── 환경변수 (ECS Task 실행 시 주입) ───────────────────────────────
# PROJECT_ID       : AutoOps 프로젝트 ID
# DEPLOYMENT_ID    : 배포 ID
# HCL_S3_PATH      : main.tf가 저장된 S3 경로
# ROLE_ARN         : 사용자 AWS 계정 Cross-Account IAM Role ARN
# REGION           : 사용자 인프라 배포 리전
# ACTION           : apply | destroy
# EXTERNAL_ID      : AssumeRole ExternalId (user_id)
# BACKEND_API_URL  : 백엔드 ALB URL (콜백용)
# INTERNAL_SECRET  : 내부 API 시크릿
# AWS_DEFAULT_REGION=us-west-2 (AutoOps 플랫폼 리전)

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

# ── Cross-Account Role Assume ───────────────────────────────────────
CREDS=$(aws sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "autoops-deploy-${DEPLOYMENT_ID}" \
  --external-id "${EXTERNAL_ID}" \
  --duration-seconds 3600 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text)

if [ $? -ne 0 ]; then
  echo "[AutoOps Runner] Cross-Account Role Assume 실패"
  send_callback "failed" "IAM Role Assume 실패: ${ROLE_ARN}"
  exit 1
fi

export AWS_ACCESS_KEY_ID=$(echo $CREDS | awk '{print $1}')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | awk '{print $2}')
export AWS_SESSION_TOKEN=$(echo $CREDS | awk '{print $3}')
export AWS_DEFAULT_REGION="${REGION}"

echo "[AutoOps Runner] Cross-Account Role Assume 완료"

# ── terraform init ──────────────────────────────────────────────────
terraform init -input=false
if [ $? -ne 0 ]; then
  echo "[AutoOps Runner] terraform init 실패"
  # apply 실패 → partial_failed / destroy 실패 → destroy_failed
  if [ "${ACTION}" = "destroy" ]; then
    send_callback "destroy_failed" "terraform init 실패 (destroy)"
  else
    send_callback "failed" "terraform init 실패"
  fi
  exit 1
fi
echo "[AutoOps Runner] terraform init 완료"

# ── terraform apply 또는 destroy ────────────────────────────────────
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