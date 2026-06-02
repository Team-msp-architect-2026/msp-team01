import boto3
import json
from typing import Any
from sqlalchemy.orm import Session
from app.models.aws_resource import AWSResource
from datetime import datetime


RESOURCE_TYPE_MAP: dict[str, dict] = {
    "AWS::EC2::VPC":                   {"service": "ec2",  "method": "describe_vpcs",            "key": "Vpcs"},
    "AWS::EC2::Subnet":                {"service": "ec2",  "method": "describe_subnets",          "key": "Subnets"},
    "AWS::EC2::InternetGateway":       {"service": "ec2",  "method": "describe_internet_gateways","key": "InternetGateways"},
    "AWS::EC2::NatGateway":            {"service": "ec2",  "method": "describe_nat_gateways",     "key": "NatGateways"},
    "AWS::EC2::RouteTable":            {"service": "ec2",  "method": "describe_route_tables",     "key": "RouteTables"},
    "AWS::EC2::SecurityGroup":         {"service": "ec2",  "method": "describe_security_groups",  "key": "SecurityGroups"},
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
    "AWS::KMS::Key":                   {"service": "kms",  "method": "list_keys",                "key": "Keys"},
}


class ResourceDetector:
    """
    AWS Config + boto3를 활용해 배포된 16개 리소스를 감지하고 정규화한다. (FR-B-003)
    Cross-Account IAM Role Assume 후 사용자 계정의 리소스를 조회한다.
    """

    def __init__(self, role_arn: str, region: str, external_id: str = ""):
        self.region  = region
        self.session = self._assume_role(role_arn, external_id)

    def _assume_role(self, role_arn: str, external_id: str = "") -> boto3.Session:
        sts    = boto3.client("sts", region_name="us-west-2")
        kwargs = {
            "RoleArn":         role_arn,
            "RoleSessionName": "autoops-mirrorops-detect",
            "DurationSeconds": 3600,
        }
        if external_id:
            kwargs["ExternalId"] = external_id
        resp  = sts.assume_role(**kwargs)
        creds = resp["Credentials"]
        return boto3.Session(
            aws_access_key_id     = creds["AccessKeyId"],
            aws_secret_access_key = creds["SecretAccessKey"],
            aws_session_token     = creds["SessionToken"],
            region_name           = self.region,
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
        seen_names: set = set()

        for resource_type in RESOURCE_TYPE_MAP:
            try:
                resources = self._query_resources(resource_type, name_prefix)
                for res in resources:
                    dedup_key = (resource_type, res.get("name", ""))
                    if dedup_key in seen_names:
                        print(f"[ResourceDetector] 중복 스킵: {resource_type} '{res.get('name', '')}'")
                        continue
                    seen_names.add(dedup_key)

                    aws_resource = AWSResource(
                        project_id      = project_id,
                        resource_type   = resource_type,
                        resource_name   = res.get("name", ""),
                        resource_id_aws = res.get("id", ""),
                        config_json     = res.get("config", {}),
                        detected_at     = datetime.utcnow(),
                    )
                    db.add(aws_resource)
                    detected.append(aws_resource)
            except Exception as e:
                print(f"[경고] {resource_type} 감지 실패: {e}")

        db.commit()
        return detected

    def _query_resources(
        self, resource_type: str, name_prefix: str
    ) -> list[dict]:
        config_client = self.session.client("config", region_name=self.region)
        results  = []
        seen_ids: set = set()

        paginator = config_client.get_paginator("list_discovered_resources")
        for page in paginator.paginate(resourceType=resource_type):
            for item in page.get("resourceIdentifiers", []):
                res_name = item.get("resourceName", "")
                res_id   = item.get("resourceId", "")

                if res_id in seen_ids:
                    continue
                seen_ids.add(res_id)

                detail = config_client.get_resource_config_history(
                    resourceType=resource_type,
                    resourceId=res_id,
                    limit=1,
                )
                config_items = detail.get("configurationItems", [])
                config_json  = {}

                if config_items:
                    item_status = config_items[0].get("configurationItemStatus", "")
                    if item_status == "ResourceDeleted":
                        continue

                    raw = config_items[0].get("configuration", "{}")
                    try:
                        config_json = json.loads(raw) if isinstance(raw, str) else raw
                    except json.JSONDecodeError:
                        config_json = {}

                    top_tags = config_items[0].get("tags", {})
                    config_json["tags"] = top_tags

                name_tag = ""
                tags = config_json.get("tags", {})
                if isinstance(tags, dict):
                    name_tag = tags.get("Name", "")
                elif isinstance(tags, list):
                    for tag in tags:
                        if tag.get("key") == "Name":
                            name_tag = tag.get("value", "")
                            break

                effective_name = name_tag or res_name
                if not effective_name.lower().startswith(name_prefix.lower()):
                    continue

                results.append({
                    "id":     res_id,
                    "name":   effective_name,
                    "config": config_json,
                })

        return results

    def scan_all(self, role_arn: str, region: str = "us-west-2", external_id: str = "") -> dict:
        import boto3

        sts = boto3.client("sts")
        kwargs = {
            "RoleArn":         role_arn,
            "RoleSessionName": "AutoOpsOnboardingScan",
            "DurationSeconds": 3600,
        }
        if external_id:
            kwargs["ExternalId"] = external_id
        assumed = sts.assume_role(**kwargs)
        creds = assumed["Credentials"]

        session = boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
            region_name=region,
        )

        config_client = session.client("config")
        ec2_client    = session.client("ec2")

        resource_types = [
            "AWS::EC2::VPC",
            "AWS::EC2::Subnet",
            "AWS::EC2::SecurityGroup",
            "AWS::ECS::Cluster",
            "AWS::RDS::DBInstance",
            "AWS::ElasticLoadBalancingV2::LoadBalancer",
            "AWS::EC2::NatGateway",
            "AWS::IAM::Role",
            "AWS::S3::Bucket",
            "AWS::Logs::LogGroup",
        ]

        all_resources = []
        for resource_type in resource_types:
            paginator = config_client.get_paginator("list_discovered_resources")
            for page in paginator.paginate(resourceType=resource_type):
                for r in page.get("resourceIdentifiers", []):
                    all_resources.append({
                        "resource_type": resource_type,
                        "resource_id":   r["resourceId"],
                        "resource_name": r.get("resourceName", r["resourceId"]),
                        "region":        r.get("resourceRegion", region),
                    })

        vpc_names = {}
        try:
            vpcs = ec2_client.describe_vpcs()["Vpcs"]
            for vpc in vpcs:
                name = next(
                    (t["Value"] for t in vpc.get("Tags", []) if t["Key"] == "Name"),
                    vpc["VpcId"],
                )
                vpc_names[vpc["VpcId"]] = name
        except Exception:
            pass

        subnet_vpc_map = {}
        try:
            subnets = ec2_client.describe_subnets()["Subnets"]
            for s in subnets:
                subnet_vpc_map[s["SubnetId"]] = s["VpcId"]
        except Exception:
            pass

        sg_vpc_map = {}
        try:
            sgs = ec2_client.describe_security_groups()["SecurityGroups"]
            for sg in sgs:
                sg_vpc_map[sg["GroupId"]] = sg.get("VpcId", "")
        except Exception:
            pass

        groups: dict = {}

        def _add_to_group(resource: dict, vpc_id: str | None):
            key = f"{resource['region']}/{vpc_id}" if vpc_id else f"{resource['region']}/no-vpc"
            if key not in groups:
                groups[key] = {
                    "region":    resource["region"],
                    "vpc_id":    vpc_id,
                    "vpc_name":  vpc_names.get(vpc_id, vpc_id) if vpc_id else None,
                    "resources": [],
                }
            groups[key]["resources"].append(resource)

        for r in all_resources:
            rtype = r["resource_type"]
            rid   = r["resource_id"]

            if rtype == "AWS::EC2::VPC":
                _add_to_group(r, rid)
            elif rtype == "AWS::EC2::Subnet":
                _add_to_group(r, subnet_vpc_map.get(rid))
            elif rtype == "AWS::EC2::SecurityGroup":
                _add_to_group(r, sg_vpc_map.get(rid))
            else:
                _add_to_group(r, None)

        return groups