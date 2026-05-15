import json

# §5-2 AWS→GCP 매핑 테이블 (매핑 방식 + confidence)
RULE_BASED_MAP: dict[str, dict] = {
    # 룰 기반 (confidence: auto) — 6개 카테고리
    "AWS::EC2::VPC": {
        "gcp_type":   "google_compute_network",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name": (
                (cfg.get("tags") or {}).get("Name", "") or
                cfg.get("vpcId", "default-vpc")
            ).lower().replace("_", "-"),
            "auto_create_subnetworks": False,
            "routing_mode":            "REGIONAL",
        },
    },
    "AWS::EC2::Subnet": {
        "gcp_type":   "google_compute_subnetwork",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name": (
                (cfg.get("tags") or {}).get("Name", "") or
                cfg.get("subnetId", "default-subnet")
            ).lower().replace("_", "-"),
            "ip_cidr_range": cfg.get("cidrBlock", ""),
            "region":        "us-west1",
            # [수정] GCP 서브넷 생성 시 network는 필수 인자입니다.
            "network":       cfg.get("vpcId", "default-vpc").lower().replace("_", "-"),
        },
    },
    "AWS::EC2::RouteTable": {
        "gcp_type":   "google_compute_router",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name": (
                (cfg.get("tags") or {}).get("Name", "") or
                "router-" + cfg.get("routeTableId", "default")
            ).lower().replace("_", "-"),
            "region": "us-west1",
            "network": cfg.get("vpcId", "default-vpc").lower().replace("_", "-"),
        },
    },
    "AWS::EC2::NatGateway": {
        "gcp_type":   "google_compute_router_nat",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name":                               "cloud-nat",
            "router":                             "cloud-router",
            "region":                             "us-west1",
            "nat_ip_allocate_option":             "AUTO_ONLY",
            "source_subnetwork_ip_ranges_to_nat": "ALL_SUBNETWORKS_ALL_IP_RANGES",
        },
    },
    "AWS::RDS::DBInstance": {
        "gcp_type":   "google_sql_database_instance",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "database_version": f"POSTGRES_{cfg.get('EngineVersion', '15').split('.')[0]}",
            "region":           "us-west1",
            "settings": {
                "tier":              "db-f1-micro",
                "availability_type": "REGIONAL" if cfg.get("MultiAZ") else "ZONAL",
                "backup_configuration": {
                    "enabled": cfg.get("BackupRetentionPeriod", 0) > 0,
                },
            },
        },
    },
    "AWS::IAM::Role": {
        "gcp_type":   "google_service_account",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "account_id":   "autoops-sa",
            "display_name": cfg.get("RoleName", ""),
        },
    },
    # Bedrock 보완 대상 (confidence: review) — 3개 카테고리
    "AWS::EC2::SecurityGroup": {
        "gcp_type":   "google_compute_firewall",
        "confidence": "review",
        "mapping":    None,
    },
    "AWS::ElasticLoadBalancingV2::LoadBalancer": {
        "gcp_type":   "google_compute_backend_service",
        "confidence": "review",
        "mapping":    None,
    },
    "AWS::ECS::Service": {
        "gcp_type":   "google_cloud_run_service",
        "confidence": "review",
        "mapping":    None,
    },
}

# §5-2 IAM Action → GCP Role 변환 테이블
IAM_ACTION_TO_GCP_ROLE: dict[str, str] = {
    "s3:GetObject":             "roles/storage.objectAdmin",
    "s3:PutObject":             "roles/storage.objectAdmin",
    "logs:PutLogEvents":        "roles/logging.logWriter",
    "cloudwatch:PutMetricData": "roles/monitoring.metricWriter",
    "ecr:BatchGetImage":        "roles/artifactregistry.reader",
    "ssm:GetParameter":         "roles/secretmanager.secretAccessor",
}

from sqlalchemy.orm import Session
from app.models.aws_resource import AWSResource
from app.models.gcp_mapping import GCPMapping
from app.services.mirrorops.bedrock_client import BedrockMapper


class MappingEngine:
    """
    AWS 리소스 목록을 GCP 리소스로 매핑한다.
    - 룰 기반: confidence=auto (6개 카테고리)
    - Bedrock 보완: confidence=review (3개 카테고리)
    """

    def __init__(self):
        self.bedrock = BedrockMapper()

    def map_all(
        self,
        aws_resources: list[AWSResource],
        project_id: str,
        sync_id: str,
        db: Session,
    ) -> list[GCPMapping]:
        mappings = []

        for res in aws_resources:
            # [수정 1] config_json이 list인 경우 dict로 정규화
            # AWS Config에서 일부 리소스가 list 형태로 반환되는 케이스 방어
            config_json = res.config_json or {}
            if isinstance(config_json, list):
                config_json = config_json[0] if config_json else {}

            rule = RULE_BASED_MAP.get(res.resource_type)
            if not rule:
                mapping = self._create_manual_mapping(res, project_id, sync_id)
                db.add(mapping)
                mappings.append(mapping)
                continue

            if rule["confidence"] == "auto" and rule["mapping"]:
                # 룰 기반 변환 (FR-B-004)
                attrs = rule["mapping"](config_json)  # 정규화된 config_json 사용
                hcl   = self._attrs_to_hcl(rule["gcp_type"], res.resource_name, attrs)
                mapping = GCPMapping(
                    resource_id       = res.resource_id,
                    project_id        = project_id,
                    sync_id           = sync_id,
                    gcp_resource_type = rule["gcp_type"],
                    gcp_resource_name = res.resource_name,
                    terraform_code    = hcl,
                    confidence        = "auto",
                    review_reason     = None,
                    user_confirmed    = False,
                )
            else:
                # Bedrock 보완 변환 (FR-B-005)
                result = self.bedrock.map_resource(
                    resource_type = res.resource_type,
                    aws_config    = config_json,      # 정규화된 config_json 사용
                    gcp_type      = rule["gcp_type"],
                )

                # [수정 2] result 또는 mapping_info가 list인 경우 방어
                if isinstance(result, list):
                    result = result[0] if result else {}

                mapping_info  = result.get("mapping_info", {})
                if isinstance(mapping_info, list):
                    mapping_info = mapping_info[0] if mapping_info else {}

                review_reason = result.get("review_reason", "")

                hcl = self._generate_hcl_from_mapping_info(
                    gcp_type     = rule["gcp_type"],
                    name         = res.resource_name,
                    mapping_info = mapping_info,
                )
                mapping = GCPMapping(
                    resource_id       = res.resource_id,
                    project_id        = project_id,
                    sync_id           = sync_id,
                    gcp_resource_type = rule["gcp_type"],
                    gcp_resource_name = res.resource_name,
                    terraform_code    = hcl,
                    confidence        = "review",
                    review_reason     = review_reason or None,
                    user_confirmed    = False,
                )

            if res.resource_type == "AWS::IAM::Role":
                mapping = self._apply_iam_mapping(mapping, res)

            db.add(mapping)
            mappings.append(mapping)

        db.commit()
        return mappings

    # ──────────────────────────────────────────────────────────
    # review 리소스용 HCL 템플릿 함수들
    # ──────────────────────────────────────────────────────────

    def _generate_hcl_from_mapping_info(
        self, gcp_type: str, name: str, mapping_info: dict
    ) -> str:
        if gcp_type == "google_compute_firewall":
            return self._generate_firewall_hcl(name, mapping_info)
        elif gcp_type == "google_compute_backend_service":
            return self._generate_backend_service_hcl(name, mapping_info)
        elif gcp_type == "google_cloud_run_service":
            return self._generate_cloud_run_hcl(name, mapping_info)
        else:
            return f'# review 필요: {gcp_type} — {name}'

    def _generate_firewall_hcl(self, name: str, info: dict) -> str:
        # [수정] GCP 리소스명 정규식 통과를 위해 소문자 및 하이픈으로 강제 변환
        gcp_name  = name.lower().replace("_", "-")
        tf_name   = gcp_name.replace("-", "_")
        direction = info.get("direction", "INGRESS")
        rules     = info.get("rules", [{"protocol": "all", "source_ranges": ["0.0.0.0/0"]}])

        # [수정] VPC 이름 동적 추론 (예: DD-prod-sg-db -> dd-prod-vpc)
        name_parts = name.split("-")
        vpc_name = "default"
        if len(name_parts) >= 2:
            vpc_name = f"{name_parts[0]}-{name_parts[1]}-vpc".lower()

        if not isinstance(rules, list):
            rules = [{"protocol": "all", "source_ranges": ["0.0.0.0/0"]}]

        allow_blocks = ""
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            ports_line = ""
            if rule.get("ports"):
                ports_line = f'\n    ports    = {json.dumps(rule["ports"])}'
            allow_blocks += f"""
  allow {{
    protocol = "{rule.get('protocol', 'all')}"{ports_line}
  }}"""

        source_ranges = json.dumps(
            rules[0].get("source_ranges", ["0.0.0.0/0"])
            if rules and isinstance(rules[0], dict) else ["0.0.0.0/0"]
        )

        return f'''resource "google_compute_firewall" "{tf_name}" {{
  name          = "{gcp_name}"
  network       = "{vpc_name}"
  direction     = "{direction}"
  source_ranges = {source_ranges}
{allow_blocks}
}}'''

    def _generate_backend_service_hcl(self, name: str, info: dict) -> str:
        # [수정] 대문자 에러 방지용 소문자 변환
        gcp_name              = name.lower().replace("_", "-")
        tf_name               = gcp_name.replace("-", "_")
        protocol              = info.get("protocol", "HTTP")
        timeout_sec           = info.get("timeout_sec", 30)
        load_balancing_scheme = info.get("load_balancing_scheme", "EXTERNAL")

        return f'''resource "google_compute_backend_service" "{tf_name}" {{
  name                  = "{gcp_name}"
  protocol              = "{protocol}"
  timeout_sec           = {timeout_sec}
  load_balancing_scheme = "{load_balancing_scheme}"
}}'''

    def _generate_cloud_run_hcl(self, name: str, info: dict) -> str:
        # [수정] 대문자 에러 방지용 소문자 변환
        gcp_name = name.lower().replace("_", "-")
        tf_name  = gcp_name.replace("-", "_")
        image    = info.get("image", "gcr.io/cloudrun/hello")
        cpu      = info.get("cpu", "1000m")
        memory   = info.get("memory", "512Mi")
        port     = info.get("port", 8080)

        env_block = ""
        for env in info.get("env_vars", []):
            if not isinstance(env, dict):
                continue
            env_block += f"""
        env {{
          name  = "{env.get('name', '')}"
          value = "{env.get('value', '')}"
        }}"""

        return f'''resource "google_cloud_run_service" "{tf_name}" {{
  name     = "{gcp_name}"
  location = "us-west1"

  template {{
    spec {{
      containers {{
        image = "{image}"
        ports {{
          container_port = {port}
        }}
        resources {{
          limits = {{
            cpu    = "{cpu}"
            memory = "{memory}"
          }}
        }}{env_block}
      }}
    }}
  }}
}}'''

    # ──────────────────────────────────────────────────────────
    # 기존 메서드들 (auto 리소스용)
    # ──────────────────────────────────────────────────────────

    def _apply_iam_mapping(
        self, mapping: GCPMapping, res: AWSResource
    ) -> GCPMapping:
        # [수정 3] config_json이 list인 경우 dict로 정규화
        config = res.config_json or {}
        if isinstance(config, list):
            config = config[0] if config else {}

        policies   = config.get("AssumeRolePolicyDocument", {})
        statements = policies.get("Statement", [])
        gcp_roles  = []

        for stmt in statements:
            actions = stmt.get("Action", [])
            if isinstance(actions, str):
                actions = [actions]
            for action in actions:
                gcp_role = IAM_ACTION_TO_GCP_ROLE.get(action)
                if gcp_role:
                    gcp_roles.append(gcp_role)

        if gcp_roles:
            extra_hcl = "\n".join([
                f'# GCP Role Binding: {role}' for role in set(gcp_roles)
            ])
            mapping.terraform_code += f"\n\n{extra_hcl}"

        return mapping

    def _create_manual_mapping(
        self, res: AWSResource, project_id: str, sync_id: str
    ) -> GCPMapping:
        return GCPMapping(
            resource_id       = res.resource_id,
            project_id        = project_id,
            sync_id           = sync_id,
            gcp_resource_type = "unknown",
            gcp_resource_name = res.resource_name,
            terraform_code    = f"# 수동 매핑 필요: {res.resource_type}",
            confidence        = "manual",
            review_reason     = "자동 변환 규칙이 없습니다. 수동으로 GCP 리소스를 설정하세요.",
            user_confirmed    = False,
        )

    def _attrs_to_hcl(
        self, gcp_type: str, name: str, attrs: dict
    ) -> str:
        """auto 리소스(룰 기반) 전용"""

        MAP_TYPE_KEYS = {"labels", "annotations", "limits", "requests", "metadata"}

        def dict_to_hcl(d: dict, indent: int = 2) -> str:
            lines = []
            pad   = " " * indent
            for k, v in d.items():
                if "." in k or "/" in k:
                    lines.append(f'{pad}# annotation: "{k}" = "{v}"')
                    continue
                if isinstance(v, dict):
                    if k in MAP_TYPE_KEYS:
                        lines.append(f'{pad}{k} = {{')
                        for mk, mv in v.items():
                            if isinstance(mv, bool):
                                lines.append(f'{pad}  {mk} = {str(mv).lower()}')
                            elif isinstance(mv, (int, float)):
                                lines.append(f'{pad}  {mk} = {mv}')
                            else:
                                lines.append(f'{pad}  {mk} = "{mv}"')
                        lines.append(f'{pad}}}')
                    else:
                        lines.append(f"{pad}{k} {{")
                        lines.append(dict_to_hcl(v, indent + 2))
                        lines.append(f"{pad}}}")
                elif isinstance(v, list):
                    if v and isinstance(v[0], dict):
                        for item in v:
                            lines.append(f"{pad}{k} {{")
                            lines.append(dict_to_hcl(item, indent + 2))
                            lines.append(f"{pad}}}")
                    else:
                        formatted = json.dumps(v)
                        lines.append(f'{pad}{k} = {formatted}')
                elif isinstance(v, bool):
                    lines.append(f'{pad}{k} = {str(v).lower()}')
                elif isinstance(v, (int, float)):
                    lines.append(f'{pad}{k} = {v}')
                else:
                    lines.append(f'{pad}{k} = "{v}"')
            return "\n".join(lines)

        # [수정] TF 리소스 이름도 일관성을 위해 소문자화 (GCP 권장 컨벤션)
        resource_name = name.lower().replace("-", "_")
        body = dict_to_hcl(attrs)
        return f'resource "{gcp_type}" "{resource_name}" {{\n{body}\n}}'