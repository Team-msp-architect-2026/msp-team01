// frontend/app/projects/[id]/mirror/package/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { Button } from '@/components/ui/button'

const CHECKLIST_ICON: Record<string, string> = {
  done:    '✅',
  pending: '⏳',
  warning: '⚠️',
}

export default function DRPackagePage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const { data, isLoading, error, refetch } = useDRPackage(projectId)

  if (isLoading) {
    return (
      <>
        <style>{styles}</style>
        <div className="pkg-state">
          <span className="pkg-spinner" />
          <span>DR Package 로딩 중...</span>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{styles}</style>
        <div className="pkg-page">
          <div className="pkg-error-card">
            <div className="pkg-error-head">
              <span className="pkg-error-dot" />
              로딩 실패
            </div>
            <p className="pkg-error-msg">{error}</p>
            <Button
              variant="outline"
              className="pkg-btn-retry"
              onClick={refetch}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              다시 시도
            </Button>
          </div>
        </div>
      </>
    )
  }

  const latest = data?.latest

  return (
    <>
      <style>{styles}</style>

      <div className="pkg-page">

        {/* ── Header ────────────────────────────── */}
        <header className="pkg-header">
          <button
            onClick={() => router.push(`/projects/${projectId}/mirror`)}
            className="pkg-back"
          >
            <span className="pkg-back-arrow">←</span>
            대시보드
          </button>
          <div className="pkg-eyebrow">
            <span className="pkg-pip" />
            MirrorOps · DR Package
          </div>
          <h1 className="pkg-title">DR Package 상세</h1>
          <p className="pkg-desc">
            AWS → GCP 페일오버를 위해 준비된 Terraform 코드, 컨테이너 이미지, DB
            스냅샷의 상태를 한눈에 확인합니다.
          </p>
        </header>

        {!latest ? (
          <div className="pkg-empty">
            <div className="pkg-empty-ico">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </div>
            <p className="pkg-empty-title">DR Package가 없습니다.</p>
            <p className="pkg-empty-sub">
              CraftOps 배포 완료 후 MirrorOps 동기화 시 자동 생성됩니다.
            </p>
          </div>
        ) : (
          <div className="pkg-stack">

            {/* ── 구성 현황 (Hero) ───────────────── */}
            <section className="pkg-card pkg-hero">
              <div className="pkg-hero-row">
                <div>
                  <div className="pkg-card-eyebrow">
                    <span className="pkg-pip pkg-pip-blue" />
                    Package Composition
                  </div>
                  <h2 className="pkg-card-title">구성 현황</h2>
                  <p className="pkg-card-time">
                    빌드 시각 · {new Date(latest.created_at).toLocaleString('ko-KR')}
                  </p>
                </div>
                <span className={`mr-badge ${latest.status === 'ready' ? 'mr-badge-ready' : 'mr-badge-preparing'}`}>
                  {latest.status === 'ready' ? '● READY' : '● PREPARING'}
                </span>
              </div>

              <div className="pkg-comp-grid">
                <div className={`pkg-comp ${latest.components.terraform_code.status === 'ready' ? 'pkg-comp-ready' : 'pkg-comp-wait'}`}>
                  <div className="pkg-comp-top">
                    <div className="pkg-comp-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 18 22 12 16 6"/>
                        <polyline points="8 6 2 12 8 18"/>
                      </svg>
                    </div>
                    <span className={`mr-badge ${latest.components.terraform_code.status === 'ready' ? 'mr-badge-ready' : 'mr-badge-preparing'}`}>
                      {latest.components.terraform_code.status === 'ready' ? 'READY' : 'WAIT'}
                    </span>
                  </div>
                  <div className="pkg-comp-label">GCP Terraform 코드</div>
                  <div className="pkg-comp-sub">생성 + validate 통과</div>
                </div>

                <div className={`pkg-comp ${latest.components.container_image.status === 'ready' ? 'pkg-comp-ready' : 'pkg-comp-wait'}`}>
                  <div className="pkg-comp-top">
                    <div className="pkg-comp-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="8" rx="2"/>
                        <rect x="2" y="14" width="20" height="8" rx="2"/>
                        <line x1="6" y1="6" x2="6.01" y2="6"/>
                        <line x1="6" y1="18" x2="6.01" y2="18"/>
                      </svg>
                    </div>
                    <span className={`mr-badge ${latest.components.container_image.status === 'ready' ? 'mr-badge-ready' : 'mr-badge-preparing'}`}>
                      {latest.components.container_image.status === 'ready' ? 'READY' : 'WAIT'}
                    </span>
                  </div>
                  <div className="pkg-comp-label">컨테이너 이미지</div>
                  <div className="pkg-comp-sub">GCR 복사 완료</div>
                  {latest.components.container_image.gcr_uri && (
                    <div className="pkg-comp-uri" title={latest.components.container_image.gcr_uri}>
                      {latest.components.container_image.gcr_uri}
                    </div>
                  )}
                </div>

                <div className={`pkg-comp ${latest.components.db_snapshot.status === 'ready' ? 'pkg-comp-ready' : 'pkg-comp-wait'}`}>
                  <div className="pkg-comp-top">
                    <div className="pkg-comp-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                        <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
                        <path d="M3 12a9 3 0 0 0 18 0"/>
                      </svg>
                    </div>
                    <span className={`mr-badge ${latest.components.db_snapshot.status === 'ready' ? 'mr-badge-ready' : 'mr-badge-preparing'}`}>
                      {latest.components.db_snapshot.status === 'ready' ? 'READY' : 'SYNCING'}
                    </span>
                  </div>
                  <div className="pkg-comp-label">RDS 스냅샷 Export</div>
                  <div className="pkg-comp-sub">
                    {latest.components.db_snapshot.status === 'ready'
                      ? '완료 (Parquet → S3)'
                      : '진행 중...'}
                  </div>
                </div>
              </div>
            </section>

            {/* ── RTO/RPO + 매핑 신뢰도 ──────────── */}
            <div className="pkg-split">
              <section className="pkg-card pkg-metric-card">
                <div className="pkg-card-eyebrow">
                  <span className="pkg-pip" />
                  Disaster Recovery Forecast
                </div>
                <h3 className="pkg-card-title">DR 예측</h3>
                <div className="pkg-metric-row">
                  <div className="pkg-metric">
                    <div className="pkg-metric-label">예상 RTO</div>
                    <div className="pkg-metric-value">
                      {latest.dr_report.rto_minutes}
                      <span className="pkg-metric-unit">분</span>
                    </div>
                    <div className="pkg-metric-foot">복구 소요 시간</div>
                  </div>
                  <div className="pkg-metric-sep" />
                  <div className="pkg-metric">
                    <div className="pkg-metric-label">예상 RPO</div>
                    <div className="pkg-metric-value">
                      {latest.dr_report.rpo_minutes}
                      <span className="pkg-metric-unit">분</span>
                    </div>
                    <div className="pkg-metric-foot">데이터 손실 한계</div>
                  </div>
                </div>
              </section>

              <section className="pkg-card pkg-conf-card">
                <div className="pkg-card-eyebrow">
                  <span className="pkg-pip pkg-pip-blue" />
                  Mapping Confidence
                </div>
                <h3 className="pkg-card-title">매핑 신뢰도</h3>
                <div className="pkg-conf-list">
                  <div className="pkg-conf-row pkg-conf-auto">
                    <span className="pkg-conf-dot" />
                    <span className="pkg-conf-label">자동 변환</span>
                    <span className="pkg-conf-count">
                      {latest.dr_report.confidence_summary.auto}<span className="pkg-conf-unit">개</span>
                    </span>
                  </div>
                  <div className="pkg-conf-row pkg-conf-review">
                    <span className="pkg-conf-dot" />
                    <span className="pkg-conf-label">검토 필요</span>
                    <span className="pkg-conf-count">
                      {latest.dr_report.confidence_summary.review}<span className="pkg-conf-unit">개</span>
                    </span>
                  </div>
                  {latest.dr_report.confidence_summary.manual > 0 && (
                    <div className="pkg-conf-row pkg-conf-manual">
                      <span className="pkg-conf-dot" />
                      <span className="pkg-conf-label">수동 설정</span>
                      <span className="pkg-conf-count">
                        {latest.dr_report.confidence_summary.manual}<span className="pkg-conf-unit">개</span>
                      </span>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* ── DR 체크리스트 ──────────────────── */}
            <section className="pkg-card">
              <div className="pkg-card-eyebrow">
                <span className="pkg-pip" />
                DR Readiness · Checklist
              </div>
              <h3 className="pkg-card-title">DR 체크리스트</h3>
              <div className="pkg-checklist">
                {latest.dr_report.checklist.map((item, i) => {
                  const cls =
                    item.status === 'done' ? 'pkg-chk-done'
                    : item.status === 'warning' ? 'pkg-chk-warn'
                    : 'pkg-chk-pend'
                  const badgeCls =
                    item.status === 'done' ? 'mr-badge-ready'
                    : item.status === 'warning' ? 'mr-badge-preparing'
                    : 'mr-badge-muted'
                  const badgeLabel =
                    item.status === 'done' ? 'DONE'
                    : item.status === 'warning' ? 'WARNING'
                    : 'PENDING'
                  return (
                    <div key={i} className={`pkg-chk ${cls}`}>
                      <div className="pkg-chk-ico">
                        {item.status === 'done' ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : item.status === 'warning' ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                        ) : (
                          <span className="pkg-chk-dot" />
                        )}
                      </div>
                      <span className="pkg-chk-text">
                        {/* 원본 이모지 아이콘 데이터 보존 — 시각상은 아이콘만 사용 */}
                        <span className="pkg-chk-legacy" aria-hidden="true">{CHECKLIST_ICON[item.status] ?? '⬜'}</span>
                        {item.item}
                      </span>
                      <span className={`mr-badge ${badgeCls}`}>{badgeLabel}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* ── S3 저장 경로 ───────────────────── */}
            <section className="pkg-card">
              <div className="pkg-card-eyebrow">
                <span className="pkg-pip pkg-pip-blue" />
                Storage Location
              </div>
              <h3 className="pkg-card-title">S3 저장 경로</h3>
              <div className="pkg-s3">
                <div className="pkg-s3-bar">
                  <span className="pkg-s3-bucket">s3://</span>
                  <span className="pkg-s3-flag">PRIMARY</span>
                </div>
                <pre className="pkg-s3-path">autoops-dr-packages/projects/{projectId}/latest/</pre>
              </div>
            </section>

            {/* ── 이전 버전 이력 ─────────────────── */}
            {data?.history && data.history.length > 0 && (
              <section className="pkg-card">
                <div className="pkg-card-eyebrow">
                  <span className="pkg-pip" />
                  Version History
                </div>
                <h3 className="pkg-card-title">이전 버전 이력</h3>
                <div className="pkg-history">
                  <div className="pkg-hist pkg-hist-current">
                    <div className="pkg-hist-node">
                      <span className="pkg-hist-pulse" />
                    </div>
                    <div className="pkg-hist-body">
                      <div className="pkg-hist-time">
                        {new Date(latest.created_at).toLocaleString('ko-KR')}
                      </div>
                      <div className="pkg-hist-meta">현재 버전 · latest</div>
                    </div>
                    <span className="mr-badge mr-badge-ready">● READY</span>
                  </div>
                  {data.history.map((h) => (
                    <div key={h.package_id} className="pkg-hist">
                      <div className="pkg-hist-node">
                        <span className="pkg-hist-dot" />
                      </div>
                      <div className="pkg-hist-body">
                        <div className="pkg-hist-time">
                          {new Date(h.created_at).toLocaleString('ko-KR')}
                        </div>
                        <div className="pkg-hist-meta">이전 버전</div>
                      </div>
                      <span className="mr-badge mr-badge-muted">{h.status}</span>
                    </div>
                  ))}
                </div>
              </section>
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

.pkg-page {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: #edf0f6;
  max-width: 1180px;
  margin: 0 auto;
  padding: 40px 36px 80px;
}

/* ── State ──────────────────────────────────── */
.pkg-state {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  height: 100vh;
  font-size: 14px; color: #aeb4c5;
  background: #0b0e17;
}
.pkg-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(174,180,197,0.2);
  border-top-color: #5aa3ff;
  animation: pkg-spin 700ms linear infinite;
}
@keyframes pkg-spin { to { transform: rotate(360deg); } }

.pkg-error-card {
  border-radius: 16px;
  border: 1px solid rgba(239,68,68,0.32);
  background: linear-gradient(180deg, rgba(239,68,68,0.06), rgba(239,68,68,0.015));
  padding: 26px 28px;
  display: flex; flex-direction: column; gap: 14px;
  align-items: flex-start;
}
.pkg-error-head {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ef4444;
}
.pkg-error-dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444; }
.pkg-error-msg { font-size: 14px; color: #edf0f6; margin: 0; line-height: 1.55; }
.pkg-btn-retry {
  display: inline-flex !important; align-items: center !important; gap: 8px !important;
  padding: 10px 16px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  border: 1px solid rgba(255,255,255,0.13) !important;
  background: rgba(255,255,255,0.04) !important;
  color: #aeb4c5 !important;
  cursor: pointer;
}
.pkg-btn-retry:hover { color: #edf0f6 !important; background: rgba(255,255,255,0.08) !important; }

/* ── Header ─────────────────────────────────── */
.pkg-header { margin-bottom: 28px; display: flex; flex-direction: column; gap: 4px; }
.pkg-back {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none;
  color: #aeb4c5;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  padding: 6px 0;
  margin-bottom: 10px;
  transition: color 160ms;
}
.pkg-back:hover { color: #edf0f6; }
.pkg-back:hover .pkg-back-arrow { transform: translateX(-3px); }
.pkg-back-arrow { transition: transform 200ms; display: inline-block; }
.pkg-eyebrow {
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
.pkg-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 8px #ffa53d;
  animation: pkg-pulse 1.6s ease-in-out infinite;
}
.pkg-pip-blue { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
@keyframes pkg-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}
.pkg-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 0 0 12px; color: #edf0f6;
}
.pkg-desc {
  font-size: 15px; color: #aeb4c5;
  line-height: 1.6; margin: 0; max-width: 680px;
}

/* ── Empty ──────────────────────────────────── */
.pkg-empty {
  border-radius: 16px;
  border: 1px dashed rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.012);
  padding: 60px 28px;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.pkg-empty-ico {
  width: 60px; height: 60px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.005));
  color: #7a8298;
  display: grid; place-items: center;
  margin-bottom: 6px;
}
.pkg-empty-title { font-size: 15px; font-weight: 600; color: #edf0f6; margin: 0; }
.pkg-empty-sub { font-size: 13px; color: #aeb4c5; margin: 0; }

/* ── Stack ──────────────────────────────────── */
.pkg-stack { display: flex; flex-direction: column; gap: 20px; }

/* ── Card ───────────────────────────────────── */
.pkg-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 24px 28px;
  display: flex; flex-direction: column; gap: 14px;
}
.pkg-card-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
}
.pkg-card-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 20px;
  letter-spacing: -0.02em;
  color: #edf0f6;
  margin: 0;
}
.pkg-card-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #aeb4c5;
  letter-spacing: 0.02em;
  margin: 4px 0 0;
}

/* ── Badges ─────────────────────────────────── */
.mr-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  border-radius: 100px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.mr-badge-ready     { background: rgba(110,231,160,0.12); color: #6ee7a0; border: 1px solid rgba(110,231,160,0.4); }
.mr-badge-syncing   { background: rgba(90,163,255,0.12);  color: #5aa3ff; border: 1px solid rgba(90,163,255,0.4); }
.mr-badge-preparing { background: rgba(255,165,61,0.12);  color: #ffa53d; border: 1px solid rgba(255,165,61,0.4); }
.mr-badge-failed    { background: rgba(239,68,68,0.12);   color: #ef4444; border: 1px solid rgba(239,68,68,0.4); }
.mr-badge-muted     { background: rgba(122,130,152,0.10); color: #aeb4c5; border: 1px solid rgba(122,130,152,0.32); }

/* ── Hero (구성 현황) ───────────────────────── */
.pkg-hero-row {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.pkg-comp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 4px;
}
.pkg-comp {
  position: relative;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.004));
  padding: 16px 18px;
  display: flex; flex-direction: column; gap: 8px;
  overflow: hidden;
}
.pkg-comp::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: rgba(122,130,152,0.4);
}
.pkg-comp-ready::before { background: #6ee7a0; box-shadow: 0 0 12px rgba(110,231,160,0.5); }
.pkg-comp-wait::before  { background: #ffa53d; box-shadow: 0 0 12px rgba(255,165,61,0.5); }

.pkg-comp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pkg-comp-icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.03);
  color: #aeb4c5;
  display: grid; place-items: center;
}
.pkg-comp-ready .pkg-comp-icon { border-color: rgba(110,231,160,0.4); background: rgba(110,231,160,0.10); color: #6ee7a0; }
.pkg-comp-wait .pkg-comp-icon  { border-color: rgba(255,165,61,0.4);  background: rgba(255,165,61,0.10);  color: #ffa53d; }

.pkg-comp-label {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14.5px; font-weight: 600;
  letter-spacing: -0.005em;
  color: #edf0f6;
  margin-top: 4px;
}
.pkg-comp-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  letter-spacing: 0.04em;
}
.pkg-comp-uri {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #5aa3ff;
  letter-spacing: 0.01em;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(90,163,255,0.18);
  border-radius: 6px;
  padding: 6px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 4px;
}

/* ── Split ──────────────────────────────────── */
.pkg-split {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 16px;
}

/* ── DR Metric ──────────────────────────────── */
.pkg-metric-card {
  background: linear-gradient(180deg, rgba(110,231,160,0.04), rgba(255,255,255,0.005));
  border-color: rgba(110,231,160,0.22);
}
.pkg-metric-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 8px 0 4px;
}
.pkg-metric { display: flex; flex-direction: column; gap: 6px; }
.pkg-metric-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #6ee7a0;
}
.pkg-metric-value {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 52px;
  letter-spacing: -0.04em; line-height: 1;
  color: #6ee7a0;
  text-shadow: 0 0 30px rgba(110,231,160,0.25);
}
.pkg-metric-unit { font-size: 22px; font-weight: 600; color: #aeb4c5; margin-left: 4px; }
.pkg-metric-foot {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.06em;
  margin-top: 2px;
}
.pkg-metric-sep {
  width: 1px; height: 56px;
  background: linear-gradient(180deg, transparent, rgba(110,231,160,0.32), transparent);
}

/* ── Confidence ─────────────────────────────── */
.pkg-conf-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.pkg-conf-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.pkg-conf-row:last-child { border-bottom: none; }
.pkg-conf-dot { width: 8px; height: 8px; border-radius: 50%; }
.pkg-conf-auto .pkg-conf-dot   { background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0; }
.pkg-conf-review .pkg-conf-dot { background: #ffa53d; box-shadow: 0 0 8px #ffa53d; }
.pkg-conf-manual .pkg-conf-dot { background: #ef4444; box-shadow: 0 0 8px #ef4444; }
.pkg-conf-label {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  letter-spacing: -0.005em;
}
.pkg-conf-auto .pkg-conf-label   { color: #6ee7a0; }
.pkg-conf-review .pkg-conf-label { color: #ffa53d; }
.pkg-conf-manual .pkg-conf-label { color: #ef4444; }
.pkg-conf-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 18px; font-weight: 700;
  color: #edf0f6;
  letter-spacing: -0.01em;
}
.pkg-conf-unit { font-size: 12px; color: #7a8298; margin-left: 3px; font-weight: 500; }

/* ── Checklist ──────────────────────────────── */
.pkg-checklist { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.pkg-chk {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.01);
}
.pkg-chk-done { border-color: rgba(110,231,160,0.18); background: rgba(110,231,160,0.03); }
.pkg-chk-warn { border-color: rgba(255,165,61,0.22);  background: rgba(255,165,61,0.04);  }
.pkg-chk-pend { border-color: rgba(122,130,152,0.18); background: rgba(122,130,152,0.03); }
.pkg-chk-ico {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid;
}
.pkg-chk-done .pkg-chk-ico { color: #6ee7a0; border-color: rgba(110,231,160,0.4); background: rgba(110,231,160,0.12); }
.pkg-chk-warn .pkg-chk-ico { color: #ffa53d; border-color: rgba(255,165,61,0.4);  background: rgba(255,165,61,0.12); }
.pkg-chk-pend .pkg-chk-ico { color: #7a8298; border-color: rgba(122,130,152,0.4); background: rgba(122,130,152,0.10); }
.pkg-chk-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pkg-chk-text {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; color: #edf0f6;
  letter-spacing: -0.005em;
}
.pkg-chk-legacy { display: none; } /* CHECKLIST_ICON 보존용 — 시각상 숨김 */

/* ── S3 path ────────────────────────────────── */
.pkg-s3 {
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(0,0,0,0.45);
  overflow: hidden;
}
.pkg-s3-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px;
  background: rgba(255,255,255,0.02);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.pkg-s3-bucket {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  color: #ffa53d;
  letter-spacing: 0.06em;
}
.pkg-s3-flag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.18em;
  color: #6ee7a0;
  padding: 2px 8px;
  border: 1px solid rgba(110,231,160,0.4);
  background: rgba(110,231,160,0.10);
  border-radius: 100px;
}
.pkg-s3-path {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; line-height: 1.5;
  color: #edf0f6;
  padding: 14px 16px;
  margin: 0;
  word-break: break-all;
  white-space: pre-wrap;
}

/* ── History ────────────────────────────────── */
.pkg-history { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.pkg-hist {
  position: relative;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 12px 4px;
}
.pkg-hist:not(:last-child)::after {
  content: ""; position: absolute;
  left: 13px; top: 38px; height: 14px; width: 1px;
  background: linear-gradient(180deg, rgba(255,255,255,0.16), transparent);
}
.pkg-hist-node {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
}
.pkg-hist-current .pkg-hist-node {
  border-color: rgba(110,231,160,0.5);
  background: rgba(110,231,160,0.14);
  box-shadow: 0 0 0 4px rgba(110,231,160,0.10);
}
.pkg-hist-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #6ee7a0; box-shadow: 0 0 10px #6ee7a0;
  animation: pkg-pulse 1.4s ease-in-out infinite;
}
.pkg-hist-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #7a8298;
}
.pkg-hist-time {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; color: #edf0f6;
  letter-spacing: 0.01em;
}
.pkg-hist-current .pkg-hist-time { color: #edf0f6; font-weight: 600; }
.pkg-hist-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #7a8298;
  letter-spacing: 0.08em; text-transform: uppercase;
  margin-top: 2px;
}

/* ── Responsive ─────────────────────────────── */
@media (max-width: 900px) {
  .pkg-page { padding: 32px 20px 80px; }
  .pkg-comp-grid { grid-template-columns: 1fr; }
  .pkg-split { grid-template-columns: 1fr; }
  .pkg-title { font-size: 28px; }
  .pkg-metric-value { font-size: 42px; }
}
`
