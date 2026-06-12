import os
import shutil
import tempfile
from pathlib import Path
from app.services.craftops.hcl_template import generate_hcl as template_generate_hcl


class HCLGenerator:
    REQUIRED_KEYS = {"project_id", "prefix", "environment", "region"}

    def __init__(self):
        pass

    def generate(self, config_snapshot: dict) -> tuple[str, str]:
        """validate용 HCL (backend 블록 없음)"""
        self._validate_snapshot(config_snapshot)
        hcl_code   = template_generate_hcl(config_snapshot, include_backend=False)
        project_id = config_snapshot.get("project_id", "unknown")
        work_dir   = tempfile.mkdtemp(prefix=f"autoops-{project_id[:8]}-")
        self.write_to_dir(hcl_code, work_dir)
        return hcl_code, work_dir

    def generate_for_deploy(self, config_snapshot: dict) -> str:
        """
        deploy용 HCL (backend + assume_role 포함).
        config_snapshot에 role_arn, external_id 필수.
        """
        self._validate_snapshot(config_snapshot)
        hcl_code = template_generate_hcl(config_snapshot, include_backend=True)

        # provider 블록에 assume_role 주입
        # hcl_template.py의 provider "aws" 블록을 assume_role 포함 버전으로 교체
        role_arn    = config_snapshot.get("role_arn", "")
        external_id = config_snapshot.get("external_id", "")
        region      = config_snapshot.get("region", "us-west-2")

        if role_arn and external_id:
            old_provider = f'provider "aws" {{\n  region = "{region}"\n}}'
            new_provider = (
                f'provider "aws" {{\n'
                f'  region = "{region}"\n\n'
                f'  assume_role {{\n'
                f'    role_arn     = "{role_arn}"\n'
                f'    external_id  = "{external_id}"\n'
                f'  }}\n'
                f'}}'
            )
            hcl_code = hcl_code.replace(old_provider, new_provider)

        return hcl_code

    def write_to_dir(self, hcl_code: str, work_dir: str) -> None:
        (Path(work_dir) / "main.tf").write_text(hcl_code, encoding="utf-8")

    def cleanup(self, work_dir: str) -> None:
        if work_dir and os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)

    def _validate_snapshot(self, config_snapshot: dict) -> None:
        missing = self.REQUIRED_KEYS - set(config_snapshot.keys())
        if missing:
            raise ValueError(f"config_snapshot 필수 키 누락: {sorted(missing)}")