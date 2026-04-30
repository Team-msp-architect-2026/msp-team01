# terraform-runner/Dockerfile
# ECS Fargate는 linux/amd64 실행 — Mac(arm64)에서 빌드 시 platform 명시 필수 (§3 Docker 플랫폼 주의)
FROM hashicorp/terraform:1.14.8

# 필수 도구 설치
RUN apk add --no-cache \
    python3 \
    py3-pip \
    aws-cli \
    curl \
    jq \
    bash

WORKDIR /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]