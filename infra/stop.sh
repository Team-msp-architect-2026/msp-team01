#!/bin/bash
set -e
echo "🛑 AutoOps 플랫폼 인프라 중지 시작..."

# ECS Service desired count → 0
aws ecs update-service \
  --cluster autoops-cluster \
  --service autoops-backend-service \
  --desired-count 0 \
  --region us-west-2 > /dev/null
echo "✅ ECS Service 중지"

# 프론트엔드 ECS Service desired count → 0
aws ecs update-service \
  --cluster autoops-cluster \
  --service autoops-frontend-service \
  --desired-count 0 \
  --region us-west-2 > /dev/null
echo "✅ 프론트엔드 ECS Service 중지"

# RDS 중지
aws rds stop-db-instance \
  --db-instance-identifier autoops-platform-rds \
  --region us-west-2 > /dev/null
echo "✅ RDS 중지 요청 (완료까지 약 1~2분)"

echo "🛑 AutoOps 플랫폼 인프라 중지 완료"
echo "재시작: ./infra/start.sh"