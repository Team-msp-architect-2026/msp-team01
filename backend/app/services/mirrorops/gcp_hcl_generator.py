import os
import re
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

        # [추가] 중복 리소스 제거 후 HCL 조합
        # detector.py에서 걸러지지 않은 모든 중복 케이스 최종 방어
        seen_resources: set = set()
        deduped_codes: list = []

        for m in mappings:
            if not m.terraform_code or m.terraform_code.startswith("# 수동 매핑"):
                continue
            # terraform_code에서 resource type + name 추출해서 중복 체크
            match = re.match(r'\s*resource\s+"([^"]+)"\s+"([^"]+)"', m.terraform_code)
            if match:
                key = (match.group(1), match.group(2))
                if key in seen_resources:
                    print(f"[GCPHCLGenerator] 중복 리소스 스킵: {key[0]} \"{key[1]}\"")
                    continue
                seen_resources.add(key)
            deduped_codes.append(m.terraform_code)

        resource_hcl = "\n\n".join(deduped_codes)
        full_hcl     = backend_hcl + "\n\n" + resource_hcl

        # 임시 작업 디렉토리에 저장
        work_dir = tempfile.mkdtemp(prefix=f"autoops-dr-{project_id[:8]}-")
        main_tf  = Path(work_dir) / "main.tf"
        main_tf.write_text(full_hcl, encoding="utf-8")
        return full_hcl, work_dir

    def validate(self, work_dir: str) -> tuple[bool, str]:
        # terraform init
        init_result = self._run_cmd(["terraform", "init", "-backend=false"], work_dir)
        if init_result["returncode"] != 0:
            error_msg = f"terraform init 실패: {init_result['stdout']} {init_result['stderr']}"
            print(f"[GCPHCLGenerator] {error_msg}")
            return False, error_msg

        result = self._run_cmd(
            ["terraform", "validate", "-json"], work_dir
        )
        print(f"[GCPHCLGenerator] validate returncode: {result['returncode']}")
        print(f"[GCPHCLGenerator] validate stdout: {result['stdout'][:500]}")
        print(f"[GCPHCLGenerator] validate stderr: {result['stderr'][:500]}")

        if result["returncode"] == 0:
            return True, ""

        import json
        try:
            output      = json.loads(result["stdout"])
            diagnostics = output.get("diagnostics", [])
            error_msg   = "\n".join([
                f"{d.get('severity', '')}: {d.get('summary', '')} — {d.get('detail', '')}"
                for d in diagnostics
            ])
        except Exception:
            error_msg = result["stdout"] or result["stderr"]

        print(f"[GCPHCLGenerator] validate 에러: {error_msg}")
        return False, error_msg

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