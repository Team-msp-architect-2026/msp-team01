// frontend/app/projects/[id]/deploy/page.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'

interface LogEntry {
  message: string
  timestamp: number
}

export default function DeployPage() {
  const router       = useRouter()
  const { id: projectId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const validationId = searchParams.get('validation_id') || ''

  const [deploymentId, setDeploymentId] = useState<string | null>(null)
  const [isDeploying, setIsDeploying]   = useState(false)
  const [projectName, setProjectName]   = useState<string>('')
  const [deployStatus, setDeployStatus] = useState<
    'idle' | 'deploying' | 'completed' | 'failed'
  >('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])

  const { events, isConnected } = useWebSocket(projectId, deploymentId)

  // auto-scroll log box
  const logRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  // 프로젝트 이름 조회 (토스트 + 상단 crumb)
  useEffect(() => {
    if (!projectId) return
    apiClient.get(`/api/projects/${projectId}`)
      .then((res) => setProjectName(res.data.data?.name ?? ''))
      .catch(() => {})
  }, [projectId])

  // WebSocket 이벤트 처리 — §7-7
  useEffect(() => {
    if (!events.length) return
    const latest = events[events.length - 1]

    if (latest.event_type === 'deploy_progress') {
      const data = latest.data as { log?: string; timestamp?: number }
      if (data.log) {
        setLogs((prev) => [
          ...prev,
          { message: data.log!, timestamp: data.timestamp || Date.now() },
        ])
      }
    }

    if (latest.event_type === 'deploy_completed') {
      setDeployStatus('completed')
      localStorage.setItem(
        'deploy_toast',
        JSON.stringify({
          projectName: projectName || projectId,
          message: '배포가 완료되었습니다.',
        })
      )
      setTimeout(() => router.push('/dashboard'), 2000)
    }

    if (latest.event_type === 'deploy_failed') {
      setDeployStatus('failed')
      setTimeout(
        () => router.push(`/projects/${projectId}/partial-failure`),
        1000
      )
    }
  }, [events, projectId, projectName, router])

  const handleDeploy = async () => {
    setIsDeploying(true)
    try {
      const res = await apiClient.post('/api/craft/deploy', {
        project_id:    projectId,
        validation_id: validationId,
      })
      setDeploymentId(res.data.data.deployment_id)
      setDeployStatus('deploying')
    } finally {
      setIsDeploying(false)
    }
  }

  // colorize terraform log lines
  const logToneClass = (line: string): string => {
    if (/error|fail/i.test(line))                          return 'dp-log-err'
    if (/destroy|deleting/i.test(line))                    return 'dp-log-warn'
    if (/✓|complete|created|successful|applied/i.test(line)) return 'dp-log-ok'
    if (/^\+|adding|creating/i.test(line))                 return 'dp-log-add'
    if (/^~|modifying|updating/i.test(line))               return 'dp-log-mod'
    return 'dp-log-dim'
  }

  const elapsedDuration = logs.length > 0
    ? Math.round((Date.now() - logs[0].timestamp) / 1000)
    : 0

  return (
    <>
      <style>{styles}</style>

      {/* Top bar */}
      <div className="dp-topbar">
        <div className="dp-top-left">
          <span className="dp-brand">
            <span className="dp-mark" />
            AutoOps
          </span>
          {projectName && (
            <>
              <span className="dp-crumb-sep" />
              <div className="dp-crumb-proj">
                <span className="dp-crumb-eyebrow">
                  <span className="dp-pip dp-pip-orange" />
                  CraftOps · 배포
                </span>
                <span className="dp-crumb-name">{projectName}</span>
              </div>
            </>
          )}
        </div>
        <button
          className="dp-back-link"
          onClick={() => router.push(`/projects/${projectId}`)}
        >
          ← 프로젝트로
        </button>
      </div>

      <div className="dp-page">

        {/* Page head */}
        <div className="dp-head">
          <div className="dp-eyebrow">
            <span className="dp-pip dp-pip-orange" />
            Step 04 · Deploy
          </div>
          <h1 className="dp-title">
            {deployStatus === 'idle'      && 'AWS에 인프라를 배포할 준비가 되었습니다.'}
            {deployStatus === 'deploying' && '인프라 배포가 진행 중입니다.'}
            {deployStatus === 'completed' && '배포가 완료되었습니다.'}
            {deployStatus === 'failed'    && '배포 중 문제가 발생했습니다.'}
          </h1>
          <p className="dp-sub">
            {deployStatus === 'idle'      && '검증을 통과한 Terraform 코드를 AWS에 직접 적용합니다. 평균 2~5분이 소요됩니다.'}
            {deployStatus === 'deploying' && 'terraform apply 가 실행되고 있습니다. CloudWatch 로그를 실시간으로 보여드립니다.'}
            {deployStatus === 'completed' && '잠시 후 대시보드로 이동합니다.'}
            {deployStatus === 'failed'    && 'Partial Failure 페이지로 이동해 실패한 리소스를 확인합니다.'}
          </p>
        </div>

        {/* 4-step strip (context for where we are in the journey) */}
        <div className="dp-steps">
          <div className="dp-step" data-status="passed">
            <div className="dp-step-num">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="dp-step-body">
              <div className="dp-step-label">설계</div>
              <div className="dp-step-sub">CraftOps Wizard</div>
            </div>
          </div>
          <div className="dp-step-connector" />
          <div className="dp-step" data-status="passed">
            <div className="dp-step-num">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="dp-step-body">
              <div className="dp-step-label">검증</div>
              <div className="dp-step-sub">Validation Loop</div>
            </div>
          </div>
          <div className="dp-step-connector" />
          <div className="dp-step" data-status={
            deployStatus === 'completed' ? 'passed'
            : deployStatus === 'failed' ? 'failed'
            : deployStatus === 'deploying' ? 'running'
            : 'current'
          }>
            <div className="dp-step-num">
              {deployStatus === 'completed' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : deployStatus === 'failed' ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              ) : deployStatus === 'deploying' ? (
                <span className="dp-step-spin" />
              ) : (
                '3'
              )}
            </div>
            <div className="dp-step-body">
              <div className="dp-step-label">배포</div>
              <div className="dp-step-sub">terraform apply</div>
            </div>
          </div>
        </div>

        {/* ── Idle: big CTA ──────────────────────────────────────── */}
        {deployStatus === 'idle' && (
          <div className="dp-cta-card">
            <div className="dp-cta-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <h2 className="dp-cta-title">실제 AWS 환경에 적용됩니다</h2>
            <p className="dp-cta-sub">
              배포를 시작하면 검증 단계에서 확인한 리소스가 AWS에 생성되고 실제 요금이 부과되기 시작합니다.
            </p>
            <button
              className="dp-btn-primary"
              onClick={handleDeploy}
              disabled={isDeploying}
            >
              {isDeploying ? (
                <>
                  <span className="dp-spinner-sm" />
                  <span>배포 시작 중...</span>
                </>
              ) : (
                <>
                  <span>배포 시작하기</span>
                  <span className="dp-arrow">→</span>
                </>
              )}
            </button>
            <div className="dp-cta-meta">
              <span>validation_id ·</span>
              <span className="dp-mono">{validationId || '—'}</span>
            </div>
          </div>
        )}

        {/* ── Deploying: terminal + status ──────────────────────── */}
        {deployStatus === 'deploying' && (
          <div className="dp-section">
            <div className="dp-deploy-head">
              <div className="dp-deploy-status">
                <span className="dp-deploy-spin" />
                <div>
                  <div className="dp-deploy-title">Terraform Apply 진행 중</div>
                  <div className="dp-deploy-sub">
                    {logs.length} log lines · {elapsedDuration}s elapsed
                  </div>
                </div>
              </div>
              <div className="dp-conn" data-state={isConnected ? 'on' : 'off'}>
                <span className="dp-conn-pip" />
                {isConnected ? 'WebSocket 연결됨' : '연결 끊김'}
              </div>
            </div>

            {/* Terminal */}
            <div className="dp-term">
              <div className="dp-term-bar">
                <div className="dp-term-dots">
                  <span /><span /><span />
                </div>
                <div className="dp-term-title">cloudwatch · {projectName || projectId} · terraform apply</div>
                <div className="dp-term-meta">
                  <span className="dp-mono">{logs.length} lines</span>
                </div>
              </div>
              <div className="dp-term-body" ref={logRef}>
                {logs.length === 0 ? (
                  <div className="dp-log-waiting">
                    <span className="dp-spin-tiny" />
                    <span>로그 수신 대기 중...</span>
                  </div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`dp-log-line ${logToneClass(log.message)}`}>
                      <span className="dp-log-num">{String(i + 1).padStart(3, '0')}</span>
                      <span className="dp-log-text">{log.message}</span>
                    </div>
                  ))
                )}
                {logs.length > 0 && <div className="dp-caret" />}
              </div>
            </div>

            <div className="dp-deploy-foot">
              <button className="dp-btn-ghost">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15 3h6v6M14 10l6.1-6.1M9 21H3v-6M10 14l-6.1 6.1"/>
                </svg>
                전체 로그
              </button>
              <button className="dp-btn-danger-ghost">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                </svg>
                배포 취소
              </button>
            </div>
          </div>
        )}

        {/* ── Completed ─────────────────────────────────────────── */}
        {deployStatus === 'completed' && (
          <div className="dp-result-card" data-tone="green">
            <div className="dp-result-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="dp-result-body">
              <div className="dp-result-title">배포 완료</div>
              <div className="dp-result-sub">
                {projectName ? `"${projectName}" 프로젝트 인프라가 정상적으로 생성됐어요. ` : ''}
                잠시 후 대시보드로 이동합니다.
              </div>
            </div>
            <div className="dp-result-spinner">
              <span className="dp-spinner-sm" />
            </div>
          </div>
        )}

        {/* ── Failed ────────────────────────────────────────────── */}
        {deployStatus === 'failed' && (
          <div className="dp-result-card" data-tone="red">
            <div className="dp-result-ico">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </div>
            <div className="dp-result-body">
              <div className="dp-result-title">배포 실패</div>
              <div className="dp-result-sub">
                일부 리소스 생성에 실패했어요. Partial Failure 페이지로 이동해 원인을 확인합니다.
              </div>
            </div>
            <div className="dp-result-spinner">
              <span className="dp-spinner-sm" />
            </div>
          </div>
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

/* Topbar */
.dp-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11,14,23,0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.dp-top-left { display: flex; align-items: center; gap: 16px; }
.dp-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6;
}
.dp-mark {
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
.dp-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.dp-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.dp-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.dp-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ffa53d;
  display: inline-flex; align-items: center; gap: 8px;
}
.dp-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.dp-back-link {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: #aeb4c5;
  background: rgba(255,255,255,0.03);
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  cursor: pointer;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.dp-back-link:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }

.dp-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 36px 80px;
  color: #edf0f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Pip helpers */
.dp-pip { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dp-pip-orange { background: #ffa53d; box-shadow: 0 0 8px #ffa53d; }
.dp-pip-blue   { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }

/* Page head */
.dp-head {
  margin-bottom: 28px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.dp-eyebrow {
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
.dp-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700;
  font-size: 32px;
  letter-spacing: -0.03em;
  line-height: 1.18;
  margin: 0 0 12px;
  color: #edf0f6;
  max-width: 760px;
}
.dp-sub {
  font-size: 14.5px;
  color: #aeb4c5;
  margin: 0;
  line-height: 1.65;
  max-width: 660px;
}

/* Step strip */
.dp-steps {
  display: flex; align-items: center;
  gap: 0;
  padding: 16px 0 24px;
  margin-bottom: 24px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.dp-step {
  display: flex; align-items: center; gap: 12px;
  flex-shrink: 0;
}
.dp-step-num {
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
.dp-step[data-status="passed"] .dp-step-num {
  color: #6ee7a0; border-color: rgba(110,231,160,0.5); background: rgba(110,231,160,0.15);
}
.dp-step[data-status="current"] .dp-step-num {
  color: #ffa53d; border-color: #ffa53d; background: rgba(255,165,61,0.15);
  box-shadow: 0 0 0 4px rgba(255,165,61,0.10), 0 0 20px rgba(255,165,61,0.25);
}
.dp-step[data-status="running"] .dp-step-num {
  color: #ffa53d; border-color: #ffa53d; background: rgba(255,165,61,0.15);
  box-shadow: 0 0 0 4px rgba(255,165,61,0.10), 0 0 20px rgba(255,165,61,0.25);
}
.dp-step[data-status="failed"] .dp-step-num {
  color: #ff7676; border-color: rgba(255,118,118,0.55); background: rgba(255,118,118,0.18);
}
.dp-step-label {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13.5px; font-weight: 600;
  color: #edf0f6;
  letter-spacing: -0.005em;
  margin-bottom: 2px;
}
.dp-step-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.05em;
}
.dp-step[data-status="current"] .dp-step-sub,
.dp-step[data-status="running"] .dp-step-sub { color: #ffa53d; }
.dp-step[data-status="failed"]  .dp-step-sub { color: #ff7676; }
.dp-step[data-status="passed"]  .dp-step-sub { color: #6ee7a0; }
.dp-step-connector {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(255,255,255,0.13), rgba(255,255,255,0.04));
  min-width: 30px;
  margin: 0 14px;
}
.dp-step-spin {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(255,165,61,0.25);
  border-top-color: #ffa53d;
  animation: dp-spin 700ms linear infinite;
}
@keyframes dp-spin { to { transform: rotate(360deg); } }

/* CTA card */
.dp-cta-card {
  padding: 48px 32px 32px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,165,61,0.10), transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  text-align: center;
  position: relative;
  overflow: hidden;
}
.dp-cta-card::before {
  content: ""; position: absolute;
  top: 0; left: 28px; right: 28px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #ffa53d, transparent);
  opacity: 0.6;
}
.dp-cta-ico {
  width: 56px; height: 56px;
  margin: 0 auto 20px;
  border-radius: 14px;
  background: rgba(255,165,61,0.10);
  border: 1px solid rgba(255,165,61,0.30);
  display: grid; place-items: center;
  color: #ffa53d;
  box-shadow: 0 0 30px -8px rgba(255,165,61,0.4);
}
.dp-cta-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px; font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  color: #edf0f6;
}
.dp-cta-sub {
  font-size: 13.5px;
  color: #aeb4c5;
  line-height: 1.6;
  margin: 0 0 28px;
  max-width: 440px;
  margin-left: auto;
  margin-right: auto;
}
.dp-cta-meta {
  margin-top: 22px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #7a8298;
  letter-spacing: 0.06em;
  display: inline-flex; align-items: center; gap: 6px;
}

/* Buttons */
.dp-btn-primary {
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
.dp-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(255,165,61,0.6);
}
.dp-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; filter: saturate(0.6); }
.dp-arrow { transition: transform 200ms; display: inline-block; }
.dp-btn-primary:hover:not(:disabled) .dp-arrow { transform: translateX(3px); }

.dp-btn-ghost {
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
.dp-btn-ghost:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }
.dp-btn-danger-ghost {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 14px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 12.5px; font-weight: 600;
  border-radius: 9px;
  border: 1px solid rgba(255,118,118,0.35);
  background: rgba(255,118,118,0.06);
  color: #ff7676;
  cursor: pointer;
  transition: all 160ms;
}
.dp-btn-danger-ghost:hover { background: rgba(255,118,118,0.12); border-color: rgba(255,118,118,0.5); }

.dp-spinner-sm {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: dp-spin 700ms linear infinite;
  display: inline-block;
}
.dp-spin-tiny {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid rgba(255,165,61,0.25);
  border-top-color: #ffa53d;
  animation: dp-spin 700ms linear infinite;
  display: inline-block;
}

/* Deploy section */
.dp-section {
  padding: 24px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  position: relative;
  overflow: hidden;
}
.dp-section::before {
  content: ""; position: absolute;
  top: 0; left: 28px; right: 28px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,165,61,0.5), transparent);
}
.dp-deploy-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  flex-wrap: wrap;
}
.dp-deploy-status { display: flex; align-items: center; gap: 14px; }
.dp-deploy-spin {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 2.5px solid rgba(255,165,61,0.2);
  border-top-color: #ffa53d;
  animation: dp-spin 700ms linear infinite;
}
.dp-deploy-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 600; font-size: 16px;
  color: #edf0f6;
  letter-spacing: -0.01em;
  margin-bottom: 3px;
}
.dp-deploy-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #7a8298;
  letter-spacing: 0.05em;
}
.dp-conn {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 6px 12px;
  border-radius: 100px;
  border: 1px solid;
}
.dp-conn[data-state="on"] {
  color: #6ee7a0;
  border-color: rgba(110,231,160,0.30);
  background: rgba(110,231,160,0.06);
}
.dp-conn[data-state="off"] {
  color: #ff7676;
  border-color: rgba(255,118,118,0.30);
  background: rgba(255,118,118,0.06);
}
.dp-conn-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  animation: dp-pulse 1.6s ease-in-out infinite;
}
@keyframes dp-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}

/* Terminal */
.dp-term {
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  background: #07090f;
  overflow: hidden;
}
.dp-term-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.015);
}
.dp-term-dots { display: flex; gap: 6px; }
.dp-term-dots span { width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.1); }
.dp-term-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: #aeb4c5;
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dp-term-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
}
.dp-term-body {
  padding: 16px 18px;
  height: 360px;
  overflow-y: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  scroll-behavior: smooth;
}
.dp-term-body::-webkit-scrollbar { width: 8px; }
.dp-term-body::-webkit-scrollbar-track { background: transparent; }
.dp-term-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
.dp-term-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

.dp-log-line {
  display: flex; gap: 14px;
  align-items: baseline;
}
.dp-log-num {
  flex-shrink: 0;
  color: #4b5267;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  user-select: none;
  min-width: 32px;
}
.dp-log-text { flex: 1; word-break: break-word; white-space: pre-wrap; }
.dp-log-dim { color: #aeb4c5; }
.dp-log-ok  { color: #6ee7a0; }
.dp-log-add { color: #6ee7a0; }
.dp-log-mod { color: #f5d061; }
.dp-log-warn { color: #ffa53d; }
.dp-log-err { color: #ff7676; }

.dp-log-waiting {
  display: flex; align-items: center; gap: 12px;
  color: #7a8298;
  font-size: 13px;
  padding: 8px 0;
}

.dp-caret {
  display: inline-block;
  width: 8px; height: 14px;
  background: #6ee7a0;
  margin-top: 2px;
  animation: dp-blink 1s steps(2) infinite;
}
@keyframes dp-blink { 50% { opacity: 0; } }

.dp-deploy-foot {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 16px;
}

/* Result card (completed / failed) */
.dp-result-card {
  display: flex; align-items: center; gap: 16px;
  padding: 24px 26px;
  border-radius: 14px;
  border: 1px solid;
  position: relative;
  overflow: hidden;
}
.dp-result-card[data-tone="green"] {
  border-color: rgba(110,231,160,0.35);
  background:
    radial-gradient(ellipse 80% 50% at 0% 0%, rgba(110,231,160,0.10), transparent 60%),
    rgba(110,231,160,0.04);
}
.dp-result-card[data-tone="red"] {
  border-color: rgba(255,118,118,0.35);
  background:
    radial-gradient(ellipse 80% 50% at 0% 0%, rgba(255,118,118,0.10), transparent 60%),
    rgba(255,118,118,0.04);
}
.dp-result-ico {
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 11px;
  display: grid; place-items: center;
}
.dp-result-card[data-tone="green"] .dp-result-ico {
  background: rgba(110,231,160,0.15);
  border: 1px solid rgba(110,231,160,0.40);
  color: #6ee7a0;
}
.dp-result-card[data-tone="red"] .dp-result-ico {
  background: rgba(255,118,118,0.15);
  border: 1px solid rgba(255,118,118,0.40);
  color: #ff7676;
}
.dp-result-body { flex: 1; min-width: 0; }
.dp-result-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 18px;
  letter-spacing: -0.015em;
  margin-bottom: 4px;
}
.dp-result-card[data-tone="green"] .dp-result-title { color: #6ee7a0; }
.dp-result-card[data-tone="red"]   .dp-result-title { color: #ff7676; }
.dp-result-sub {
  font-size: 13.5px;
  color: #aeb4c5;
  line-height: 1.5;
}
.dp-result-spinner {
  flex-shrink: 0;
}
.dp-result-card[data-tone="green"] .dp-spinner-sm {
  border-color: rgba(110,231,160,0.25);
  border-top-color: #6ee7a0;
}
.dp-result-card[data-tone="red"] .dp-spinner-sm {
  border-color: rgba(255,118,118,0.25);
  border-top-color: #ff7676;
}

.dp-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

@media (max-width: 900px) {
  .dp-topbar { padding: 14px 20px; }
  .dp-top-left .dp-crumb-sep, .dp-top-left .dp-crumb-proj { display: none; }
  .dp-page { padding: 28px 20px 60px; }
  .dp-title { font-size: 26px; }
  .dp-steps { padding: 12px 0 20px; }
  .dp-step-connector { min-width: 16px; margin: 0 10px; }
  .dp-step-label { font-size: 12.5px; }
  .dp-term-body { height: 280px; font-size: 11.5px; }
  .dp-deploy-head { flex-direction: column; align-items: flex-start; }
}
`
