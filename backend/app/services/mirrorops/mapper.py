# §5-2 AWS→GCP 매핑 테이블 (매핑 방식 + confidence)
RULE_BASED_MAP: dict[str, dict] = {
    # 룰 기반 (confidence: auto) — 6개 카테고리
    "AWS::EC2::VPC": {
        "gcp_type":    "google_compute_network",
        "confidence":  "auto",
        "mapping":     lambda cfg: {
            "name":                  cfg.get("vpcId", "").replace("vpc-", ""),
            "auto_create_subnetworks": False,
            "routing_mode":          "REGIONAL",
        },
    },
    "AWS::EC2::Subnet": {
        "gcp_type":   "google_compute_subnetwork",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name":        cfg.get("subnetId", "").replace("subnet-", ""),
            "ip_cidr_range": cfg.get("cidrBlock", ""),
            "region":      "us-west1",
        },
    },
    "AWS::EC2::RouteTable": {
        "gcp_type":   "google_compute_router",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name":   cfg.get("routeTableId", "").replace("rtb-", ""),
            "region": "us-west1",
        },
    },
    "AWS::EC2::NatGateway": {
        "gcp_type":   "google_compute_router_nat",
        "confidence": "auto",
        "mapping":    lambda cfg: {
            "name":                            "cloud-nat",
            "nat_ip_allocate_option":          "AUTO_ONLY",
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
                "tier":               "db-f1-micro",
                "availability_type":  "REGIONAL" if cfg.get("MultiAZ") else "ZONAL",
                "backup_configuration": {
                    "enabled": cfg.get("BackupRetentionPeriod", 0) > 0
                },
            },
        },
    },
    "AWS::IAM::Role": {
        "gcp_type":   "google_service_account",
        "confidence": "auto",  # 단순 변환은 auto, 복잡한 Policy는 Bedrock
        "mapping":    lambda cfg: {
            "account_id":  "autoops-sa",
            "display_name": cfg.get("RoleName", ""),
        },
    },
    # Bedrock 보완 대상 (confidence: review) — 5개 카테고리
    "AWS::EC2::SecurityGroup": {
        "gcp_type":   "google_compute_firewall",
        "confidence": "review",  # §5-2: Bedrock 보완
        "mapping":    None,      # BedrockMapper에서 처리
    },
    "AWS::ElasticLoadBalancingV2::LoadBalancer": {
        "gcp_type":   "google_compute_backend_service",
        "confidence": "review",  # §5-2: Bedrock 보완
        "mapping":    None,
    },
    "AWS::ECS::Service": {
        "gcp_type":   "google_cloud_run_service",
        "confidence": "review",  # §5-2: Bedrock 보완
        "mapping":    None,
    },
}

# §5-2 IAM Action → GCP Role 변환 테이블
IAM_ACTION_TO_GCP_ROLE: dict[str, str] = {
    "s3:GetObject":              "roles/storage.objectAdmin",
    "s3:PutObject":              "roles/storage.objectAdmin",
    "logs:PutLogEvents":         "roles/logging.logWriter",
    "cloudwatch:PutMetricData":  "roles/monitoring.metricWriter",
    "ecr:BatchGetImage":         "roles/artifactregistry.reader",
    "ssm:GetParameter":          "roles/secretmanager.secretAccessor",
}

from sqlalchemy.orm import Session
from app.models.aws_resource import AWSResource
from app.models.gcp_mapping import GCPMapping
from app.services.mirrorops.bedrock_client import BedrockMapper


class MappingEngine:
    """
    AWS 리소스 목록을 GCP 리소스로 매핑한다.
    - 룰 기반: confidence=auto (6개 카테고리) — RULE_BASED_MAP 사용
    - Bedrock 보완: confidence=review (5개 카테고리) — BedrockMapper 사용
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
        """
        감지된 AWS 리소스 전체를 GCP 리소스로 매핑하고
        gcp_mappings 테이블에 저장한다.
        """
        mappings = []

        for res in aws_resources:
            rule = RULE_BASED_MAP.get(res.resource_type)
            if not rule:
                # 매핑 규칙 없는 리소스 → manual confidence
                mapping = self._create_manual_mapping(res, project_id, sync_id)
                db.add(mapping)
                mappings.append(mapping)
                continue

            if rule["confidence"] == "auto" and rule["mapping"]:
                # 룰 기반 변환 (FR-B-004)
                attrs = rule["mapping"](res.config_json or {})
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
                    aws_config    = res.config_json or {},
                    gcp_type      = rule["gcp_type"],
                )
                attrs        = result.get("terraform_attributes", {})
                review_reason = result.get("review_reason", "")
                hcl          = self._attrs_to_hcl(rule["gcp_type"], res.resource_name, attrs)
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

            # IAM Role의 경우 추가로 Policy → GCP Role 변환 (FR-B-006)
            if res.resource_type == "AWS::IAM::Role":
                mapping = self._apply_iam_mapping(mapping, res)

            db.add(mapping)
            mappings.append(mapping)

        db.commit()
        return mappings

    def _apply_iam_mapping(
        self, mapping: GCPMapping, res: AWSResource
    ) -> GCPMapping:
        """
        §5-2 IAM Action → GCP Role 변환 테이블 적용 (FR-B-006)
        표준 Action은 룰 기반, 복잡한 Condition은 Bedrock 보완.
        완전 커스텀 정책은 manual 표시.
        """
        policies = (res.config_json or {}).get("AssumeRolePolicyDocument", {})
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
            # HCL에 GCP 역할 바인딩 추가
            extra_hcl = "\n".join([
                f'# GCP Role Binding:{role}' for role in set(gcp_roles)
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
            terraform_code    = f"# 수동 매핑 필요:{res.resource_type}",
            confidence        = "manual",
            review_reason     = "자동 변환 규칙이 없습니다. 수동으로 GCP 리소스를 설정하세요.",
            user_confirmed    = False,
        )

    def _attrs_to_hcl(
        self, gcp_type: str, name: str, attrs: dict
    ) -> str:
        """GCP Terraform 리소스 속성을 HCL 문자열로 변환한다."""
        import json

        def dict_to_hcl(d: dict, indent: int = 2) -> str:
            lines = []
            pad   = " " * indent
            for k, v in d.items():
                if isinstance(v, dict):
                    lines.append(f"{pad}{k}{{")
                    lines.append(dict_to_hcl(v, indent + 2))
                    lines.append(f"{pad}}}")
                elif isinstance(v, bool):
                    lines.append(f'{pad}{k} ={str(v).lower()}')
                elif isinstance(v, (int, float)):
                    lines.append(f'{pad}{k} ={v}')
                else:
                    lines.append(f'{pad}{k} = "{v}"')
            return "\n".join(lines)

        resource_name = name.replace("-", "_")
        body = dict_to_hcl(attrs)
        return f'resource "{gcp_type}" "{resource_name}"{{\n{body}\n}}'