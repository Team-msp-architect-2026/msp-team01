# backend/app/services/craftops/dag_engine.py

# MVP 16개 리소스 의존성 맵
# 기술참조문서 §4-2 Python 의존성 맵 구조 기준
# requires: 반드시 완료되어야 하는 선행 리소스
# optional: 있으면 자동 연결되는 선택적 리소스
# wizard_step: 해당 리소스가 설정되는 위저드 단계
DEPENDENCY_MAP: dict[str, dict] = {
    # §4-2 명시 항목
    "aws_vpc": {
        "requires": [],
        "optional": [],
        "wizard_step": "2-2",
        "label": "VPC",
    },
    "aws_subnet": {
        "requires": ["aws_vpc"],          # §4-2: aws_subnet requires aws_vpc
        "optional": [],
        "wizard_step": "2-2",
        "label": "Subnet",
    },
    "aws_security_group": {
        "requires": ["aws_vpc"],          # §4-2: aws_security_group requires aws_vpc
        "optional": [],
        "wizard_step": "2-3",
        "label": "Security Group (ALB / App / DB)",
    },
    "aws_lb": {
        "requires": ["aws_vpc", "aws_subnet", "aws_security_group"],  # §4-2
        "optional": [],
        "wizard_step": "2-4",
        "label": "ALB",
    },
    "aws_ecs_service": {
        "requires": [                     # §4-2
            "aws_vpc", "aws_subnet", "aws_security_group",
            "aws_ecs_cluster", "aws_ecs_task_definition",
        ],
        "optional": ["aws_lb_target_group", "aws_cloudwatch_log_group"],  # §4-2
        "wizard_step": "2-5",
        "label": "ECS Service",
    },
    "aws_db_instance": {
        "requires": ["aws_vpc", "aws_db_subnet_group", "aws_security_group"],  # §4-2
        "optional": ["aws_kms_key"],      # §4-2
        "wizard_step": "2-6",
        "label": "RDS Instance (PostgreSQL)",
    },
    # 의존성 트리(§4-2)에서 도출한 추가 항목
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


class DAGEngine:
    """
    16개 AWS 리소스 간 의존성을 관리한다.
    위저드 각 단계에서 선행 리소스 완료 여부를 검사하고 (FR-A-004),
    환경별 Context-Aware 값을 자동으로 계산한다. (FR-A-005)
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

        step_index = step_order.index(step)
        required_steps = step_order[:step_index]  # 현재 단계 이전 모든 단계

        return all(s in completed_steps for s in required_steps)

    def compute_context_aware_values(
        self, step: str, current_config: dict
    ) -> dict:
        """
        이전 단계 설정값을 기반으로 현재 단계의 값을 자동 계산한다. (FR-A-005)

        §4-4 Context-Aware Form 반영:
        - 2-2: VPC CIDR → 서브넷 CIDR 자동 분배 (환경별 서브넷 수 다름)
                          NAT Gateway 생성 여부 결정 (dev는 미생성)
        - 2-3: SG 간 참조 관계 자동 구성 (Chaining)
        - 2-4: ALB → Public Subnet 자동 배치
        - 2-5: 환경별 ECS 프리셋 자동 결정
        - 2-6: 환경별 RDS 프리셋 자동 결정

        §4-4 환경별 프리셋 매트릭스:
        항목            prod              staging           dev
        서브넷 구성     Public 2+Private 2 Public 1+Private 1 Public 1+Private 1
        NAT Gateway   생성               생성               미생성
        """
        computed = {}
        env = current_config.get("environment", "dev")

        if step == "2-2":
            vpc_cidr = current_config.get("vpc_cidr", "10.0.0.0/16")
            computed["subnet_auto"] = self._compute_subnet_cidrs(vpc_cidr, env)
            # §4-4: prod/staging → NAT GW 생성, dev → 미생성
            computed["nat_gateway"] = env in ("prod", "staging")

        elif step == "2-3":
            # §4-3: ALB용(80/443), App용(ALB에서만), DB용(App에서만 5432)
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
            # §4-4: ALB는 Public Subnet에 자동 배치
            computed["alb_subnet_type"] = "public"

        elif step == "2-5":
            computed["ecs_preset"] = self._get_ecs_preset(env)

        elif step == "2-6":
            computed["rds_preset"] = self._get_rds_preset(env)

        return computed

    def generate_naming_preview(
        self, prefix: str, environment: str
    ) -> list[str]:
        """
        {prefix}-{env}-{resource} 패턴으로 네이밍 미리보기를 생성한다. (FR-A-003)
        §7-5 POST /api/craft/config 응답 포맷: 평면 문자열 배열로 반환.
        예: ["DD-prod-vpc", "DD-prod-ecs-cluster", "DD-prod-rds", "DD-prod-alb"]

        환경별 서브넷 수 반영 (§4-4 프리셋 매트릭스):
        - prod:          Public 2 + Private 2 → 4개 서브넷 네이밍
        - staging / dev: Public 1 + Private 1 → 2개 서브넷 네이밍
        """
        p = prefix
        e = environment

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

        if environment == "prod":
            # prod: Public 2 + Private 2, NAT GW 포함
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
            # staging / dev: Public 1 + Private 1
            # dev는 NAT GW 미생성
            subnet_names = [
                f"{p}-{e}-subnet-public-a",
                f"{p}-{e}-subnet-private-a",
                f"{p}-{e}-rt-public",
                f"{p}-{e}-rt-private",
            ]
            if environment == "staging":
                subnet_names.append(f"{p}-{e}-nat")

        return base_names + subnet_names

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _compute_subnet_cidrs(self, vpc_cidr: str, environment: str) -> dict:
        """
        환경별로 서브넷 CIDR을 자동 분배한다. (§4-4 프리셋 매트릭스)

        prod:          Public 2 + Private 2
        staging / dev: Public 1 + Private 1

        기본 VPC CIDR 10.0.0.0/16 기준:
          Public A:  10.0.1.0/24
          Public C:  10.0.2.0/24  (prod만)
          Private A: 10.0.10.0/24
          Private C: 10.0.20.0/24 (prod만)
        """
        prefix_16 = ".".join(vpc_cidr.split(".")[:2])  # 예: "10.0"

        if environment == "prod":
            return {
                "public_a":  f"{prefix_16}.1.0/24",
                "public_c":  f"{prefix_16}.2.0/24",
                "private_a": f"{prefix_16}.10.0/24",
                "private_c": f"{prefix_16}.20.0/24",
            }
        else:
            # staging / dev: Public 1 + Private 1
            return {
                "public_a":  f"{prefix_16}.1.0/24",
                "private_a": f"{prefix_16}.10.0/24",
            }

    def _get_ecs_preset(self, environment: str) -> dict:
        """
        환경별 ECS 프리셋을 반환한다. (§4-4 환경별 프리셋 자동 결정 매트릭스)

        항목                  prod              staging   dev
        ECS 최소 태스크       2                 1         1
        오토스케일링          ON (CPU 70%)      OFF       OFF
        CloudWatch 로그 보존  90일              30일      7일
        """
        presets = {
            "prod": {
                "min_tasks": 2,
                "max_tasks": 10,
                "autoscaling": True,
                "autoscaling_target_cpu": 70,
                "cw_log_retention_days": 90,
            },
            "staging": {
                "min_tasks": 1,
                "max_tasks": 5,
                "autoscaling": False,
                "cw_log_retention_days": 30,
            },
            "dev": {
                "min_tasks": 1,
                "max_tasks": 2,
                "autoscaling": False,
                "cw_log_retention_days": 7,
            },
        }
        return presets.get(environment, presets["dev"])

    def _get_rds_preset(self, environment: str) -> dict:
        """
        환경별 RDS 프리셋을 반환한다. (§4-4 환경별 프리셋 자동 결정 매트릭스)

        항목              prod        staging     dev
        Multi-AZ          ON          OFF         OFF
        RDS 백업 보존     30일        7일         0일
        RDS 암호화        ON          ON          OFF
        """
        presets = {
            "prod": {
                "multi_az": True,
                "backup_retention_days": 30,
                "storage_encrypted": True,
                "instance_class": "db.t3.medium",
                "engine": "postgresql",
                "engine_version": "15",
            },
            "staging": {
                "multi_az": False,
                "backup_retention_days": 7,
                "storage_encrypted": True,
                "instance_class": "db.t3.small",
                "engine": "postgresql",
                "engine_version": "15",
            },
            "dev": {
                "multi_az": False,
                "backup_retention_days": 0,
                "storage_encrypted": False,
                "instance_class": "db.t3.micro",
                "engine": "postgresql",
                "engine_version": "15",
            },
        }
        return presets.get(environment, presets["dev"])
    
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
    """
    Step 2-1 최초 호출 시 deployments 레코드를 생성한다.
    config_snapshot은 /api/craft/config 호출마다 누적 저장된다.
    terraform_code는 /api/craft/validate 단계에서 채워진다.
    total_resources는 MVP 고정값 16개.
    """
    deployment = Deployment(
        deployment_id=str(uuid.uuid4()),
        project_id=project_id,
        prefix=prefix,
        environment=environment,
        terraform_code="",
        config_snapshot={},
        status="created",
        total_resources=16,
        started_at=datetime.utcnow(),
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)
    return deployment