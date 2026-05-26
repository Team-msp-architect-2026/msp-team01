# backend/app/services/craftops/hcl_generator.py
import os
import shutil
import tempfile
from pathlib import Path
from app.services.craftops.hcl_template import generate_hcl as template_generate_hcl


class HCLGenerator:
    """
    config_snapshot을 받아 Terraform HCL 코드를 생성하고
    terraform CLI 명령어 실행을 위한 임시 디렉토리를 관리한다.

    v2: Gemini API 호출 제거 → Python 템플릿 기반 HCL 생성으로 전환
    v3: validate용(include_backend=False) / deploy용(include_backend=True) 분리
        - validate용: backend 블록 없음 → plan.add 정상 출력
        - deploy용:   backend 블록 포함 → S3 state 정상 저장
    v4: config_snapshot 필수 키 검증 추가
        random provider 추가 (RDS 패스워드 random_id 사용)
    """

    REQUIRED_KEYS = {"project_id", "prefix", "environment", "region"}

    def __init__(self):
        pass

    def generate(self, config_snapshot: dict) -> tuple[str, str]:
        """
        validate용 HCL 생성 (backend 블록 없음 → plan.add 정상 출력).
        validator.py에서 호출.
        반환: (hcl_code, work_dir)
        """
        self._validate_snapshot(config_snapshot)
        hcl_code   = template_generate_hcl(config_snapshot, include_backend=False)
        project_id = config_snapshot.get("project_id", "unknown")
        work_dir   = tempfile.mkdtemp(prefix=f"autoops-{project_id[:8]}-")
        self.write_to_dir(hcl_code, work_dir)
        return hcl_code, work_dir

    def generate_for_deploy(self, config_snapshot: dict) -> str:
        """
        deploy용 HCL 생성 (backend 블록 포함 → S3 state 저장).
        craft.py의 deploy 엔드포인트에서 호출.
        반환: hcl_code (S3 업로드용)
        """
        self._validate_snapshot(config_snapshot)
        return template_generate_hcl(config_snapshot, include_backend=True)

    def write_to_dir(self, hcl_code: str, work_dir: str) -> None:
        """HCL 코드를 작업 디렉토리의 main.tf에 저장(덮어쓰기)한다."""
        (Path(work_dir) / "main.tf").write_text(hcl_code, encoding="utf-8")

    def cleanup(self, work_dir: str) -> None:
        """Validation 완료 후 임시 디렉토리를 정리한다."""
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _validate_snapshot(self, config_snapshot: dict) -> None:
        """
        config_snapshot 필수 키 존재 여부를 검증한다.
        누락된 키가 있으면 ValueError를 발생시킨다.
        """
        missing = self.REQUIRED_KEYS - set(config_snapshot.keys())
        if missing:
            raise ValueError(
                f"config_snapshot 필수 키 누락: {sorted(missing)}"
            )

    def _write_providers(self, work_dir: str) -> None:
        """
        random provider 설정 파일을 작업 디렉토리에 생성한다.
        hcl_template.py의 random_id 리소스(RDS 패스워드)가 이 provider를 필요로 한다.
        """
        providers_hcl = """terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}
"""
        (Path(work_dir) / "providers.tf").write_text(
            providers_hcl, encoding="utf-8"
        )