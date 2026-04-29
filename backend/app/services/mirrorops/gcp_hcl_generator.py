import os
import subprocess
import tempfile
from pathlib import Path
from sqlalchemy.orm import Session
from app.models.gcp_mapping import GCPMapping
from app.core.config import settings


class GCPHCLGenerator:
    """
    gcp_mappings 테이블의 terraform_code를 합쳐 완전한 GCP Terraform HCL을 생성한다.
    GCS backend 설정을 자동으로 추가하고 terraform validate로 검증한다. (FR-B-007)
    """

    def generate(
        self,
        project_id: str,
        mappings: list[GCPMapping],
        gcp_project: str,
    ) -> tuple[str, str]:
        """
        GCP Terraform HCL 전체를 생성하고 임시 디렉토리에 저장한다.
        반환: (full_hcl_code, work_dir)
        """
        # §5-3 DR Package backend.tf: GCS State 버킷
        backend_hcl = f"""
terraform{{
  required_providers{{
    google ={{
      source  = "hashicorp/google"
      version = "~> 5.0"
}}
}}
  backend "gcs"{{
    bucket = "autoops-dr-state-{project_id}"
    prefix = "terraform/state"
}}
}}

provider "google"{{
  project = "{gcp_project}"
  region  = "{settings.gcp_region}"
}}
"""

        # 모든 매핑 리소스 HCL 합치기
        resource_hcl = "\n\n".join([
            m.terraform_code for m in mappings
            if m.terraform_code and not m.terraform_code.startswith("# 수동 매핑")
        ])

        full_hcl = backend_hcl + "\n\n" + resource_hcl

        # 임시 작업 디렉토리에 저장
        work_dir = tempfile.mkdtemp(prefix=f"autoops-dr-{project_id[:8]}-")
        main_tf  = Path(work_dir) / "main.tf"
        main_tf.write_text(full_hcl, encoding="utf-8")

        return full_hcl, work_dir

    def validate(self, work_dir: str) -> tuple[bool, str]:
        """
        terraform validate로 생성된 GCP HCL의 유효성을 검증한다. (FR-B-007)
        반환: (passed, error_message)
        """
        # terraform init (-backend=false: 로컬 검증용)
        self._run_cmd(["terraform", "init", "-backend=false"], work_dir)

        result = self._run_cmd(
            ["terraform", "validate", "-json"], work_dir
        )
        return result["returncode"] == 0, result["stderr"]

    def cleanup(self, work_dir: str) -> None:
        import shutil
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)

    def _run_cmd(self, cmd: list, work_dir: str) -> dict:
        try:
            proc = subprocess.run(
                cmd, cwd=work_dir,
                capture_output=True, text=True, timeout=120,
                env={**os.environ, "TF_IN_AUTOMATION": "1"},
            )
            return {"returncode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}
        except subprocess.TimeoutExpired:
            return {"returncode": 1, "stdout": "", "stderr": "terraform validate 타임아웃"}