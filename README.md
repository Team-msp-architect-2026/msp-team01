# ☁️ AutoOps

<div align="center">
  <img width="945" height="276" alt="main banner" src="https://github.com/user-attachments/assets/8a98bee0-47d2-460d-9ad2-e573e407ef38" />

  <br><br>

  **자연어 입력 하나로 AWS 인프라를 배포하고, GCP 재해복구(DR) 환경이 자동으로 준비되는 멀티클라우드 자동화 플랫폼**

  <br>

  인프라 구축의 병목, 반복적인 수동 IaC 작성, 방치되는 DR 환경, 그리고 운영 단계의 구성 편위(Drift) 방치라는 실무 문제를 해결하기 위해 <b>CraftOps(지능형 인프라 프로비저닝)</b>, <b>MirrorOps(실시간 재해복구 자동화)</b>, 그리고 <b>CoreOps(운영 거버넌스)</b>를 단일 파이프라인으로 연결한 플랫폼입니다.
</div>

---

## 👥 팀원 및 역할

| 역할 | 이름 | 담당 파트 | 주요 책임 |
|------|------|-----------|-----------|
| 팀장 (PM) · 아키텍트 | 김&nbsp;태&nbsp;승 | 기획<br>MirrorOps | 프로젝트 총괄 및 멀티클라우드 아키텍처 설계 · 이벤트 기반 DR 자동화 파이프라인 구축 · AWS-GCP 리소스 매핑 및 페일오버 실행 환경 격리 구현 |
| 테크 리드 · QA/DevOps | 김&nbsp;영&nbsp;찬 | CraftOps<br>CoreOps | 프론트엔드 전반 및 AI/DAG 기반 인프라 설계 엔진 개발 · 일회성 격리 배포 환경(Runner) 구축 · 통합 운영 거버넌스(Drift 감지 및 모니터링) 구현 |

---

## 🛠️ Tech Stack

<div align="center">

**⚛️ Frontend**<br>
<img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white">
<img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB">
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white">
<img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white">
<img src="https://img.shields.io/badge/shadcn/ui-000000?style=for-the-badge&logo=shadcnui&logoColor=white">
<img src="https://img.shields.io/badge/Zustand-764ABC?style=for-the-badge&logo=react&logoColor=white">
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
<img src="https://img.shields.io/badge/CloudFront-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white">
<br><br>

**💾 Database & Messaging**<br>
<img src="https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_RDS-527FFF?style=for-the-badge&logo=amazonrds&logoColor=white">
<img src="https://img.shields.io/badge/DynamoDB-4053D6?style=for-the-badge&logo=amazondynamodb&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_SQS-FF4F8B?style=for-the-badge&logo=amazonsqs&logoColor=white">
<br><br>

**🔐 Security, Governance & Monitoring**<br>
<img src="https://img.shields.io/badge/Amazon_Cognito-DD344C?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/AWS_IAM-DD344C?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/Secrets_Manager-DD344C?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/tfsec-4A154B?style=for-the-badge&logo=security&logoColor=white">
<img src="https://img.shields.io/badge/Checkov-157EFB?style=for-the-badge&logo=bridgecrew&logoColor=white">
<img src="https://img.shields.io/badge/AWS_Config-FF4F8B?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/Amazon_EventBridge-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white">
<img src="https://img.shields.io/badge/CloudWatch-FF4F8B?style=for-the-badge&logo=amazonaws&logoColor=white">

</div>

---

## 💡 프로젝트 개요 (Overview)

AutoOps는 인프라 엔지니어가 **반복적인 코드 작성 대신 아키텍처 설계와 보안 정책 수립 등 본연의 업무에 집중할 수 있는 환경**을 만들기 위해 탄생했습니다.

단일 파이프라인으로 연결된 3대 서브시스템을 통해 프로비저닝부터 재해복구, 운영 통제까지의 라이프사이클을 자동화합니다.

- **CraftOps (프로비저닝)** — 자연어로 인프라를 설계하고, 4단계 검증(보안/비용/Plan)을 거쳐 안전하게 배포합니다.
- **MirrorOps (재해복구)** — AWS 인프라 배포 즉시 이를 감지하여 GCP DR 패키지(IaC, 컨테이너 이미지, DB 스냅샷)를 상시 준비합니다.
- **CoreOps (운영 거버넌스)** — 인프라 변경을 실시간 감지하여 알림을 발송하고, 추가 비용 없이 인프라 메트릭을 모니터링합니다.

---

## ✨ 핵심 기능 (Features)

### 1. CraftOps (지능형 인프라 프로비저닝)
- 🗣️ **자연어 기반 인프라 설계 (Intent Analysis):** Gemini 2.5 Flash가 자연어 프롬프트를 분석하여 환경/리전/성능 파라미터를 추출하고, 인프라와 무관한 프롬프트는 자동으로 차단합니다.
- 🕸️ **의존성 기반 설계 엔진 (DAG Engine):** AWS 16개 리소스 간의 선행 관계를 보장하고, 환경(Prod/Staging/Dev)에 따라 서브넷, NAT Gateway, Multi-AZ 등을 자동으로 구성합니다.
- 🔒 **Validation Loop:** `tfsec + checkov`로 보안 스캔을 수행하여 CRITICAL 취약점 발생 시 배포를 원천 차단하고, `Infracost`로 예상 비용을 산출합니다.

### 2. MirrorOps (실시간 재해복구 자동화)
- 🪞 **AI + 룰 엔진 하이브리드 매핑:** AWS Config로 감지한 리소스를 GCP 리소스로 변환할 때, 일반 리소스는 룰 기반으로 매핑하고 복잡한 리소스(SG, ALB, ECS)는 AWS Bedrock (Claude 3.5 Sonnet)을 통해 정확히 변환합니다.
- 📦 **2단계 비동기 DR Package:** Skopeo를 통한 Docker 데몬 없는 ECR → GCR 이미지 복사, RDS 스냅샷 S3 Export 등을 비동기로 처리하여 상시 페일오버 대기 상태(Warm Standby)를 유지합니다.
- 🔄 **격리된 원클릭 페일오버:** 개별 사용자의 GCP JSON Key를 격리 보관하고, 별도의 Ephemeral ECS Task(`autoops-failover-runner`)를 기동하여 시뮬레이션 및 실제 페일오버를 수행합니다.

### 3. CoreOps (운영 거버넌스 및 모니터링)
- 📡 **Configuration Drift 실시간 감지:** 배포된 리소스의 기준선(Baseline)과 실제 상태를 비교해 변경 사항이 발생하면 즉시 심각도(CRITICAL 등)를 분류하여 Slack 알림을 발송합니다.
- 📊 **CloudWatch API 기반 서버리스 모니터링:** 무거운 Prometheus/Grafana 구성 없이 CloudWatch `get_metric_data` API와 Recharts를 연동하여 $0의 추가 비용으로 인프라 헬스를 모니터링합니다.
- 📝 **3-레이어 Audit Log:** 플랫폼 내 사용자 조작, AWS 외부 환경에서의 인프라 변경, 보안 검증 차단 내역을 계층별로 감사 로그에 기록합니다.
- 🗺️ **아키텍처 다이어그램 자동 생성:** Bedrock을 통해 배포된 리소스 기반의 Mermaid.js 아키텍처 다이어그램을 실시간으로 렌더링합니다.

---

## 🚀 기술적 핵심 성과 (Architecture Highlights)

### 1. 추가 비용 제로($0) 서버리스 모니터링 아키텍처 도입
Prometheus/Grafana 방식의 복잡성과 상시 유지 비용을 제거하기 위해, AWS CloudWatch API를 직접 호출하여 Recharts로 프론트엔드에 렌더링하는 방식을 채택했습니다. Cross-Account AssumeRole을 통해 안전하게 지표를 수집하며 **인프라 유지 비용을 $0로 절감**했습니다.

### 2. 비용 90% 절감 Warm Standby DR 전략
GCP를 상시 가동하는 Hot Standby 방식 대신, **DR Package(Terraform HCL + 컨테이너 이미지 + DB 스냅샷)를 S3에 상시 최신화**하는 Warm Standby 전략을 채택했습니다. 이를 통해 GCP 상시 운영 대비 비용을 대폭 절감하면서도 RTO 15분 내외의 복구 능력을 확보했습니다.

### 3. 일회성 격리 실행 환경 (Ephemeral ECS Task)
Terraform CLI를 서버 내부에서 직접 실행하지 않고, 사용자별 AWS/GCP 배포를 전담하는 일회성 컨테이너(`terraform-runner`, `failover-runner`)를 매번 ECS Fargate에 Spawn하여 실행합니다. 이를 통해 완전한 보안 격리와 무제한 실행 시간을 보장하며, CloudWatch Logs를 WebSocket으로 2초마다 브라우저에 실시간 스트리밍합니다.

### 4. 이벤트 기반 멀티클라우드 파이프라인 (EventBridge + SQS)
CraftOps 배포 완료 및 인프라 변경 이벤트를 EventBridge가 수신한 뒤, SQS를 통해 MirrorOps와 CoreOps(Drift 감지)로 각각 이벤트를 분산시킵니다. 특히 MirrorOps의 경우 SQS VisibilityTimeout 5분 디바운싱을 적용하여 중복 실행을 완벽하게 방지했습니다.

---

## 🖥️ Service Previews

*(추후 핵심 기능별 스크린샷 및 GIF 이미지로 업데이트 예정입니다.)*

* **인프라 프로비저닝 (CraftOps Wizard)**
* **거버넌스 통합 허브 (CoreOps Dashboard)**
* **실시간 Drift 감지 및 Slack 알림**
* **DR 패키지 및 원클릭 페일오버 (MirrorOps Console)**

---

## 📚 AutoOps Wiki
 
### [🏠 Home](https://github.com/Team-msp-architect-2026/msp-team01/wiki)
위키 안내(Index) · 프로젝트 개요 · 팀 구성 · 핵심 성과 요약
 
### [🎯 Project Story & Features](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Project-Story-and-Features)
기획 의도 · 해결하는 문제 · 9단계 사용자 여정 · 주요 기능 소개
 
### [🛠️ Tech Stack & Decisions](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Tech-Stack-and-Decisions)
기술 선정 배경 · 대안 비교 · 프론트/백엔드/인프라 스택
 
### [🏛️ Architecture](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Architecture)
전체 시스템 흐름도 · CraftOps↔MirrorOps 연동 구조 · EventBridge 이벤트 설계
 
### [⚙️ CraftOps](https://github.com/Team-msp-architect-2026/msp-team01/wiki/CraftOps-Overview)
모듈 개요 · DAG 의존성 엔진 · Validation Loop 4단계 · Terraform Runner
 
### [🪞 MirrorOps](https://github.com/Team-msp-architect-2026/msp-team01/wiki/MirrorOps-Overview)
모듈 개요 · 리소스 감지 및 매핑 · DR Package 구조 · Warm Standby 전략

### [📊 CoreOps](https://github.com/Team-msp-architect-2026/msp-team01/wiki/CoreOps-Overview)
운영 거버넌스 · 기존 인프라 온보딩 · Drift 실시간 감지 · 3-레이어 Audit Log · 인프라 메트릭 모니터링
 
### [🖥️ Infrastructure Setup](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Infrastructure-Setup)
AWS 리소스 구성 · GCP DR 환경 · IAM / 보안 설계 · 리전 정책
 
### [🚀 CI/CD Pipeline](https://github.com/Team-msp-architect-2026/msp-team01/wiki/CI-CD-Pipeline)
GitHub Actions 파이프라인 · Docker 플랫폼 주의사항 · 배포 흐름
 
### [🤝 Collaboration Guide](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Collaboration-Guide)
개발 환경 설정 · Git 협업 규칙 · Alembic 마이그레이션 규칙 · .env 관리
 
### [📈 Scenario & Testing](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Scenario-and-Testing)
DR 시나리오 검증 · 페일오버 테스트 · RTO/RPO 측정 결과
 
### [⚡ Performance Improvement](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Performance-Improvement)
성능 개선 이력 · 개선 전후 비교 · 측정 결과
 
### [💰 Cost & Policy](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Cost-and-Policy)
비용 산정 · 야간 중지 정책 · Warm Standby 절감률
 
### [🔥 Troubleshooting](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Troubleshooting)
Partial Failure 대응 · 핵심 이슈 원인 분석 · 해결 과정
 
### [📝 Meetings & Feedback](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Meetings-and-Feedback)
주간 회의록 · 피드백 · 액션 아이템
 
### [🌟 Retrospective & Vision](https://github.com/Team-msp-architect-2026/msp-team01/wiki/Retrospective-and-Vision)
최종 회고 · 향후 비전
