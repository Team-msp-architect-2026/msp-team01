# backend/app/services/craftops/validator.py
import json
import os
import subprocess
from dataclasses import dataclass, field
from app.services.craftops.gemini_client import GeminiClient


@dataclass
class ValidationResult:
    """Validation Loop 4단계 전체 결과"""
    # ① terraform validate
    validate_passed: bool = False
    validate_correction_attempts: int = 0
    validate_error: str = ""
    validate_manual_edit_required: bool = False  # 3회 실패 시 True

    # ② 보안 스캔 (tfsec + checkov)
    security_passed: bool = False
    security_critical_count: int = 0
    security_high_count: int = 0
    security_medium_count: int = 0
    security_issues: list = field(default_factory=list)
    security_fixed_hcl: str = ""

    # ③ 비용 예측 (Infracost)
    cost_monthly_total: float = 0.0
    cost_breakdown: list = field(default_factory=list)

    # ④ terraform plan
    plan_passed: bool = False
    plan_add: int = 0
    plan_change: int = 0
    plan_destroy: int = 0

    # 최종 HCL
    final_hcl_code: str = ""


class ValidationLoop:
    """
    Terraform HCL에 대해 4단계 Validation을 순차 실행한다. (§4-4 Step 3)

    ① terraform validate  — Self-Correction 최대 3회 (FR-A-011)
    ② tfsec + checkov     — CRITICAL 시 Gemini 자동 수정 후 재스캔 (FR-A-012)
    ③ Infracost           — 리소스별 월 예상 비용 (FR-A-013)
    ④ terraform plan      — 리소스 변경 미리보기 (FR-A-014)
    """

    MAX_CORRECTION_ATTEMPTS = 3

    def __init__(self):
        self.gemini = GeminiClient()

    def run(self, hcl_code: str, work_dir: str) -> ValidationResult:
        result = ValidationResult(final_hcl_code=hcl_code)

        # ① terraform validate + Self-Correction Loop
        current_hcl = hcl_code
        self._write_hcl(work_dir, current_hcl)
        self._run_cmd(["terraform", "init", "-backend=false"], work_dir)

        for attempt in range(1, self.MAX_CORRECTION_ATTEMPTS + 1):
            vr = self._run_cmd(["terraform", "validate", "-json"], work_dir)

            if vr["returncode"] == 0:
                result.validate_passed = True
                result.validate_correction_attempts = attempt - 1
                result.final_hcl_code = current_hcl
                break
            else:
                error_msg = vr["stdout"] or vr["stderr"]
                if attempt < self.MAX_CORRECTION_ATTEMPTS:
                    current_hcl = self.gemini.correct_hcl(current_hcl, error_msg, attempt)
                    self._write_hcl(work_dir, current_hcl)
                else:
                    result.validate_passed = False
                    result.validate_correction_attempts = self.MAX_CORRECTION_ATTEMPTS
                    result.validate_error = error_msg
                    result.validate_manual_edit_required = True
                    return result

        # ② tfsec + checkov 보안 스캔
        tfsec_result   = self._run_tfsec(work_dir)
        checkov_result = self._run_checkov(work_dir)
        result.security_issues = tfsec_result["issues"] + checkov_result["issues"]

        for issue in result.security_issues:
            sev = issue.get("severity", "").upper()
            if sev == "CRITICAL":
                result.security_critical_count += 1
            elif sev == "HIGH":
                result.security_high_count += 1
            elif sev == "MEDIUM":
                result.security_medium_count += 1

        if result.security_critical_count > 0:
            critical_issues = [
                i for i in result.security_issues
                if i.get("severity", "").upper() == "CRITICAL"
            ]
            fixed_hcl = self.gemini.fix_critical_security_issues(
                result.final_hcl_code, critical_issues
            )
            result.security_fixed_hcl = fixed_hcl
            result.security_passed = False
            return result

        result.security_passed = True

        # ③ Infracost 비용 예측
        cost = self._run_infracost(work_dir)
        result.cost_monthly_total = cost.get("monthly_total", 0.0)
        result.cost_breakdown     = cost.get("breakdown", [])

        # ④ terraform plan
        pr = self._run_cmd(
            ["terraform", "plan", "-json", "-out=tfplan.binary"], work_dir
        )
        if pr["returncode"] == 0:
            result.plan_passed = True
            summary = self._parse_plan_summary(pr["stdout"])
            result.plan_add     = summary.get("add", 0)
            result.plan_change  = summary.get("change", 0)
            result.plan_destroy = summary.get("destroy", 0)

        return result

    # ── Private 헬퍼 ────────────────────────────────────────────────

    def _run_cmd(self, cmd: list, work_dir: str) -> dict:
        try:
            proc = subprocess.run(
                cmd,
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=300,
                env={**os.environ, "TF_IN_AUTOMATION": "1"},
            )
            return {
                "returncode": proc.returncode,
                "stdout":     proc.stdout,
                "stderr":     proc.stderr,
            }
        except subprocess.TimeoutExpired:
            return {
                "returncode": 1,
                "stdout":     "",
                "stderr":     "terraform 명령어 타임아웃 (5분)",
            }

    def _run_tfsec(self, work_dir: str) -> dict:
        try:
            proc = subprocess.run(
                ["tfsec", work_dir, "--format", "json", "--no-color"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            raw = json.loads(proc.stdout) if proc.stdout.strip() else {"results": []}
            issues = [
                {
                    "tool":        "tfsec",
                    "severity":    r.get("severity", "UNKNOWN").upper(),
                    "rule_id":     r.get("rule_id", ""),
                    "description": r.get("description", ""),
                    "location":    r.get("location", {}).get("filename", ""),
                    "line":        r.get("location", {}).get("start_line", 0),
                }
                for r in raw.get("results", [])
            ]
            return {"issues": issues}
        except Exception as e:
            return {"issues": [], "error": str(e)}

    def _run_checkov(self, work_dir: str) -> dict:
        try:
            proc = subprocess.run(
                [
                    "checkov", "-d", work_dir,
                    "--output", "json",
                    "--framework", "terraform",
                    "--quiet",
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            raw = json.loads(proc.stdout) if proc.stdout.strip() else {}
            failed = raw.get("results", {}).get("failed_checks", [])
            issues = [
                {
                    "tool":        "checkov",
                    "severity":    c.get("severity", "MEDIUM").upper(),
                    "rule_id":     c.get("check_id", ""),
                    "description": c.get("check", {}).get("name", ""),
                    "location":    c.get("repo_file_path", ""),
                    "line":        (c.get("file_line_range") or [0])[0],
                }
                for c in failed
            ]
            return {"issues": issues}
        except Exception as e:
            return {"issues": [], "error": str(e)}

    def _run_infracost(self, work_dir: str) -> dict:
        try:
            proc = subprocess.run(
                [
                    "infracost", "breakdown",
                    "--path", work_dir,
                    "--format", "json",
                    "--no-color",
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if proc.returncode != 0:
                return {"monthly_total": 0.0, "breakdown": []}

            output        = json.loads(proc.stdout)
            monthly_total = float(
                output.get("totalMonthlyCost", "0").replace(",", "")
            )

            breakdown = []
            for proj in output.get("projects", []):
                for res in proj.get("breakdown", {}).get("resources", []):
                    mc = res.get("monthlyCost")
                    if mc:
                        breakdown.append({
                            "resource":     res.get("name", ""),
                            "monthly_cost": float(mc),
                        })

            breakdown.sort(key=lambda x: x["monthly_cost"], reverse=True)
            return {"monthly_total": monthly_total, "breakdown": breakdown}
        except Exception as e:
            return {"monthly_total": 0.0, "breakdown": [], "error": str(e)}

    def _parse_plan_summary(self, plan_json_output: str) -> dict:
        add = change = destroy = 0
        for line in plan_json_output.splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                if event.get("type") == "change_summary":
                    changes = event.get("changes", {})
                    add     = changes.get("add", 0)
                    change  = changes.get("change", 0)
                    destroy = changes.get("remove", 0)
                    break
            except json.JSONDecodeError:
                continue
        return {"add": add, "change": change, "destroy": destroy}

    def _write_hcl(self, work_dir: str, hcl_code: str) -> None:
        from pathlib import Path
        (Path(work_dir) / "main.tf").write_text(hcl_code, encoding="utf-8")