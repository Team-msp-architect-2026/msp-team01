# backend/app/services/craftops/gemini_client.py
import json
import re
import time
import logging
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)

class GeminiClient:
    """
    Gemini 2.5 Flash API 클라이언트. (§2: gemini-2.5-flash 모델 고정)

    v3 변경:
    - 데드코드 제거 (generate_hcl / correct_hcl / fix_critical_security_issues)
    - analyze_intent system_prompt 하드코딩 수치 전면 제거
    - environment 추론 제거 — 프로젝트 생성 시 확정된 값 사용
    - Gemini가 워크로드 성격 기반으로 성능값만 추론
    - _is_infra_request() 추가 — 인프라 무관 입력 차단
    - _validate_and_sanitize() 추가 — 추론값 범위 검증
    - _call_with_retry() 추가 — API 실패 시 지수 백오프 재시도
    - _extract_json_block() 추가 — 중괄호 depth 카운팅으로 JSON 블록 추출
    - _remove_trailing_commas() 추가 — trailing comma 제거

    현재 역할: analyze_intent() 단독 (자연어 → 성능 파라미터 JSON 추출)
    """

    MODEL_NAME = "gemini-2.5-flash"  # §2 기술스택 확정값 — 변경 금지

    VALID_REGIONS = {
        "us-east-1", "us-west-2", "ap-northeast-2",
        "ap-northeast-1", "eu-west-1", "eu-central-1",
    }
    VALID_INSTANCE_CLASSES = {
        "db.t3.micro", "db.t3.small", "db.t3.medium", "db.t3.large",
        "db.r6g.large", "db.r6g.xlarge", "db.r6g.2xlarge",
    }

    def __init__(self):
        genai.configure(api_key=settings.gemini_api_key)
        self.model = genai.GenerativeModel(self.MODEL_NAME)

    # ── Intent Analysis ─────────────────────────────────────────────

    def analyze_intent(self, prompt: str, project_context: dict) -> dict:
        """
        자연어 프롬프트를 분석해 성능·비용 최적 인프라 파라미터를 추출한다. (FR-A-001)

        environment는 project_context에서 확정된 값을 사용한다.
        Gemini는 워크로드 성격 기반으로 성능값(vcpu, memory, instance_class 등)만 추론한다.
        보안·가용성 기준값(multi_az, backup_retention 등)은 dag_engine 프리셋이 담당한다.
        """
        is_infra, reason = self._is_infra_request(prompt)
        print(f"[Gemini] is_infra_request: {is_infra}, reason: {reason}", flush=True)
        if not is_infra:
            raise ValueError(f"INVALID_PROMPT:{reason}")

        environment = project_context.get("environment", "production")

        system_prompt = f"""
당신은 AWS 클라우드 인프라 성능 설계 전문가입니다.
사용자의 자연어 요구사항을 분석해 워크로드에 최적화된 성능 파라미터를 추론합니다.

## 역할 범위
- 당신이 추론할 항목: vcpu, memory, instance_class, max_tasks, autoscaling_target_cpu, region
- 당신이 추론하지 않는 항목: environment(이미 확정), multi_az, backup_retention_days, storage_encrypted, min_tasks, cw_log_retention_days
  (위 항목들은 환경별 보안·운영 정책으로 별도 결정됨)

## 현재 확정된 환경
environment: {environment}

## 추론 원칙

### 리전 추론
- 한국/서울/국내 사용자 대상 → ap-northeast-2
- 미국/글로벌/기본 → us-west-2
- 일본/도쿄 → ap-northeast-1
- 유럽 → eu-west-1
- 명시 없을 시 → us-west-2

### vCPU 추론 (워크로드 처리 복잡도 기준)
- 단순 정적 서비스·소규모 조회 API → 0.25~0.5
- 일반 웹서비스·REST API → 1
- 복잡한 비즈니스 로직·중간 트래픽 → 2
- 고트래픽·AI 처리·실시간 연산·금융 트랜잭션 → 4

### memory 추론 (vCPU 대비 워크로드 특성)
- 단순 서비스: vCPU x 512MB
- 일반 서비스: vCPU x 2048MB
- 메모리 집약적(캐싱·세션·대용량 처리): vCPU x 4096MB 이상

### instance_class 추론 (데이터 규모·쿼리 복잡도·동시접속)
- 개발/소규모/단순 조회: db.t3.micro ~ db.t3.small
- 중소규모 일반 서비스: db.t3.medium ~ db.t3.large
- 대규모/복잡한 쿼리/고동시접속: db.r6g.large
- 금융 트랜잭션/고성능 필수: db.r6g.large ~ db.r6g.xlarge

### max_tasks 추론 (트래픽 급증 가능성)
- 소규모·안정적 트래픽: 3~5
- 일반 서비스: 5~10
- 이벤트성·급증 가능: 10~20
- 글로벌·대규모: 20~50

### autoscaling_target_cpu 추론 (응답속도 민감도, 50~80% 범위)
- 응답속도 민감(결제·실시간): 50~60%
- 일반 서비스: 65~70%
- 비용 우선·배치성: 75~80%

## 출력 형식
반드시 아래 JSON 구조만 반환. 마크다운·설명 텍스트 절대 포함 금지.
모든 수치는 위 추론 원칙에 따라 직접 추론한 값. 예시 수치 복사 금지.

{{
  "region": "추론된 AWS 리전 코드",
  "resources": ["vpc", "subnet", "security_group", "alb", "ecs_fargate", "rds"],
  "recommended_config": {{
    "vpc": {{
      "cidr": "추론된 CIDR"
    }},
    "subnets": {{
      "public":  ["추론된 public-a CIDR", "추론된 public-c CIDR"],
      "private": ["추론된 private-a CIDR", "추론된 private-c CIDR"]
    }},
    "ecs": {{
      "vcpu":   추론된_vCPU_숫자,
      "memory": 추론된_메모리_MB_숫자,
      "autoscaling": {{
        "max":        추론된_최대_태스크_숫자,
        "target_cpu": 추론된_CPU_목표율_숫자
      }}
    }},
    "rds": {{
      "instance_class": "추론된 인스턴스 타입"
    }}
  }},
  "reasoning": {{
    "workload_analysis":    "워크로드 성격 분석 한 줄",
    "performance_strategy": "성능 전략 한 줄",
    "cost_strategy":        "비용 전략 한 줄",
    "region_reason":        "리전 선택 근거 한 줄"
  }}
}}
"""

        user_message = (
            f"[프로젝트 정보]\n"
            f"프로젝트명: {project_context.get('name', '미정')}\n"
            f"prefix: {project_context.get('prefix', '미정')}\n"
            f"확정된 환경: {environment}\n\n"
            f"[사용자 요구사항]\n{prompt}\n\n"
            f"위 요구사항을 분석해 워크로드에 최적화된 성능 파라미터를 추론하세요.\n"
            f"예시 수치를 절대 복사하지 말고 요구사항에서 직접 추론한 값만 사용하세요."
        )

        raw = self._call_with_retry(
            [system_prompt, user_message],
            genai.GenerationConfig(temperature=0.3, max_output_tokens=4096),
        )
        result = self._parse_json_response(raw)
        result = self._validate_and_sanitize(result, environment)

        # 테스트용 로그 — 운영 배포 전 제거
        print(f"[Gemini] 추론 결과:\n{json.dumps(result, ensure_ascii=False, indent=2)}", flush=True)

        return result

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _is_infra_request(self, prompt: str) -> tuple[bool, str]:
        system_prompt = (
            "당신은 사용자 입력이 클라우드 인프라 또는 서버 구성 관련 요청인지 판단합니다.\n\n"
            "판단 기준 - 아래 중 하나라도 해당하면 인프라 요청으로 판단합니다:\n"
            "- 서버, 웹서버, API 서버, 애플리케이션 배포, 서비스 운영 관련\n"
            "- 데이터베이스, DB, 저장소, 스토리지 관련\n"
            "- 네트워크, 방화벽, 보안 그룹, 트래픽, 로드밸런서 관련\n"
            "- 클라우드 환경, AWS, GCP, Azure, 인프라, IaC 관련\n"
            "- 컨테이너, 도커, ECS, 쿠버네티스 관련\n"
            "- 운영 환경, 배포 환경, 스테이징, 프로덕션 구성 관련\n"
            "- 스케일링, 가용성, 재해복구 관련\n"
            "- 서비스 런칭, 출시, 오픈, 운영 관련 (인프라 맥락)\n\n"
            '아래 JSON만 반환하세요. 설명 없이:\n'
            '반드시 JSON만 반환. 마크다운 코드블록 절대 사용 금지:\n'
            '{"is_infra": true또는false, "reason": "판단 이유 한 줄 (한국어)"}'
        )
        try:
            raw = self._call_with_retry(
                [system_prompt, f"입력: {prompt}"],
                genai.GenerationConfig(temperature=0.0, max_output_tokens=512),
            )
            print(f"[Gemini] _is_infra_request raw: {raw}", flush=True)
            result = self._parse_json_response(raw)
            return result.get("is_infra", True), result.get("reason", "")
        except Exception as e:
            print(f"[Gemini] _is_infra_request 실패: {e}", flush=True)
            return True, ""

    def _validate_and_sanitize(self, result: dict, environment: str) -> dict:
        """
        Gemini 추론값 유효성 검증 + 허용 범위 보정.
        environment는 project_context에서 받아 강제 적용한다.
        Gemini 판단을 최대한 존중하되 배포 실패 방지를 위해
        명백히 잘못된 값만 보정한다.
        """
        import ipaddress

        # environment는 Gemini가 추론하지 않음 — project_context 값 강제
        result["environment"] = environment

        # region 보정
        if result.get("region") not in self.VALID_REGIONS:
            result["region"] = "us-west-2"

        config = result.get("recommended_config", {})

        # ECS 숫자 타입 및 범위 보정
        ecs  = config.get("ecs", {})
        auto = ecs.get("autoscaling", {})

        ecs["vcpu"]   = max(0.25, float(ecs.get("vcpu", 1)))
        ecs["memory"] = max(512,  int(ecs.get("memory", 2048)))

        max_t              = max(1, int(auto.get("max", 5)))
        auto["max"]        = max_t
        auto["target_cpu"] = max(50, min(80, int(auto.get("target_cpu", 70))))
        ecs["autoscaling"] = auto
        config["ecs"]      = ecs

        # RDS 보정
        rds = config.get("rds", {})
        if rds.get("instance_class") not in self.VALID_INSTANCE_CLASSES:
            rds["instance_class"] = "db.t3.medium"
        config["rds"] = rds

        # VPC CIDR 형식 보정
        try:
            ipaddress.ip_network(
                config.get("vpc", {}).get("cidr", "10.0.0.0/16"),
                strict=False,
            )
        except ValueError:
            config["vpc"] = {"cidr": "10.0.0.0/16"}

        result["recommended_config"] = config
        return result

    def _call_with_retry(
        self,
        messages: list,
        config: genai.GenerationConfig,
        max_retries: int = 1,
    ) -> str:
        """
        Gemini API 호출 재시도 + 지수 백오프.
        rate limit, 네트워크 오류 등 일시적 실패에 대응한다.
        """
        last_error = None
        for attempt in range(max_retries):
            try:
                response = self.model.generate_content(
                    messages,
                    generation_config=config,
                )
                return response.text.strip()
            except Exception as e:
                last_error = e
                if attempt < max_retries - 1:
                    time.sleep(2 ** attempt)
        raise RuntimeError(f"Gemini API 호출 실패 ({max_retries}회): {last_error}")

    def _parse_json_response(self, raw_text: str) -> dict:
        """
        Gemini 응답에서 JSON 객체를 파싱한다.
        아래 순서로 파싱을 시도해 에러 확률을 최소화한다:
        1. 마크다운 제거 후 직접 파싱
        2. 중괄호 depth 카운팅으로 JSON 블록 추출 후 파싱
        3. trailing comma 제거 후 재파싱
        4. 위 모두 실패 시 ValueError
        """
        # Step 1 — 마크다운 제거 후 직접 파싱 시도
        cleaned = self._strip_markdown(raw_text)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        # Step 2 — 중첩 중괄호 기반으로 JSON 블록 추출
        json_str = self._extract_json_block(cleaned)
        if json_str:
            try:
                return json.loads(json_str)
            except json.JSONDecodeError:
                pass

        # Step 3 — trailing comma 제거 후 재파싱
        if json_str:
            sanitized = self._remove_trailing_commas(json_str)
            try:
                return json.loads(sanitized)
            except json.JSONDecodeError:
                pass

        # Step 4 — 전체 텍스트에서 trailing comma 제거 후 재파싱
        sanitized_full = self._remove_trailing_commas(cleaned)
        try:
            return json.loads(sanitized_full)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"Gemini JSON 파싱 실패: {e}\n원본: {raw_text[:300]}"
            )

    def _strip_markdown(self, text: str) -> str:
        """마크다운 코드 블록을 완전히 제거한다."""
        text = re.sub(r"```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```", "", text)
        return text.strip()

    def _extract_json_block(self, text: str) -> str | None:
        """
        텍스트에서 가장 바깥쪽 JSON 객체 블록을 추출한다.
        정규식 대신 중괄호 depth 카운팅으로 정확하게 추출한다.
        """
        start = text.find("{")
        if start == -1:
            return None

        depth       = 0
        in_string   = False
        escape_next = False

        for i, ch in enumerate(text[start:], start):
            if escape_next:
                escape_next = False
                continue
            if ch == "\\" and in_string:
                escape_next = True
                continue
            if ch == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]

        return None

    def _remove_trailing_commas(self, text: str) -> str:
        """JSON에서 trailing comma를 제거한다."""
        text = re.sub(r",\s*}", "}", text)
        text = re.sub(r",\s*]", "]", text)
        return text