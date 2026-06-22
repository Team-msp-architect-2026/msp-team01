import boto3
import json
from sqlalchemy.orm import Session
from app.models.aws_resource import AWSResource
from datetime import datetime, date


def _serialize_config(obj):
    """boto3 응답의 datetime을 문자열로 변환"""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


def _clean_config(config: dict) -> dict:
    """config_json 직렬화 가능하도록 변환"""
    try:
        return json.loads(json.dumps(config, default=_serialize_config))
    except Exception:
        return {}


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


def _extract_name(resource_type: str, item: dict) -> str:
    """리소스 타입별 Name 태그 또는 식별자 추출"""
    # Tags에서 Name 추출 (EC2 계열)
    tags = item.get("Tags", item.get("tags", []))
    if isinstance(tags, list):
        for tag in tags:
            if tag.get("Key", tag.get("key", "")) == "Name":
                return tag.get("Value", tag.get("value", ""))
    elif isinstance(tags, dict):
        name = tags.get("Name", "")
        if name:
            return name

    # name 필드 직접 사용 (ECS Service/TaskDefinition 수동 구성)
    if item.get("name"):
        return item["name"]

    # 리소스별 이름 필드 (버그 3 수정: GroupName 추가)
    return (
        item.get("GroupName") or          # ← v2 추가: SecurityGroup 이름 필드
        item.get("clusterName") or
        item.get("logGroupName") or
        item.get("DBSubnetGroupName") or
        item.get("DBInstanceIdentifier") or
        item.get("RoleName") or
        item.get("LoadBalancerName") or
        item.get("TargetGroupName") or
        ""
    )


def _extract_id(resource_type: str, item: dict) -> str:
    """리소스 타입별 ID 추출 — resource_type 기반으로 정확히 매핑"""
    id_map = {
        "AWS::EC2::VPC":                                  "VpcId",
        "AWS::EC2::Subnet":                               "SubnetId",
        "AWS::EC2::InternetGateway":                      "InternetGatewayId",
        "AWS::EC2::NatGateway":                           "NatGatewayId",
        "AWS::EC2::RouteTable":                           "RouteTableId",
        "AWS::EC2::SecurityGroup":                        "GroupId",
        "AWS::ElasticLoadBalancingV2::LoadBalancer":      "LoadBalancerArn",
        "AWS::ElasticLoadBalancingV2::TargetGroup":       "TargetGroupArn",
        "AWS::IAM::Role":                                 "RoleName",
        "AWS::ECS::Cluster":                              "clusterArn",
        "AWS::ECS::TaskDefinition":                       "taskDefinitionArn",
        "AWS::ECS::Service":                              "serviceArn",
        "AWS::Logs::LogGroup":                            "logGroupName",
        "AWS::RDS::DBSubnetGroup":                        "DBSubnetGroupName",
        "AWS::RDS::DBInstance":                           "DBInstanceIdentifier",
        "AWS::KMS::Key":                                  "KeyId",
    }
    field = id_map.get(resource_type)
    if field:
        return item.get(field, "")
    return ""


def _matches_prefix(resource_type: str, name: str, name_prefix: str) -> bool:
    """리소스 타입별 prefix 매칭"""
    name_lower   = name.lower()
    prefix_lower = name_prefix.lower()
    # Log Group: "/ecs/test-prod-app" → prefix가 포함되면 매칭
    if resource_type == "AWS::Logs::LogGroup":
        return prefix_lower.rstrip("-") in name_lower
    return name_lower.startswith(prefix_lower)


class ResourceDetector:
    """
    boto3 직접 호출로 배포된 리소스를 감지하고 정규화한다. (FR-B-003)
    Cross-Account IAM Role Assume 후 사용자 계정의 리소스를 조회한다.
    AWS Config 의존 제거 → 배포 완료 즉시 스캔 가능.
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
        """
        RESOURCE_TYPE_MAP 기반 boto3 직접 호출.
        AWS Config 의존 없이 즉시 리소스 조회 가능.
        버그 4 수정: IAM/ELB/Logs/RDS 페이지네이션 추가
        """
        type_config = RESOURCE_TYPE_MAP.get(resource_type, {})
        service = type_config.get("service")
        method  = type_config.get("method")
        key     = type_config.get("key")

        if not service or not method:
            return []

        client = self.session.client(service, region_name=self.region)
        results = []

        try:
            # ── 서비스별 특수 처리 (페이지네이션 포함) ──────────────────
            if resource_type == "AWS::ECS::Cluster":
                arns = client.list_clusters().get("clusterArns", [])
                if not arns:
                    return []
                items = client.describe_clusters(clusters=arns).get("clusters", [])

            elif resource_type == "AWS::ECS::TaskDefinition":
                arns = client.list_task_definitions(status="ACTIVE").get("taskDefinitionArns", [])
                items = [{"taskDefinitionArn": arn, "name": arn.split("/")[-1].split(":")[0]} for arn in arns]

            elif resource_type == "AWS::ECS::Service":
                cluster_arns = client.list_clusters().get("clusterArns", [])
                items = []
                for cluster in cluster_arns:
                    arns = client.list_services(cluster=cluster).get("serviceArns", [])
                    items.extend([{"serviceArn": arn, "name": arn.split("/")[-1]} for arn in arns])

            elif resource_type == "AWS::IAM::Role":
                # ← 버그 4 수정: IAM 페이지네이션
                items = []
                paginator = client.get_paginator("list_roles")
                for page in paginator.paginate():
                    items.extend(page.get("Roles", []))

            elif resource_type == "AWS::KMS::Key":
                keys = client.list_keys().get("Keys", [])
                items = []
                for k in keys:
                    try:
                        meta = client.describe_key(KeyId=k["KeyId"])["KeyMetadata"]
                        if meta.get("KeyState") == "Enabled" and meta.get("KeyManager") == "CUSTOMER":
                            items.append(meta)
                    except Exception:
                        pass

            elif resource_type == "AWS::EC2::NatGateway":
                items = client.describe_nat_gateways(
                    Filters=[{"Name": "state", "Values": ["available"]}]
                ).get("NatGateways", [])

            elif resource_type == "AWS::ElasticLoadBalancingV2::LoadBalancer":
                # ← 버그 4 수정: ELB 페이지네이션
                items = []
                paginator = client.get_paginator("describe_load_balancers")
                for page in paginator.paginate():
                    items.extend(page.get("LoadBalancers", []))

            elif resource_type == "AWS::ElasticLoadBalancingV2::TargetGroup":
                # ← 버그 4 수정: TargetGroup 페이지네이션
                items = []
                paginator = client.get_paginator("describe_target_groups")
                for page in paginator.paginate():
                    items.extend(page.get("TargetGroups", []))

            elif resource_type == "AWS::Logs::LogGroup":
                # ← 버그 4 수정: LogGroup 페이지네이션
                items = []
                paginator = client.get_paginator("describe_log_groups")
                for page in paginator.paginate():
                    items.extend(page.get("logGroups", []))

            elif resource_type == "AWS::RDS::DBInstance":
                # ← 버그 4 수정: RDS 페이지네이션
                items = []
                paginator = client.get_paginator("describe_db_instances")
                for page in paginator.paginate():
                    items.extend(page.get("DBInstances", []))

            elif resource_type == "AWS::RDS::DBSubnetGroup":
                # ← 버그 4 수정: RDS SubnetGroup 페이지네이션
                items = []
                paginator = client.get_paginator("describe_db_subnet_groups")
                for page in paginator.paginate():
                    items.extend(page.get("DBSubnetGroups", []))

            else:
                response = getattr(client, method)()
                items = response.get(key, [])

            # ── 이름/ID 추출 + prefix 필터링 ────────────────────────────
            for item in items:
                name        = _extract_name(resource_type, item)
                resource_id = _extract_id(resource_type, item)

                if not resource_id:
                    continue

                if not name:
                    name = resource_id

                if not _matches_prefix(resource_type, name, name_prefix):
                    continue

                results.append({
                    "id":     resource_id,
                    "name":   name,
                    "config": _clean_config(item),
                })

        except Exception as e:
            print(f"[경고] {resource_type} boto3 직접 조회 실패: {e}")

        return results

    def _enabled_regions(self, session: boto3.Session) -> list[str]:
        """계정에서 활성화된(opt-in 제외) 전체 리전 목록 조회"""
        ec2 = session.client("ec2", region_name="us-west-2")
        try:
            regions = ec2.describe_regions(
                Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]
            )["Regions"]
            return [r["RegionName"] for r in regions]
        except Exception as e:
            print(f"[scan_all] 리전 목록 조회 실패, us-west-2만 스캔: {e}")
            return ["us-west-2"]

    def _scan_region(self, session: boto3.Session, region: str) -> list[dict]:
        """단일 리전 내 EC2/ECS/RDS/ALB/Logs 리소스 스캔"""
        ec2   = session.client("ec2",   region_name=region)
        ecs   = session.client("ecs",   region_name=region)
        rds   = session.client("rds",   region_name=region)
        elbv2 = session.client("elbv2", region_name=region)
        logs  = session.client("logs",  region_name=region)

        all_resources = []

        # ── EC2 ──────────────────────────────────────────────────────
        try:
            for vpc in ec2.describe_vpcs()["Vpcs"]:
                if vpc.get("IsDefault"): continue
                name = next((t["Value"] for t in vpc.get("Tags", []) if t["Key"] == "Name"), vpc["VpcId"])
                all_resources.append({"resource_type": "AWS::EC2::VPC", "resource_id": vpc["VpcId"], "resource_name": name, "region": region, "vpc_id": vpc["VpcId"]})
        except Exception as e:
            print(f"[scan_all] {region} VPC 조회 실패: {e}")

        try:
            for sn in ec2.describe_subnets()["Subnets"]:
                if sn.get("DefaultForAz"): continue
                name = next((t["Value"] for t in sn.get("Tags", []) if t["Key"] == "Name"), sn["SubnetId"])
                all_resources.append({"resource_type": "AWS::EC2::Subnet", "resource_id": sn["SubnetId"], "resource_name": name, "region": region, "vpc_id": sn.get("VpcId")})
        except Exception as e:
            print(f"[scan_all] {region} Subnet 조회 실패: {e}")

        try:
            for sg in ec2.describe_security_groups()["SecurityGroups"]:
                if sg.get("GroupName") == "default": continue
                name = next((t["Value"] for t in sg.get("Tags", []) if t["Key"] == "Name"), sg.get("GroupName", sg["GroupId"]))
                all_resources.append({"resource_type": "AWS::EC2::SecurityGroup", "resource_id": sg["GroupId"], "resource_name": name, "region": region, "vpc_id": sg.get("VpcId")})
        except Exception as e:
            print(f"[scan_all] {region} SecurityGroup 조회 실패: {e}")

        # ── ECS ──────────────────────────────────────────────────────
        try:
            cluster_arns = ecs.list_clusters().get("clusterArns", [])
            if cluster_arns:
                for c in ecs.describe_clusters(clusters=cluster_arns).get("clusters", []):
                    all_resources.append({"resource_type": "AWS::ECS::Cluster", "resource_id": c["clusterArn"], "resource_name": c["clusterName"], "region": region, "vpc_id": None})
        except Exception as e:
            print(f"[scan_all] {region} ECS Cluster 조회 실패: {e}")

        # ── RDS ──────────────────────────────────────────────────────
        try:
            paginator = rds.get_paginator("describe_db_instances")
            for page in paginator.paginate():
                for db in page.get("DBInstances", []):
                    all_resources.append({"resource_type": "AWS::RDS::DBInstance", "resource_id": db["DBInstanceIdentifier"], "resource_name": db["DBInstanceIdentifier"], "region": region, "vpc_id": None})
        except Exception as e:
            print(f"[scan_all] {region} RDS 조회 실패: {e}")

        # ── ALB ──────────────────────────────────────────────────────
        try:
            paginator = elbv2.get_paginator("describe_load_balancers")
            for page in paginator.paginate():
                for lb in page.get("LoadBalancers", []):
                    all_resources.append({"resource_type": "AWS::ElasticLoadBalancingV2::LoadBalancer", "resource_id": lb["LoadBalancerArn"], "resource_name": lb["LoadBalancerName"], "region": region, "vpc_id": lb.get("VpcId")})
        except Exception as e:
            print(f"[scan_all] {region} ALB 조회 실패: {e}")

        # ── NAT Gateway ───────────────────────────────────────────────
        try:
            for nat in ec2.describe_nat_gateways(Filters=[{"Name": "state", "Values": ["available"]}])["NatGateways"]:
                name = next((t["Value"] for t in nat.get("Tags", []) if t["Key"] == "Name"), nat["NatGatewayId"])
                all_resources.append({"resource_type": "AWS::EC2::NatGateway", "resource_id": nat["NatGatewayId"], "resource_name": name, "region": region, "vpc_id": nat.get("VpcId")})
        except Exception as e:
            print(f"[scan_all] {region} NAT Gateway 조회 실패: {e}")

        # ── Log Groups ───────────────────────────────────────────────
        try:
            paginator = logs.get_paginator("describe_log_groups")
            for page in paginator.paginate():
                for lg in page.get("logGroups", []):
                    all_resources.append({"resource_type": "AWS::Logs::LogGroup", "resource_id": lg["logGroupName"], "resource_name": lg["logGroupName"], "region": region, "vpc_id": None})
        except Exception as e:
            print(f"[scan_all] {region} LogGroup 조회 실패: {e}")

        return all_resources

    def scan_all(self, role_arn: str, region: str = "", external_id: str = "") -> dict:
        """
        온보딩용 전체 계정 리소스 스캔.
        버그 1 수정: AWS Config 의존 제거 → boto3 직접 호출로 전환.
        Config 초기 탐색 지연(수십 분) 없이 즉시 스캔 가능.
        멀티 리전: 계정에 활성화된 전체 리전을 순회 (IAM Role은 글로벌이라 1회만 조회).
        region을 명시하면 해당 리전만 스캔(테스트/디버그용, 기존 동작 유지).
        """
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
        )

        regions = [region] if region else self._enabled_regions(session)

        all_resources = []
        for r in regions:
            all_resources.extend(self._scan_region(session, r))

        # ── IAM Role (글로벌, 1회만 조회) ───────────────────────────────
        try:
            iam = session.client("iam", region_name="us-west-2")
            paginator = iam.get_paginator("list_roles")
            for page in paginator.paginate():
                for role in page.get("Roles", []):
                    all_resources.append({"resource_type": "AWS::IAM::Role", "resource_id": role["RoleName"], "resource_name": role["RoleName"], "region": "global", "vpc_id": None})
        except Exception as e:
            print(f"[scan_all] IAM Role 조회 실패: {e}")

        # ── VPC 기반 그룹화 ───────────────────────────────────────────
        vpc_names = {r["resource_id"]: r["resource_name"] for r in all_resources if r["resource_type"] == "AWS::EC2::VPC"}

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
            _add_to_group(r, r.get("vpc_id"))

        return groups