'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { FailoverResponse } from '@/types/mirror'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function FailoverPage() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()

  const [mode, setMode]               = useState<'simulation' | 'actual'>('simulation')
  const [confirmName, setConfirmName] = useState('')
  const [projectName, setProjectName] = useState('')
  const [isRunning, setIsRunning]     = useState(false)
  const [error, setError]             = useState('')
  const [failoverData, setFailoverData] = useState<FailoverResponse | null>(null)
  const [simStep, setSimStep]           = useState(-1)
  const [logs, setLogs]                 = useState<string[]>([])
  const [destroyStatus, setDestroyStatus] = useState<'idle' | 'confirming' | 'destroying' | 'destroyed' | 'failed'>('idle')
  const [destroyError, setDestroyError]   = useState('')

  const processedEventsRef = useRef(0)

  const { data: packageData } = useDRPackage(projectId)
  const latest = packageData?.latest
  const [completedFailover, setCompletedFailover] = useState<{failover_id: string, status: string} | null>(null)

  useEffect(() => {
    apiClient
      .get(`/api/mirror/${projectId}/failover-history`)
      .then((res) => {
        const history = res.data.data
        const active = history.find((fh: any) =>
          ['completed', 'destroy_failed', 'destroying'].includes(fh.status)
        )
        if (active) setCompletedFailover(active)
      })
      .catch(() => {})
  }, [projectId])

  const SIMULATION_STEPS = [
    { label: 'Terraform Init',        duration: '2초' },
    { label: 'Terraform Plan',        duration: `GCP ${
        latest?.dr_report?.confidence_summary
          ? (latest.dr_report.confidence_summary.auto + latest.dr_report.confidence_summary.review)
          : 19
      }개` },
    { label: 'Terraform Apply',       duration: '시뮬레이션' },
    { label: 'Cloud SQL 복원 예상',    duration: '3분 20초' },
    { label: 'Cloud Run 배포 예상',    duration: '2분 10초' },
    { label: 'Load Balancer 헬스체크', duration: '시뮬레이션' },
  ]

  const { events } = useWebSocket(
    failoverData ? projectId : null,
    failoverData ? failoverData.failover_id : null,
    'failover_id'
  )

  // ── 시뮬레이션 단계 진행 ─────────────────────────────────────
  useEffect(() => {
    if (!isRunning || mode !== 'simulation') return
    if (simStep >= SIMULATION_STEPS.length - 1) {
      setIsRunning(false)
      return
    }
    const timer = setTimeout(() => setSimStep((s) => s + 1), 800)
    return () => clearTimeout(timer)
  }, [isRunning, simStep, mode])

  // ── WebSocket 이벤트 (actual 모드) ───────────────────────────
  useEffect(() => {
    const newEvents = events.slice(processedEventsRef.current)
    if (!newEvents.length) return
    processedEventsRef.current = events.length

    for (const event of newEvents) {
      if (event.event_type === 'failover_progress') {
        const data = event.data as { current_resource?: string; message?: string }
        const line = data.current_resource ?? data.message
        if (line) {
          setLogs((prev) => [...prev, line])
        }
      }

      if (event.event_type === 'failover_completed') {
        const data = event.data as {
          gcp_resources_created?: number
          actual_rto_seconds?: number
        }
        setIsRunning(false)
        setLogs((prev) => [
          ...prev,
          `✅ GCP 페일오버 완료. 실제 RTO: ${
            data.actual_rto_seconds
              ? `${Math.floor(data.actual_rto_seconds / 60)}분 ${data.actual_rto_seconds % 60}초`
              : '측정 중'
          }`,
        ])
      }

      if (event.event_type === 'failover_failed') {
        const data = event.data as { error_message?: string }
        setIsRunning(false)
        setError(data.error_message ?? '페일오버 실행에 실패했습니다.')
        setLogs((prev) => [
          ...prev,
          `❌ 페일오버 실패: ${data.error_message ?? '알 수 없는 오류'}`,
        ])
      }
    }
  }, [events])

  // ── 페일오버 실행 ────────────────────────────────────────────
  const handleFailover = async () => {
    setError('')
    if (mode === 'actual' && !confirmName.trim()) {
      setError('프로젝트명을 입력하세요.')
      return
    }

    setIsRunning(true)
    setSimStep(0)
    setLogs([])
    setDestroyStatus('idle')
    setDestroyError('')
    processedEventsRef.current = 0

    try {
      const body: Record<string, string> = { mode }
      if (mode === 'actual') body.confirm_project_name = confirmName

      const res = await apiClient.post(`/api/mirror/${projectId}/failover`, body)
      setFailoverData(res.data.data)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? '페일오버 실행에 실패했습니다.'
      setError(msg)
      setIsRunning(false)
      setSimStep(-1)
    }
  }

  // ── GCP 리소스 삭제 ──────────────────────────────────────────
  const handleDestroyGcp = async () => {
    if (!failoverData) return
    setDestroyStatus('destroying')
    setDestroyError('')

    try {
      await apiClient.post(
        `/api/mirror/${projectId}/failover/${failoverData.failover_id}/destroy`
      )
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'GCP 리소스 삭제에 실패했습니다.'
      setDestroyError(msg)
      setDestroyStatus('failed')
      return
    }

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 10000))
      try {
        const res = await apiClient.get(
          `/api/mirror/${projectId}/failover/${failoverData.failover_id}`
        )
        const fh = res.data.data
        if (fh?.status === 'destroyed') {
          setDestroyStatus('destroyed')
          return
        }
        if (fh?.status === 'destroy_failed') {
          setDestroyStatus('failed')
          setDestroyError(fh.error_message ?? 'GCP 리소스 삭제에 실패했습니다.')
          return
        }
      } catch {
        // 일시적 오류 — 계속 폴링
      }
    }

    // 타임아웃 시 실제 상태 한 번 더 확인
    try {
      const res = await apiClient.get(
        `/api/mirror/${projectId}/failover/${failoverData.failover_id}`
      )
      const fh = res.data.data
      if (fh?.status === 'destroyed') {
        setDestroyStatus('destroyed')
        return
      }
    } catch {}

    setDestroyStatus('failed')
    setDestroyError('삭제 시간이 초과됐습니다. GCP 콘솔에서 직접 확인하세요.')
  }

  return (
    <>
      <style>{styles}</style>

      <div className="fo-page">

        {/* ── Header ────────────────────────────── */}
        <header className="fo-header">
          <button
            onClick={() => router.push(`/projects/${projectId}/mirror`)}
            className="fo-back"
          >
            <span className="fo-back-arrow">←</span>
            대시보드
          </button>
          <div className="fo-eyebrow">
            <span className="fo-pip" />
            MirrorOps · Failover Console
          </div>
          <h1 className="fo-title">
            <span className="fo-title-dot" />
            페일오버 콘솔
          </h1>
          <p className="fo-desc">
            AWS 장애 시 GCP DR 환경으로 트래픽을 전환합니다. 먼저 시뮬레이션으로 흐름을
            점검한 뒤, 실제 실행은 신중히 진행하세요.
          </p>
        </header>

        {/* ── DR Package 상태 ───────────────────── */}
        {latest && (
          <section className="fo-dr-strip">
            <div className="fo-dr-left">
              <div className="fo-dr-eyebrow">
                <span className="fo-pip fo-pip-blue" />
                DR Package · 최신
              </div>
              <div className="fo-dr-time">
                {new Date(latest.created_at).toLocaleString('ko-KR')}
              </div>
            </div>
            <div className="fo-dr-right">
              <span className="fo-dr-label">예상 RTO</span>
              <span className="fo-dr-rto">{latest.dr_report.rto_minutes}<span className="fo-dr-rto-unit">분</span></span>
            </div>
          </section>
        )}

        {/* ── 모드 선택 ─────────────────────────── */}
        {!isRunning && !(mode === 'actual' && !error && logs.some(l => l.includes('완료'))) && (
          <section className="fo-card fo-mode-card">
            <div className="fo-card-eyebrow">
              <span className="fo-pip fo-pip-blue" />
              Step 01 · Mode Selection
            </div>

            <div className="fo-mode-grid">
              <label className={`fo-mode-opt fo-mode-sim ${mode === 'simulation' ? 'fo-mode-on' : ''}`}>
                <input
                  type="radio"
                  value="simulation"
                  checked={mode === 'simulation'}
                  onChange={() => setMode('simulation')}
                  className="fo-radio"
                />
                <div className="fo-mode-body">
                  <div className="fo-mode-top">
                    <span className="mr-badge mr-badge-ready">SAFE</span>
                    <span className="fo-mode-pick">
                      <span className="fo-mode-dot" />
                    </span>
                  </div>
                  <div className="fo-mode-title">시뮬레이션</div>
                  <div className="fo-mode-sub">예상 흐름과 RTO를 미리 확인합니다. 실제 리소스는 생성되지 않습니다.</div>
                </div>
              </label>

              <label className={`fo-mode-opt fo-mode-actual ${mode === 'actual' ? 'fo-mode-on' : ''}`}>
                <input
                  type="radio"
                  value="actual"
                  checked={mode === 'actual'}
                  onChange={() => setMode('actual')}
                  className="fo-radio"
                />
                <div className="fo-mode-body">
                  <div className="fo-mode-top">
                    <span className="mr-badge mr-badge-failed">DESTRUCTIVE</span>
                    <span className="fo-mode-pick">
                      <span className="fo-mode-dot" />
                    </span>
                  </div>
                  <div className="fo-mode-title">실제 페일오버 실행</div>
                  <div className="fo-mode-sub">GCP us-west1에 실제 인프라가 생성됩니다. 되돌리기 어렵습니다.</div>
                </div>
              </label>
            </div>

            {mode === 'actual' && (
              <div className="fo-confirm-block">
                <div className="fo-confirm-head">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  실제 페일오버 — 안전 확인
                </div>
                <p className="fo-confirm-line">GCP us-west1에 실제로 인프라가 생성됩니다. 이 작업은 되돌리기 어렵습니다.</p>

                <div className="fo-confirm-input-wrap">
                  <div className="fo-confirm-label">확인을 위해 프로젝트명을 정확히 입력하세요</div>
                  <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={projectName || '프로젝트명 입력'}
                    className="fo-input"
                  />
                  {projectName && (
                    <p className="fo-confirm-hint">
                      입력해야 할 값: <span className="fo-confirm-target">{projectName}</span>
                    </p>
                  )}
                </div>

                <div className="fo-confirm-meta">
                  <span className="fo-meta-k">TARGET REGION</span>
                  <span className="fo-meta-v">us-west1 (오레곤) · 고정</span>
                </div>
              </div>
            )}

            {error && (
              <div className="fo-error">
                <span className="fo-error-dot" />
                {error}
              </div>
            )}

            <button
              className={`fo-run-btn ${mode === 'actual' ? 'mr-btn-danger fo-run-danger' : 'mr-btn-primary fo-run-primary'}`}
              onClick={handleFailover}
            >
              {mode === 'simulation' ? (
                <>
                  <span className="fo-run-glyph">▶</span>
                  <span>시뮬레이션 시작</span>
                </>
              ) : (
                <>
                  <span className="fo-run-pulse" />
                  <span>페일오버 실행</span>
                  <span className="fo-run-arrow">→</span>
                </>
              )}
            </button>
          </section>
        )}

        {/* ── 시뮬레이션 진행 ───────────────────── */}
        {(isRunning || simStep >= 0) && mode === 'simulation' && (
          <section className="fo-card fo-sim-card">
            <div className="fo-card-eyebrow">
              <span className="fo-pip" />
              {isRunning ? '시뮬레이션 진행 중' : '시뮬레이션 완료'}
            </div>
            <h2 className="fo-card-title">예상 페일오버 흐름</h2>

            <div className="fo-timeline">
              {SIMULATION_STEPS.map((step, i) => {
                const isDone    = i < simStep
                const isCurrent = i === simStep && isRunning
                const isFinal   = !isRunning && i === simStep && i >= SIMULATION_STEPS.length - 1
                const done      = isDone || isFinal
                return (
                  <div key={i} className={`fo-tl-row ${done ? 'fo-tl-done' : ''} ${isCurrent ? 'fo-tl-current' : ''}`}>
                    <div className="fo-tl-node">
                      {done ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : isCurrent ? (
                        <span className="fo-tl-pulse" />
                      ) : (
                        <span className="fo-tl-num">{String(i + 1).padStart(2, '0')}</span>
                      )}
                    </div>
                    <div className="fo-tl-body">
                      <div className="fo-tl-label">{step.label}</div>
                      <div className="fo-tl-sub">
                        {isCurrent ? '실행 중 …' : step.duration}
                      </div>
                    </div>
                    {done && (
                      <div className="fo-tl-time">{step.duration}</div>
                    )}
                  </div>
                )
              })}
            </div>

            {!isRunning && simStep >= SIMULATION_STEPS.length - 1 && (
              <div className="fo-sim-result">
                <div>
                  <div className="fo-sim-result-label">총 예상 RTO</div>
                  <div className="fo-sim-result-value">
                    약 {latest?.dr_report?.rto_minutes ?? 15}<span className="fo-sim-result-unit">분</span>
                  </div>
                </div>
                <span className="mr-badge mr-badge-ready">SIMULATION OK</span>
              </div>
            )}
          </section>
        )}

        {/* ── actual 실행 중 ───────────────────── */}
        {isRunning && mode === 'actual' && (
          <section className="fo-terminal">
            <div className="fo-term-bar">
              <div className="fo-term-lights">
                <span className="fo-term-light fo-tl-red" />
                <span className="fo-term-light fo-tl-yel" />
                <span className="fo-term-light fo-tl-grn" />
              </div>
              <div className="fo-term-title">
                <span className="fo-term-rec" />
                LIVE · GCP us-west1 — 페일오버 실행 중
              </div>
              <span className="mr-badge mr-badge-syncing">SYNCING</span>
            </div>
            <div className="fo-term-body">
              {logs.length === 0 ? (
                <p className="fo-term-wait">
                  <span className="fo-term-prompt">$</span> GCP 리소스 생성 대기 중<span className="fo-term-dots">…</span>
                </p>
              ) : (
                logs.map((log, i) => (
                  <p key={i} className="fo-term-line">
                    <span className="fo-term-prompt">›</span>
                    <span className="fo-term-text">{log}</span>
                  </p>
                ))
              )}
            </div>
          </section>
        )}

        {/* ── actual 완료/실패 후 ─────────────── */}
        {!isRunning && mode === 'actual' && (logs.length > 0 || completedFailover) && (
          <div className="fo-stack">

            {/* 결과 로그 */}
            <section className="fo-terminal">
              <div className="fo-term-bar">
                <div className="fo-term-lights">
                  <span className="fo-term-light fo-tl-red" />
                  <span className="fo-term-light fo-tl-yel" />
                  <span className="fo-term-light fo-tl-grn" />
                </div>
                <div className="fo-term-title">
                  {error ? (
                    <><span className="fo-term-rec fo-term-rec-red" /> FAILED · GCP us-west1</>
                  ) : (
                    <><span className="fo-term-rec fo-term-rec-green" /> COMPLETED · GCP us-west1</>
                  )}
                </div>
                <span className={`mr-badge ${error ? 'mr-badge-failed' : 'mr-badge-ready'}`}>
                  {error ? 'FAILED' : 'READY'}
                </span>
              </div>
              <div className="fo-term-body fo-term-body-short">
                {logs.map((log, i) => (
                  <p key={i} className={`fo-term-line ${error ? 'fo-term-line-err' : ''}`}>
                    <span className="fo-term-prompt">›</span>
                    <span className="fo-term-text">{log}</span>
                  </p>
                ))}
              </div>
            </section>

            {/* GCP 리소스 관리 */}
            <section className="fo-card fo-danger-card">
              <div className="fo-card-eyebrow fo-eyebrow-red">
                <span className="fo-pip fo-pip-red" />
                Danger Zone · GCP 리소스 관리
              </div>
              <h2 className="fo-card-title">GCP DR 리소스 정리</h2>
              <p className="fo-card-desc">
                {error
                  ? '페일오버 실패로 인해 일부 GCP 리소스가 생성됐을 수 있습니다. 삭제하여 비용을 절감하세요.'
                  : '페일오버 검증이 완료됐다면 GCP 리소스를 삭제해 비용을 절감하세요.'}
              </p>

              {destroyStatus === 'idle' && (
                <Button
                  variant="outline"
                  className="fo-destroy-btn"
                  onClick={() => setDestroyStatus('confirming')}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                  </svg>
                  GCP 리소스 삭제
                </Button>
              )}

              {destroyStatus === 'confirming' && (
                <div className="fo-confirm-destroy">
                  <p className="fo-confirm-destroy-line">
                    <strong>주의</strong> · GCP에 생성된 모든 리소스가 삭제됩니다. 계속하시겠습니까?
                  </p>
                  <div className="fo-confirm-actions">
                    <Button
                      size="sm"
                      className="mr-btn-danger fo-btn-destroy-go"
                      onClick={handleDestroyGcp}
                    >
                      삭제 확인
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="fo-btn-cancel"
                      onClick={() => setDestroyStatus('idle')}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}

              {destroyStatus === 'destroying' && (
                <div className="fo-destroy-status fo-destroy-progress">
                  <span className="fo-spinner" />
                  <div>
                    <div className="fo-destroy-title">GCP 리소스 삭제 중</div>
                    <div className="fo-destroy-sub">약 5~10분 소요 · 진행 상황을 폴링합니다</div>
                  </div>
                </div>
              )}

              {destroyStatus === 'destroyed' && (
                <div className="fo-destroy-status fo-destroy-ok">
                  <div className="fo-destroy-ok-ico">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div>
                    <div className="fo-destroy-title">GCP 리소스가 모두 삭제됐습니다</div>
                    <div className="fo-destroy-sub">비용 발생이 중단됐습니다</div>
                  </div>
                </div>
              )}

              {destroyStatus === 'failed' && (
                <div className="fo-destroy-fail">
                  <div className="fo-destroy-fail-head">
                    <span className="fo-error-dot" />
                    삭제에 실패했습니다
                  </div>
                  {destroyError && (
                    <pre className="fo-destroy-fail-msg">{destroyError}</pre>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="fo-destroy-btn"
                    onClick={() => {
                      setDestroyStatus('confirming')
                      setDestroyError('')
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    삭제 재시도
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ── 시뮬레이션 다시 ───────────────────── */}
        {!isRunning && simStep >= SIMULATION_STEPS.length - 1 && (
          <div className="fo-foot-row">
            <Button
              variant="outline"
              className="fo-btn-ghost"
              onClick={() => {
                setSimStep(-1)
                setFailoverData(null)
              }}
            >
              <span className="fo-back-arrow">↻</span>
              다시 시뮬레이션
            </Button>
          </div>
        )}

        {/* ── actual 완료/실패 푸터 ───────────── */}
        {!isRunning && mode === 'actual' && (error || logs.some(l => l.includes('완료'))) && (
          <div className="fo-foot-row">
            <Button
              variant="outline"
              className="fo-btn-ghost"
              onClick={() => router.push(`/projects/${projectId}/mirror`)}
            >
              <span className="fo-back-arrow">←</span>
              대시보드로
            </Button>
            {error && (
              <Button
                variant="outline"
                className="fo-btn-retry"
                onClick={() => {
                  setError('')
                  setLogs([])
                  setFailoverData(null)
                  setDestroyStatus('idle')
                  setDestroyError('')
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                페일오버 재시도
              </Button>
            )}
          </div>
        )}

      </div>
    </>
  )
}

// ─── styles ─────────────────────────────────────────────────────
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

.fo-page {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: #edf0f6;
  max-width: 880px;
  margin: 0 auto;
  padding: 40px 36px 80px;
  display: flex; flex-direction: column; gap: 20px;
}

/* ── Header ─────────────────────────────────── */
.fo-header { display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
.fo-back {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none;
  color: #aeb4c5;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  padding: 6px 0;
  transition: color 160ms;
  margin-bottom: 6px;
}
.fo-back:hover { color: #edf0f6; }
.fo-back:hover .fo-back-arrow { transform: translateX(-3px); }
.fo-back-arrow { transition: transform 200ms; display: inline-block; }

.fo-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #ef4444;
  padding: 5px 11px;
  border: 1px solid rgba(239,68,68,0.32);
  border-radius: 100px;
  background: rgba(239,68,68,0.06);
  align-self: flex-start;
}
.fo-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ef4444; box-shadow: 0 0 8px #ef4444;
  animation: fo-pulse 1.4s ease-in-out infinite;
}
.fo-pip-blue { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
.fo-pip-red  { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
@keyframes fo-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(0.8); }
}

.fo-title {
  display: flex; align-items: center; gap: 14px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 6px 0 8px;
  color: #edf0f6;
}
.fo-title-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239,68,68,0.16), 0 0 24px rgba(239,68,68,0.5);
  animation: fo-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
.fo-desc {
  font-size: 15px; color: #aeb4c5;
  line-height: 1.6; margin: 0; max-width: 680px;
}

/* ── DR Package strip ───────────────────────── */
.fo-dr-strip {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 16px 22px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
}
.fo-dr-left { display: flex; flex-direction: column; gap: 4px; }
.fo-dr-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #5aa3ff;
}
.fo-dr-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px; color: #edf0f6;
  letter-spacing: 0.02em;
}
.fo-dr-right { display: flex; align-items: baseline; gap: 10px; }
.fo-dr-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #aeb4c5;
}
.fo-dr-rto {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 26px;
  letter-spacing: -0.02em;
  color: #6ee7a0;
}
.fo-dr-rto-unit { font-size: 14px; margin-left: 2px; color: #6ee7a0; font-weight: 600; }

/* ── Card ───────────────────────────────────── */
.fo-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 26px 28px;
  display: flex; flex-direction: column; gap: 16px;
}
.fo-card-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
}
.fo-eyebrow-red { color: #ef4444; }
.fo-card-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 20px;
  letter-spacing: -0.02em;
  color: #edf0f6;
  margin: 0;
}
.fo-card-desc {
  font-size: 13.5px; color: #aeb4c5;
  line-height: 1.6; margin: 0;
}

/* ── Mode grid ──────────────────────────────── */
.fo-mode-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fo-mode-opt {
  position: relative;
  display: block;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.004));
  padding: 18px 20px;
  cursor: pointer;
  transition: all 200ms;
  overflow: hidden;
}
.fo-mode-opt::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px;
  background: transparent;
  transition: background 200ms;
}
.fo-mode-opt:hover { border-color: rgba(255,255,255,0.22); }
.fo-mode-on { border-color: rgba(255,255,255,0.28); background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.008)); }
.fo-mode-sim.fo-mode-on { border-color: rgba(110,231,160,0.5); box-shadow: 0 0 0 1px rgba(110,231,160,0.18), 0 0 28px rgba(110,231,160,0.10); }
.fo-mode-sim.fo-mode-on::before { background: #6ee7a0; box-shadow: 0 0 12px rgba(110,231,160,0.6); }
.fo-mode-actual.fo-mode-on { border-color: rgba(239,68,68,0.5); box-shadow: 0 0 0 1px rgba(239,68,68,0.18), 0 0 28px rgba(239,68,68,0.10); }
.fo-mode-actual.fo-mode-on::before { background: #ef4444; box-shadow: 0 0 12px rgba(239,68,68,0.6); }
.fo-radio { position: absolute; opacity: 0; pointer-events: none; }
.fo-mode-body { display: flex; flex-direction: column; gap: 10px; }
.fo-mode-top { display: flex; align-items: center; justify-content: space-between; }
.fo-mode-pick {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.22);
  display: grid; place-items: center;
  transition: all 180ms;
}
.fo-mode-dot { width: 8px; height: 8px; border-radius: 50%; background: transparent; transition: background 180ms; }
.fo-mode-sim.fo-mode-on .fo-mode-pick { border-color: #6ee7a0; }
.fo-mode-sim.fo-mode-on .fo-mode-dot { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; }
.fo-mode-actual.fo-mode-on .fo-mode-pick { border-color: #ef4444; }
.fo-mode-actual.fo-mode-on .fo-mode-dot { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
.fo-mode-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 16px; font-weight: 700;
  letter-spacing: -0.015em;
  color: #edf0f6;
}
.fo-mode-sub {
  font-size: 12.5px; color: #aeb4c5;
  line-height: 1.55;
}

/* ── Badges (mr-badge spec) ─────────────────── */
.mr-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: 100px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.mr-badge-ready     { background: rgba(110,231,160,0.12); color: #6ee7a0; border: 1px solid rgba(110,231,160,0.4); }
.mr-badge-syncing   { background: rgba(90,163,255,0.12);  color: #5aa3ff; border: 1px solid rgba(90,163,255,0.4); }
.mr-badge-preparing { background: rgba(255,165,61,0.12);  color: #ffa53d; border: 1px solid rgba(255,165,61,0.4); }
.mr-badge-failed    { background: rgba(239,68,68,0.12);   color: #ef4444; border: 1px solid rgba(239,68,68,0.4); }

/* ── Confirm block (actual) ─────────────────── */
.fo-confirm-block {
  border-radius: 12px;
  border: 1px solid rgba(239,68,68,0.28);
  background: linear-gradient(180deg, rgba(239,68,68,0.06), rgba(239,68,68,0.015));
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 14px;
}
.fo-confirm-head {
  display: flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #ef4444;
}
.fo-confirm-line { font-size: 13px; color: #edf0f6; margin: 0; line-height: 1.55; }
.fo-confirm-input-wrap { display: flex; flex-direction: column; gap: 6px; }
.fo-confirm-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #aeb4c5;
}
.fo-input {
  background: rgba(0,0,0,0.4) !important;
  border: 1px solid rgba(239,68,68,0.32) !important;
  color: #edf0f6 !important;
  padding: 11px 14px !important;
  border-radius: 10px !important;
  font-family: 'JetBrains Mono', ui-monospace, monospace !important;
  font-size: 13px !important;
}
.fo-input::placeholder { color: #7a8298 !important; }
.fo-input:focus {
  outline: none !important;
  border-color: rgba(239,68,68,0.6) !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,0.14) !important;
}
.fo-confirm-hint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  margin: 2px 0 0;
}
.fo-confirm-target { color: #ffa53d; font-weight: 600; }
.fo-confirm-meta {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid rgba(239,68,68,0.18);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.fo-meta-k { font-size: 10px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: #7a8298; }
.fo-meta-v { font-size: 12px; color: #edf0f6; letter-spacing: 0.02em; }

/* ── Error ──────────────────────────────────── */
.fo-error {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.06);
  font-size: 13px; color: #ef4444;
}
.fo-error-dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444; flex-shrink: 0; }

/* ── Run button ─────────────────────────────── */
.fo-run-btn {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  width: 100%;
  padding: 16px 24px;
  border-radius: 12px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: all 200ms;
  margin-top: 4px;
}
.fo-run-primary {
  border: 1px solid rgba(255,255,255,0.18);
  background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.025));
  color: #edf0f6;
}
.fo-run-primary:hover { transform: translateY(-1px); border-color: rgba(110,231,160,0.5); box-shadow: 0 8px 30px -8px rgba(110,231,160,0.3); }
.fo-run-glyph { color: #6ee7a0; font-size: 12px; }
.fo-run-danger {
  background: linear-gradient(180deg, #dc2626, #b91c1c);
  border: 1px solid rgba(220,38,38,0.5);
  color: #fff;
  box-shadow: 0 0 24px rgba(220,38,38,0.2);
}
.fo-run-danger:hover { transform: translateY(-1px); box-shadow: 0 0 36px rgba(220,38,38,0.4); }
.fo-run-pulse {
  width: 9px; height: 9px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 12px #fff;
  animation: fo-pulse 1s ease-in-out infinite;
}
.fo-run-arrow { transition: transform 200ms; display: inline-block; }
.fo-run-danger:hover .fo-run-arrow { transform: translateX(4px); }

/* ── Simulation timeline ────────────────────── */
.fo-timeline { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.fo-tl-row {
  position: relative;
  display: flex; align-items: center; gap: 16px;
  padding: 10px 4px;
}
.fo-tl-row:not(:last-child)::after {
  content: ""; position: absolute;
  left: 14px; top: 38px; height: 14px; width: 1px;
  background: linear-gradient(180deg, rgba(255,255,255,0.16), transparent);
}
.fo-tl-done:not(:last-child)::after { background: linear-gradient(180deg, rgba(110,231,160,0.4), transparent); }
.fo-tl-current:not(:last-child)::after { background: linear-gradient(180deg, rgba(255,165,61,0.4), transparent); }
.fo-tl-node {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
  color: #7a8298;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.04em;
  transition: all 220ms;
}
.fo-tl-done .fo-tl-node {
  border-color: rgba(110,231,160,0.5);
  background: rgba(110,231,160,0.14);
  color: #6ee7a0;
}
.fo-tl-current .fo-tl-node {
  border-color: #ffa53d;
  background: rgba(255,165,61,0.14);
  color: #ffa53d;
  box-shadow: 0 0 0 4px rgba(255,165,61,0.12), 0 0 20px rgba(255,165,61,0.3);
}
.fo-tl-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 10px #ffa53d;
  animation: fo-pulse 1s ease-in-out infinite;
}
.fo-tl-body { flex: 1; min-width: 0; }
.fo-tl-label {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  color: #aeb4c5; letter-spacing: -0.005em;
  transition: color 200ms;
}
.fo-tl-done .fo-tl-label, .fo-tl-current .fo-tl-label { color: #edf0f6; }
.fo-tl-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.04em;
  margin-top: 1px;
}
.fo-tl-current .fo-tl-sub { color: #ffa53d; }
.fo-tl-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #6ee7a0;
  letter-spacing: 0.04em;
}

.fo-sim-result {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  margin-top: 8px;
  border-radius: 12px;
  border: 1px solid rgba(110,231,160,0.32);
  background: linear-gradient(135deg, rgba(110,231,160,0.10), rgba(110,231,160,0.02));
}
.fo-sim-result-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #6ee7a0;
}
.fo-sim-result-value {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 26px;
  letter-spacing: -0.02em;
  color: #edf0f6;
  margin-top: 4px;
}
.fo-sim-result-unit { font-size: 14px; color: #6ee7a0; margin-left: 4px; font-weight: 600; }

/* ── Terminal ───────────────────────────────── */
.fo-terminal {
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: #060810;
  overflow: hidden;
  display: flex; flex-direction: column;
}
.fo-term-bar {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px;
  background: linear-gradient(180deg, #15171f, #101218);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.fo-term-lights { display: flex; gap: 7px; }
.fo-term-light { width: 10px; height: 10px; border-radius: 50%; }
.fo-tl-red { background: #ff5f57; }
.fo-tl-yel { background: #febc2e; }
.fo-tl-grn { background: #28c840; }
.fo-term-title {
  flex: 1;
  display: inline-flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: 0.06em;
  color: #aeb4c5;
}
.fo-term-rec {
  width: 7px; height: 7px; border-radius: 50%;
  background: #ef4444; box-shadow: 0 0 8px #ef4444;
  animation: fo-pulse 1.2s ease-in-out infinite;
}
.fo-term-rec-red { background: #ef4444; box-shadow: 0 0 8px #ef4444; animation: none; }
.fo-term-rec-green { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; animation: none; }

.fo-term-body {
  padding: 16px 20px;
  height: 240px;
  overflow-y: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.018), transparent 80px),
    #060810;
  display: flex; flex-direction: column; gap: 2px;
}
.fo-term-body-short { height: 160px; }
.fo-term-body::-webkit-scrollbar { width: 8px; }
.fo-term-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
.fo-term-wait { color: #7a8298; margin: 0; }
.fo-term-dots { animation: fo-blink 1.2s infinite; }
@keyframes fo-blink { 50% { opacity: 0.3; } }
.fo-term-line {
  margin: 0;
  display: flex; gap: 10px;
  color: #6ee7a0;
}
.fo-term-line-err { color: #ef4444; }
.fo-term-prompt { color: #5aa3ff; font-weight: 600; flex-shrink: 0; }
.fo-term-line-err .fo-term-prompt { color: #ef4444; }
.fo-term-text { word-break: break-word; }

/* ── Danger card ────────────────────────────── */
.fo-danger-card {
  border-color: rgba(239,68,68,0.28);
  background: linear-gradient(180deg, rgba(239,68,68,0.04), rgba(239,68,68,0.008));
}

.fo-destroy-btn {
  display: inline-flex !important; align-items: center !important; gap: 8px !important;
  align-self: flex-start !important;
  padding: 10px 16px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  border: 1px solid rgba(239,68,68,0.4) !important;
  background: rgba(239,68,68,0.08) !important;
  color: #ef4444 !important;
  cursor: pointer;
  transition: all 160ms;
}
.fo-destroy-btn:hover { background: rgba(239,68,68,0.16) !important; border-color: rgba(239,68,68,0.6) !important; color: #ff8080 !important; }

.fo-confirm-destroy {
  border-radius: 12px;
  border: 1px solid rgba(239,68,68,0.4);
  background: rgba(239,68,68,0.08);
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 12px;
}
.fo-confirm-destroy-line {
  font-size: 13px; color: #edf0f6;
  margin: 0; line-height: 1.55;
}
.fo-confirm-destroy-line strong {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #ef4444;
  margin-right: 4px;
}
.fo-confirm-actions { display: flex; gap: 8px; }

.mr-btn-danger {
  padding: 10px 18px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  background: linear-gradient(180deg, #dc2626, #b91c1c) !important;
  border: 1px solid rgba(220,38,38,0.5) !important;
  color: #fff !important;
  box-shadow: 0 0 24px rgba(220,38,38,0.2);
  cursor: pointer;
  transition: all 180ms;
}
.mr-btn-danger:hover { filter: brightness(1.1); box-shadow: 0 0 32px rgba(220,38,38,0.35); }
.fo-btn-destroy-go {}

.fo-btn-cancel {
  padding: 10px 16px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 500 !important;
  border: 1px solid rgba(255,255,255,0.13) !important;
  background: transparent !important;
  color: #aeb4c5 !important;
  cursor: pointer;
}
.fo-btn-cancel:hover { background: rgba(255,255,255,0.04) !important; color: #edf0f6 !important; }

.fo-destroy-status {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid;
}
.fo-destroy-progress {
  border-color: rgba(255,165,61,0.32);
  background: linear-gradient(135deg, rgba(255,165,61,0.08), rgba(255,165,61,0.02));
}
.fo-destroy-ok {
  border-color: rgba(110,231,160,0.32);
  background: linear-gradient(135deg, rgba(110,231,160,0.08), rgba(110,231,160,0.02));
}
.fo-destroy-ok-ico {
  width: 30px; height: 30px; border-radius: 50%;
  background: rgba(110,231,160,0.18);
  color: #6ee7a0;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.fo-destroy-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  color: #edf0f6; letter-spacing: -0.005em;
}
.fo-destroy-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.fo-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid rgba(255,165,61,0.18);
  border-top-color: #ffa53d;
  animation: fo-spin 700ms linear infinite;
  flex-shrink: 0;
}
@keyframes fo-spin { to { transform: rotate(360deg); } }

.fo-destroy-fail {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(239,68,68,0.32);
  background: rgba(239,68,68,0.06);
}
.fo-destroy-fail-head {
  display: flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #ef4444;
}
.fo-destroy-fail-msg {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; line-height: 1.55;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(239,68,68,0.18);
  border-radius: 8px;
  padding: 10px 12px;
  color: #ef4444;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── Stack & foot ───────────────────────────── */
.fo-stack { display: flex; flex-direction: column; gap: 16px; }
.fo-foot-row { display: flex; gap: 10px; margin-top: 4px; }
.fo-btn-ghost {
  display: inline-flex !important; align-items: center !important; gap: 8px !important;
  padding: 10px 14px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 500 !important;
  border: 1px solid rgba(255,255,255,0.13) !important;
  background: transparent !important;
  color: #aeb4c5 !important;
  cursor: pointer;
  transition: all 160ms;
}
.fo-btn-ghost:hover { color: #edf0f6 !important; background: rgba(255,255,255,0.04) !important; }
.fo-btn-retry {
  display: inline-flex !important; align-items: center !important; gap: 8px !important;
  padding: 10px 14px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  border: 1px solid rgba(255,165,61,0.4) !important;
  background: rgba(255,165,61,0.08) !important;
  color: #ffa53d !important;
  cursor: pointer;
  transition: all 160ms;
}
.fo-btn-retry:hover { background: rgba(255,165,61,0.16) !important; border-color: rgba(255,165,61,0.6) !important; }

/* ── Responsive ─────────────────────────────── */
@media (max-width: 700px) {
  .fo-page { padding: 32px 20px 80px; gap: 16px; }
  .fo-mode-grid { grid-template-columns: 1fr; }
  .fo-title { font-size: 28px; }
  .fo-dr-strip { flex-direction: column; align-items: flex-start; gap: 10px; }
  .fo-dr-right { align-self: stretch; justify-content: space-between; }
}
`
