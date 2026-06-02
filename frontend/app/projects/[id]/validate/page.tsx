// frontend/app/projects/[id]/validate/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { ValidationResult } from '@/types'

interface ErrorDetails {
  manual_edit_required?: boolean
  error_location?: string
  fixed_code?: string
}

interface ProjectInfo {
  name: string
  region?: string
}

const STAGES = [
  { key: 'validate', label: 'terraform validate', sub: '문법 검증',           tone: 'orange' },
  { key: 'security', label: 'tfsec · checkov',    sub: '보안 스캔',           tone: 'orange' },
  { key: 'cost',     label: 'infracost',          sub: '비용 예측',           tone: 'orange' },
  { key: 'plan',     label: 'terraform plan',     sub: '리소스 변경 미리보기', tone: 'orange' },
]

export default function ValidatePage() {
  const router = useRouter()
  const { id: projectId } = useParams<{ id: string }>()

  const [project, setProject] = useState<ProjectInfo | null>(null)
  useEffect(() => {
    apiClient
      .get(`/api/projects/${projectId}`)
      .then((res) => setProject(res.data.data))
      .catch(() => {})
  }, [projectId])

  const [isValidating, setIsValidating] = useState(false)
  const [result, setResult]             = useState<ValidationResult | null>(null)
  const [error, setError]               = useState<{
    code: string
    message: string
    details?: ErrorDetails
  } | null>(null)

  const handleValidate = async () => {
    setIsValidating(true)
    setError(null)
    try {
      const res = await apiClient.post('/api/craft/validate', {
        project_id: projectId,
      })
      setResult(res.data.data)
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { error?: { code?: string; message?: string; details?: ErrorDetails } } }
        code?: string
      }

      if (axiosErr?.response?.status === 504 || axiosErr?.code === 'ECONNABORTED') {
        setError({
          code:    'TIMEOUT',
          message: '요청 시간이 초과됐습니다. 다시 시도해 주세요.\n(tfsec · checkov · infracost 분석에 시간이 걸릴 수 있습니다)',
          details: undefined,
        })
      } else {
        const errData = axiosErr?.response?.data?.error
        setError({
          code:    errData?.code    || 'UNKNOWN',
          message: errData?.message || 'Validation에 실패했습니다.',
          details: errData?.details,
        })
      }
    } finally {
      setIsValidating(false)
    }
  }

  const handleViewFullCode = () => {
    if (!result) return
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(
        `<pre style="background:#0b0e17;color:#aeb4c5;padding:24px;font-size:12.5px;font-family:ui-monospace,monospace;line-height:1.6;">${result.terraform_code}</pre>`
      )
      win.document.close()
    }
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([result.terraform_code], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = 'main.tf'
    a.click()
    URL.revokeObjectURL(url)
  }

  const vr = result?.validation_results

  // Derive stage statuses for stepper
  const stageStatuses = (() => {
    if (!vr) {
      return STAGES.map(() => 'pending' as const)
    }
    return [
      vr.validate.passed                                ? 'passed' as const : 'failed' as const,
      vr.security_scan.passed                           ? 'passed' as const : 'warn'   as const,
      'passed' as const, // cost always informational
      'passed' as const, // plan
    ]
  })()

  return (
    <>
      <style>{styles}</style>

      {/* Top bar */}
      <div className="vp-topbar">
        <div className="vp-top-left">
          <span className="vp-brand">
            <span className="vp-mark" />
            AutoOps
          </span>
          {project?.name && (
            <>
              <span className="vp-crumb-sep" />
              <div className="vp-crumb-proj">
                <span className="vp-crumb-eyebrow">
                  <span className="vp-pip vp-pip-blue" />
                  Validation Loop
                </span>
                <span className="vp-crumb-name">{project.name}</span>
              </div>
            </>
          )}
        </div>
        <button className="vp-back-link" onClick={() => router.push(`/projects/${projectId}`)}>
          ← 프로젝트로
        </button>
      </div>

      <div className="vp-page">

        {/* Page head */}
        <div className="vp-head">
          <div className="vp-eyebrow">
            <span className="vp-pip vp-pip-blue" />
            Step 03 · Validation Loop
          </div>
          <h1 className="vp-title">배포 전 4단계 자동 검증</h1>
          <p className="vp-sub">
            terraform validate → tfsec · checkov → infracost → terraform plan 순서로 자동 실행됩니다. 모든 검사를 통과하면 안전하게 배포할 수 있습니다.
          </p>
        </div>

        {/* Stage stepper (always visible) */}
        <div className="vp-stages">
          {STAGES.map((s, idx) => {
            const status = stageStatuses[idx]
            const isActive = isValidating && !result // all stages "active" during run
            return (
              <div
                key={s.key}
                className="vp-stage"
                data-status={isActive ? 'running' : status}
              >
                <div className="vp-stage-num">
                  {status === 'passed' ? (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : status === 'failed' ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  ) : status === 'warn' ? (
                    '!'
                  ) : isActive ? (
                    <span className="vp-spinner-tiny" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <div className="vp-stage-body">
                  <div className="vp-stage-label">{s.label}</div>
                  <div className="vp-stage-sub">{s.sub}</div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Initial state: big start CTA ───────────────────── */}
        {!result && !error && (
          <div className="vp-cta-card">
            <div className="vp-cta-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3 7-7"/>
                <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>
              </svg>
            </div>
            <h2 className="vp-cta-title">검증 시작 준비 완료</h2>
            <p className="vp-cta-sub">
              위 4단계를 자동으로 실행하고 결과를 보여드립니다. 평균 30~60초 소요됩니다.
            </p>
            <button
              className="vp-btn-primary"
              onClick={handleValidate}
              disabled={isValidating}
            >
              {isValidating ? (
                <>
                  <span className="vp-spinner-sm" />
                  <span>검증 진행 중...</span>
                </>
              ) : (
                <>
                  <span>검증 시작하기</span>
                  <span className="vp-arrow">→</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Error: manual edit required ─────────────────────── */}
        {error?.details?.manual_edit_required && (
          <div className="vp-alert vp-alert-danger">
            <div className="vp-alert-head">
              <span className="vp-alert-ico">×</span>
              <div>
                <div className="vp-alert-title">자동 수정 실패</div>
                <div className="vp-alert-msg">
                  CraftOps의 Self-Correction이 해결할 수 없는 문법 오류가 발견됐습니다. 수동 편집 후 재검증해주세요.
                </div>
              </div>
            </div>
            {error.details.error_location && (
              <div className="vp-alert-code">
                <div className="vp-alert-code-label">에러 위치</div>
                <pre>{error.details.error_location.slice(0, 200)}</pre>
              </div>
            )}
            <div className="vp-alert-actions">
              <button className="vp-btn-secondary">수동 편집 모드</button>
            </div>
          </div>
        )}

        {/* ── Error: terraform error w/ auto-fix ────────────── */}
        {error?.code === 'TERRAFORM_ERROR' && !error.details?.manual_edit_required && (
          <div className="vp-alert vp-alert-danger">
            <div className="vp-alert-head">
              <span className="vp-alert-ico">!</span>
              <div>
                <div className="vp-alert-title">Terraform 검증 실패</div>
                <div className="vp-alert-msg">{error.message}</div>
              </div>
            </div>
            {error.details?.fixed_code !== undefined && (
              <div className="vp-alert-actions">
                <button className="vp-btn-primary" onClick={handleValidate}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
                  </svg>
                  자동 수정 적용 후 재검증
                </button>
              </div>
            )}
          </div>
        )}

        {/* Generic error fallback */}
        {error && error.code !== 'TERRAFORM_ERROR' && !error.details?.manual_edit_required && (
          <div className="vp-alert vp-alert-danger">
            <div className="vp-alert-head">
              <span className="vp-alert-ico">!</span>
              <div>
                <div className="vp-alert-title">
                  {error.code === 'TIMEOUT' ? '⏱ 응답 시간 초과' : '검증 실패'}
                </div>
                <div className="vp-alert-msg" style={{ whiteSpace: 'pre-line' }}>
                  {error.message}
                </div>
              </div>
            </div>
            <div className="vp-alert-actions">
              <button className="vp-btn-secondary" onClick={() => { setError(null); handleValidate() }}>
                다시 시도
              </button>
            </div>
          </div>
        )}

        {/* ── Result ─────────────────────────────────────────── */}
        {result && vr && (
          <>

            {/* Terraform code preview */}
            <div className="vp-section">
              <div className="vp-section-head">
                <span className="vp-section-eyebrow">
                  <span className="vp-pip vp-pip-orange" />
                  Generated Terraform
                </span>
                <span className="vp-section-meta">
                  {result.terraform_code.length.toLocaleString()} chars
                </span>
              </div>
              <pre className="vp-code">{result.terraform_code.slice(0, 400)}...</pre>
              <div className="vp-code-actions">
                <button className="vp-btn-secondary" onClick={handleViewFullCode}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1"/>
                  </svg>
                  전체 코드 보기
                </button>
                <button className="vp-btn-secondary" onClick={handleDownload}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  main.tf 다운로드
                </button>
              </div>
            </div>

            {/* Results grid: validate + security */}
            <div className="vp-grid-2">
              {/* terraform validate */}
              <div className="vp-section">
                <div className="vp-section-head">
                  <span className="vp-section-eyebrow">
                    <span className="vp-pip vp-pip-orange" />
                    Stage 1 · Validate
                  </span>
                </div>
                <div className="vp-result-row">
                  <span className="vp-result-label">terraform validate</span>
                  <span className="vp-status" data-tone={vr.validate.passed ? 'green' : 'red'}>
                    <span className="vp-status-pip" />
                    {vr.validate.passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
                {vr.validate.correction_attempts > 0 && (
                  <div className="vp-result-note">
                    <span className="vp-correction-pill">Self-Correction</span>
                    <span>{vr.validate.correction_attempts}회 자동 수정 적용</span>
                  </div>
                )}
              </div>

              {/* security scan */}
              <div className="vp-section">
                <div className="vp-section-head">
                  <span className="vp-section-eyebrow">
                    <span className="vp-pip vp-pip-orange" />
                    Stage 2 · Security
                  </span>
                </div>
                <div className="vp-result-row">
                  <span className="vp-result-label">tfsec + checkov</span>
                  <span className="vp-status" data-tone={vr.security_scan.passed ? 'green' : 'yellow'}>
                    <span className="vp-status-pip" />
                    {vr.security_scan.passed ? 'Passed' : 'Warnings'}
                  </span>
                </div>
                <div className="vp-sev-grid">
                  <div className="vp-sev" data-tone="red">
                    <div className="vp-sev-num">{vr.security_scan.critical}</div>
                    <div className="vp-sev-label">Critical</div>
                  </div>
                  <div className="vp-sev" data-tone="orange">
                    <div className="vp-sev-num">{vr.security_scan.high}</div>
                    <div className="vp-sev-label">High</div>
                  </div>
                  <div className="vp-sev" data-tone="yellow">
                    <div className="vp-sev-num">{vr.security_scan.medium}</div>
                    <div className="vp-sev-label">Medium</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cost estimation */}
            <div className="vp-section">
              <div className="vp-section-head">
                <span className="vp-section-eyebrow">
                  <span className="vp-pip vp-pip-orange" />
                  Stage 3 · Cost Estimation · Infracost
                </span>
                <span className="vp-cost-total">
                  ${vr.cost_estimation.monthly_total.toFixed(2)}
                  <small> / 월</small>
                </span>
              </div>
              <table className="vp-cost-table">
                <thead>
                  <tr>
                    <th>리소스</th>
                    <th className="vp-th-right">월 예상 비용</th>
                  </tr>
                </thead>
                <tbody>
                  {vr.cost_estimation.breakdown.map((item) => {
                    const pct = vr.cost_estimation.monthly_total > 0
                      ? (item.monthly_cost / vr.cost_estimation.monthly_total) * 100
                      : 0
                    return (
                      <tr key={item.resource}>
                        <td className="vp-cost-name">
                          <div>{item.resource}</div>
                          <div className="vp-cost-bar">
                            <div className="vp-cost-fill" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="vp-cost-amt">
                          ${item.monthly_cost.toFixed(2)}<small> / 월</small>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* terraform plan */}
            <div className="vp-section">
              <div className="vp-section-head">
                <span className="vp-section-eyebrow">
                  <span className="vp-pip vp-pip-orange" />
                  Stage 4 · Terraform Plan
                </span>
              </div>
              <div className="vp-plan-grid">
                <div className="vp-plan-cell" data-tone="green">
                  <div className="vp-plan-num">+{vr.plan.add}</div>
                  <div className="vp-plan-label">to add</div>
                </div>
                <div className="vp-plan-cell" data-tone="yellow">
                  <div className="vp-plan-num">~{vr.plan.change}</div>
                  <div className="vp-plan-label">to change</div>
                </div>
                <div className="vp-plan-cell" data-tone="red">
                  <div className="vp-plan-num">-{vr.plan.destroy}</div>
                  <div className="vp-plan-label">to destroy</div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <div className="vp-nav-row">
              <button className="vp-btn-prev" onClick={() => router.push('/projects/new')}>
                <span className="vp-arrow">←</span>
                설정 수정
              </button>
              <button
                className="vp-btn-primary"
                onClick={() =>
                  router.push(`/projects/${projectId}/deploy?validation_id=${result.validation_id}`)
                }
              >
                <span>배포하기</span>
                <span className="vp-arrow">→</span>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

body { background: #0b0e17; color: #edf0f6; }
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1;
  background-image:
    linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
  opacity: 0.55; pointer-events: none;
}

.vp-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11,14,23,0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.vp-top-left { display: flex; align-items: center; gap: 16px; }
.vp-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6;
}
.vp-mark {
  width: 26px; height: 26px;
  border-radius: 7px;
  background:
    radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.7), transparent 60%),
    radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.7), transparent 60%),
    #11151f;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 24px rgba(90,163,255,0.18), inset 0 0 12px rgba(255,255,255,0.06);
  position: relative; flex-shrink: 0;
}
.vp-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.vp-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.vp-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.vp-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #5aa3ff;
  display: inline-flex; align-items: center; gap: 8px;
}
.vp-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.vp-back-link {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: #aeb4c5;
  background: rgba(255,255,255,0.03);
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  cursor: pointer;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.vp-back-link:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }

.vp-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 36px 80px;
  color: #edf0f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Pip helpers */
.vp-pip { width: 6px; height: 6px; border-radius: 50%; }
.vp-pip-blue   { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
.vp-pip-orange { background: #ffa53d; box-shadow: 0 0 8px #ffa53d; }

/* Page head */
.vp-head {
  margin-bottom: 32px;
  padding-bottom: 28px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.vp-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
  padding: 5px 11px;
  border: 1px solid rgba(90,163,255,0.3);
  border-radius: 100px;
  background: rgba(90,163,255,0.06);
  margin-bottom: 16px;
}
.vp-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700;
  font-size: 36px;
  letter-spacing: -0.03em;
  line-height: 1.15;
  margin: 0 0 12px;
  color: #edf0f6;
}
.vp-sub {
  font-size: 14.5px;
  color: #aeb4c5;
  margin: 0;
  line-height: 1.65;
  max-width: 720px;
}

/* Stages stepper */
.vp-stages {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}
.vp-stage {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 16px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.02);
  transition: all 200ms;
}
.vp-stage[data-status="running"] {
  border-color: rgba(90,163,255,0.4);
  background: rgba(90,163,255,0.06);
  box-shadow: 0 0 0 4px rgba(90,163,255,0.08);
}
.vp-stage[data-status="passed"] {
  border-color: rgba(110,231,160,0.30);
  background: rgba(110,231,160,0.05);
}
.vp-stage[data-status="failed"] {
  border-color: rgba(255,118,118,0.35);
  background: rgba(255,118,118,0.06);
}
.vp-stage[data-status="warn"] {
  border-color: rgba(245,208,97,0.30);
  background: rgba(245,208,97,0.05);
}
.vp-stage-num {
  flex-shrink: 0;
  width: 30px; height: 30px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
  color: #7a8298;
  transition: all 200ms;
}
.vp-stage[data-status="running"] .vp-stage-num {
  color: #5aa3ff; border-color: #5aa3ff; background: rgba(90,163,255,0.15);
}
.vp-stage[data-status="passed"] .vp-stage-num {
  color: #6ee7a0; border-color: rgba(110,231,160,0.5); background: rgba(110,231,160,0.15);
}
.vp-stage[data-status="failed"] .vp-stage-num {
  color: #ff7676; border-color: rgba(255,118,118,0.55); background: rgba(255,118,118,0.18);
}
.vp-stage[data-status="warn"] .vp-stage-num {
  color: #f5d061; border-color: rgba(245,208,97,0.50); background: rgba(245,208,97,0.15);
}
.vp-stage-body { min-width: 0; flex: 1; }
.vp-stage-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px; font-weight: 600;
  color: #edf0f6;
  letter-spacing: 0.01em;
  margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vp-stage-sub {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 11.5px;
  color: #aeb4c5;
}
.vp-stage[data-status="running"] .vp-stage-sub { color: #5aa3ff; }
.vp-stage[data-status="passed"] .vp-stage-sub { color: #6ee7a0; }
.vp-stage[data-status="failed"] .vp-stage-sub { color: #ff7676; }
.vp-stage[data-status="warn"] .vp-stage-sub { color: #f5d061; }

.vp-spinner-tiny {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(90,163,255,0.25);
  border-top-color: #5aa3ff;
  animation: vp-spin 700ms linear infinite;
}
@keyframes vp-spin { to { transform: rotate(360deg); } }

/* CTA card */
.vp-cta-card {
  padding: 48px 32px 36px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(90,163,255,0.08), transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  text-align: center;
  position: relative;
  overflow: hidden;
}
.vp-cta-card::before {
  content: ""; position: absolute;
  top: 0; left: 28px; right: 28px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #5aa3ff, transparent);
  opacity: 0.5;
}
.vp-cta-ico {
  width: 56px; height: 56px;
  margin: 0 auto 20px;
  border-radius: 14px;
  background: rgba(90,163,255,0.10);
  border: 1px solid rgba(90,163,255,0.25);
  display: grid; place-items: center;
  color: #5aa3ff;
}
.vp-cta-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px; font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  color: #edf0f6;
}
.vp-cta-sub {
  font-size: 13.5px;
  color: #aeb4c5;
  line-height: 1.6;
  margin: 0 0 28px;
  max-width: 440px;
  margin-left: auto;
  margin-right: auto;
}

/* Buttons */
.vp-btn-primary {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 13px 24px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  letter-spacing: -0.005em;
  border-radius: 10px;
  border: 1px solid #f3f4f8;
  background: linear-gradient(180deg, #ffffff, #e8eaf0);
  color: #0a0d14;
  cursor: pointer;
  transition: transform 180ms, box-shadow 180ms, filter 180ms;
}
.vp-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(90,163,255,0.5);
}
.vp-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; filter: saturate(0.6); }
.vp-btn-primary .vp-arrow { transition: transform 200ms; display: inline-block; }
.vp-btn-primary:hover:not(:disabled) .vp-arrow { transform: translateX(3px); }
.vp-btn-secondary {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 12.5px; font-weight: 600;
  border-radius: 9px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.03);
  color: #aeb4c5;
  cursor: pointer;
  transition: all 160ms;
}
.vp-btn-secondary:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }
.vp-btn-prev {
  font-size: 13.5px; font-weight: 500;
  color: #aeb4c5; background: none; border: none;
  cursor: pointer; padding: 10px 8px;
  display: inline-flex; align-items: center; gap: 8px;
  transition: color 160ms;
  font-family: inherit;
}
.vp-btn-prev:hover { color: #edf0f6; }
.vp-btn-prev:hover .vp-arrow { transform: translateX(-3px); }
.vp-btn-prev .vp-arrow { transition: transform 200ms; display: inline-block; }

.vp-spinner-sm {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: vp-spin 700ms linear infinite;
  display: inline-block;
}

/* Alerts */
.vp-alert {
  padding: 18px 20px;
  border-radius: 12px;
  margin-bottom: 18px;
  display: flex; flex-direction: column; gap: 14px;
}
.vp-alert-danger {
  border: 1px solid rgba(255,118,118,0.35);
  background: rgba(255,118,118,0.05);
}
.vp-alert-head {
  display: flex; gap: 12px; align-items: flex-start;
}
.vp-alert-ico {
  flex-shrink: 0;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: rgba(255,118,118,0.2);
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700; font-size: 14px;
  color: #ff7676;
}
.vp-alert-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 700;
  color: #ff7676; margin-bottom: 4px;
  letter-spacing: -0.01em;
}
.vp-alert-msg { font-size: 13px; color: #aeb4c5; line-height: 1.55; }
.vp-alert-code {
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.08);
}
.vp-alert-code-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #7a8298; margin-bottom: 8px;
}
.vp-alert-code pre {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #edf0f6;
  white-space: pre-wrap; word-break: break-all;
  line-height: 1.5;
}
.vp-alert-actions { display: flex; gap: 8px; }

/* Section card */
.vp-section {
  padding: 22px 24px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  margin-bottom: 18px;
  position: relative;
  overflow: hidden;
}
.vp-section::before {
  content: ""; position: absolute;
  top: 0; left: 24px; right: 24px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,165,61,0.45), transparent);
}
.vp-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px; flex-wrap: wrap;
}
.vp-section-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #ffa53d;
}
.vp-section-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.06em;
  padding: 3px 9px;
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.04);
}

/* Code preview */
.vp-code {
  margin: 0;
  padding: 16px;
  border-radius: 10px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.06);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  color: #aeb4c5;
  line-height: 1.65;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.vp-code-actions {
  display: flex; gap: 8px;
  margin-top: 14px;
}

/* Result rows */
.vp-result-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
}
.vp-result-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; color: #edf0f6;
  font-weight: 500;
}
.vp-status {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 600;
  color: #aeb4c5;
}
.vp-status .vp-status-pip { width: 7px; height: 7px; border-radius: 50%; }
.vp-status[data-tone="green"]  { color: #6ee7a0; }
.vp-status[data-tone="green"] .vp-status-pip  { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; }
.vp-status[data-tone="yellow"] { color: #f5d061; }
.vp-status[data-tone="yellow"] .vp-status-pip { background: #f5d061; box-shadow: 0 0 8px #f5d061; }
.vp-status[data-tone="red"]    { color: #ff7676; }
.vp-status[data-tone="red"] .vp-status-pip    { background: #ff7676; box-shadow: 0 0 8px #ff7676; }

.vp-result-note {
  margin-top: 14px;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255,165,61,0.05);
  border: 1px dashed rgba(255,165,61,0.25);
  font-size: 12.5px; color: #aeb4c5;
}
.vp-correction-pill {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 100px;
  background: rgba(255,165,61,0.12);
  border: 1px solid rgba(255,165,61,0.3);
  color: #ffa53d;
}

/* Severity grid (security scan) */
.vp-sev-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255,255,255,0.08);
}
.vp-sev {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.02);
}
.vp-sev-num {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 22px;
  letter-spacing: -0.02em;
  line-height: 1;
  margin-bottom: 6px;
  color: #aeb4c5;
}
.vp-sev-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.12em; text-transform: uppercase;
}
.vp-sev[data-tone="red"]    .vp-sev-num { color: #ff7676; }
.vp-sev[data-tone="orange"] .vp-sev-num { color: #ffa53d; }
.vp-sev[data-tone="yellow"] .vp-sev-num { color: #f5d061; }

/* Grid 2-col */
.vp-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 18px;
}
.vp-grid-2 > .vp-section { margin-bottom: 0; }

/* Cost table */
.vp-cost-total {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 24px;
  letter-spacing: -0.025em;
  color: #6ee7a0;
}
.vp-cost-total small {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px; color: #7a8298;
  font-weight: 500; margin-left: 3px;
}
.vp-cost-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.vp-cost-table thead th {
  text-align: left;
  padding: 10px 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #7a8298;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.vp-cost-table tbody td {
  padding: 14px 0;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
  vertical-align: middle;
}
.vp-cost-table tbody tr:last-child td { border-bottom: none; }
.vp-th-right { text-align: right !important; }
.vp-cost-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; color: #edf0f6;
  width: 65%;
}
.vp-cost-bar {
  margin-top: 6px;
  height: 3px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  overflow: hidden;
  max-width: 240px;
}
.vp-cost-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffa53d, #ffc875);
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(255,165,61,0.4);
}
.vp-cost-amt {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 14px; color: #edf0f6;
  font-weight: 600;
  text-align: right;
}
.vp-cost-amt small {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 11px; color: #7a8298;
  font-weight: 500; margin-left: 3px;
}

/* Plan grid */
.vp-plan-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.vp-plan-cell {
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.02);
  text-align: center;
}
.vp-plan-cell[data-tone="green"]  { border-color: rgba(110,231,160,0.30); background: rgba(110,231,160,0.05); }
.vp-plan-cell[data-tone="yellow"] { border-color: rgba(245,208,97,0.30); background: rgba(245,208,97,0.05); }
.vp-plan-cell[data-tone="red"]    { border-color: rgba(255,118,118,0.30); background: rgba(255,118,118,0.05); }
.vp-plan-num {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 32px;
  letter-spacing: -0.025em;
  line-height: 1;
  margin-bottom: 8px;
}
.vp-plan-cell[data-tone="green"]  .vp-plan-num { color: #6ee7a0; }
.vp-plan-cell[data-tone="yellow"] .vp-plan-num { color: #f5d061; }
.vp-plan-cell[data-tone="red"]    .vp-plan-num { color: #ff7676; }
.vp-plan-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  letter-spacing: 0.12em; text-transform: uppercase;
}

/* Nav row */
.vp-nav-row {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 16px;
}

@media (max-width: 900px) {
  .vp-topbar { padding: 14px 20px; }
  .vp-top-left .vp-crumb-sep, .vp-top-left .vp-crumb-proj { display: none; }
  .vp-page { padding: 28px 20px 60px; }
  .vp-title { font-size: 28px; }
  .vp-stages { grid-template-columns: 1fr 1fr; }
  .vp-grid-2 { grid-template-columns: 1fr; }
  .vp-sev-grid, .vp-plan-grid { grid-template-columns: repeat(3, 1fr); gap: 8px; }
}
`
