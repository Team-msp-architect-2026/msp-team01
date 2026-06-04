import boto3
import json
import re
from app.core.config import settings


# 리소스 타입별 Bedrock 프롬프트
RESOURCE_PROMPTS: dict[str, str] = {
    "google_compute_firewall": """
AWS SecurityGroup 설정을 분석하여 GCP Firewall 변환에 필요한 정보를 추출하세요.

반환 형식:
{
  "mapping_info": {
    "direction": "INGRESS 또는 EGRESS",
    "rules": [
      {
        "protocol": "tcp 또는 udp 또는 icmp 또는 all",
        "ports": ["80", "443"],
        "source_ranges": ["0.0.0.0/0"]
      }
    ]
  },
  "review_reason": "검토 필요한 이유 (없으면 빈 문자열)"
}

추출 규칙:
- IpPermissions(inbound) → direction: "INGRESS"
- IpPermissionsEgress(outbound) → direction: "EGRESS"
- FromPort~ToPort를 포트 목록으로 변환 (80~80 → ["80"], 8000~8080 → ["8000-8080"])
- CidrIp/CidrIpv6 → source_ranges
- 프로토콜 -1 → "all"
- 보안 그룹 참조(source_group)는 review_reason에 명시
""",
    "google_compute_backend_service": """
AWS ALB 설정을 분석하여 GCP Backend Service 변환에 필요한 정보를 추출하세요.

반환 형식:
{
  "mapping_info": {
    "protocol": "HTTP 또는 HTTPS",
    "timeout_sec": 30,
    "load_balancing_scheme": "EXTERNAL"
  },
  "review_reason": "검토 필요한 이유 (없으면 빈 문자열)"
}

추출 규칙:
- Scheme internet-facing → load_balancing_scheme: "EXTERNAL"
- Scheme internal → load_balancing_scheme: "INTERNAL"
- ALB는 HTTP/HTTPS 프로토콜 사용
- Target Group 및 리스너 규칙은 review_reason에 안내
""",
    "google_cloud_run_service": """
AWS ECS Service 및 Task Definition 설정을 분석하여 GCP Cloud Run 변환에 필요한 정보를 추출하세요.

반환 형식:
{
  "mapping_info": {
    "image": "컨테이너 이미지 URI",
    "cpu": "1000m",
    "memory": "512Mi",
    "port": 8080,
    "env_vars": [{"name": "KEY", "value": "VALUE"}]
  },
  "review_reason": "검토 필요한 이유 (없으면 빈 문자열)"
}

추출 규칙:
- ECS vCPU 단위 → Cloud Run cpu 단위 (0.25→"250m", 0.5→"500m", 1→"1000m", 2→"2000m")
- ECS Memory MB → Mi 단위 (512→"512Mi", 1024→"1Gi", 2048→"2Gi")
- ECR 이미지는 GCR 이전 필요함을 review_reason에 명시
- 민감한 환경변수(secrets)는 review_reason에 안내
""",
}


class BedrockMapper:
    """
    Bedrock Claude로 복잡한 AWS→GCP 리소스 변환을 보완한다. (FR-B-005)

    [이전 방식]
    Bedrock → terraform_attributes(HCL 속성 dict) → _attrs_to_hcl() → HCL
    문제: Bedrock이 GCP Terraform 스키마를 몰라 매번 다른 틀린 필드명 생성

    [현재 방식]
    Bedrock → mapping_info(의미 있는 매핑 정보) → Python 템플릿 함수 → HCL
    Bedrock: "어떤 값을 써야 하는지" 분석
    Python: 정확한 스키마로 HCL 생성 보장
    """

    MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    def __init__(self):
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=settings.bedrock_region,
        )

    def map_resource(
        self, resource_type: str, aws_config: dict, gcp_type: str
    ) -> dict:
        """
        AWS 리소스 설정을 받아 GCP 매핑에 필요한 의미 정보를 반환한다.
        반환: {"mapping_info": {...}, "review_reason": "..."}
        """
        type_prompt = RESOURCE_PROMPTS.get(gcp_type, "")

        prompt = f"""
당신은 AWS→GCP 인프라 마이그레이션 전문가입니다.
아래 AWS 리소스 설정을 분석하여 GCP 매핑에 필요한 정보를 추출하세요.

AWS 리소스 타입: {resource_type}
AWS 설정:
{json.dumps(aws_config, indent=2, ensure_ascii=False)}

{type_prompt}

[중요 제약사항]
1. 반드시 위에 명시된 JSON 형식만 반환하세요. 주석(//)이나 부연 설명 절대 금지.
2. mapping_info에는 위 반환 형식에 정의된 키만 포함하세요.
3. 변환 불가하거나 불확실한 항목은 review_reason에 명시하세요.
4. 숫자는 숫자형, 문자열은 문자열로 반환하세요.
"""

        response = self.client.invoke_model(
            modelId=self.MODEL_ID,
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens":        2048,
                "messages": [{"role": "user", "content": prompt}],
            }),
        )

        body    = json.loads(response["body"].read())
        raw     = body["content"][0]["text"].strip()
        cleaned = re.sub(r"```(?:json)?\n?", "", raw)
        cleaned = re.sub(r"```\n?", "", cleaned).strip()

        try:
            result = json.loads(cleaned)

            # [추가] Bedrock이 list로 반환하는 경우 처리
            if isinstance(result, list):
                result = {
                    "mapping_info":  result[0] if result else {},
                    "review_reason": "Bedrock 응답이 리스트 형태로 반환됨 — 검토 필요",
                }

            if "mapping_info" not in result:
                result["mapping_info"] = {}
            return result

        except json.JSONDecodeError:
            return {
                "mapping_info":  {},
                "review_reason": f"Bedrock 응답 파싱 실패: {raw[:200]}",
            }

    def generate_architecture_diagram(self, resources: list[dict]) -> dict:
        """
        리소스 목록을 기반으로 Mermaid 다이어그램 + 한국어 설명 생성.
        CraftOps 배포 프로젝트: deployment_resources 전달
        온보딩 프로젝트: scan_result resources 전달

        반환:
        {
            "mermaid_code": "graph TD\\n  ...",
            "description":  "## 인프라 구조 설명\\n..."
        }
        """
        resource_summary = []
        for r in resources[:20]:
            resource_summary.append({
                "type": r.get("resource_type", r.get("resourceType", "")),
                "name": r.get("resource_name", r.get("resourceName", r.get("resource_id", ""))),
                "id":   r.get("resource_id", r.get("resource_id_aws", "")),
            })

        prompt = f"""당신은 AWS 인프라 아키텍처 설계 전문가입니다.
아래 AWS 리소스 목록을 분석하여 다음 두 가지를 마크다운 형식으로 작성해주세요.

리소스 목록:
{json.dumps(resource_summary, ensure_ascii=False, indent=2)}

1. 이 인프라의 구조를 표현하는 Mermaid 다이어그램 코드 (graph TD 스타일)
   - 리소스 간 연결 관계를 화살표로 표현
   - 인터넷 트래픽 흐름 포함 (Internet → ALB → ECS → RDS 등)
   - 반드시 ```mermaid 코드블록으로 감싸기

2. 리소스별 역할 및 전체적인 데이터 흐름/동작 방식 한국어 설명

마크다운 형식으로 응답하세요."""

        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens":         2000,
            "messages": [{"role": "user", "content": prompt}],
        })

        response = self.client.invoke_model(
            modelId     = "us.anthropic.claude-sonnet-4-20250514-v1:0",
            body        = body,
            contentType = "application/json",
            accept      = "application/json",
        )

        result   = json.loads(response["body"].read())
        raw_text = result["content"][0]["text"]

        mermaid_match = re.search(r"```mermaid\n(.*?)```", raw_text, re.DOTALL)
        if mermaid_match:
            mermaid_code = mermaid_match.group(1).strip()
        else:
            print(f"[Diagram] mermaid 코드블록 파싱 실패 — raw_text 앞 200자: {raw_text[:200]}")
            mermaid_code = ""
        description   = re.sub(r"```mermaid\n.*?```", "", raw_text, flags=re.DOTALL).strip()

        return {
            "mermaid_code": mermaid_code,
            "description":  description,
        }