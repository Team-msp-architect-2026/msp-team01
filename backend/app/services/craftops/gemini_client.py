# backend/app/services/craftops/gemini_client.py
import json
import re
import google.generativeai as genai
from app.core.config import settings


class GeminiClient:
    """
    Gemini 2.5 Flash API 클라이언트. (§2: gemini-2.5-flash 모델 고정)
    세 가지 역할을 담당한다:
      1. 자연어 프롬프트 → 인프라 파라미터 JSON 추출 (FR-A-001)
      2. config_snapshot → Terraform HCL 생성 (FR-A-009)
      3. validate 실패 시 HCL 자동 수정 — Self-Correction (FR-A-011)
         CRITICAL 보안 이슈 발생 시 자동 수정 코드 생성 (FR-A-012)
    """

    MODEL_NAME = "gemini-2.5-flash"   # §2 기술스택 확정값 — 변경 금지

    def __init__(self):
        genai.configure(api_key=settings.gemini_api_key)
        self.model = genai.GenerativeModel(self.MODEL_NAME)

    # ── 1. Intent Analysis ──────────────────────────────────────────

    def analyze_intent(self, prompt: str, project_context: dict) -> dict:
        """
        자연어 프롬프트를 분석해 인프라 파라미터를 추출한다. (FR-A-001)
        §7-5 POST /api/craft/analyze 응답의 recommended_config 데이터 생성.

        반환 구조:
        {
          "environment": "production",   # Gemini 원문 그대로 반환
          "region": "us-west-2",
          "resources": ["vpc", "subnet", "security_group", "alb", "ecs_fargate", "rds"],
          "recommended_config": {
            "vpc": {"cidr": "10.0.0.0/16"},
            "subnets": {"public": [...], "private": [...]},
            "ecs": {"vcpu": 1, "memory": 2048, "autoscaling": {...}},
            "rds": {"engine": "postgresql", "version": "15", ...}
          }
        }
        """
        system_prompt = """
당신은 AWS 인프라 설계 전문가입니다.
사용자의 자연어 요구사항을 분석해 3-Tier 웹 서비스 인프라 파라미터를 JSON으로 반환합니다.

반드시 아래 JSON 형식만 반환하세요. 마크다운 코드 블록이나 설명 텍스트를 절대 포함하지 마세요.

{
  "environment": "production|staging|development",
  "region": "AWS 리전 코드 (기본값: us-west-2)",
  "resources": ["vpc", "subnet", "security_group", "alb", "ecs_fargate", "rds"],
  "recommended_config": {
    "vpc": {"cidr": "10.0.0.0/16"},
    "subnets": {
      "public":  ["10.0.1.0/24", "10.0.2.0/24"],
      "private": ["10.0.10.0/24", "10.0.20.0/24"]
    },
    "ecs": {
      "vcpu": 1,
      "memory": 2048,
      "autoscaling": {"min": 2, "max": 10, "target_cpu": 70}
    },
    "rds": {
      "engine": "postgresql",
      "version": "15",
      "instance_class": "db.t3.medium",
      "multi_az": true
    }
  }
}

분석 규칙:
- "프로덕션", "운영", "prod" → environment: "production"
- "스테이징", "staging"     → environment: "staging"
- "개발", "테스트", "dev"   → environment: "development"
- 리전 언급 없으면 us-west-2 기본값
- DB 언급 없으면 postgresql 기본값
"""

        user_message = (
            f"프로젝트:{project_context.get('name', '미정')}\n\n"
            f"요구사항:\n{prompt}"
        )

        response = self.model.generate_content(
            [system_prompt, user_message],
            generation_config=genai.GenerationConfig(
                temperature=0.1,      # 낮은 temperature로 일관된 JSON 출력
                max_output_tokens=2048,
            ),
        )

        return self._parse_json_response(response.text.strip())

    # ── 2. HCL 생성 ────────────────────────────────────────────────

    def generate_hcl(self, config_snapshot: dict) -> str:
        """
        config_snapshot을 기반으로 Terraform HCL 코드를 생성한다. (FR-A-009)

        생성 규칙:
        - 리소스 네이밍: {prefix}-{env}-{resource} 패턴 (§4-1)
        - terraform backend: S3(autoops-terraform-state) + DynamoDB(autoops-terraform-lock) (§4-6)
        - provider: aws, region = config의 region 값
        - 환경별 프리셋 반영 (§4-4 매트릭스): Multi-AZ, 백업 보존, 암호화
        - tfsec/checkov 통과 요건 준수 (§4-4 Step 2-6 Sidekick 가이드)
        """
        prefix      = config_snapshot.get("prefix", "autoops")
        environment = config_snapshot.get("environment", "dev")
        region      = config_snapshot.get("region", "us-west-2")
        project_id  = config_snapshot.get("project_id", "")
        network     = config_snapshot.get("network", {})
        security    = config_snapshot.get("security", {})
        web_tier    = config_snapshot.get("web_tier", {})
        app_tier    = config_snapshot.get("app_tier", {})
        data_tier   = config_snapshot.get("data_tier", {})

        system_prompt = f"""
당신은 Terraform HCL 전문가입니다.
주어진 인프라 설정으로 완전하고 유효한 Terraform HCL 코드를 생성합니다.

생성 규칙:
1. 모든 리소스명: "{prefix}-{environment}-{{resource}}" 패턴 (§4-1 네이밍 규칙)
2. terraform backend (§4-6):
   bucket         = "autoops-terraform-state"
   key            = "projects/{project_id}/terraform.tfstate"
   region         = "us-west-2"
   dynamodb_table = "autoops-terraform-lock"
   encrypt        = true
3. provider aws region = "{region}"
4. tfsec/checkov 보안 스캔 통과 요건 적용 (§4-4 Step 2-6):
   - RDS: storage_encrypted, deletion_protection, backup_retention_period >= 1
   - ECS: assign_public_ip = false (Private Subnet 배치)
   - S3 state backend: encrypt = true (이미 위에 포함)
5. HCL 코드만 반환. 마크다운 코드 블록(```) 없이 순수 HCL만 반환.
6. 각 리소스 블록 앞에 역할 주석 추가.
"""

        user_message = (
            f"[기본 설정]\n"
            f"prefix:{prefix}, environment:{environment}, "
            f"region:{region}, project_id:{project_id}\n\n"
            f"[네트워크 (Step 2-2)]\n{json.dumps(network, ensure_ascii=False, indent=2)}\n\n"
            f"[보안 그룹 (Step 2-3)]\n{json.dumps(security, ensure_ascii=False, indent=2)}\n\n"
            f"[Web Tier / ALB (Step 2-4)]\n{json.dumps(web_tier, ensure_ascii=False, indent=2)}\n\n"
            f"[App Tier / ECS (Step 2-5)]\n{json.dumps(app_tier, ensure_ascii=False, indent=2)}\n\n"
            f"[Data Tier / RDS (Step 2-6)]\n{json.dumps(data_tier, ensure_ascii=False, indent=2)}\n\n"
            f"위 설정으로 16개 AWS 리소스 전체를 포함하는 완전한 Terraform HCL을 생성하세요."
        )

        response = self.model.generate_content(
            [system_prompt, user_message],
            generation_config=genai.GenerationConfig(
                temperature=0.1,
                max_output_tokens=8192,
            ),
        )

        return self._strip_markdown(response.text.strip())

    # ── 3. Self-Correction (FR-A-011) ──────────────────────────────

    def correct_hcl(
        self, hcl_code: str, error_message: str, attempt: int
    ) -> str:
        """
        terraform validate 실패 시 에러 메시지를 받아 HCL을 자동 수정한다.
        Self-Correction Loop에서 최대 3회 호출된다. (FR-A-011)
        """
        system_prompt = """
당신은 Terraform 오류 수정 전문가입니다.
에러 메시지를 분석해 HCL 코드의 해당 부분만 정확히 수정합니다.
- 에러가 발생한 부분만 수정하고 나머지는 유지합니다.
- HCL 코드만 반환합니다. 마크다운 코드 블록 없이 순수 HCL만 반환합니다.
- 수정 이유를 코드 주석으로 짧게 추가합니다.
"""

        user_message = (
            f"[수정 시도{attempt}/3]\n\n"
            f"[에러 메시지]\n{error_message}\n\n"
            f"[현재 HCL 코드]\n{hcl_code}\n\n"
            f"에러를 수정한 전체 HCL 코드를 반환하세요."
        )

        response = self.model.generate_content(
            [system_prompt, user_message],
            generation_config=genai.GenerationConfig(
                temperature=0.05,     # 수정 시 더욱 보수적인 temperature
                max_output_tokens=8192,
            ),
        )

        return self._strip_markdown(response.text.strip())

    # ── 4. CRITICAL 보안 이슈 자동 수정 (FR-A-012) ────────────────

    def fix_critical_security_issues(
        self, hcl_code: str, critical_issues: list[dict]
    ) -> str:
        """
        CRITICAL 보안 이슈 발생 시 Gemini가 자동 수정 코드를 생성한다. (FR-A-012)
        §4-4 Step 3: CRITICAL → 배포 차단 + Gemini 자동 수정 코드 생성
        """
        issues_text = "\n".join([
            f"- [{i.get('tool')}]{i.get('rule_id')}:{i.get('description')} "
            f"(파일:{i.get('location')}, 라인:{i.get('line')})"
            for i in critical_issues
        ])

        system_prompt = """
당신은 Terraform 보안 전문가입니다.
아래 CRITICAL 보안 취약점을 모두 수정한 안전한 Terraform HCL 코드를 생성합니다.
- 보안 취약점이 수정된 부분만 변경하고 나머지 로직은 유지합니다.
- HCL 코드만 반환합니다. 마크다운 코드 블록 없이 순수 HCL만 반환합니다.
- 수정된 각 항목에 # SECURITY FIX: [rule_id] 주석을 추가합니다.
"""

        user_message = (
            f"[CRITICAL 보안 이슈 목록]\n{issues_text}\n\n"
            f"[현재 HCL 코드]\n{hcl_code}\n\n"
            f"모든 CRITICAL 이슈를 수정한 전체 HCL 코드를 반환하세요."
        )

        response = self.model.generate_content(
            [system_prompt, user_message],
            generation_config=genai.GenerationConfig(
                temperature=0.05,
                max_output_tokens=8192,
            ),
        )

        return self._strip_markdown(response.text.strip())

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _parse_json_response(self, raw_text: str) -> dict:
        """Gemini 응답에서 JSON 객체를 파싱한다."""
        cleaned = self._strip_markdown(raw_text)
        json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not json_match:
            raise ValueError(
                f"Gemini 응답에서 JSON을 추출할 수 없습니다:{raw_text[:200]}"
            )
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Gemini JSON 파싱 실패:{e}\n원본:{raw_text[:200]}"
            )

    def _strip_markdown(self, text: str) -> str:
        """마크다운 코드 블록을 제거한다."""
        text = re.sub(r"```(?:hcl|terraform|json)?\n?", "", text)
        text = re.sub(r"```\n?", "", text)
        return text.strip()