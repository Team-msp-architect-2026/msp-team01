#!/bin/bash
# infra/build-frontend.sh

# ECR 로그인
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 611058323802.dkr.ecr.us-west-2.amazonaws.com

# 프론트엔드 빌드 & 푸시
docker buildx build \
  --platform linux/amd64 \
  --no-cache \
  --push \
  --build-arg NEXT_PUBLIC_API_URL=https://d1zl418y69bnx0.cloudfront.net \
  --build-arg NEXT_PUBLIC_WS_URL=wss://d1zl418y69bnx0.cloudfront.net \
  -t 611058323802.dkr.ecr.us-west-2.amazonaws.com/autoops-frontend:latest \
  ~/project/AOps/msp-team01/frontend

echo "✅ 프론트엔드 빌드 완료"