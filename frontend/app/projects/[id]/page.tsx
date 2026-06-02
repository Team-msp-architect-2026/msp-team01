// frontend/app/projects/[id]/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import dynamic from 'next/dynamic'
import InfraMetrics from '@/components/InfraMetrics'

const ArchitectureDiagram = dynamic<{ mermaidCode: string }>(
  () => import('@/components/ArchitectureDiagram'),
  { ssr: false }
)

// ─── 타입 정의 ────────────────────────────────────────────────────
interface DriftEvent {
  drift_id:      string
  resource_id:   string
  resource_type: string
  changed_by:    string
  diff_summary:  string
  severity:      'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  status:        'detected' | 'accepted' | 'guided'
  detected_at:   string
}

interface AuditLog {
  id:         string
  layer:      'platform' | 'aws_change' | 'validation_block'
  action:     string
  actor:      string
  detail:     Record<string, unknown>
  created_at: string
}

interface ProjectInfo {
  project_id:     string
  name:           string
  prefix:         string
  environment:    string
  region:         string
  status:         string
  dr_status:      string
  last_synced_at: string | null
}

// ─── 상수 ─────────────────────────────────────────────────────────
const SEVERITY_TONE: Record<DriftEvent['severity'], 'red' | 'yellow' | 'orange' | 'mute'> = {
  CRITICAL: 'red',
  HIGH:     'yellow',
  MEDIUM:   'orange',
  LOW:      'mute',
}

const LAYER_STYLE = {
  platform:         { label: '플랫폼',        tone: 'blue'   },
  aws_change:       { label: 'AWS 변경',       tone: 'orange' },
  validation_block: { label: 'Validation 차단', tone: 'red'   },
} as const

const ACTION_LABEL: Record<string, string> = {
  craftops_deploy:            '배포 실행',
  craftops_destroy:           '인프라 삭제',
  project_delete:             '프로젝트 삭제',
  failover_execute:           '페일오버 실행',
  drift_approve:              'Drift 승인',
  drift_reject:               'Drift 거부',
  onboarding_complete:        '온보딩 완료',
  validation_blocked_tfsec:   'tfsec 차단',
  validation_blocked_checkov: 'checkov 차단',
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
export default function GovernancePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()

  const [project, setProject]      = useState<ProjectInfo | null>(null)
  const [driftEvents, setDrift]    = useState<DriftEvent[]>([])
  const [auditLogs, setAudit]      = useState<AuditLog[]>([])
  const [diagram, setDiagram]      = useState<{ mermaid_code?: string; generated_at?: string } | null>(null)
  const [totalResources, setTotal] = useState(0)
  const [totalDriftAll, setTotalDriftAll] = useState(0)
  const [actionId, setActionId]    = useState<string | null>(null)
  const [regenerating, setRegen]   = useState(false)
  const [loading, setLoading]      = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [projRes, driftRes, auditRes] = await Promise.all([
        apiClient.get(`/api/projects/${projectId}`),
        apiClient.get(`/api/projects/${projectId}/drift?limit=5`),
        apiClient.get(`/api/projects/${projectId}/audit-logs?limit=5`),
      ])
      setProject(projRes.data.data)
      setDrift(driftRes.data.data.slice(0, 5))
      setTotalDriftAll(driftRes.data.data.length)
      setAudit(auditRes.data.data.items?.slice(0, 5) || [])

      apiClient.get(`/api/projects/${projectId}/resources`)
        .then(res => setTotal(res.data.data?.total_resources || 0))
        .catch(() => {})

      apiClient.get(`/api/projects/${projectId}/documents`)
        .then(res => setDiagram(res.data.data))
        .catch(() => {})
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // WebSocket — drift_detected 실시간 수신
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || ''
    const wsUrl   = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')
    const token   = typeof window !== 'undefined' ? localStorage.getItem('access_token') : ''
    const ws      = new WebSocket(`${wsUrl}/ws/events/${projectId}?token=${token}`)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'drift_detected') fetchAll()
    }

    return () => ws.close()
  }, [projectId, fetchAll])

  const handleApprove = async (driftId: string) => {
    setActionId(driftId)
    try {
      await apiClient.post(`/api/drift/${driftId}/approve`)
      await fetchAll()
    } finally { setActionId(null) }
  }

  const handleReject = async (driftId: string) => {
    setActionId(driftId)
    try {
      await apiClient.post(`/api/drift/${driftId}/reject`)
      await fetchAll()
    } finally { setActionId(null) }
  }

  const handleRegenDiagram = async () => {
    setRegen(true)
    try {
      await apiClient.post(`/api/projects/${projectId}/documents/regenerate`)
      setTimeout(() => { fetchAll(); setRegen(false) }, 120_000)
    } catch { setRegen(false) }
  }

  if (loading) {
    return (
      <>
        <style>{styles}</style>
        <div className="gv-loading">
          <span className="gv-spinner" />
          <span>loading governance</span>
        </div>
      </>
    )
  }
  if (!project) return null

  const criticalCount = driftEvents.filter(e => e.severity === 'CRITICAL' && e.status === 'detected').length
  const detectedCount = driftEvents.filter(e => e.status === 'detected').length
  const drReady       = project.dr_status === 'ready'

  return (
    <>
      <style>{styles}</style>

      {/* Top bar */}
      <div className="gv-topbar">
        <div className="gv-top-left">
          <button className="gv-brand" onClick={() => router.push('/dashboard')}>
            <span className="gv-mark" />
            AutoOps
          </button>
          <span className="gv-crumb-sep" />
          <div className="gv-crumb-proj">
            <span className="gv-crumb-eyebrow">
              <span className="gv-pip-static gv-pip-blue" />
              Governance · Live Monitoring
            </span>
            <span className="gv-crumb-name">{project.name}</span>
          </div>
        </div>
        <button className="gv-back-link" onClick={() => router.push('/dashboard')}>← 대시보드</button>
      </div>

      <div className="gv-page">

        {/* ── Page header ── */}
        <div className="gv-head">
          <div className="gv-head-left">
            <div className="gv-eyebrow">
              <span className="gv-pip gv-pip-green" />
              All systems monitored
              <span className="gv-eyebrow-sep" />
              <span className="gv-mono-sm">{project.prefix}-{project.environment}</span>
              <span className="gv-eyebrow-sep" />
              <span className="gv-mono-sm">{project.region}</span>
            </div>
            <div className="gv-title-row">
              <h1 className="gv-title">{project.name}</h1>
              <span className="gv-env-badge" data-env={project.environment}>{project.environment}</span>
              {criticalCount > 0 && (
                <span className="gv-crit-badge">
                  <span className="gv-pip gv-pip-red" />
                  CRITICAL × {criticalCount}
                </span>
              )}
            </div>
          </div>
          <div className="gv-head-actions">
            <button className="gv-btn" onClick={() => router.push(`/projects/${projectId}/mirror`)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M12 3v18"/>
              </svg>
              MirrorOps DR
            </button>
            <button
              className="gv-btn gv-btn-danger"
              disabled={!drReady}
              onClick={() => router.push(`/projects/${projectId}/failover`)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
              페일오버 실행
            </button>
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div className="gv-kpi-strip">
          <div className="gv-kpi">
            <div className="gv-kpi-head">
              <span className="gv-kpi-label">전체 리소스</span>
              <span className="gv-kpi-tag">RESOURCES</span>
            </div>
            <div className="gv-kpi-value">
              {totalResources}<small>개</small>
            </div>
            <div className="gv-kpi-foot">온보딩 스캔 기준</div>
          </div>

          <div className="gv-kpi" data-tone={detectedCount > 0 ? 'red' : 'green'}>
            <div className="gv-kpi-head">
              <span className="gv-kpi-label">Drift 감지</span>
              <span className="gv-kpi-tag">
                <span className="gv-pip gv-pip-tag" />
                LIVE
              </span>
            </div>
            <div className="gv-kpi-value">
              {totalDriftAll}<small>건</small>
            </div>
            <div className="gv-kpi-foot">
              {criticalCount > 0 ? `CRITICAL ${criticalCount}건 포함` : '이상 없음'}
            </div>
          </div>

          <div className="gv-kpi" data-tone={drReady ? 'green' : 'mute'}>
            <div className="gv-kpi-head">
              <span className="gv-kpi-label">DR 상태</span>
              <span className="gv-kpi-tag">MIRROROPS</span>
            </div>
            <div className="gv-kpi-value gv-kpi-value-text">
              {project.dr_status === 'ready'   ? 'Ready'
               : project.dr_status === 'syncing' ? 'Syncing'
               : 'Not Ready'}
            </div>
            <div className="gv-kpi-foot">GCP us-central1</div>
          </div>

          <div className="gv-kpi">
            <div className="gv-kpi-head">
              <span className="gv-kpi-label">마지막 감사</span>
              <span className="gv-kpi-tag">AUDIT</span>
            </div>
            <div className="gv-kpi-value gv-kpi-value-text">
              {auditLogs[0]
                ? new Date(auditLogs[0].created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </div>
            <div className="gv-kpi-foot">
              {auditLogs[0] ? (ACTION_LABEL[auditLogs[0].action] || auditLogs[0].action) : '기록 없음'}
            </div>
          </div>

          <div className="gv-kpi" data-tone={project.status === 'completed' ? 'green' : 'orange'}>
            <div className="gv-kpi-head">
              <span className="gv-kpi-label">배포 상태</span>
              <span className="gv-kpi-tag">CRAFTOPS</span>
            </div>
            <div className="gv-kpi-value gv-kpi-value-text">
              {project.status === 'completed'  ? '완료'
               : project.status === 'deploying' ? '배포 중'
               : project.status}
            </div>
            <div className="gv-kpi-foot">{project.prefix}-{project.environment}</div>
          </div>
        </div>

        {/* ── 인프라 모니터링 (CloudWatch) ── */}
        <div className="gv-panel">
          <div className="gv-panel-head">
            <div className="gv-panel-title">
              <span className="gv-panel-ico" data-tone="blue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
                </svg>
              </span>
              <span>인프라 모니터링</span>
              {project.status === 'completed' && (
                <span className="gv-status-pill" data-tone="green">
                  <span className="gv-pip gv-pip-green" />
                  CloudWatch Live
                </span>
              )}
            </div>
          </div>
          <div style={{ padding: '20px' }}>
            <InfraMetrics projectId={projectId} />
          </div>
        </div>

        {/* ── Drift + Audit (2-col) ── */}
        <div className="gv-two-col">

          {/* Drift */}
          <div className="gv-panel">
            <div className="gv-panel-head">
              <div className="gv-panel-title">
                <span className="gv-panel-ico" data-tone="red">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </span>
                <span>Configuration Drift</span>
                {detectedCount > 0 && (
                  <span className="gv-status-pill" data-tone="red">
                    {detectedCount} 미처리
                  </span>
                )}
                <span className="gv-live">
                  <span className="gv-live-dot" />
                  실시간
                </span>
              </div>
              <button
                className="gv-link-btn"
                onClick={() => router.push(`/projects/${projectId}/drift`)}
              >
                전체 보기 →
              </button>
            </div>

            {driftEvents.length === 0 ? (
              <div className="gv-empty">
                <span className="gv-empty-check">✓</span>
                감지된 Drift 없음
              </div>
            ) : (
              <div className="gv-list">
                {driftEvents.map(event => (
                  <div key={event.drift_id} className="gv-drift-row">
                    <span className="gv-sev-pill" data-tone={SEVERITY_TONE[event.severity]}>
                      {event.severity}
                    </span>
                    <div className="gv-drift-body">
                      <div className="gv-drift-id">{event.resource_id}</div>
                      <div className="gv-drift-diff">{event.diff_summary}</div>
                    </div>
                    {event.status === 'detected' ? (
                      <div className="gv-drift-actions">
                        <button
                          className="gv-btn-tiny"
                          data-tone="green"
                          disabled={actionId === event.drift_id}
                          onClick={() => handleApprove(event.drift_id)}
                        >
                          승인
                        </button>
                        <button
                          className="gv-btn-tiny"
                          data-tone="red"
                          disabled={actionId === event.drift_id}
                          onClick={() => handleReject(event.drift_id)}
                        >
                          거부
                        </button>
                      </div>
                    ) : (
                      <span className="gv-drift-resolved">
                        {event.status === 'accepted' ? '승인됨' : '거부됨'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {totalDriftAll > 5 && (
              <div className="gv-panel-foot">
                <button className="gv-link-btn" onClick={() => router.push(`/projects/${projectId}/drift`)}>
                  +{totalDriftAll - 5}건 더 보기 →
                </button>
              </div>
            )}
          </div>

          {/* Audit */}
          <div className="gv-panel">
            <div className="gv-panel-head">
              <div className="gv-panel-title">
                <span className="gv-panel-ico" data-tone="blue">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </span>
                <span>Audit Log</span>
              </div>
              <button
                className="gv-link-btn"
                onClick={() => router.push(`/projects/${projectId}/audit`)}
              >
                전체 보기 →
              </button>
            </div>

            {auditLogs.length === 0 ? (
              <div className="gv-empty">기록 없음</div>
            ) : (
              <div className="gv-list">
                {auditLogs.map(log => {
                  const ls = LAYER_STYLE[log.layer]
                  return (
                    <div key={log.id} className="gv-audit-row">
                      <span className="gv-audit-dot" data-tone={ls.tone} />
                      <div className="gv-audit-body">
                        <div className="gv-audit-line">
                          <span className="gv-layer-chip" data-tone={ls.tone}>{ls.label}</span>
                          <span className="gv-audit-action">{ACTION_LABEL[log.action] || log.action}</span>
                        </div>
                        <div className="gv-audit-meta">
                          <span>{log.actor?.split('@')[0] || log.actor}</span>
                          <span className="gv-dot-sep" />
                          <span>
                            {new Date(log.created_at).toLocaleString('ko-KR', {
                              month: '2-digit', day: '2-digit',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Architecture Diagram ── */}
        <div className="gv-panel">
          <div className="gv-panel-head">
            <div className="gv-panel-title">
              <span className="gv-panel-ico" data-tone="blue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              </span>
              <span>아키텍처 다이어그램</span>
              {diagram?.generated_at && (
                <span className="gv-panel-meta">
                  {new Date(diagram.generated_at).toLocaleString('ko-KR', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })} 생성
                </span>
              )}
            </div>
            <button
              className="gv-btn gv-btn-sm"
              onClick={handleRegenDiagram}
              disabled={regenerating}
            >
              {regenerating ? (
                <>
                  <span className="gv-spinner-tiny" />
                  생성 중...
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
                  </svg>
                  재생성
                </>
              )}
            </button>
          </div>
          {diagram?.mermaid_code ? (
            <div className="gv-diagram-wrap">
              <ArchitectureDiagram mermaidCode={diagram.mermaid_code} />
            </div>
          ) : (
            <div className="gv-placeholder">
              <div className="gv-placeholder-mark" data-tone="blue">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="18" cy="5" r="3"/>
                  <circle cx="6" cy="12" r="3"/>
                  <circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              </div>
              <div className="gv-placeholder-title">Bedrock AI 다이어그램 미생성</div>
              <div className="gv-placeholder-sub">현재 인프라 구조를 자동 분석합니다</div>
              <button
                className="gv-btn-primary gv-mt"
                onClick={handleRegenDiagram}
                disabled={regenerating}
              >
                {regenerating ? (
                  <>
                    <span className="gv-spinner-sm" />
                    생성 중...
                  </>
                ) : (
                  <>
                    <span>AI 다이어그램 생성</span>
                    <span className="gv-arrow">→</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
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
.gv-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11,14,23,0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #edf0f6;
}
.gv-top-left { display: flex; align-items: center; gap: 16px; }
.gv-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6; background: none; border: none; cursor: pointer; padding: 0;
}
.gv-mark {
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
.gv-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.gv-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.gv-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.gv-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #5aa3ff;
  display: inline-flex; align-items: center; gap: 8px;
}
.gv-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.gv-back-link {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: #aeb4c5;
  background: rgba(255,255,255,0.03);
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  cursor: pointer;
  transition: color 160ms, border-color 160ms, background 160ms;
}
.gv-back-link:hover { color: #edf0f6; border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.06); }

/* Page */
.gv-page {
  max-width: 1480px;
  margin: 0 auto;
  padding: 36px 36px 80px;
  color: #edf0f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex; flex-direction: column; gap: 16px;
}

/* Loading */
.gv-loading {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase;
  color: #7a8298;
}
.gv-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.1);
  border-top-color: #5aa3ff;
  animation: gv-spin 700ms linear infinite;
}
.gv-spinner-tiny {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.15);
  border-top-color: currentColor;
  animation: gv-spin 700ms linear infinite;
  display: inline-block;
}
.gv-spinner-sm {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: gv-spin 700ms linear infinite;
  display: inline-block;
}
@keyframes gv-spin { to { transform: rotate(360deg); } }
@keyframes gv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

/* Pip helpers */
.gv-pip {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  display: inline-block;
  animation: gv-pulse 1.6s ease-in-out infinite;
}
.gv-pip-static { animation: none; }
.gv-pip-green  { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; }
.gv-pip-blue   { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
.gv-pip-red    { background: #ff7676; box-shadow: 0 0 8px #ff7676; }
.gv-pip-tag    { background: #5aa3ff; box-shadow: 0 0 6px #5aa3ff; width: 5px; height: 5px; }
.gv-mono-sm {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.04em;
}

/* Page head */
.gv-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.gv-head-left { flex: 1; min-width: 0; }
.gv-eyebrow {
  display: inline-flex; align-items: center; gap: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #aeb4c5;
  margin-bottom: 14px;
}
.gv-eyebrow-sep {
  width: 3px; height: 3px; border-radius: 50%;
  background: #4b5267;
}
.gv-title-row {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.gv-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700;
  font-size: 32px;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0;
  color: #edf0f6;
}
.gv-env-badge {
  display: inline-flex; align-items: center;
  padding: 5px 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 500;
  letter-spacing: 0.08em; text-transform: uppercase;
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.025);
  color: #aeb4c5;
}
.gv-env-badge[data-env="prod"], .gv-env-badge[data-env="production"]   { color: #ffa53d; border-color: rgba(255,165,61,0.3); background: rgba(255,165,61,0.06); }
.gv-env-badge[data-env="stage"], .gv-env-badge[data-env="staging"]     { color: #f5d061; border-color: rgba(245,208,97,0.3); background: rgba(245,208,97,0.06); }
.gv-env-badge[data-env="dev"], .gv-env-badge[data-env="development"]   { color: #5aa3ff; border-color: rgba(90,163,255,0.3); background: rgba(90,163,255,0.06); }

.gv-crit-badge {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase;
  border-radius: 100px;
  border: 1px solid rgba(255,118,118,0.35);
  background: rgba(255,118,118,0.08);
  color: #ff7676;
}

/* Buttons */
.gv-head-actions { display: flex; gap: 10px; align-items: center; }
.gv-btn {
  display: inline-flex; align-items: center; gap: 9px;
  padding: 10px 16px;
  font-family: inherit;
  font-size: 13px; font-weight: 600;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.04);
  color: #edf0f6;
  cursor: pointer;
  transition: background 160ms, border-color 160ms, transform 160ms, box-shadow 160ms;
}
.gv-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.20); }
.gv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gv-btn-sm { padding: 7px 12px; font-size: 12px; gap: 6px; }
.gv-btn-danger {
  background: linear-gradient(180deg, rgba(255,118,118,0.18), rgba(255,118,118,0.10));
  border-color: rgba(255,118,118,0.45);
  color: #ff7676;
  font-weight: 700;
}
.gv-btn-danger:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255,118,118,0.25), rgba(255,118,118,0.15));
  border-color: rgba(255,118,118,0.6);
  box-shadow: 0 0 30px -10px rgba(255,118,118,0.5);
}
.gv-btn-primary {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 11px 20px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13.5px; font-weight: 600;
  border-radius: 10px;
  border: 1px solid #f3f4f8;
  background: linear-gradient(180deg, #ffffff, #e8eaf0);
  color: #0a0d14;
  cursor: pointer;
  transition: transform 180ms, box-shadow 180ms, filter 180ms;
}
.gv-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(90,163,255,0.4);
}
.gv-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; filter: saturate(0.6); }
.gv-arrow { transition: transform 200ms; display: inline-block; }
.gv-btn-primary:hover:not(:disabled) .gv-arrow { transform: translateX(3px); }
.gv-mt { margin-top: 16px; }

.gv-link-btn {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #5aa3ff;
  letter-spacing: 0.05em;
  background: none; border: none; padding: 0;
  cursor: pointer;
  transition: color 160ms;
}
.gv-link-btn:hover { color: #88bcff; }

/* KPI strip */
.gv-kpi-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}
.gv-kpi {
  position: relative;
  padding: 16px 18px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012));
  overflow: hidden;
  transition: border-color 200ms;
}
.gv-kpi:hover { border-color: rgba(255,255,255,0.20); }
.gv-kpi::before {
  content: ""; position: absolute;
  top: 0; left: 18px; right: 18px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--gv-acc, rgba(255,255,255,0.4)), transparent);
}
.gv-kpi[data-tone="red"]    { --gv-acc: #ff7676; }
.gv-kpi[data-tone="green"]  { --gv-acc: #6ee7a0; }
.gv-kpi[data-tone="blue"]   { --gv-acc: #5aa3ff; }
.gv-kpi[data-tone="orange"] { --gv-acc: #ffa53d; }
.gv-kpi[data-tone="yellow"] { --gv-acc: #f5d061; }
.gv-kpi[data-tone="mute"]   { --gv-acc: rgba(255,255,255,0.15); }

.gv-kpi-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.gv-kpi-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em;
  color: #aeb4c5;
}
.gv-kpi-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #7a8298;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.10);
}
.gv-kpi-value {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700;
  font-size: 28px;
  letter-spacing: -0.025em;
  line-height: 1;
  color: var(--gv-acc, #edf0f6);
}
.gv-kpi-value small {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  color: #7a8298;
  font-weight: 500;
  margin-left: 4px;
}
.gv-kpi-value-text { font-size: 18px; padding-top: 6px; }
.gv-kpi-foot {
  margin-top: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #7a8298;
  letter-spacing: 0.02em;
}

/* Panel */
.gv-panel {
  position: relative;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008));
  overflow: hidden;
}
.gv-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.012);
  gap: 12px;
}
.gv-panel-title {
  display: flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 13.5px;
  color: #edf0f6;
  letter-spacing: -0.005em;
}
.gv-panel-ico {
  width: 26px; height: 26px;
  border-radius: 7px;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.gv-panel-ico[data-tone="blue"]   { background: rgba(90,163,255,0.10);  border: 1px solid rgba(90,163,255,0.25);  color: #5aa3ff; }
.gv-panel-ico[data-tone="red"]    { background: rgba(255,118,118,0.10); border: 1px solid rgba(255,118,118,0.25); color: #ff7676; }
.gv-panel-ico[data-tone="orange"] { background: rgba(255,165,61,0.10);  border: 1px solid rgba(255,165,61,0.25);  color: #ffa53d; }

.gv-status-pill {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 100px;
  border: 1px solid;
}
.gv-status-pill[data-tone="green"] { color: #6ee7a0; border-color: rgba(110,231,160,0.30); background: rgba(110,231,160,0.07); }
.gv-status-pill[data-tone="red"]   { color: #ff7676; border-color: rgba(255,118,118,0.30); background: rgba(255,118,118,0.07); }

.gv-live {
  display: inline-flex; align-items: center; gap: 6px;
  margin-left: auto;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; color: #6ee7a0;
  letter-spacing: 0.1em; text-transform: uppercase;
}
.gv-live-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #6ee7a0;
  box-shadow: 0 0 6px #6ee7a0;
  animation: gv-pulse 1.4s ease-in-out infinite;
}
.gv-panel-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.04em;
}

/* Placeholder */
.gv-placeholder {
  padding: 56px 24px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
}
.gv-placeholder-mark {
  width: 48px; height: 48px;
  margin: 0 auto 14px;
  border-radius: 12px;
  border: 1px dashed rgba(255,255,255,0.20);
  display: grid; place-items: center;
  color: #7a8298;
}
.gv-placeholder-mark[data-tone="blue"] {
  border-color: rgba(90,163,255,0.30);
  background: rgba(90,163,255,0.05);
  color: #5aa3ff;
}
.gv-placeholder-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 600; font-size: 14px;
  color: #edf0f6;
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}
.gv-placeholder-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #7a8298;
  letter-spacing: 0.04em;
}

/* Two-col layout */
.gv-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* List body */
.gv-list { display: flex; flex-direction: column; }

/* Drift row */
.gv-drift-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  transition: background 140ms;
}
.gv-drift-row:last-child { border-bottom: none; }
.gv-drift-row:hover { background: rgba(255,255,255,0.025); }
.gv-sev-pill {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px; font-weight: 700;
  padding: 3px 8px;
  border-radius: 5px;
  letter-spacing: 0.08em;
  flex-shrink: 0;
  border: 1px solid;
}
.gv-sev-pill[data-tone="red"]    { color: #ff7676; border-color: rgba(255,118,118,0.30); background: rgba(255,118,118,0.10); }
.gv-sev-pill[data-tone="yellow"] { color: #f5d061; border-color: rgba(245,208,97,0.30); background: rgba(245,208,97,0.10); }
.gv-sev-pill[data-tone="orange"] { color: #ffa53d; border-color: rgba(255,165,61,0.30); background: rgba(255,165,61,0.10); }
.gv-sev-pill[data-tone="mute"]   { color: #aeb4c5; border-color: rgba(255,255,255,0.13); background: rgba(255,255,255,0.04); }
.gv-drift-body { flex: 1; min-width: 0; }
.gv-drift-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 500;
  color: #edf0f6;
  letter-spacing: 0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gv-drift-diff {
  font-size: 12px;
  color: #aeb4c5;
  margin-top: 3px;
  line-height: 1.4;
}
.gv-drift-actions { display: flex; gap: 6px; flex-shrink: 0; }
.gv-btn-tiny {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  padding: 4px 11px;
  border-radius: 6px;
  border: 1px solid;
  background: rgba(255,255,255,0.03);
  cursor: pointer;
  transition: all 140ms;
  letter-spacing: 0.05em;
}
.gv-btn-tiny[data-tone="green"] { color: #6ee7a0; border-color: rgba(110,231,160,0.35); }
.gv-btn-tiny[data-tone="green"]:hover:not(:disabled) { background: rgba(110,231,160,0.10); border-color: rgba(110,231,160,0.5); }
.gv-btn-tiny[data-tone="red"]   { color: #ff7676; border-color: rgba(255,118,118,0.35); }
.gv-btn-tiny[data-tone="red"]:hover:not(:disabled) { background: rgba(255,118,118,0.10); border-color: rgba(255,118,118,0.5); }
.gv-btn-tiny:disabled { opacity: 0.4; cursor: not-allowed; }
.gv-drift-resolved {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.04em;
}

/* Empty */
.gv-empty {
  padding: 36px 18px;
  text-align: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #7a8298;
  letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: center; gap: 10px;
}
.gv-empty-check {
  display: inline-grid; place-items: center;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: rgba(110,231,160,0.15);
  border: 1px solid rgba(110,231,160,0.35);
  color: #6ee7a0;
  font-weight: 700;
}

.gv-panel-foot {
  padding: 12px 18px;
  border-top: 1px solid rgba(255,255,255,0.06);
  text-align: center;
  background: rgba(255,255,255,0.012);
}

/* Audit row */
.gv-audit-row {
  display: flex; gap: 14px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  transition: background 140ms;
}
.gv-audit-row:last-child { border-bottom: none; }
.gv-audit-row:hover { background: rgba(255,255,255,0.025); }
.gv-audit-dot {
  flex-shrink: 0;
  width: 8px; height: 8px; border-radius: 50%;
  margin-top: 6px;
}
.gv-audit-dot[data-tone="blue"]   { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
.gv-audit-dot[data-tone="orange"] { background: #ffa53d; box-shadow: 0 0 8px #ffa53d; }
.gv-audit-dot[data-tone="red"]    { background: #ff7676; box-shadow: 0 0 8px #ff7676; }
.gv-audit-body { flex: 1; min-width: 0; }
.gv-audit-line {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 4px;
}
.gv-layer-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid;
}
.gv-layer-chip[data-tone="blue"]   { color: #5aa3ff; border-color: rgba(90,163,255,0.30);  background: rgba(90,163,255,0.08); }
.gv-layer-chip[data-tone="orange"] { color: #ffa53d; border-color: rgba(255,165,61,0.30);  background: rgba(255,165,61,0.08); }
.gv-layer-chip[data-tone="red"]    { color: #ff7676; border-color: rgba(255,118,118,0.30); background: rgba(255,118,118,0.08); }
.gv-audit-action {
  font-size: 12.5px;
  font-weight: 500;
  color: #edf0f6;
}
.gv-audit-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: #7a8298;
  letter-spacing: 0.04em;
  display: flex; align-items: center; gap: 8px;
}
.gv-dot-sep {
  width: 2px; height: 2px; border-radius: 50%;
  background: #4b5267;
}

/* Diagram wrap */
.gv-diagram-wrap {
  padding: 20px 24px;
  background: rgba(0,0,0,0.15);
}

@media (max-width: 1280px) {
  .gv-kpi-strip { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 900px) {
  .gv-page { padding: 28px 20px 60px; }
  .gv-topbar { padding: 14px 20px; }
  .gv-top-left .gv-crumb-sep, .gv-top-left .gv-crumb-proj { display: none; }
  .gv-title { font-size: 26px; }
  .gv-two-col { grid-template-columns: 1fr; }
  .gv-kpi-strip { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 520px) {
  .gv-kpi-strip { grid-template-columns: 1fr; }
}
`