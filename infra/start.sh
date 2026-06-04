#!/bin/bash
set -e
echo "🚀 AutoOps 플랫폼 인프라 시작..."

# RDS 시작
RDS_STATUS=$(aws rds describe-db-instances \
  --db-instance-identifier autoops-platform-rds \
  --region us-west-2 \
  --query 'DBInstances[0].DBInstanceStatus' --output text)

if [ "${RDS_STATUS}" = "stopped" ]; then
  aws rds start-db-instance \
    --db-instance-identifier autoops-platform-rds \
    --region us-west-2 > /dev/null
  echo "⏳ RDS 시작 중... (약 3~5분 소요)"
  aws rds wait db-instance-available \
    --db-instance-identifier autoops-platform-rds \
    --region us-west-2
  echo "✅ RDS 시작 완료"
else
  echo "ℹ️ RDS 이미 실행 중:${RDS_STATUS}"
fi

# ECS Service desired count → 1
aws ecs update-service \
  --cluster autoops-cluster \
  --service autoops-backend-service \
  --desired-count 1 \
  --region us-west-2 > /dev/null
echo "✅ ECS Service 시작"

# 프론트엔드 ECS Service desired count → 1
aws ecs update-service \
  --cluster autoops-cluster \
  --service autoops-frontend-service \
  --desired-count 1 \
  --region us-west-2 > /dev/null
echo "✅ 프론트엔드 ECS Service 시작"

echo "🚀 AutoOps 플랫폼 인프라 시작 완료"