# backend/app/services/craftops/hcl_generator.py
import os
import shutil
import tempfile
from pathlib import Path
from app.services.craftops.gemini_client import GeminiClient


class HCLGenerator:
    """
    config_snapshot을 받아 Terraform HCL 코드를 생성하고
    terraform CLI 명령어 실행을 위한 임시 디렉토리를 관리한다.
    """

    def __init__(self):
        self.gemini = GeminiClient()

    def generate(self, config_snapshot: dict) -> tuple[str, str]:
        """
        Gemini로 HCL을 생성하고 임시 디렉토리 main.tf에 저장한다.
        반환: (hcl_code, work_dir)
        """
        hcl_code = self.gemini.generate_hcl(config_snapshot)

        project_id = config_snapshot.get("project_id", "unknown")
        work_dir   = tempfile.mkdtemp(prefix=f"autoops-{project_id[:8]}-")

        self.write_to_dir(hcl_code, work_dir)
        return hcl_code, work_dir

    def write_to_dir(self, hcl_code: str, work_dir: str) -> None:
        """HCL 코드를 작업 디렉토리의 main.tf에 저장(덮어쓰기)한다."""
        (Path(work_dir) / "main.tf").write_text(hcl_code, encoding="utf-8")

    def cleanup(self, work_dir: str) -> None:
        """Validation 완료 후 임시 디렉토리를 정리한다."""
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)