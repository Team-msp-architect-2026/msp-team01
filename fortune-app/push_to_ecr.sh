#!/bin/bash
# ============================================================
# Fortune 샘플 앱 이미지 빌드 & ECR 푸시
# Usage: ./push_to_ecr.sh
# 실행 환경: WSL2 (Ubuntu), Docker 실행 중이어야 함
# ============================================================

set -euo pipefail

# ── 설정값 ──────────────────────────────────────────────────
AWS_ACCOUNT_ID="611058323802"
AWS_REGION="us-west-2"
REPO_NAME="autoops-sample-app"
IMAGE_TAG="latest"

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"

echo "======================================================"
echo "  Fortune 샘플 앱 → ECR 빌드 & 푸시"
echo "  레포: ${ECR_URI}"
echo "======================================================"

# ── Step 1: ECR 레포 생성 (이미 존재하면 skip) ──────────────
echo ""
echo "[1/4] ECR 레포 확인/생성..."
aws ecr describe-repositories \
  --repository-names "${REPO_NAME}" \
  --region "${AWS_REGION}" \
  --query 'repositories[0].repositoryName' \
  --output text 2>/dev/null && echo "  ✅ 레포 이미 존재: ${REPO_NAME}" || {
    echo "  생성 중..."
    aws ecr create-repository \
      --repository-name "${REPO_NAME}" \
      --region "${AWS_REGION}" \
      --image-scanning-configuration scanOnPush=true \
      --query 'repository.repositoryUri' \
      --output text
    echo "  ✅ ECR 레포 생성 완료: ${REPO_NAME}"
  }

# ── Step 2: ECR 로그인 ───────────────────────────────────────
echo ""
echo "[2/4] ECR 로그인..."
aws ecr get-login-password \
  --region "${AWS_REGION}" | \
docker login \
  --username AWS \
  --password-stdin \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "  ✅ ECR 로그인 완료"

# ── Step 3: 이미지 빌드 (linux/amd64 고정) ───────────────────
echo ""
echo "[3/4] Docker 이미지 빌드 (linux/amd64)..."
docker build \
  --platform linux/amd64 \
  --tag "${REPO_NAME}:${IMAGE_TAG}" \
  .
echo "  ✅ 빌드 완료: ${REPO_NAME}:${IMAGE_TAG}"

# ── Step 4: 태그 & 푸시 ─────────────────────────────────────
echo ""
echo "[4/4] ECR 푸시..."
docker tag "${REPO_NAME}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:${IMAGE_TAG}"

echo ""
echo "======================================================"
echo "  ✅ 완료!"
echo ""
echo "  ECR 이미지 URI:"
echo "  ${ECR_URI}:${IMAGE_TAG}"
echo ""
echo "  위저드 Step 2~5 ECS 컨테이너 이미지 필드에 위 URI 입력"
echo "  (또는 Terraform 템플릿에 하드코딩 가능)"
echo "======================================================"
