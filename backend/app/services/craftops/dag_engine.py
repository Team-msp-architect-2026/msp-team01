# backend/app/services/craftops/dag_engine.py
from __future__ import annotations

# MVP 16개 리소스 의존성 맵
# 기술참조문서 §4-2 Python 의존성 맵 구조 기준
DEPENDENCY_MAP: dict[str, dict] = {
    "aws_vpc": {
        "requires": [],
        "optional": [],
        "wizard_step": "2-2",
        "label": "VPC",
    },
    "aws_subnet": {
        "requires": ["aws_vpc"],
        "optional": [],
        "wizard_step": "2-2",
        "label": "Subnet",
    },
    "aws_security_group": {
        "requires": ["aws_vpc"],
        "optional": [],
        "wizard_step": "2-3",
        "label": "Security Group (ALB / App / DB)",
    },
    "aws_lb": {
        "requires": ["aws_vpc", "aws_subnet", "aws_security_group"],
        "optional": [],
        "wizard_step": "2-4",
        "label": "ALB",
    },
    "aws_ecs_service": {
        "requires": [
            "aws_vpc", "aws_subnet", "aws_security_group",
            "aws_ecs_cluster", "aws_ecs_task_definition",
        ],
        "optional": ["aws_lb_target_group", "aws_cloudwatch_log_group"],
        "wizard_step": "2-5",
        "label": "ECS Service",
    },
    "aws_db_instance": {
        "requires": ["aws_vpc", "aws_db_subnet_group", "aws_security_group"],
        "optional": ["aws_kms_key"],
        "wizard_step": "2-6",
        "label": "RDS Instance (PostgreSQL)",
    },
    "aws_internet_gateway": {
        "requires": ["aws_vpc"],
        "optional": [],
        "wizard_step": "2-2",
        "label": "Internet Gateway",
    },
    "aws_nat_gateway": {
        "requires": ["aws_subnet", "aws_internet_gateway"],
        "optional": [],
        "wizard_step": "2-2",
        "label": "NAT Gateway",
    },
    "aws_route_table": {
        "requires": ["aws_vpc", "aws_internet_gateway", "aws_nat_gateway"],
        "optional": [],
        "wizard_step": "2-2",
        "label": "Route Table (Public + Private)",
    },
    "aws_lb_target_group": {
        "requires": ["aws_vpc", "aws_lb"],
        "optional": [],
        "wizard_step": "2-4",
        "label": "Target Group",
    },
    "aws_iam_role": {
        "requires": [],
        "optional": [],
        "wizard_step": "2-5",
        "label": "IAM Role + Policy",
    },
    "aws_ecs_cluster": {
        "requires": ["aws_vpc"],
        "optional": [],
        "wizard_step": "2-5",
        "label": "ECS Cluster",
    },
    "aws_ecs_task_definition": {
        "requires": ["aws_iam_role"],
        "optional": [],
        "wizard_step": "2-5",
        "label": "ECS Task Definition",
    },
    "aws_cloudwatch_log_group": {
        "requires": [],
        "optional": [],
        "wizard_step": "2-5",
        "label": "CloudWatch Log Group",
    },
    "aws_db_subnet_group": {
        "requires": ["aws_vpc", "aws_subnet"],
        "optional": [],
        "wizard_step": "2-6",
        "label": "RDS Subnet Group",
    },
    "aws_kms_key": {
        "requires": [],
        "optional": [],
        "wizard_step": "2-6",
        "label": "KMS Key (RDS 암호화)",
    },
}

# 위저드 단계 → 포함 리소스 매핑
STEP_RESOURCES: dict[str, list[str]] = {
    "2-2": [
        "aws_vpc", "aws_internet_gateway", "aws_subnet",
        "aws_nat_gateway", "aws_route_table",
    ],
    "2-3": ["aws_security_group"],
    "2-4": ["aws_lb", "aws_lb_target_group"],
    "2-5": [
        "aws_iam_role", "aws_ecs_cluster", "aws_ecs_task_definition",
        "aws_ecs_service", "aws_cloudwatch_log_group",
    ],
    "2-6": ["aws_db_subnet_group", "aws_db_instance", "aws_kms_key"],
}

# environment 정규화 맵
# projects 테이블: "production" / "staging" / "development"
# dag_engine 내부: "production" / "staging" / "development" 통일
_ENV_NORMALIZE: dict[str, str] = {
    "prod":        "production",
    "production":  "production",
    "stage":       "staging",
    "staging":     "staging",
    "dev":         "development",
    "development": "development",
}


def _normalize_env(environment: str) -> str:
    """environment 값을 정규화한다. 알 수 없는 값은 'production'으로 처리."""
    return _ENV_NORMALIZE.get(environment.lower(), "production")


class DAGEngine:
    """
    16개 AWS 리소스 간 의존성을 관리한다.
    위저드 각 단계에서 선행 리소스 완료 여부를 검사하고 (FR-A-004),
    환경별 Context-Aware 값을 자동으로 계산한다. (FR-A-005)

    v2 변경:
    - _get_ecs_preset / _get_rds_preset이 Gemini 추론값을 우선 적용
    - 환경 프리셋은 Gemini가 추론하지 않는 보안·운영 기준값만 담당
    - environment 정규화 처리 추가 (prod → production 등)
    - create_initial_deployment 분리 → deployment_service.py로 이동
    """

    def get_dependency_tree(self) -> dict:
        """전체 의존성 트리를 반환한다. FE 의존성 패널 렌더링에 사용."""
        return DEPENDENCY_MAP

    def validate_step_prerequisites(
        self, step: str, completed_steps: list[str]
    ) -> bool:
        """
        해당 단계를 시작하기 위한 선행 단계가 모두 완료되었는지 검사한다.
        위저드 단계 순서: 2-1 → 2-2 → 2-3 → 2-4 → 2-5 → 2-6
        """
        step_order = ["2-1", "2-2", "2-3", "2-4", "2-5", "2-6"]

        if step not in step_order:
            return False

        step_index     = step_order.index(step)
        required_steps = step_order[:step_index]
        return all(s in completed_steps for s in required_steps)

    def compute_context_aware_values(
        self, step: str, current_config: dict
    ) -> dict:
        """
        이전 단계 설정값을 기반으로 현재 단계의 값을 자동 계산한다. (FR-A-005)

        Gemini 추론값(recommended_config)이 current_config에 있으면 우선 적용.
        보안·운영 기준값(multi_az, backup_retention 등)은 환경 프리셋으로 결정.

        §4-4 환경별 프리셋 매트릭스:
        항목              production        staging           development
        서브넷 구성       Public 2+Private 2 Public 1+Private 1 Public 1+Private 1
        NAT Gateway      생성               생성               미생성
        ECS 최소 태스크  2                  1                  1
        Multi-AZ         ON                 OFF                OFF
        RDS 백업 보존    30일               7일                0일
        RDS 암호화       ON                 ON                 OFF
        """
        computed = {}
        env = _normalize_env(current_config.get("environment", "production"))

        # Gemini 추론값 추출 (analyze_intent 결과가 config에 포함된 경우)
        gemini = current_config.get("recommended_config", {})

        if step == "2-2":
            vpc_cidr = current_config.get("vpc_cidr", "10.0.0.0/16")
            # Gemini가 추론한 VPC CIDR이 있으면 우선 사용
            if gemini.get("vpc", {}).get("cidr"):
                vpc_cidr = gemini["vpc"]["cidr"]

            computed["subnet_auto"] = self._compute_subnet_cidrs(vpc_cidr, env)
            # production/staging → NAT GW 생성, development → 미생성
            computed["nat_gateway"] = env in ("production", "staging")

        elif step == "2-3":
            computed["sg_chaining"] = {
                "sg_alb": {
                    "inbound": [
                        {"port": 443, "source": "0.0.0.0/0"},
                        {"port": 80,  "source": "0.0.0.0/0"},
                    ]
                },
                "sg_app": {
                    "inbound": [{"port": 8080, "source": "sg_alb"}]
                },
                "sg_db": {
                    "inbound": [{"port": 5432, "source": "sg_app"}]
                },
            }

        elif step == "2-4":
            computed["alb_subnet_type"] = "public"

        elif step == "2-5":
            # Gemini ECS 추론값 추출
            gemini_ecs = gemini.get("ecs", {})
            computed["ecs_preset"] = self._get_ecs_preset(env, gemini_ecs)

        elif step == "2-6":
            # Gemini RDS 추론값 추출
            gemini_rds = gemini.get("rds", {})
            computed["rds_preset"] = self._get_rds_preset(env, gemini_rds)

        return computed

    def generate_naming_preview(
        self, prefix: str, environment: str
    ) -> list[str]:
        """
        {prefix}-{env}-{resource} 패턴으로 네이밍 미리보기를 생성한다. (FR-A-003)
        환경별 서브넷 수 반영 (§4-4 프리셋 매트릭스).
        """
        p   = prefix
        e   = environment
        env = _normalize_env(environment)

        base_names = [
            f"{p}-{e}-vpc",
            f"{p}-{e}-igw",
            f"{p}-{e}-sg-alb",
            f"{p}-{e}-sg-app",
            f"{p}-{e}-sg-db",
            f"{p}-{e}-alb",
            f"{p}-{e}-tg",
            f"{p}-{e}-iam-role",
            f"{p}-{e}-ecs-cluster",
            f"{p}-{e}-ecs-task-def",
            f"{p}-{e}-ecs-service",
            f"{p}-{e}-cw-log",
            f"{p}-{e}-rds-subnet-group",
            f"{p}-{e}-rds",
        ]

        if env == "production":
            subnet_names = [
                f"{p}-{e}-subnet-public-a",
                f"{p}-{e}-subnet-public-c",
                f"{p}-{e}-subnet-private-a",
                f"{p}-{e}-subnet-private-c",
                f"{p}-{e}-nat",
                f"{p}-{e}-rt-public",
                f"{p}-{e}-rt-private",
            ]
        else:
            # staging / development: Public 1 + Private 1
            subnet_names = [
                f"{p}-{e}-subnet-public-a",
                f"{p}-{e}-subnet-private-a",
                f"{p}-{e}-rt-public",
                f"{p}-{e}-rt-private",
            ]
            if env == "staging":
                subnet_names.append(f"{p}-{e}-nat")

        return base_names + subnet_names

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _compute_subnet_cidrs(self, vpc_cidr: str, environment: str) -> dict:
        """
        환경별로 서브넷 CIDR을 자동 분배한다.

        production:          Public 2 + Private 2
        staging/development: Public 1 + Private 1

        VPC CIDR에서 앞 두 옥텟을 추출해 서브넷 대역 계산.
        예: 10.0.0.0/16 → public-a: 10.0.1.0/24, private-a: 10.0.10.0/24
        """
        import ipaddress
        try:
            network    = ipaddress.ip_network(vpc_cidr, strict=False)
            base       = str(network.network_address)
            octets     = base.split(".")
            prefix_16  = f"{octets[0]}.{octets[1]}"
        except ValueError:
            prefix_16 = "10.0"

        if environment == "production":
            return {
                "public_a":  f"{prefix_16}.1.0/24",
                "public_c":  f"{prefix_16}.2.0/24",
                "private_a": f"{prefix_16}.10.0/24",
                "private_c": f"{prefix_16}.20.0/24",
            }
        else:
            # staging / development: Public 1 + Private 1
            return {
                "public_a":  f"{prefix_16}.1.0/24",
                "public_c":  f"{prefix_16}.2.0/24",   # hcl_template 호환성 유지
                "private_a": f"{prefix_16}.10.0/24",
                "private_c": f"{prefix_16}.20.0/24",  # hcl_template 호환성 유지
            }

    def _get_ecs_preset(
        self, environment: str, gemini_ecs: dict
    ) -> dict:
        """
        환경별 ECS 프리셋을 반환한다.

        역할 분리:
        - Gemini 담당: vcpu, memory, max_tasks, autoscaling_target_cpu
        - 환경 프리셋 담당: min_tasks, cw_log_retention_days (운영·비용 기준)

        Gemini 추론값이 있으면 우선 적용하고, 없는 항목만 환경 기본값으로 채운다.
        """
        # 환경별 운영 기준값 (보안·운영 정책 — Gemini가 추론하지 않음)
        env_presets: dict[str, dict] = {
            "production": {
                "min_tasks":             2,
                "cw_log_retention_days": 90,
            },
            "staging": {
                "min_tasks":             1,
                "cw_log_retention_days": 30,
            },
            "development": {
                "min_tasks":             1,
                "cw_log_retention_days": 7,
            },
        }
        base = env_presets.get(environment, env_presets["production"]).copy()

        # Gemini 추론값 우선 적용
        auto = gemini_ecs.get("autoscaling", {})
        base["vcpu"]                    = gemini_ecs.get("vcpu",   1)
        base["memory"]                  = gemini_ecs.get("memory", 2048)
        base["max_tasks"]               = auto.get("max",        5)
        base["autoscaling_target_cpu"]  = auto.get("target_cpu", 70)
        base["autoscaling"]             = environment == "production"

        return base

    def _get_rds_preset(
        self, environment: str, gemini_rds: dict
    ) -> dict:
        """
        환경별 RDS 프리셋을 반환한다.

        역할 분리:
        - Gemini 담당: instance_class (데이터 규모·성능 기준)
        - 환경 프리셋 담당: multi_az, backup_retention_days, storage_encrypted
          (보안·가용성·규제 기준 — 환경에 따라 정책으로 결정)

        Gemini 추론값이 있으면 우선 적용하고, 없는 항목만 환경 기본값으로 채운다.
        """
        # 환경별 보안·가용성 기준값 (Gemini가 추론하지 않음)
        env_presets: dict[str, dict] = {
            "production": {
                "multi_az":              True,
                "backup_retention_days": 30,
                "storage_encrypted":     True,
                "instance_class":        "db.t3.medium",  # Gemini 없을 때 기본값
            },
            "staging": {
                "multi_az":              False,
                "backup_retention_days": 7,
                "storage_encrypted":     True,
                "instance_class":        "db.t3.small",
            },
            "development": {
                "multi_az":              False,
                "backup_retention_days": 0,
                "storage_encrypted":     False,
                "instance_class":        "db.t3.micro",
            },
        }
        base = env_presets.get(environment, env_presets["production"]).copy()

        # Gemini 추론값 우선 적용 (instance_class만)
        if gemini_rds.get("instance_class"):
            base["instance_class"] = gemini_rds["instance_class"]

        # engine/version 고정
        base["engine"]         = "postgresql"
        base["engine_version"] = "15"

        return base
    

import uuid
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.deployment import Deployment


def create_initial_deployment(
    project_id: str,
    prefix: str,
    environment: str,
    db: Session,
) -> Deployment:
    deployment = Deployment(
        deployment_id   = str(uuid.uuid4()),
        project_id      = project_id,
        prefix          = prefix,
        environment     = environment,
        terraform_code  = "",
        config_snapshot = {},
        status          = "created",
        total_resources = 16,
        started_at      = datetime.utcnow(),
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    return deployment