# backend/app/services/craftops/runner.py
import boto3
import json
from datetime import datetime
from app.core.config import settings
from datetime import timezone

def upload_hcl_to_s3(project_id: str, deployment_id: str, hcl_code: str) -> str:
    """
    Ephemeral ECS Task가 다운로드할 수 있도록
    HCL 코드를 S3에 저장하고 경로를 반환한다.

    §4-6 S3 구조:
    autoops-terraform-state/
    └── projects/{project_id}/
        └── terraform.tfstate  ← terraform apply 후 자동 생성
    HCL은 별도 경로에 저장:
    autoops-terraform-state/
    └── projects/{project_id}/
        └── source/main.tf
    """
    s3 = boto3.client("s3", region_name="us-west-2")
    s3_key = f"projects/{project_id}/source/main.tf"

    s3.put_object(
        Bucket="autoops-terraform-state",
        Key=s3_key,
        Body=hcl_code.encode("utf-8"),
        ContentType="text/plain",
    )

    return f"s3://autoops-terraform-state/{s3_key}"

class TerraformRunnerService:
    """
    Ephemeral ECS Task(Terraform Runner)를 생성하고 관리한다.

    배포 흐름:
    1. HCL 코드를 S3에 업로드
    2. ECS RunTask로 Ephemeral Task 생성
    3. Task에 환경변수로 PROJECT_ID, DEPLOYMENT_ID, ROLE_ARN 등 주입
    4. Task는 S3에서 main.tf를 다운로드하고 terraform apply 실행
    5. 완료/실패 시 Task가 자동 종료 (Ephemeral — 재사용하지 않음)
    """

    def __init__(self):
        self.ecs = boto3.client("ecs", region_name="us-west-2")
        self.account_id = boto3.client(
            "sts", region_name="us-west-2"
        ).get_caller_identity()["Account"]

    def spawn_apply_task(
        self,
        project_id: str,
        deployment_id: str,
        hcl_s3_path: str,
        role_arn: str,
        region: str,
        subnet_ids: list[str],
        security_group_ids: list[str],
    ) -> str:
        """
        terraform apply를 실행하는 Ephemeral ECS Task를 생성한다.
        반환: ECS Task ARN
        """
        response = self.ecs.run_task(
            cluster="autoops-cluster",
            taskDefinition="autoops-terraform-runner",
            launchType="FARGATE",
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": subnet_ids,
                    "securityGroups": security_group_ids,
                    "assignPublicIp": "DISABLED",   # Private Subnet 배치
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": "terraform-runner",
                        "environment": [
                            {"name": "PROJECT_ID",     "value": project_id},
                            {"name": "DEPLOYMENT_ID",  "value": deployment_id},
                            {"name": "HCL_S3_PATH",    "value": hcl_s3_path},
                            {"name": "ROLE_ARN",       "value": role_arn},
                            {"name": "REGION",         "value": region},
                            {"name": "ACTION",         "value": "apply"},
                            # CloudWatch 로그 그룹 — §7-7 명명 규칙
                            {"name": "CW_LOG_GROUP",
                             "value": f"/autoops/terraform-runner/{deployment_id}"},
                        ],
                    }
                ]
            },
        )

        tasks = response.get("tasks", [])
        if not tasks:
            failures = response.get("failures", [])
            reason = failures[0].get("reason", "알 수 없는 오류") if failures else "Task 생성 실패"
            raise RuntimeError(f"ECS Task 생성 실패:{reason}")

        task_arn = tasks[0]["taskArn"]
        return task_arn

    def spawn_destroy_task(
        self,
        project_id: str,
        deployment_id: str,
        role_arn: str,
        region: str,
        subnet_ids: list[str],
        security_group_ids: list[str],
    ) -> str:
        """
        terraform destroy를 실행하는 Ephemeral ECS Task를 생성한다.
        Full Destroy 액션에서 호출된다. (§4-7)
        """
        hcl_s3_path = f"s3://autoops-terraform-state/projects/{project_id}/source/main.tf"

        response = self.ecs.run_task(
            cluster="autoops-cluster",
            taskDefinition="autoops-terraform-runner",
            launchType="FARGATE",
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": subnet_ids,
                    "securityGroups": security_group_ids,
                    "assignPublicIp": "DISABLED",
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": "terraform-runner",
                        "environment": [
                            {"name": "PROJECT_ID",    "value": project_id},
                            {"name": "DEPLOYMENT_ID", "value": deployment_id},
                            {"name": "HCL_S3_PATH",   "value": hcl_s3_path},
                            {"name": "ROLE_ARN",      "value": role_arn},
                            {"name": "REGION",        "value": region},
                            {"name": "ACTION",        "value": "destroy"},
                            {"name": "CW_LOG_GROUP",
                             "value": f"/autoops/terraform-runner/{deployment_id}"},
                        ],
                    }
                ]
            },
        )

        tasks = response.get("tasks", [])
        if not tasks:
            raise RuntimeError("ECS Destroy Task 생성 실패")

        return tasks[0]["taskArn"]
    
class EventBridgePublisher:
    """
    배포 완료 시 MirrorOps를 트리거하는
    EventBridge 이벤트를 발행한다.

    §7-8 이벤트 스펙:
      source:      "autoops.craftops"  (확정값 — §18 변경 이력 ❼)
      detail-type: "InfraDeploymentCompleted"
    """

    def __init__(self):
        self.eb = boto3.client("events", region_name="us-west-2")

    def publish_deployment_completed(
        self,
        project_id: str,
        deployment_id: str,
        user_id: str,
        account_id: str,
        aws_account_id: str,
        role_arn: str,
        region: str,
        prefix: str,
        environment: str,
        resources: dict,
    ) -> None:
        """
        §7-8 InfraDeploymentCompleted 이벤트 발행.
        source: "autoops.craftops" — 확정값, 변경 금지
        MirrorOps SQS 규칙이 이 source 값으로 필터링한다.
        """
        detail = {
            "project_id":     project_id,
            "deployment_id":  deployment_id,
            "user_id":        user_id,
            "account_id":     account_id,
            "aws_account_id": aws_account_id,
            "role_arn":       role_arn,
            "region":         region,
            "prefix":         prefix,
            "environment":    environment,
            "resources":      resources,
            "deployed_at":    datetime.now(timezone.utc).isoformat(),
        }

        self.eb.put_events(
            Entries=[
                {
                    "Source":       "autoops.craftops",
                    "DetailType":   "InfraDeploymentCompleted",
                    "Detail":       json.dumps(detail),
                    "EventBusName": "default",
                }
            ]
        )