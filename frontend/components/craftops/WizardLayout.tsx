// frontend/components/craftops/WizardLayout.tsx
'use client'

import { ReactNode } from 'react'

interface Step {
  id: string
  label: string
  sub: string
}

const STEPS: Step[] = [
  { id: '2-1', label: '기본 설정',   sub: 'Naming · Region' },
  { id: '2-2', label: '네트워크',    sub: 'VPC · Subnet' },
  { id: '2-3', label: '보안 그룹',   sub: '3-Tier 망분리' },
  { id: '2-4', label: '로드 밸런서', sub: 'ALB · Multi-AZ' },
  { id: '2-5', label: '애플리케이션', sub: 'ECS Fargate' },
  { id: '2-6', label: '데이터베이스', sub: 'RDS PostgreSQL' },
]

interface Props {
  currentStep: string
  completedSteps: string[]
  children: ReactNode
  dependencyTree?: ReactNode
  sidekick?: string
  onPrev?: () => void
  onNext?: () => void
  isSubmitting?: boolean
  // ─ optional chrome (used by NewProjectPageContent) ─────────
  projectName?: string
  region?: string
  onExit?: () => void
  /** title above the step content, e.g. "VPC 네트워크 대역을 정해주세요." */
  title?: string
  /** sub-description shown under title */
  description?: string
}

export function WizardLayout({
  currentStep,
  completedSteps,
  children,
  sidekick,
  onPrev,
  onNext,
  isSubmitting,
  projectName,
  region,
  onExit,
  title,
  description,
}: Props) {
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep)
  const current   = STEPS[stepIndex]
  const totalDone = completedSteps.length
  const pct       = Math.round((totalDone / STEPS.length) * 100)
  const stepNum   = String(stepIndex + 1).padStart(2, '0')

  return (
    <>
      <style>{styles}</style>

      {/* ─── Top bar ─── */}
      <div className="wz-topbar">
        <div className="wz-top-left">
          <span className="wz-brand">
            <span className="wz-mark"></span>
            AutoOps
          </span>
          {projectName && (
            <>
              <span className="wz-crumb-sep" />
              <div className="wz-crumb-proj">
                <span className="wz-crumb-eyebrow">
                  <span className="wz-pip" />
                  CraftOps · 인프라 설계
                </span>
                <span className="wz-crumb-name">{projectName}</span>
              </div>
            </>
          )}
        </div>
        <div className="wz-top-right">
          <span className="wz-step-counter">
            Step <span className="wz-num">{stepNum}</span> / 06
          </span>
          {onExit && (
            <button className="wz-btn-exit" onClick={onExit}>나가기</button>
          )}
        </div>
      </div>

      {/* ─── Page ─── */}
      <div className="wz-page">

        {/* Sidebar */}
        <aside className="wz-sidebar">
          <div className="wz-progress-card">

            <div className="wz-progress-head">
              <div className="wz-progress-eyebrow">진행 상황</div>
              <h2 className="wz-progress-title">AWS 인프라 설계</h2>
              <div className="wz-bar-wrap">
                <div className="wz-bar"><div className="wz-bar-fill" style={{ width: `${pct}%` }} /></div>
                <span className="wz-bar-pct">{pct}%</span>
              </div>
            </div>

            <div className="wz-steps">
              {STEPS.map((s, idx) => {
                const isDone    = completedSteps.includes(s.id)
                const isCurrent = s.id === currentStep
                const cls = `wz-step${isDone ? ' wz-done' : ''}${isCurrent ? ' wz-current' : ''}`
                return (
                  <div key={s.id} className={cls}>
                    <div className="wz-step-num">
                      {isDone ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : (idx + 1)}
                    </div>
                    <div className="wz-step-body">
                      <div className="wz-step-label">{s.label}</div>
                      <div className="wz-step-sub">
                        {isCurrent ? `진행 중 · ${s.sub}` : s.sub}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="wz-progress-foot">
              <span>리소스</span>
              <span><span className="wz-foot-count">16</span>개 / AWS {region ?? 'us-west-2'}</span>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="wz-main">

          <div className="wz-step-header">
            <div className="wz-step-eyebrow">
              <span className="wz-pip" />
              Step {stepNum} · {current?.label}
            </div>
            {title && <h1 className="wz-step-title">{title}</h1>}
            {description && <p className="wz-step-desc">{description}</p>}
          </div>

          <div className="wz-form-card">
            {children}
          </div>

          {sidekick && (
            <div className="wz-sidekick">
              <div className="wz-sidekick-ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
              </div>
              <div className="wz-sidekick-body">
                <div className="wz-sidekick-label">CraftOps Tip</div>
                <p className="wz-sidekick-text">{sidekick}</p>
              </div>
            </div>
          )}

          <div className="wz-nav-row">
            <button className="wz-btn-prev" onClick={onPrev} disabled={!onPrev}>
              <span className="wz-arrow">←</span>
              이전
            </button>
            <button className="wz-btn-next" onClick={onNext} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <span className="wz-spinner" />
                  <span>저장 중...</span>
                </>
              ) : (
                <>
                  <span>다음</span>
                  <span className="wz-arrow">→</span>
                </>
              )}
            </button>
          </div>

        </main>
      </div>
    </>
  )
}

// ─── styles ─────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

.wz-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11, 14, 23, 0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.wz-top-left { display: flex; align-items: center; gap: 16px; }
.wz-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6;
}
.wz-mark {
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
.wz-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.wz-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.wz-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.wz-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ffa53d;
  display: inline-flex; align-items: center; gap: 8px;
}
.wz-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.wz-top-right { display: flex; align-items: center; gap: 14px; }
.wz-step-counter {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: #aeb4c5;
  padding: 6px 12px; border: 1px solid rgba(255,255,255,0.13);
  border-radius: 100px; background: rgba(255,255,255,0.03);
  display: inline-flex; align-items: center; gap: 8px;
}
.wz-step-counter .wz-num { color: #ffa53d; font-weight: 600; }
.wz-btn-exit {
  font-size: 13px; font-weight: 500;
  color: #aeb4c5; background: none; border: none;
  cursor: pointer; padding: 6px 10px;
  transition: color 160ms; font-family: inherit;
}
.wz-btn-exit:hover { color: #edf0f6; }

.wz-page {
  display: grid;
  grid-template-columns: 320px 1fr;
  max-width: 1480px;
  margin: 0 auto;
  padding: 40px 36px 80px;
  gap: 56px;
  color: #edf0f6;
}

.wz-sidebar { position: sticky; top: 95px; align-self: start; height: fit-content; }
.wz-progress-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008));
  overflow: hidden;
}
.wz-progress-head { padding: 22px 22px 20px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.wz-progress-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #aeb4c5; margin-bottom: 14px;
  display: flex; align-items: center; gap: 8px;
}
.wz-progress-eyebrow::before { content: ""; width: 14px; height: 1px; background: #ffa53d; }
.wz-progress-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 17px;
  letter-spacing: -0.015em; color: #edf0f6;
  margin: 0 0 16px;
}
.wz-bar-wrap { display: flex; align-items: center; gap: 12px; }
.wz-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
.wz-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffa53d, #ffc875);
  border-radius: 2px;
  box-shadow: 0 0 10px rgba(255,165,61,0.5);
  transition: width 600ms cubic-bezier(.22,.8,.18,1);
}
.wz-bar-pct {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 600;
  color: #ffa53d; min-width: 38px; text-align: right;
}

.wz-steps { padding: 14px 14px 18px; display: flex; flex-direction: column; gap: 2px; }
.wz-step {
  position: relative;
  display: flex; align-items: center; gap: 14px;
  padding: 12px;
  border-radius: 10px;
  transition: background 160ms;
}
.wz-step:not(:last-child)::after {
  content: ""; position: absolute;
  left: 27px; top: 38px; bottom: -2px;
  width: 1px;
  background: linear-gradient(180deg, rgba(255,255,255,0.13), transparent);
}
.wz-step.wz-done:not(:last-child)::after,
.wz-step.wz-current:not(:last-child)::after {
  background: linear-gradient(180deg, rgba(255,165,61,0.25), transparent);
}
.wz-step-num {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 600;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
  color: #7a8298;
  transition: all 200ms;
}
.wz-step.wz-done .wz-step-num {
  border-color: rgba(110,231,160,0.4);
  background: rgba(110,231,160,0.12);
  color: #6ee7a0;
}
.wz-step.wz-current .wz-step-num {
  border-color: #ffa53d;
  background: rgba(255,165,61,0.15);
  color: #ffa53d;
  box-shadow: 0 0 0 4px rgba(255,165,61,0.10), 0 0 20px rgba(255,165,61,0.25);
}
.wz-step-body { flex: 1; min-width: 0; }
.wz-step-label {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13.5px; font-weight: 600;
  letter-spacing: -0.005em;
  color: #aeb4c5; margin-bottom: 2px;
  transition: color 200ms;
}
.wz-step.wz-done .wz-step-label,
.wz-step.wz-current .wz-step-label { color: #edf0f6; }
.wz-step-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298; letter-spacing: 0.04em;
}
.wz-step.wz-current .wz-step-sub { color: #ffa53d; }

.wz-progress-foot {
  padding: 14px 22px 18px;
  border-top: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: space-between;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  letter-spacing: 0.06em; text-transform: uppercase;
}
.wz-foot-count { color: #ffa53d; font-weight: 600; }

.wz-main { min-width: 0; max-width: 760px; }
.wz-step-header { margin-bottom: 28px; }
.wz-step-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #ffa53d;
  padding: 5px 11px;
  border: 1px solid rgba(255,165,61,0.3);
  border-radius: 100px;
  background: rgba(255,165,61,0.06);
  margin-bottom: 16px;
}
.wz-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 8px #ffa53d;
  animation: wz-pulse 1.6s ease-in-out infinite;
}
.wz-step-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 0 0 12px; color: #edf0f6;
}
.wz-step-desc {
  font-size: 15px; color: #aeb4c5;
  line-height: 1.6; margin: 0; max-width: 560px;
}

.wz-form-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 28px;
  margin-bottom: 20px;
}

.wz-sidekick {
  display: flex; gap: 14px;
  padding: 18px 20px;
  border-radius: 12px;
  border: 1px solid rgba(255,165,61,0.22);
  background: linear-gradient(135deg, rgba(255,165,61,0.06), rgba(255,165,61,0.02));
  margin-bottom: 28px;
}
.wz-sidekick-ico {
  flex-shrink: 0;
  width: 32px; height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(255,165,61,0.3);
  background: rgba(255,165,61,0.10);
  color: #ffa53d;
  display: grid; place-items: center;
}
.wz-sidekick-body { flex: 1; min-width: 0; }
.wz-sidekick-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ffa53d; margin-bottom: 4px;
}
.wz-sidekick-text {
  font-size: 13.5px; color: #aeb4c5;
  line-height: 1.6; margin: 0;
}

.wz-nav-row { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; }
.wz-btn-prev {
  font-size: 13.5px; font-weight: 500;
  color: #aeb4c5; background: none; border: none;
  cursor: pointer; padding: 10px 8px;
  display: inline-flex; align-items: center; gap: 8px;
  transition: color 160ms;
  font-family: inherit;
}
.wz-btn-prev:hover:not(:disabled) { color: #edf0f6; }
.wz-btn-prev:hover:not(:disabled) .wz-arrow { transform: translateX(-3px); }
.wz-btn-prev .wz-arrow { transition: transform 200ms; display: inline-block; }
.wz-btn-prev:disabled { opacity: 0.3; cursor: not-allowed; }

.wz-btn-next {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 13px 22px;
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
.wz-btn-next:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(255,165,61,0.5);
}
.wz-btn-next:disabled { opacity: 0.6; cursor: not-allowed; filter: saturate(0.6); }
.wz-btn-next .wz-arrow { transition: transform 200ms; display: inline-block; }
.wz-btn-next:hover:not(:disabled) .wz-arrow { transform: translateX(3px); }
.wz-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: wz-spin 700ms linear infinite;
  display: inline-block;
}
@keyframes wz-spin { to { transform: rotate(360deg); } }
@keyframes wz-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}

@media (max-width: 1100px) {
  .wz-page { grid-template-columns: 280px 1fr; gap: 40px; padding: 36px 28px 80px; }
}
@media (max-width: 900px) {
  .wz-page { grid-template-columns: 1fr; gap: 32px; }
  .wz-sidebar { position: static; }
  .wz-step-title { font-size: 28px; }
  .wz-topbar { padding: 14px 20px; }
  .wz-top-left .wz-crumb-sep, .wz-top-left .wz-crumb-proj { display: none; }
}
`
