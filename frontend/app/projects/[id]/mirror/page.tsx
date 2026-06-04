// frontend/app/projects/[id]/mirror/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useDRStatus, useSyncHistory } from '@/hooks/useMirrorOps'

type DrTone = 'green' | 'blue' | 'mute'
const DR_STATUS_CONFIG: Record<string, { label: string; tone: DrTone }> = {
  ready:     { label: '준비 완료',    tone: 'green' },
  syncing:   { label: '동기화 중',    tone: 'blue' },
  not_ready: { label: '동기화 필요',  tone: 'mute' },
}

type PkgTone = 'green' | 'yellow' | 'red'
const PACKAGE_STATUS_CONFIG: Record<string, { label: string; tone: PkgTone }> = {
  ready:     { label: '준비 완료',                            tone: 'green' },
  preparing: { label: '준비 중 (DB 스냅샷 Export 진행 중...)', tone: 'yellow' },
  failed:    { label: '생성 실패',                            tone: 'red' },
}

const TRIGGER_LABEL: Record<string, string> = {
  deployment_completed: '배포 완료',
  infra_changed:        '인프라 변경',
  manual:               '수동 동기화',
}

interface ProjectInfo {
  name: string
  region?: string
  prefix?: string
  environment?: string
  status?: string
}

interface FailoverRecord {
  failover_id:           string
  mode:                  string
  status:                string
  gcp_region:            string
  gcp_resources_created: number | null
  actual_rto_seconds:    number | null
  error_message:         string | null
  started_at:            string
  completed_at:          string | null
}

export default function MirrorDashboardPage() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()

  const { data: drStatus, isLoading, error, refetch } = useDRStatus(projectId)
  const { data: history } = useSyncHistory(projectId)

  const [project, setProject]             = useState<ProjectInfo | null>(null)
  const [syncError, setSyncError]         = useState<string | null>(null)
  const [isSyncing, setIsSyncing]         = useState(false)

  // ── GCP 연동 상태 ────────────────────────────────────────────────
  const [isConnected, setIsConnected]       = useState<boolean | null>(null)
  const [showNotConnected, setShowNotConnected] = useState(false)

  // ── GCP 리소스 관리 상태 ─────────────────────────────────────────
  const [latestFailover, setLatestFailover]   = useState<FailoverRecord | null>(null)
  const [destroyStatus, setDestroyStatus] = useState<'idle' | 'confirming' | 'destroying' | 'destroyed' | 'failed'>('idle')
  const [destroyError, setDestroyError]       = useState('')

  useEffect(() => {
    apiClient
      .get(`/api/projects/${projectId}`)
      .then((res) => setProject(res.data.data))
      .catch(() => {})
  }, [projectId])

  // GCP 연동 상태 조회 — 페이지 진입 시 is_connected 확인
  useEffect(() => {
    apiClient
      .get(`/api/projects/${projectId}/gcp/status`)
      .then((res) => setIsConnected(Boolean(res.data?.data?.is_connected)))
      .catch(() => setIsConnected(false))
  }, [projectId])

  // 페일오버 이력 조회 — 페이지 진입 시 GCP 리소스 상태 복원
  const fetchLatestFailover = useCallback(async () => {
    try {
      const res  = await apiClient.get(`/api/mirror/${projectId}/failover-history`)
      const list: FailoverRecord[] = res.data.data ?? []
      const latest = list.find((f) => f.mode === 'actual') ?? null
      setLatestFailover(latest)

      if (latest?.status === 'completed') setDestroyStatus('idle')
      else if (latest?.status === 'destroying') setDestroyStatus('destroying')
      else if (latest?.status === 'destroyed') setDestroyStatus('destroyed')
      else if (latest?.status === 'destroy_failed') {
        setDestroyStatus('failed')
        setDestroyError(latest.error_message ?? 'GCP 리소스 삭제에 실패했습니다.')
      }
    } catch {
      // 이력 없음
    }
  }, [projectId])

  useEffect(() => { fetchLatestFailover() }, [fetchLatestFailover])

  useEffect(() => {
    if (destroyStatus !== 'failed') return
    const timer = setTimeout(async () => {
      await fetchLatestFailover()
    }, 3000)
    return () => clearTimeout(timer)
  }, [destroyStatus, fetchLatestFailover])

  // ── GCP 리소스 삭제 ──────────────────────────────────────────────
  const handleDestroyGcp = async () => {
    if (!latestFailover) return
    const failoverId = latestFailover.failover_id
    setDestroyStatus('destroying')
    setDestroyError('')

    try {
      await apiClient.post(
        `/api/mirror/${projectId}/failover/${failoverId}/destroy`
      )
    } catch (err: unknown) {
      const status = (err as any)?.response?.status

      if (status === 409) {
        await fetchLatestFailover()
        return
      }

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
          `/api/mirror/${projectId}/failover/${failoverId}`
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
        // 컨테이너 교체 등 일시적 오류 — 계속 폴링
      }
    }

    await fetchLatestFailover()
  }

  const handleManualSync = async () => {
    setSyncError(null)
    setIsSyncing(true)
    try {
      await apiClient.post(`/api/mirror/${projectId}/sync`)
      refetch()
    } catch (err: unknown) {
      // GCP_NOT_CONNECTED (400) → 연동 안내 배너 표시 (추가)
      const code =
        (err as { response?: { data?: { error?: { code?: string } } } })
          ?.response?.data?.error?.code
      const httpStatus = (err as { response?: { status?: number } })?.response?.status
      if (code === 'GCP_NOT_CONNECTED' || httpStatus === 400) {
        setIsConnected(false)
        setShowNotConnected(true)
      }
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? '동기화 요청에 실패했습니다.'
      setSyncError(msg)
    } finally {
      setIsSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <>
        <style>{styles}</style>
        <div className="mr-loading">
          <span className="mr-spinner" />
          <span>loading DR status</span>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{styles}</style>
        <Topbar projectName={project?.name} onBack={() => router.push(`/dashboard`)} />
        <div className="mr-page">
          <div className="mr-error-block">
            <div className="mr-error-ico">!</div>
            <div>
              <div className="mr-error-title">DR 상태를 불러올 수 없습니다</div>
              <div className="mr-error-msg">{error}</div>
              <button className="mr-btn mr-btn-ghost mr-mt" onClick={refetch}>
                <span className="mr-arrow">↻</span>
                다시 시도
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  const statusKey       = drStatus?.dr_status ?? 'not_ready'
  const statusConfig    = DR_STATUS_CONFIG[statusKey] ?? DR_STATUS_CONFIG.not_ready
  const pkg             = drStatus?.dr_package
  const pkgStatusConfig = pkg?.status ? PACKAGE_STATUS_CONFIG[pkg.status] : null

  const awsRegion = project?.region ?? 'us-west-2'
  const drReady   = statusKey === 'ready'

  // GCP 리소스 관리 섹션 표시 조건
  const showGcpManagement = latestFailover &&
    ['completed', 'failed', 'destroying', 'destroyed', 'destroy_failed'].includes(latestFailover.status)

  const goToConnect = () => router.push(`/projects/${projectId}/gcp-connect`)

  return (
    <>
      <style>{styles}</style>
      <Topbar projectName={project?.name} onBack={() => router.push(`/dashboard`)} />

      <div className="mr-page">

        {/* Page header */}
        <div className="mr-head">
          <div className="mr-head-block">
            <div className="mr-eyebrow">
              <span className="mr-pip" />
              MirrorOps · GCP DR
            </div>
            <h1 className="mr-title">{project?.name ?? '프로젝트 로딩 중'}</h1>
            <p className="mr-sub">
              {awsRegion} 리전 기준 실시간 인프라 동기화 현황입니다.
            </p>
          </div>

          {/* Sync 버튼 — GCP 연동 상태에 따라 활성/비활성 */}
          <div className="mr-sync-wrap">
            <button
              className="mr-btn mr-btn-secondary"
              onClick={handleManualSync}
              disabled={isSyncing || project?.status !== 'completed' || isConnected === false || drStatus?.dr_status === 'syncing'}
            >
              {isSyncing ? (
                <>
                  <span className="mr-spinner-sm" />
                  <span>동기화 중...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
                  </svg>
                  <span>{isConnected === null ? '로딩 중...' : isConnected ? 'DR 패키지 생성' : 'GCP 연동 필요'}</span>
                </>
              )}
            </button>

            {isConnected === false && (
              <div className="mr-sync-hint">
                <span className="mr-sync-hint-text">GCP 연동 후 DR 패키지를 생성할 수 있습니다.</span>
                <button className="mr-sync-link" onClick={goToConnect}>
                  GCP 연동하기 <span className="mr-arrow">→</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* GCP_NOT_CONNECTED 인라인 에러 배너 */}
        {showNotConnected && (
          <div className="mr-gcp-banner">
            <span className="mr-gcp-banner-ico">⚠️</span>
            <div className="mr-gcp-banner-body">
              <div className="mr-gcp-banner-title">GCP 계정 연동이 필요합니다.</div>
              <div className="mr-gcp-banner-desc">
                MirrorOps Sync와 Failover를 사용하려면 GCP 계정을 먼저 연동해야 합니다.
              </div>
              <button className="mr-gcp-banner-cta" onClick={goToConnect}>
                GCP 연동하기 <span className="mr-arrow">→</span>
              </button>
            </div>
            <button
              className="mr-gcp-banner-close"
              onClick={() => setShowNotConnected(false)}
              aria-label="닫기"
            >
              ✕
            </button>
          </div>
        )}

        {/* Sync error */}
        {syncError && (
          <div className="mr-alert">
            <span className="mr-alert-ico">!</span>
            <span>{syncError}</span>
          </div>
        )}

        {/* GCP 리소스 관리 섹션 */}
        {showGcpManagement && (
          <div className="mr-section mr-section-gcp">
            <div className="mr-section-head">
              <span className="mr-card-eyebrow" style={{ '--mr-accent': '#ffa53d' } as React.CSSProperties}>
                <span className="mr-pip" style={{ background: '#ffa53d', boxShadow: '0 0 8px #ffa53d' }} />
                GCP 리소스 관리
              </span>
              {latestFailover?.actual_rto_seconds && (
                <span className="mr-count">
                  실제 RTO {Math.floor(latestFailover.actual_rto_seconds / 60)}분 {latestFailover.actual_rto_seconds % 60}초
                </span>
              )}
            </div>

            <div className="mr-gcp-info">
              <div>
                <div className="mr-label">페일오버 ID</div>
                <div className="mr-mono mr-value" style={{ fontSize: 12 }}>{latestFailover?.failover_id}</div>
              </div>
              <div>
                <div className="mr-label">GCP 리전</div>
                <div className="mr-mono mr-value">{latestFailover?.gcp_region ?? 'us-west1'}</div>
              </div>
              <div>
                <div className="mr-label">생성된 리소스</div>
                <div className="mr-mono mr-value">{latestFailover?.gcp_resources_created ?? '-'}개</div>
              </div>
              <div>
                <div className="mr-label">페일오버 시각</div>
                <div className="mr-mono mr-value" style={{ fontSize: 12 }}>
                  {latestFailover?.started_at
                    ? new Date(latestFailover.started_at).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })
                    : '-'}
                </div>
              </div>
            </div>

            <div className="mr-divider" />

            {destroyStatus === 'idle' && (
              <div className="mr-gcp-action">
                <p className="mr-gcp-desc">
                  페일오버 검증이 완료됐다면 GCP 리소스를 삭제해 비용을 절감하세요.
                </p>
                <button
                  className="mr-btn mr-btn-destroy"
                  onClick={() => setDestroyStatus('confirming')}
                >
                  🗑️ GCP 리소스 삭제
                </button>
              </div>
            )}

            {destroyStatus === 'confirming' && (
              <div className="mr-confirm-box">
                <p className="mr-confirm-text">
                  ⚠️ GCP에 생성된 모든 리소스가 삭제됩니다. 계속하시겠습니까?
                </p>
                <div className="mr-confirm-btns">
                  <button className="mr-btn mr-btn-danger" onClick={handleDestroyGcp}>
                    삭제 확인
                  </button>
                  <button
                    className="mr-btn mr-btn-ghost"
                    onClick={() => setDestroyStatus('idle')}
                  >
                    취소
                  </button>
                </div>
              </div>
            )}

            {destroyStatus === 'destroying' && (
              <div className="mr-gcp-action">
                <span className="mr-status" data-tone="yellow">
                  <span className="mr-status-pip" />
                  <span className="mr-spinner-sm" style={{ marginRight: 4 }} />
                  GCP 리소스 삭제 중... (약 5~10분 소요)
                </span>
              </div>
            )}

            {destroyStatus === 'destroyed' && (
              <div className="mr-gcp-action">
                <span className="mr-status" data-tone="green">
                  <span className="mr-status-pip" />
                  ✅ GCP 리소스가 모두 삭제됐습니다.
                </span>
              </div>
            )}

            {destroyStatus === 'failed' && (
              <div className="mr-gcp-action">
                <span className="mr-status" data-tone="red">
                  <span className="mr-status-pip" />
                  ❌ 삭제에 실패했습니다.
                </span>
                {destroyError && (
                  <p className="mr-destroy-err">{destroyError}</p>
                )}
                <button
                  className="mr-btn mr-btn-destroy"
                  style={{ marginTop: 8 }}
                  onClick={() => { setDestroyStatus('confirming'); setDestroyError('') }}
                >
                  🔄 삭제 재시도
                </button>
              </div>
            )}
          </div>
        )}

        {/* AWS Primary / GCP Standby */}
        <div className="mr-split">
          <div className="mr-card" data-tone="orange">
            <div className="mr-card-head">
              <span className="mr-card-eyebrow">
                <span className="mr-pip" />
                AWS Primary
              </span>
              <span className="mr-region">{awsRegion}</span>
            </div>
            <div className="mr-card-row">
              <span className="mr-status" data-tone="green">
                <span className="mr-status-pip" />
                운영 중
              </span>
              <span className="mr-stat-num">
                {drStatus?.aws_resource_count ?? 0}<small>개 리소스</small>
              </span>
            </div>
          </div>

          <div className="mr-card" data-tone="blue">
            <div className="mr-card-head">
              <span className="mr-card-eyebrow">
                <span className="mr-pip" />
                GCP Standby
              </span>
              <span className="mr-region">us-west1</span>
            </div>
            <div className="mr-card-row">
              {drReady ? (
                <span className="mr-status" data-tone={
                  latestFailover?.status === 'completed' ? 'green' : 'yellow'
                }>
                  <span className="mr-status-pip" />
                  {latestFailover?.status === 'completed' ? '운영 중 (페일오버)' : '대기 중'}
                </span>
              ) : (
                <span className="mr-status" data-tone="mute">
                  <span className="mr-status-pip" />
                  DR 패키지 준비 중
                </span>
              )}
              <span className="mr-stat-num">
                {drStatus?.gcp_resource_count ?? 0}<small>개 리소스</small>
              </span>
            </div>
          </div>
        </div>

        {/* DR status summary */}
        <div className="mr-section">
          <div className="mr-section-head">
            <span className="mr-card-eyebrow">
              <span className="mr-pip" />
              DR 상태 · 페일오버 준비도
            </span>
          </div>

          <div className="mr-status-row">
            <div>
              <div className="mr-label">현재 상태</div>
              <span className="mr-status mr-status-lg" data-tone={statusConfig.tone}>
                <span className="mr-status-pip" />
                {statusConfig.label}
              </span>
            </div>
            <div className="mr-text-right">
              <div className="mr-label">마지막 동기화</div>
              <div className="mr-mono mr-value">
                {drStatus?.last_synced_at
                  ? new Date(drStatus.last_synced_at).toLocaleString('ko-KR')
                  : '-'}
              </div>
            </div>
          </div>

          {pkg && (
            <>
              <div className="mr-divider" />
              <div className="mr-pkg-row">
                <div>
                  <div className="mr-label">DR Package 구성</div>
                  <span className="mr-status" data-tone={pkgStatusConfig?.tone ?? 'mute'}>
                    <span className="mr-status-pip" />
                    {pkgStatusConfig?.label ?? '확인 중'}
                  </span>
                </div>
                <div className="mr-kpi-pair">
                  <div className="mr-kpi-cell">
                    <div className="mr-label">RTO</div>
                    <div className="mr-kpi-val">{pkg.rto_minutes ?? 12}<small>분</small></div>
                  </div>
                  <div className="mr-kpi-cell">
                    <div className="mr-label">RPO</div>
                    <div className="mr-kpi-val">{pkg.rpo_minutes ?? 3}<small>분</small></div>
                  </div>
                </div>
              </div>

              {pkg.status === 'preparing' && (
                <div className="mr-preparing">
                  <div className="mr-preparing-head">
                    <span className="mr-spinner-sm" />
                    <span>DR Package 준비 중</span>
                  </div>
                  <div className="mr-preparing-list">
                    <div className="mr-prep-item mr-done"><span className="mr-check">✓</span> GCP Terraform 코드</div>
                    <div className="mr-prep-item mr-done"><span className="mr-check">✓</span> 컨테이너 이미지</div>
                    <div className="mr-prep-item"><span className="mr-spin-tiny" /> RDS 스냅샷 Export</div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mr-divider" />

          <div className="mr-action-row">
            <button
              className="mr-btn mr-btn-secondary mr-flex"
              onClick={() => router.push(`/projects/${projectId}/mirror/resources`)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              리소스 매핑 현황
            </button>
            <button
              className="mr-btn mr-btn-secondary mr-flex"
              onClick={() => router.push(`/projects/${projectId}/mirror/package`)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
              </svg>
              DR 리포트
            </button>
            <button
              className="mr-btn mr-btn-danger mr-flex"
              onClick={() => drReady && router.push(`/projects/${projectId}/failover`)}
              disabled={!drReady}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              페일오버 실행
            </button>
          </div>
        </div>

        {/* Sync history */}
        <div className="mr-section">
          <div className="mr-section-head">
            <span className="mr-card-eyebrow">
              <span className="mr-pip" />
              동기화 이력
            </span>
            {history.length > 0 && (
              <span className="mr-count">최근 {Math.min(history.length, 5)}건</span>
            )}
          </div>

          {history.length === 0 ? (
            <div className="mr-empty">
              <div className="mr-empty-mark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div className="mr-empty-text">동기화 이력이 아직 없습니다.</div>
            </div>
          ) : (
            <table className="mr-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>트리거</th>
                  <th>상태</th>
                  <th className="mr-th-right">소요 시간</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 5).map((h) => {
                  const dur = h.completed_at
                    ? Math.round(
                        (new Date(h.completed_at).getTime() - new Date(h.started_at).getTime()) / 1000
                      )
                    : null
                  const tone: 'green' | 'blue' | 'red' =
                    h.status === 'completed' ? 'green'
                    : h.status === 'running' ? 'blue'
                    : 'red'
                  const label =
                    h.status === 'completed' ? '완료'
                    : h.status === 'running' ? '진행 중'
                    : '실패'
                  return (
                    <tr key={h.sync_id}>
                      <td className="mr-mono mr-cell-dim">
                        {new Date(h.started_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                      </td>
                      <td className="mr-cell-dim">
                        {TRIGGER_LABEL[h.trigger_type] ?? h.trigger_type}
                      </td>
                      <td>
                        <span className="mr-status" data-tone={tone}>
                          <span className="mr-status-pip" />
                          {label}
                        </span>
                      </td>
                      <td className="mr-mono mr-cell-dim mr-td-right">
                        {dur !== null ? `${dur}초` : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}

// ─── shared topbar ─────────────────────────────────────────────
function Topbar({ projectName, onBack }: { projectName?: string; onBack: () => void }) {
  return (
    <div className="mr-topbar">
      <div className="mr-top-left">
        <span className="mr-brand">
          <span className="mr-mark" />
          AutoOps
        </span>
        {projectName && (
          <>
            <span className="mr-crumb-sep" />
            <div className="mr-crumb-proj">
              <span className="mr-crumb-eyebrow">
                <span className="mr-pip" />
                MirrorOps · DR
              </span>
              <span className="mr-crumb-name">{projectName}</span>
            </div>
          </>
        )}
      </div>
      <button className="mr-back-link" onClick={onBack}>← 대시보드</button>
    </div>
  )
}

// ─── styles ────────────────────────────────────────────────────
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

.mr-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11,14,23,0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.mr-top-left { display: flex; align-items: center; gap: 16px; }
.mr-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6;
}
.mr-mark {
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
.mr-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.mr-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.mr-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.mr-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #5aa3ff;
  display: inline-flex; align-items: center; gap: 8px;
}
.mr-crumb-eyebrow .mr-pip {
  background: #5aa3ff !important; box-shadow: 0 0 8px #5aa3ff !important;
}
.mr-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.mr-back-link {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: #aeb4c5;
  background: rgba(255,255,255,0.03);
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  cursor: pointer;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.mr-back-link:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }

.mr-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 36px 80px;
  color: #edf0f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.mr-loading {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase;
  color: #7a8298;
}
.mr-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: #5aa3ff;
  animation: mr-spin 700ms linear infinite;
}
.mr-spinner-sm {
  width: 13px; height: 13px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.15);
  border-top-color: #5aa3ff;
  animation: mr-spin 700ms linear infinite;
  display: inline-block;
}
.mr-spin-tiny {
  width: 9px; height: 9px; border-radius: 50%;
  border: 1.5px solid rgba(245,208,97,0.3);
  border-top-color: #f5d061;
  animation: mr-spin 700ms linear infinite;
  display: inline-block;
}
@keyframes mr-spin { to { transform: rotate(360deg); } }

.mr-error-block {
  display: flex; gap: 14px;
  padding: 20px;
  border-radius: 12px;
  border: 1px solid rgba(255,118,118,0.3);
  background: rgba(255,118,118,0.06);
  max-width: 500px;
  margin-top: 24px;
}
.mr-error-ico {
  flex-shrink: 0;
  width: 28px; height: 28px;
  border-radius: 50%;
  background: rgba(255,118,118,0.18);
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700; color: #ff7676;
}
.mr-error-title { font-weight: 600; font-size: 15px; color: #ff7676; margin-bottom: 4px; }
.mr-error-msg { font-size: 13px; color: #aeb4c5; line-height: 1.5; margin-bottom: 12px; }
.mr-mt { margin-top: 8px; }

.mr-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
  margin-bottom: 28px;
  padding-bottom: 26px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.mr-head-block { flex: 1; min-width: 0; }
.mr-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
  margin-bottom: 14px;
}
.mr-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #5aa3ff;
  box-shadow: 0 0 8px #5aa3ff;
}
.mr-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.1;
  margin: 0 0 12px; color: #edf0f6;
}
.mr-sub { font-size: 14.5px; color: #aeb4c5; margin: 0; line-height: 1.55; }

/* Sync 버튼 + 안내 (추가) */
.mr-sync-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.mr-sync-hint {
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  text-align: right; max-width: 240px;
}
.mr-sync-hint-text {
  font-size: 12px; color: #7a8298; line-height: 1.5;
}
.mr-sync-link {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 12.5px; font-weight: 600;
  color: #5aa3ff;
  padding: 0;
  transition: color 160ms;
}
.mr-sync-link:hover { color: #8cc0ff; }
.mr-sync-link:hover .mr-arrow { transform: translateX(3px); }
.mr-sync-link .mr-arrow { transition: transform 200ms; }

.mr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  padding: 11px 18px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13.5px; font-weight: 600;
  letter-spacing: -0.005em;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.04);
  color: #edf0f6;
  cursor: pointer;
  transition: background 160ms, border-color 160ms, transform 160ms, box-shadow 160ms;
}
.mr-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.20); }
.mr-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mr-btn-secondary { background: rgba(255,255,255,0.03); color: #aeb4c5; }
.mr-btn-secondary:hover:not(:disabled) { color: #edf0f6; }
.mr-btn-ghost { background: transparent; border-color: rgba(255,255,255,0.13); color: #aeb4c5; }
.mr-btn-danger {
  background: linear-gradient(180deg, rgba(255,118,118,0.18), rgba(255,118,118,0.10));
  border-color: rgba(255,118,118,0.45); color: #ff7676; font-weight: 700;
}
.mr-btn-danger:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255,118,118,0.25), rgba(255,118,118,0.15));
  border-color: rgba(255,118,118,0.6);
  box-shadow: 0 0 30px -10px rgba(255,118,118,0.5);
}
.mr-btn-destroy {
  background: rgba(255,165,61,0.08);
  border-color: rgba(255,165,61,0.3);
  color: #ffa53d; font-weight: 600;
}
.mr-btn-destroy:hover:not(:disabled) {
  background: rgba(255,165,61,0.14);
  border-color: rgba(255,165,61,0.5);
}
.mr-flex { flex: 1; }
.mr-arrow { font-family: 'JetBrains Mono', ui-monospace, monospace; display: inline-block; }

.mr-alert {
  display: flex; gap: 10px; align-items: center;
  padding: 12px 14px; border-radius: 10px;
  border: 1px solid rgba(255,118,118,0.3);
  background: rgba(255,118,118,0.06);
  color: #ff7676; font-size: 13px; line-height: 1.5;
  margin-bottom: 20px;
}
.mr-alert-ico {
  flex-shrink: 0; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(255,118,118,0.18);
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700; font-size: 11px;
}

/* GCP_NOT_CONNECTED 배너 (추가) */
.mr-gcp-banner {
  display: flex; gap: 14px; align-items: flex-start;
  padding: 16px 18px; border-radius: 12px;
  border: 1px solid rgba(250,204,21,0.3);
  background: rgba(250,204,21,0.1);
  margin-bottom: 20px;
  position: relative;
}
.mr-gcp-banner-ico {
  flex-shrink: 0; font-size: 18px; line-height: 1.4;
}
.mr-gcp-banner-body { flex: 1; min-width: 0; }
.mr-gcp-banner-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 14.5px;
  color: #facc15; letter-spacing: -0.01em;
  margin-bottom: 4px;
}
.mr-gcp-banner-desc {
  font-size: 13px; color: #d6c98a; line-height: 1.55;
  margin-bottom: 12px;
}
.mr-gcp-banner-cta {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px; border-radius: 9px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px; font-weight: 600;
  border: 1px solid rgba(250,204,21,0.45);
  background: rgba(250,204,21,0.14);
  color: #facc15;
  cursor: pointer;
  transition: background 160ms, border-color 160ms;
}
.mr-gcp-banner-cta:hover { background: rgba(250,204,21,0.22); border-color: rgba(250,204,21,0.65); }
.mr-gcp-banner-cta:hover .mr-arrow { transform: translateX(3px); }
.mr-gcp-banner-cta .mr-arrow { transition: transform 200ms; }
.mr-gcp-banner-close {
  flex-shrink: 0;
  width: 26px; height: 26px;
  border-radius: 7px;
  border: 1px solid rgba(250,204,21,0.22);
  background: transparent;
  color: rgba(250,204,21,0.7);
  cursor: pointer; font-size: 12px;
  display: grid; place-items: center;
  transition: color 160ms, background 160ms, border-color 160ms;
}
.mr-gcp-banner-close:hover { color: #facc15; background: rgba(250,204,21,0.12); border-color: rgba(250,204,21,0.4); }

.mr-split {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 14px; margin-bottom: 18px;
}
.mr-card {
  position: relative; padding: 22px;
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  overflow: hidden;
}
.mr-card::before {
  content: ""; position: absolute;
  top: 0; left: 28px; right: 28px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--mr-accent, rgba(255,255,255,0.5)), transparent);
}
.mr-card[data-tone="orange"] {
  --mr-accent: #ffa53d;
  background:
    radial-gradient(ellipse 80% 50% at 100% 0%, rgba(255,165,61,0.07), transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
}
.mr-card[data-tone="blue"] {
  --mr-accent: #5aa3ff;
  background:
    radial-gradient(ellipse 80% 50% at 0% 0%, rgba(90,163,255,0.07), transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
}
.mr-card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
}
.mr-card-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--mr-accent, #5aa3ff);
}
.mr-card-eyebrow .mr-pip { background: var(--mr-accent, #5aa3ff); box-shadow: 0 0 8px var(--mr-accent, #5aa3ff); }
.mr-region {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298; letter-spacing: 0.06em;
}
.mr-card-row {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
}
.mr-stat-num {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 28px;
  letter-spacing: -0.025em; color: #edf0f6; line-height: 1;
}
.mr-stat-num small {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px; color: #7a8298; font-weight: 500; margin-left: 4px;
}

.mr-status {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13.5px; font-weight: 500; color: #aeb4c5;
}
.mr-status-lg { font-size: 16px; font-weight: 600; }
.mr-status .mr-status-pip { width: 7px; height: 7px; border-radius: 50%; }
.mr-status-lg .mr-status-pip { width: 8px; height: 8px; }
.mr-status[data-tone="green"]  { color: #6ee7a0; }
.mr-status[data-tone="green"] .mr-status-pip  { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; }
.mr-status[data-tone="blue"]   { color: #5aa3ff; }
.mr-status[data-tone="blue"] .mr-status-pip   { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; animation: mr-pulse 1.6s ease-in-out infinite; }
.mr-status[data-tone="red"]    { color: #ff7676; }
.mr-status[data-tone="red"] .mr-status-pip    { background: #ff7676; box-shadow: 0 0 8px #ff7676; }
.mr-status[data-tone="yellow"] { color: #f5d061; }
.mr-status[data-tone="yellow"] .mr-status-pip { background: #f5d061; box-shadow: 0 0 8px #f5d061; }
.mr-status[data-tone="mute"] .mr-status-pip { background: #7a8298; }
@keyframes mr-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}

.mr-section {
  padding: 24px 26px; border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  margin-bottom: 18px;
}
.mr-section-gcp {
  border-color: rgba(255,165,61,0.25);
  background:
    radial-gradient(ellipse 60% 40% at 100% 0%, rgba(255,165,61,0.05), transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
}
.mr-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
}
.mr-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298; letter-spacing: 0.1em;
  padding: 4px 10px; border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.04);
}
.mr-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #7a8298; margin-bottom: 8px;
}
.mr-value { font-size: 13px; color: #edf0f6; font-weight: 500; }
.mr-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.mr-text-right { text-align: right; }

.mr-gcp-info {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 16px; margin-bottom: 4px;
}
.mr-gcp-action {
  display: flex; flex-direction: column; gap: 8px;
}
.mr-gcp-desc { font-size: 13px; color: #aeb4c5; margin: 0 0 8px; }
.mr-confirm-box {
  padding: 14px 16px; border-radius: 10px;
  border: 1px solid rgba(255,118,118,0.25);
  background: rgba(255,118,118,0.05);
}
.mr-confirm-text { font-size: 13px; color: #ff7676; margin: 0 0 12px; }
.mr-confirm-btns { display: flex; gap: 8px; }
.mr-destroy-err {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: rgba(255,118,118,0.7);
  background: rgba(255,118,118,0.05);
  border-radius: 8px; padding: 8px 10px;
  margin: 4px 0 0; line-height: 1.5;
}

.mr-status-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; flex-wrap: wrap;
}
.mr-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 20px 0; }
.mr-pkg-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; flex-wrap: wrap;
}
.mr-kpi-pair { display: flex; gap: 24px; }
.mr-kpi-cell { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.mr-kpi-val {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 22px;
  letter-spacing: -0.02em; color: #6ee7a0; line-height: 1;
}
.mr-kpi-val small {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 11px; color: #7a8298; font-weight: 500; margin-left: 3px;
}

.mr-preparing {
  margin-top: 16px; padding: 14px 16px; border-radius: 10px;
  border: 1px solid rgba(245,208,97,0.22);
  background: rgba(245,208,97,0.05);
}
.mr-preparing-head {
  display: flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 600; font-size: 13.5px; color: #f5d061; margin-bottom: 10px;
}
.mr-preparing-list {
  display: flex; flex-direction: column; gap: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px;
}
.mr-prep-item { display: flex; align-items: center; gap: 8px; color: rgba(245,208,97,0.7); }
.mr-prep-item.mr-done { color: #6ee7a0; }
.mr-check {
  width: 14px; height: 14px; border-radius: 50%;
  display: inline-grid; place-items: center;
  background: rgba(110,231,160,0.18);
  font-size: 10px; font-weight: 700;
}

.mr-action-row { display: flex; gap: 10px; flex-wrap: wrap; }

.mr-empty { padding: 40px 24px; text-align: center; }
.mr-empty-mark {
  width: 44px; height: 44px; margin: 0 auto 12px;
  border-radius: 11px; border: 1px dashed rgba(255,255,255,0.20);
  display: grid; place-items: center; color: #7a8298;
}
.mr-empty-text { font-size: 13px; color: #aeb4c5; }

.mr-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mr-table thead th {
  text-align: left; padding: 12px 14px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #aeb4c5;
  background: rgba(255,255,255,0.025);
  border-bottom: 1px solid rgba(255,255,255,0.13);
}
.mr-table thead th:first-child { padding-left: 18px; border-top-left-radius: 10px; }
.mr-table thead th:last-child  { padding-right: 18px; border-top-right-radius: 10px; }
.mr-th-right { text-align: right !important; }
.mr-table tbody td {
  padding: 14px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: middle;
}
.mr-table tbody td:first-child { padding-left: 18px; }
.mr-table tbody td:last-child  { padding-right: 18px; }
.mr-table tbody tr:last-child td { border-bottom: none; }
.mr-cell-dim { color: #aeb4c5; }
.mr-td-right { text-align: right; }

@media (max-width: 900px) {
  .mr-topbar { padding: 14px 20px; }
  .mr-top-left .mr-crumb-sep, .mr-top-left .mr-crumb-proj { display: none; }
  .mr-page { padding: 28px 20px 60px; }
  .mr-title { font-size: 28px; }
  .mr-split { grid-template-columns: 1fr; }
  .mr-status-row, .mr-pkg-row { flex-direction: column; align-items: flex-start; }
  .mr-text-right { text-align: left; }
  .mr-kpi-pair { gap: 20px; }
  .mr-kpi-cell { align-items: flex-start; }
  .mr-action-row { flex-direction: column; }
  .mr-gcp-info { grid-template-columns: repeat(2, 1fr); }
  .mr-sync-wrap { align-items: flex-start; }
  .mr-sync-hint { align-items: flex-start; text-align: left; }
}
`
