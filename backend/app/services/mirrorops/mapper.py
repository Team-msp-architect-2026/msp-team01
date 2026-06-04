import json

# GCP에 대응 개념이 없어 매핑이 불필요한 리소스 타입
NOT_REQUIRED_RESOURCES = {
    "AWS::EC2::InternetGateway",
    "AWS::ElasticLoadBalancingV2::TargetGroup",
    "AWS::ECS::Cluster",
    "AWS::ECS::TaskDefinition",
    "AWS::RDS::DBSubnetGroup",
    "AWS::Logs::LogGroup",
    "AWS::KMS::Key",
}


# ── terraform 참조 헬퍼 ──────────────────────────────────────────────

def _vpc_ref(cfg: dict) -> str:
    """이름 태그에서 VPC terraform 참조 생성 (network 필드용)"""
    name_tag = (cfg.get("tags") or {}).get("Name", "")
    if name_tag:
        vpc_name = "-".join(name_tag.lower().replace("_", "-").split("-")[:2]) + "-vpc"
    else:
        vpc_name = "default-vpc"
    return f"__ref__google_compute_network.{vpc_name.replace('-', '_')}.id"


def _router_ref(cfg: dict) -> str:
    """이름 태그에서 Router terraform 참조 생성 (NAT router 필드용)"""
    name_tag = (cfg.get("tags") or {}).get("Name", "")
    if name_tag:
        router_name = "-".join(name_tag.lower().replace("_", "-").split("-")[:2]) + "-rt-public"
    else:
        router_name = "cloud-router"
    return f"__ref__google_compute_router.{router_name.replace('-', '_')}.name"


# §5-2 AWS→GCP 매핑 테이블
RULE_BASED_MAP: dict[str, dict] = {
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
            # [수정] terraform 참조 — VPC 생성 완료 후 서브넷 생성되도록 의존성 설정
            "network": _vpc_ref(cfg),
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
            # [수정] terraform 참조
            "network": _vpc_ref(cfg),
        },
    },
    "AWS::EC2::NatGateway": {
        "gcp_type":   "google_compute_router_nat",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name": (
                (cfg.get("tags") or {}).get("Name", "") or
                "cloud-nat"
            ).lower().replace("_", "-"),
            # [수정] terraform 참조 — Router 생성 완료 후 NAT 생성되도록 의존성 설정
            "router": _router_ref(cfg),
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
            "deletion_protection": False, 
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
            config_json = res.config_json or {}
            if isinstance(config_json, list):
                config_json = config_json[0] if config_json else {}

            rule = RULE_BASED_MAP.get(res.resource_type)
            if not rule:
                if res.resource_type in NOT_REQUIRED_RESOURCES:
                    mapping = self._create_not_required_mapping(res, project_id, sync_id)
                else:
                    mapping = self._create_manual_mapping(res, project_id, sync_id)
                db.add(mapping)
                mappings.append(mapping)
                continue

            if rule["confidence"] == "auto" and rule["mapping"]:
                attrs = rule["mapping"](config_json)
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
                result = self.bedrock.map_resource(
                    resource_type = res.resource_type,
                    aws_config    = config_json,
                    gcp_type      = rule["gcp_type"],
                )
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

    def _create_not_required_mapping(
        self, res: AWSResource, project_id: str, sync_id: str
    ) -> GCPMapping:
        return GCPMapping(
            resource_id       = res.resource_id,
            project_id        = project_id,
            sync_id           = sync_id,
            gcp_resource_type = "not_required",
            gcp_resource_name = res.resource_name,
            terraform_code    = f"# GCP 매핑 불필요: {res.resource_type}",
            confidence        = "not_required",
            review_reason     = "GCP에 동일한 개념의 리소스가 없어 별도 생성이 필요하지 않습니다.",
            user_confirmed    = False,
        )

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

    def _generate_hcl_from_mapping_info(
        self, gcp_type: str, name: str, mapping_info: dict
    ) -> str:
        if gcp_type == "google_compute_firewall":
            return self._generate_firewall_hcl(name, mapping_info)
        elif gcp_type == "google_compute_backend_service":
            return self._generate_backend_service_hcl(name, mapping_info)
        elif gcp_type == "google_cloud_run_service":
            return self._generate_cloud_run_hcl(name, mapping_info)
        return f'# review 필요: {gcp_type} — {name}'

    def _generate_firewall_hcl(self, name: str, info: dict) -> str:
        gcp_name  = name.lower().replace("_", "-")
        tf_name   = gcp_name.replace("-", "_")
        direction = info.get("direction", "INGRESS")
        rules     = info.get("rules", [{"protocol": "all", "source_ranges": ["0.0.0.0/0"]}])

        # [수정] firewall도 terraform 참조 사용
        name_parts  = name.split("-")
        vpc_name    = f"{name_parts[0]}-{name_parts[1]}-vpc".lower() if len(name_parts) >= 2 else "default-vpc"
        vpc_tf_name = vpc_name.replace("-", "_")

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
  network       = google_compute_network.{vpc_tf_name}.name
  direction     = "{direction}"
  source_ranges = {source_ranges}
{allow_blocks}
}}'''

    def _generate_backend_service_hcl(self, name: str, info: dict) -> str:
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
        gcp_name = name.lower().replace("_", "-")
        tf_name  = gcp_name.replace("-", "_")
        image = info.get("image") or "gcr.io/cloudrun/hello"
        cpu    = info.get("cpu") or "1000m"
        memory = info.get("memory") or "512Mi"
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

    def _apply_iam_mapping(self, mapping: GCPMapping, res: AWSResource) -> GCPMapping:
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

    def _attrs_to_hcl(self, gcp_type: str, name: str, attrs: dict) -> str:
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
                        lines.append(f'{pad}{k} = {json.dumps(v)}')
                elif isinstance(v, bool):
                    lines.append(f'{pad}{k} = {str(v).lower()}')
                elif isinstance(v, (int, float)):
                    lines.append(f'{pad}{k} = {v}')
                # [수정] __ref__ 접두사 → terraform 참조 (따옴표 없이 출력)
                elif isinstance(v, str) and v.startswith("__ref__"):
                    lines.append(f'{pad}{k} = {v[7:]}')
                else:
                    lines.append(f'{pad}{k} = "{v}"')
            return "\n".join(lines)

        resource_name = name.lower().replace("-", "_")
        body = dict_to_hcl(attrs)
        return f'resource "{gcp_type}" "{resource_name}" {{\n{body}\n}}'