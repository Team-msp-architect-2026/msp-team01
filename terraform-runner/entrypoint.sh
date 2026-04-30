# terraform-runner/entrypoint.sh
#!/bin/bash
set -e

# ── 환경변수 (ECS Task 실행 시 주입) ───────────────────────────────
# PROJECT_ID       : AutoOps 프로젝트 ID
# DEPLOYMENT_ID    : 배포 ID (CloudWatch 로그 그룹 식별자)
# HCL_S3_PATH      : main.tf가 저장된 S3 경로
# ROLE_ARN         : 사용자 AWS 계정 Cross-Account IAM Role ARN
# REGION           : 사용자 인프라 배포 리전
# ACTION           : apply | destroy
# AWS_DEFAULT_REGION=us-west-2 (AutoOps 플랫폼 리전)

echo "[AutoOps Runner] 시작: DEPLOYMENT_ID=${DEPLOYMENT_ID}, ACTION=${ACTION}"

# ── S3에서 main.tf 다운로드 ─────────────────────────────────────────
mkdir -p /workspace/tf
aws s3 cp "${HCL_S3_PATH}" /workspace/tf/main.tf
echo "[AutoOps Runner] main.tf 다운로드 완료:${HCL_S3_PATH}"

cd /workspace/tf

# ── Cross-Account Role Assume ───────────────────────────────────────
# 사용자 AWS 계정에 실제 인프라를 배포하기 위해 AutoOpsRole을 Assume
CREDS=$(aws sts assume-role \
  --role-arn "${ROLE_ARN}" \
  --role-session-name "autoops-deploy-${DEPLOYMENT_ID}" \
  --duration-seconds 3600 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text)

export AWS_ACCESS_KEY_ID=$(echo $CREDS | awk '{print $1}')
export AWS_SECRET_ACCESS_KEY=$(echo $CREDS | awk '{print $2}')
export AWS_SESSION_TOKEN=$(echo $CREDS | awk '{print $3}')
export AWS_DEFAULT_REGION="${REGION}"

echo "[AutoOps Runner] Cross-Account Role Assume 완료"

# ── terraform init ──────────────────────────────────────────────────
# backend는 main.tf에 이미 정의되어 있음 (§4-6: autoops-terraform-state)
terraform init -input=false
echo "[AutoOps Runner] terraform init 완료"

# ── terraform apply 또는 destroy ────────────────────────────────────
if [ "${ACTION}" = "destroy" ]; then
  terraform destroy -auto-approve -input=false
  echo "[AutoOps Runner] terraform destroy 완료"
else
  terraform apply -auto-approve -input=false
  echo "[AutoOps Runner] terraform apply 완료"
fi

echo "[AutoOps Runner] 완료"