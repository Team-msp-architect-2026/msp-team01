import boto3
import json
import re
from app.core.config import settings


class BedrockMapper:
    """
    Bedrock Claude Sonnet으로 복잡한 AWS→GCP 리소스 변환을 보완한다. (FR-B-005)
    Security Group, ALB, ECS 등 1:1 변환이 어려운 리소스에 사용한다.
    """

    MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"

    def __init__(self):
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=settings.bedrock_region,
        )

    def map_resource(
        self, resource_type: str, aws_config: dict, gcp_type: str
    ) -> dict:
        """
        AWS 리소스 설정을 받아 GCP Terraform 리소스 속성을 생성한다.
        반환: {"terraform_attributes": {...}, "review_reason": "..."}
        """
        prompt = f"""
당신은 AWS→GCP 인프라 마이그레이션 전문가입니다.
아래 AWS 리소스 설정을 GCP{gcp_type} Terraform 리소스 속성으로 변환하세요.

AWS 리소스 타입:{resource_type}
AWS 설정:
{json.dumps(aws_config, indent=2, ensure_ascii=False)}

반드시 아래 JSON 형식만 반환하세요. 다른 텍스트 없이 JSON만 반환합니다.
{{
  "terraform_attributes":{{
    // GCP{gcp_type}의 Terraform 속성 키-값
}},
  "review_reason": "사용자 검토가 필요한 이유 (없으면 빈 문자열)"
}}

변환 규칙:
- Security Group inbound 규칙 → google_compute_firewall allow 블록으로 변환
- ECS Task Definition → Cloud Run Service spec으로 변환 (CPU/메모리 단위 변환)
- ALB → Cloud Load Balancer (백엔드 서비스, URL 맵, 프록시) 로 분리 안내
- 완전 변환 불가한 항목은 review_reason에 명시
"""

        response = self.client.invoke_model(
            modelId=self.MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens":        2048,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )

        body   = json.loads(response["body"].read())
        raw    = body["content"][0]["text"].strip()
        cleaned = re.sub(r"```(?:json)?\n?", "", raw)
        cleaned = re.sub(r"```\n?", "", cleaned).strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return {
                "terraform_attributes": {},
                "review_reason": f"Bedrock 응답 파싱 실패:{raw[:200]}",
            }