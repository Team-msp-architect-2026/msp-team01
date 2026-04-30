# ☁️ AutoOps

<div align="center">
  <img width="945" height="276" alt="main banner" src="https://github.com/user-attachments/assets/8a98bee0-47d2-460d-9ad2-e573e407ef38" />

  <br><br>

  **자연어 입력 하나로 AWS 인프라를 배포하고, GCP 재해복구(DR) 환경이 자동으로 준비되는 멀티클라우드 자동화 플랫폼**

  <br>

  인프라 구축의 병목, 반복적인 수동 IaC 작성, 방치되는 DR 환경이라는 세 가지 실무 문제를 해결하기 위해
  <b>CraftOps(지능형 인프라 프로비저닝)</b> 와 <b>MirrorOps(실시간 재해복구 자동화)</b> 를 단일 파이프라인으로 연결한 플랫폼입니다.
</div>

---

## 👥 팀원

| 역할 | 이름 | 담당 파트 | 주요 책임 |
|------|------|-----------|-----------|
| 팀장 (PM) · 아키텍트 | 김&nbsp;태&nbsp;승 | MirrorOps | 일정 관리 · 문서화 · 통합 조율 · 발표 주도 · 멀티클라우드 아키텍처 설계 · 이벤트 파이프라인 설계 |
| 테크 리드 · QA/DevOps 리드 | 김&nbsp;영&nbsp;찬 | CraftOps | DAG 엔진 · LLM 파이프라인 · Terraform Runner · CI/CD · 보안 스캔 통합 · 배포 자동화 |

---

## 🛠️ Tech Stack

<div align="center">

**⚛️ Frontend**<br>
<img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB">
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
<img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white">
<img src="https://img.shields.io/badge/shadcn/ui-000000?style=for-the-badge&logo=shadcnui&logoColor=white">
<br><br>

**🐍 Backend & AI**<br>
<img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white">
<img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white">
<img src="https://img.shields.io/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white">
<img src="https://img.shields.io/badge/AWS_Bedrock-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white">
<br><br>

**🏗️ Infrastructure & IaC**<br>
<img src="https://img.shields.io/badge/Terraform-7B42BC?style=for-the-badge&logo=terraform&logoColor=white">
<img src="https://img.shields.io/badge/AWS-232F3E?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/GCP-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white">
<img src="https://img.shields.io/badge/ECS_Fargate-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white">
<br><br>

**💾 Database & Messaging**<br>
<img src="https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_RDS-527FFF?style=for-the-badge&logo=amazonrds&logoColor=white">
<img src="https://img.shields.io/badge/DynamoDB-4053D6?style=for-the-badge&logo=amazondynamodb&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_SQS-FF4F8B?style=for-the-badge&logo=amazonsqs&logoColor=white">
<br><br>

**🔐 Auth & Security**<br>
<img src="https://img.shields.io/badge/Amazon_Cognito-DD344C?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/tfsec-4A154B?style=for-the-badge&logo=security&logoColor=white">
<img src="https://img.shields.io/badge/Checkov-157EFB?style=for-the-badge&logo=bridgecrew&logoColor=white">
<br><br>

**🚀 CI/CD & Monitoring**<br>
<img src="https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_EventBridge-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/CloudWatch-FF4F8B?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/Infracost-7B42BC?style=for-the-badge&logo=terraform&logoColor=white">

</div>

---

## 💡 프로젝트 개요 (Overview)

AutoOps는 인프라 엔지니어가 **반복적인 코드 작성 대신 아키텍처 설계와 보안 정책 수립 등 본연의 업무에 집중할 수 있는 환경**을 만들기 위해 탄생했습니다.

개발팀의 인프라 요청부터 실제 배포까지 평균 5~7일이 걸리는 병목, 유사한 3-Tier 구성을 매번 처음부터 수동으로 작성하는 비효율, 비용과 복잡도를 이유로 항상 후순위로 밀리는 DR 구축이라는 세 가지 실무 문제를 동시에 해결합니다.

플랫폼은 두 개의 서브시스템이 하나의 자동화 파이프라인으로 연결됩니다.

- **CraftOps** — "자연어로 설계하고, AI가 검증하며, 사람이 최종 결정한다" (Guided, Not Magic)
- **MirrorOps** — "AWS 인프라가 배포되는 순간, GCP DR이 자동으로 준비된다"

---

## ✨ 핵심 기능 (Features)

- 🗣️ **자연어 인프라 설계 (Intent Analysis):** "프로덕션용 Python API 서버, PostgreSQL DB, 오레곤 리전"과 같은 자연어 프롬프트를 Gemini 2.5 Flash가 분석해 환경·리전·워크로드를 자동으로 추출하고 6단계 위저드 폼을 채워줍니다.

- 🕸️ **의존성 기반 설계 엔진 (DAG Engine):** VPC → Subnet → SG → ALB → ECS → RDS 순서로 리소스 간 선행 관계를 그래프(DAG)로 관리하여, 선행 리소스 누락으로 인한 배포 실패를 원천 차단합니다.

- 🔒 **4단계 Validation Loop:** `terraform validate` 자동 수정(Self-Correction 최대 3회) → `tfsec + checkov` 보안 스캔(CRITICAL 이슈 배포 차단) → `Infracost` 월 비용 예측 → `terraform plan` 리소스 미리보기까지 단계별 검증 후 사람이 최종 확인합니다.

- ⚡ **Ephemeral ECS Task 기반 격리 배포:** terraform apply를 완전히 격리된 일회용 ECS Task에서 실행하여 백엔드 서버와 Terraform 실행 환경을 분리합니다. CloudWatch → WebSocket을 통해 배포 로그를 브라우저에 실시간으로 스트리밍합니다.

- 🪞 **이벤트 기반 DR 자동화 (MirrorOps):** AWS 배포가 완료되는 순간 EventBridge가 감지해 MirrorOps 파이프라인을 자동 트리거합니다. 룰 기반(6개) + AWS Bedrock 보완(5개)으로 AWS 리소스를 GCP로 자동 매핑하고 Terraform HCL을 생성합니다.

- 📦 **2단계 비동기 DR Package:** GCP Terraform HCL + Skopeo ECR→GCR 이미지 복사를 즉시 완료하고, RDS 스냅샷 Export는 비동기로 처리해 DR Package를 S3에 상시 최신 상태로 유지합니다.

- 🔄 **원클릭 페일오버:** 재해 발생 시 시뮬레이션 모드(terraform plan, 실제 실행 없음)로 예상 RTO를 먼저 확인하고, Actual 모드로 GCP 복구를 즉시 실행합니다.

---

## 🚀 기술적 핵심 성과 (Architecture Highlights)

### 1. 비용 90% 절감 Warm Standby DR 전략
GCP를 상시 가동하는 Hot Standby 방식 대신, 즉시 배포 가능한 **DR Package(Terraform HCL + 컨테이너 이미지 + DB 스냅샷)를 S3에 상시 최신화**하는 Warm Standby 전략을 채택했습니다. GCP 상시 운영 대비 약 90% 이상의 비용을 절감하면서도 **목표 RTO 12분 이내, RPO 3분 이내**의 복구 능력을 유지합니다.

### 2. AI + 룰 엔진 하이브리드 매핑 아키텍처
AWS → GCP 리소스 변환에 단일 AI에 의존하지 않고 **룰 기반(6개 리소스, 신뢰도 auto) + AWS Bedrock Claude Sonnet(5개 리소스, 신뢰도 review)** 의 하이브리드 전략을 설계했습니다. 표준 리소스는 결정론적 룰로 빠르게 처리하고, SG→Firewall 변환처럼 복잡한 매핑만 AI로 보완해 신뢰도와 비용을 동시에 최적화했습니다.

### 3. Self-Correction Loop 기반 자동 코드 수정
Gemini가 생성한 Terraform HCL이 `terraform validate`를 통과하지 못할 경우, 에러 메시지를 컨텍스트로 포함해 Gemini가 스스로 수정을 시도하는 **Self-Correction Loop(최대 3회)** 를 구현했습니다. 3회 실패 시에만 사용자에게 수동 편집을 요청하여 AI 코드 생성의 신뢰성을 구조적으로 보장합니다.

### 4. 이벤트 기반 멀티클라우드 파이프라인 (EventBridge + SQS 디바운싱)
CraftOps → MirrorOps 트리거를 사람의 개입 없이 **EventBridge InfraDeploymentCompleted 이벤트**로 자동 연결했습니다. 연속적인 인프라 변경으로 인한 중복 파이프라인 실행을 막기 위해 SQS VisibilityTimeout 5분 디바운싱을 적용했습니다.

### 5. Partial Failure 대응 — 배포 실패 시 선택지 제공
terraform apply 중 부분 실패가 발생하더라도 현재 State를 보존하고 **Resume(재실행) / Fix & Retry(수정 후 재시도) / Full Destroy(전체 정리)** 세 가지 선택지를 제공합니다. 실패를 전체 롤백이 아닌 복구 가능한 상태로 다루어 불필요한 리소스 재생성 비용을 방지합니다.

---

## 🎮 Quick Start (Local Demo)

> 🚧 **추후 작성 예정**
>
> 프로젝트 완성 후 Docker Compose 기반 로컬 실행 가이드를 작성할 예정입니다.

---

## 📚 상세 문서 및 회고 (Wiki)

아키텍처 설계부터 DR 시나리오 검증, 페일오버 RTO 측정 결과까지 프로젝트의 모든 의사결정과 엔지니어링 기록은 아래 Wiki에 상세히 문서화되어 있습니다.

- **[🏠 Home (프로젝트 위키 홈)](https://github.com/Team-msp-architect-2026/msp-team01/wiki)**
  전체 위키 문서의 네비게이션 허브. 각 엔지니어링 단계별 상세 문서로 이동할 수 있는 인덱스를 제공합니다.

- **[🎯 Project Story & Features (기획 의도 및 서비스 소개)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Project-Story-and-Features)**
  인프라 구축 병목, 수동 IaC 반복, 방치되는 DR이라는 세 가지 실무 문제에서 AutoOps가 탄생하게 된 배경과 9단계 사용자 여정, 핵심 기능을 소개합니다.

- **[🛠️ Tech Stack & Decisions (기술 선정 배경)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Tech-Stack-and-Decisions)**
  단순한 AI 코드 생성이 아닌 Self-Correction + Validation Loop 구조를 선택한 이유, Warm Standby vs Hot Standby 트레이드오프, 룰 엔진 + Bedrock 하이브리드 매핑 전략의 결정 근거를 다룹니다.

- **[🏛️ Architecture (아키텍처 설계)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Architecture)**
  전체 시스템 흐름도, CraftOps ↔ MirrorOps 연동 구조, EventBridge 이벤트 설계, 9단계 사용자 여정의 기술적 구현 방식을 설명합니다.

- **[⚙️ CraftOps (지능형 인프라 프로비저닝)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/CraftOps-Overview)**
  DAG 의존성 엔진 설계, Gemini Self-Correction Loop, Validation Loop 4단계 상세, Ephemeral ECS Task 기반 Terraform Runner 구조를 설명합니다.

- **[🪞 MirrorOps (실시간 재해복구 자동화)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/MirrorOps-Overview)**
  AWS 리소스 자동 감지(AWS Config + boto3), 룰 기반 + Bedrock 하이브리드 매핑 엔진, DR Package 2단계 비동기 구성, Warm Standby 전략과 원클릭 페일오버 실행 흐름을 설명합니다.

- **[🖥️ Infrastructure Setup (인프라 구성)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Infrastructure-Setup)**
  AWS 공용 리소스 구성(S3, DynamoDB, ECR, Cognito), GCP DR 환경(Cloud Run, Cloud SQL, VPC), Cross-Account IAM Role 설계, 리전 정책(us-west-2 / us-west1)을 다룹니다.

- **[🚀 CI/CD Pipeline (GitHub Actions 파이프라인)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/CI-CD-Pipeline)**
  백엔드 ECS 자동 배포, 프론트엔드 S3+CloudFront 배포, Mac Apple Silicon linux/amd64 빌드 주의사항, 브랜치 전략을 설명합니다.

- **[🤝 Collaboration Guide (개발 협업 가이드)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Collaboration-Guide)**
  팀원별 개발 환경 설정(Mac / WSL2), Git 브랜치 전략, Alembic 마이그레이션 협업 규칙, .env 관리 정책을 다룹니다.

- **[📈 Scenario & Testing (DR 시나리오 검증 및 테스트)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Scenario-and-Testing)**
  실제 재해 상황을 가정한 페일오버 시나리오 검증, RTO/RPO 실측 결과, Simulation 모드 vs Actual 모드 비교 리포트를 담고 있습니다.

- **[⚡ Performance Improvement (성능 개선 이력)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Performance-Improvement)**
  성능 개선 전후 비교 및 측정 결과를 기록합니다.

- **[💰 Cost & Policy (비용 산정 및 운영 정책)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Cost-and-Policy)**
  Infracost 기반 리소스별 월 예상 비용, 야간 중지 정책(평일 업무 외 시간 가동률 약 27%), Warm Standby 90% 비용 절감 산정 근거를 다룹니다.

- **[🔥 Troubleshooting (문제 해결 기록)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Troubleshooting)**
  Partial Failure 대응 설계 과정, Mac Apple Silicon linux/amd64 빌드 이슈, Terraform State Lock 충돌, Alembic 마이그레이션 충돌 등 실제 개발 과정에서 겪은 문제와 해결 과정을 기록합니다.

- **[📝 Meetings & Feedback (주간 회의록)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Meetings-and-Feedback)**
  주간 회의 및 멘토링을 통해 도출된 피드백과 이를 실제 아키텍처에 반영한 의사결정 기록입니다.

- **[🌟 Retrospective & Vision (최종 회고 및 향후 비전)](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Retrospective-and-Vision)**
  멀티클라우드 자동화 플랫폼을 팀으로 설계하고 구현하며 겪은 엔지니어링 회고와 향후 비전을 담고 있습니다.

- **[📋 Kanban Board (프로젝트 작업 보드)](https://github.com/orgs/Team-msp-architect-2026/projects/3)**
  프로젝트 전체 기간 동안 발행된 모든 이슈와 Epic 진행 상황을 관리하고 추적한 칸반 보드입니다.
