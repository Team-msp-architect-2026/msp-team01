import boto3
from typing import Any
from sqlalchemy.orm import Session
from app.models.aws_resource import AWSResource
from datetime import datetime


# 감지 대상 리소스 타입 매핑
# AWS Config resource type → boto3 서비스/메서드
RESOURCE_TYPE_MAP: dict[str, dict] = {
    "AWS::EC2::VPC":                   {"service": "ec2",  "method": "describe_vpcs",           "key": "Vpcs"},
    "AWS::EC2::Subnet":                {"service": "ec2",  "method": "describe_subnets",         "key": "Subnets"},
    "AWS::EC2::InternetGateway":       {"service": "ec2",  "method": "describe_internet_gateways","key": "InternetGateways"},
    "AWS::EC2::NatGateway":            {"service": "ec2",  "method": "describe_nat_gateways",    "key": "NatGateways"},
    "AWS::EC2::RouteTable":            {"service": "ec2",  "method": "describe_route_tables",    "key": "RouteTables"},
    "AWS::EC2::SecurityGroup":         {"service": "ec2",  "method": "describe_security_groups", "key": "SecurityGroups"},
    "AWS::ElasticLoadBalancingV2::LoadBalancer": {
        "service": "elbv2", "method": "describe_load_balancers", "key": "LoadBalancers"
    },
    "AWS::ElasticLoadBalancingV2::TargetGroup": {
        "service": "elbv2", "method": "describe_target_groups",  "key": "TargetGroups"
    },
    "AWS::IAM::Role":                  {"service": "iam",  "method": "list_roles",               "key": "Roles"},
    "AWS::ECS::Cluster":               {"service": "ecs",  "method": "describe_clusters",        "key": "clusters"},
    "AWS::ECS::TaskDefinition":        {"service": "ecs",  "method": "list_task_definitions",    "key": "taskDefinitionArns"},
    "AWS::ECS::Service":               {"service": "ecs",  "method": "list_services",            "key": "serviceArns"},
    "AWS::Logs::LogGroup":             {"service": "logs", "method": "describe_log_groups",      "key": "logGroups"},
    "AWS::RDS::DBSubnetGroup":         {"service": "rds",  "method": "describe_db_subnet_groups","key": "DBSubnetGroups"},
    "AWS::RDS::DBInstance":            {"service": "rds",  "method": "describe_db_instances",    "key": "DBInstances"},
    "AWS::KMS::Key":                   {"service": "kms",  "method": "list_keys",               "key": "Keys"},
}


class ResourceDetector:
    """
    AWS Config + boto3를 활용해 배포된 16개 리소스를 감지하고 정규화한다. (FR-B-003)
    Cross-Account IAM Role Assume 후 사용자 계정의 리소스를 조회한다.
    """

    def __init__(self, role_arn: str, region: str):
        self.region   = region
        self.session  = self._assume_role(role_arn)
        self.config   = self.session.client("config", region_name=region)

    def _assume_role(self, role_arn: str) -> boto3.Session:
        """Cross-Account IAM Role을 Assume하고 boto3 Session을 반환한다."""
        sts  = boto3.client("sts", region_name="us-west-2")
        resp = sts.assume_role(
            RoleArn=role_arn,
            RoleSessionName="autoops-mirrorops-detect",
            DurationSeconds=3600,
        )
        creds = resp["Credentials"]
        return boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=self.region,
        )

    def detect_all(
        self,
        project_id: str,
        prefix: str,
        environment: str,
        db: Session,
    ) -> list[AWSResource]:
        """
        네이밍 규칙({prefix}-{env}-*)에 일치하는 리소스를 전체 감지하고
        aws_resources 테이블에 저장한다.
        """
        name_prefix = f"{prefix}-{environment}-"
        detected    = []

        for resource_type in RESOURCE_TYPE_MAP:
            try:
                resources = self._query_resources(resource_type, name_prefix)
                for res in resources:
                    aws_resource = AWSResource(
                        project_id    = project_id,
                        resource_type = resource_type,
                        resource_name = res.get("name", ""),
                        resource_id_aws = res.get("id", ""),
                        config_json   = res.get("config", {}),
                        detected_at   = datetime.utcnow(),
                    )
                    db.add(aws_resource)
                    detected.append(aws_resource)
            except Exception as e:
                # 특정 리소스 타입 조회 실패 시 로그 남기고 계속 진행
                print(f"[경고]{resource_type} 감지 실패:{e}")

        db.commit()
        return detected

    def _query_resources(
        self, resource_type: str, name_prefix: str
    ) -> list[dict]:
        """
        AWS Config list_discovered_resources로 리소스를 조회한다.
        name_prefix로 필터링해 해당 프로젝트 리소스만 반환한다.
        """
        config_client = self.session.client("config", region_name=self.region)
        results = []

        paginator = config_client.get_paginator("list_discovered_resources")
        for page in paginator.paginate(resourceType=resource_type):
            for item in page.get("resourceIdentifiers", []):
                res_name = item.get("resourceName", "")
                res_id   = item.get("resourceId", "")

                # 네이밍 규칙 기반 필터링
                if not res_name.startswith(name_prefix):
                    continue

                # 상세 정보 조회
                detail = config_client.get_resource_config_history(
                    resourceType=resource_type,
                    resourceId=res_id,
                    limit=1,
                )
                config_items = detail.get("configurationItems", [])
                config_json  = {}
                if config_items:
                    import json
                    raw = config_items[0].get("configuration", "{}")
                    try:
                        config_json = json.loads(raw) if isinstance(raw, str) else raw
                    except json.JSONDecodeError:
                        config_json = {}

                results.append({
                    "id":     res_id,
                    "name":   res_name,
                    "config": config_json,
                })

        return results