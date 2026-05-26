'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useResourceMappings } from '@/hooks/useMirrorOps'
import { ResourceMapping, Confidence } from '@/types/mirror'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api'

type ExtendedConfidence = Confidence | 'not_required'

const CONFIDENCE_CONFIG: Record<ExtendedConfidence, { label: string; badgeClass: string }> = {
  auto:         { label: '✅ 자동',      badgeClass: 'bg-emerald-500/10 text-emerald-400' },
  review:       { label: '⚠️ 검토 필요', badgeClass: 'bg-yellow-500/10 text-yellow-400' },
  manual:       { label: '🔧 수동 설정', badgeClass: 'bg-red-500/10 text-red-400' },
  not_required: { label: 'ℹ️ 매핑 불필요', badgeClass: 'bg-[#9ca3af]/10 text-[#9ca3af]' },
}

const AWS_TYPE_SHORT: Record<string, string> = {
  'AWS::EC2::VPC':                                 'VPC',
  'AWS::EC2::Subnet':                              'Subnet',
  'AWS::EC2::RouteTable':                          'Route Table',
  'AWS::EC2::NatGateway':                          'NAT Gateway',
  'AWS::EC2::InternetGateway':                     'Internet Gateway',
  'AWS::EC2::SecurityGroup':                       'Security Group',
  'AWS::ElasticLoadBalancingV2::LoadBalancer':     'ALB',
  'AWS::ElasticLoadBalancingV2::TargetGroup':      'Target Group',
  'AWS::IAM::Role':                                'IAM Role',
  'AWS::ECS::Cluster':                             'ECS Cluster',
  'AWS::ECS::Service':                             'ECS Service',
  'AWS::ECS::TaskDefinition':                      'ECS Task Definition',
  'AWS::RDS::DBInstance':                          'RDS',
  'AWS::RDS::DBSubnetGroup':                       'RDS Subnet Group',
  'AWS::Logs::LogGroup':                           'Log Group',
  'AWS::KMS::Key':                                 'KMS Key',
}

const GCP_TYPE_SHORT: Record<string, string> = {
  'google_compute_network':         'VPC Network',
  'google_compute_subnetwork':      'Subnetwork',
  'google_compute_router':          'Cloud Router',
  'google_compute_router_nat':      'Cloud NAT',
  'google_compute_firewall':        'Firewall Rule',
  'google_compute_backend_service': 'Cloud LB',
  'google_service_account':         'Service Account',
  'google_cloud_run_service':       'Cloud Run',
  'google_sql_database_instance':   'Cloud SQL',
}

// review_reason을 사용자 친화적으로 변환
const formatReviewReason = (reason: string): string => {
  if (!reason) return ''
  // 기술적인 ID 패턴 제거 (sg-xxx, vpc-xxx 등)
  return reason
    .replace(/\(sg-[a-z0-9]+\)/g, '')
    .replace(/\(vpc-[a-z0-9]+\)/g, '')
    .replace(/\(subnet-[a-z0-9]+\)/g, '')
    .replace(/source group reference/gi, '다른 보안 그룹 참조')
    .replace(/source_ranges/g, '허용 IP 범위')
    .replace(/CIDR/g, 'IP 범위')
    .replace(/INGRESS/g, '인바운드')
    .replace(/EGRESS/g, '아웃바운드')
    .trim()
}

// confidence key → mr-badge 변종 매핑 (시각용; CONFIDENCE_CONFIG는 불변)
const BADGE_VARIANT: Record<ExtendedConfidence, string> = {
  auto:         'mr-badge mr-badge-ready',
  review:       'mr-badge mr-badge-preparing',
  manual:       'mr-badge mr-badge-failed',
  not_required: 'mr-badge mr-badge-muted',
}

export default function ResourceMappingsPage() {
  const params = useParams()
  const projectId = params.id as string

  const { data: mappings, isLoading, error } = useResourceMappings(projectId)
  const [selectedMapping, setSelectedMapping] = useState<ResourceMapping | null>(null)
  const [confirmedIds, setConfirmedIds]       = useState<Set<string>>(new Set())
  const [isEditing, setIsEditing]             = useState(false)
  const [editedCode, setEditedCode]           = useState('')

  const autoCount        = mappings.filter((m) => m.confidence === 'auto').length
  const reviewCount      = mappings.filter((m) => m.confidence === 'review').length
  const manualCount      = mappings.filter((m) => m.confidence === 'manual').length
  const notRequiredCount = mappings.filter((m) => (m.confidence as string) === 'not_required').length

  const handleConfirm = (mapping: ResourceMapping) => {
    setConfirmedIds((prev) => new Set(prev).add(mapping.aws_resource_id))
    setSelectedMapping(null)
    setIsEditing(false)
  }

  const handleOpenEdit = (mapping: ResourceMapping) => {
    setEditedCode(mapping.terraform_code ?? '')
    setIsEditing(true)
  }

  const handleSaveEdit = async () => {
    if (!selectedMapping) return
    try {
      await apiClient.patch(
        `/api/mirror/${projectId}/resources/${selectedMapping.resource_id}/terraform-code`,
        { terraform_code: editedCode }
      )
      setIsEditing(false)
    } catch (err) {
      console.error('저장 실패:', err)
    }
  }

  const isConfirmed = (mapping: ResourceMapping) =>
    mapping.user_confirmed || confirmedIds.has(mapping.aws_resource_id)

  const getConfidence = (m: ResourceMapping): ExtendedConfidence =>
    (m.confidence as ExtendedConfidence) ?? 'manual'

  if (isLoading) {
    return (
      <>
        <style>{styles}</style>
        <div className="mr-state">
          <span className="mr-spinner" />
          <span>리소스 매핑 로딩 중...</span>
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <style>{styles}</style>
        <div className="mr-state mr-state-error">{error}</div>
      </>
    )
  }

  const total = autoCount + reviewCount + manualCount + notRequiredCount

  return (
    <>
      <style>{styles}</style>

      <div className="mr-page">

        {/* ── Page header ────────────────────────────── */}
        <header className="mr-page-header">
          <div className="mr-eyebrow">
            <span className="mr-pip" />
            MirrorOps · AWS → GCP
          </div>
          <h1 className="mr-page-title">리소스 매핑 현황</h1>
          <p className="mr-page-desc">
            CraftOps가 배포한 AWS 리소스를 GCP DR 환경으로 변환한 결과입니다. 검토가 필요한 항목은
            Terraform 코드를 직접 확인하고 확정해주세요.
          </p>
        </header>

        {/* ── Summary strip ──────────────────────────── */}
        <section className="mr-summary">
          <div className="mr-sum-card mr-sum-auto">
            <div className="mr-sum-eyebrow">자동 변환</div>
            <div className="mr-sum-num">{autoCount}</div>
            <div className="mr-sum-foot">
              {total > 0 ? Math.round((autoCount / total) * 100) : 0}% · ready
            </div>
          </div>
          <div className="mr-sum-card mr-sum-review">
            <div className="mr-sum-eyebrow">검토 필요</div>
            <div className="mr-sum-num">{reviewCount}</div>
            <div className="mr-sum-foot">
              {total > 0 ? Math.round((reviewCount / total) * 100) : 0}% · preparing
            </div>
          </div>
          <div className={`mr-sum-card mr-sum-manual ${manualCount === 0 ? 'mr-dim' : ''}`}>
            <div className="mr-sum-eyebrow">수동 설정</div>
            <div className="mr-sum-num">{manualCount}</div>
            <div className="mr-sum-foot">
              {total > 0 ? Math.round((manualCount / total) * 100) : 0}% · failed
            </div>
          </div>
          <div className={`mr-sum-card mr-sum-nr ${notRequiredCount === 0 ? 'mr-dim' : ''}`}>
            <div className="mr-sum-eyebrow">매핑 불필요</div>
            <div className="mr-sum-num">{notRequiredCount}</div>
            <div className="mr-sum-foot">
              {total > 0 ? Math.round((notRequiredCount / total) * 100) : 0}% · skipped
            </div>
          </div>
        </section>

        {/* ── Mapping table ──────────────────────────── */}
        <section className="mr-card mr-table-card">
          <div className="mr-card-head">
            <div>
              <div className="mr-card-eyebrow">
                <span className="mr-pip mr-pip-blue" />
                Mapping Table
              </div>
              <h2 className="mr-card-title">전체 리소스 ({mappings.length})</h2>
            </div>
            <div className="mr-card-meta">
              <span className="mr-meta-k">REGION PAIR</span>
              <span className="mr-meta-v">us-west-2 → asia-northeast3</span>
            </div>
          </div>

          {mappings.length === 0 ? (
            <div className="mr-empty">
              <p className="mr-empty-title">매핑된 리소스가 없습니다.</p>
              <p className="mr-empty-sub">
                CraftOps로 AWS 인프라 배포 후 MirrorOps 동기화 시 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="mr-table-wrap">
              <table className="mr-table">
                <thead>
                  <tr>
                    <th>AWS 리소스</th>
                    <th>GCP 리소스</th>
                    <th>신뢰도</th>
                    <th className="mr-th-action">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m, i) => {
                    const confKey    = getConfidence(m)
                    const conf       = CONFIDENCE_CONFIG[confKey]
                    const isNR       = (m.confidence as string) === 'not_required'
                    return (
                      <tr key={i} className={`mr-row ${isNR ? 'mr-row-nr' : ''}`}>
                        <td>
                          <div className="mr-res">
                            <div className="mr-res-type mr-res-aws">
                              {AWS_TYPE_SHORT[m.aws_resource_type] ?? m.aws_resource_type}
                            </div>
                            <div className="mr-res-name">{m.aws_resource_name}</div>
                          </div>
                        </td>
                        <td>
                          {isNR ? (
                            <span className="mr-nr-tag">GCP 불필요</span>
                          ) : (
                            <div className="mr-res">
                              <div className="mr-res-type mr-res-gcp">
                                {m.gcp_resource_type
                                  ? GCP_TYPE_SHORT[m.gcp_resource_type] ?? m.gcp_resource_type
                                  : '-'}
                              </div>
                              <div className="mr-res-name">
                                {m.gcp_resource_name ?? '-'}
                              </div>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={BADGE_VARIANT[confKey]}>
                            {conf.label}
                          </span>
                        </td>
                        <td className="mr-td-action">
                          {m.confidence === 'review' && !isConfirmed(m) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mr-btn-confirm"
                              onClick={() => setSelectedMapping(m)}
                            >
                              확인
                            </Button>
                          )}
                          {m.confidence === 'review' && isConfirmed(m) && (
                            <span className="mr-confirmed">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              확인됨
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── Modal ─────────────────────────────────── */}
      {selectedMapping && (
        <div className="mr-modal-backdrop">
          <div className="mr-modal">
            <header className="mr-modal-head">
              <div>
                <div className="mr-card-eyebrow">
                  <span className="mr-pip mr-pip-blue" />
                  Mapping Detail
                </div>
                <h3 className="mr-modal-title">
                  <span className="mr-modal-aws">
                    {AWS_TYPE_SHORT[selectedMapping.aws_resource_type] ?? selectedMapping.aws_resource_type}
                  </span>
                  <span className="mr-modal-arrow">→</span>
                  <span className="mr-modal-gcp">
                    {selectedMapping.gcp_resource_type
                      ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type] ?? selectedMapping.gcp_resource_type
                      : 'GCP 리소스'}
                  </span>
                </h3>
              </div>
              <button
                onClick={() => { setSelectedMapping(null); setIsEditing(false) }}
                className="mr-modal-close"
                aria-label="닫기"
              >
                ✕
              </button>
            </header>

            <div className="mr-modal-body">
              <div className="mr-kv">
                <div className="mr-kv-label">
                  AWS · {AWS_TYPE_SHORT[selectedMapping.aws_resource_type]} (원본)
                </div>
                <div className="mr-kv-value mr-mono">
                  {selectedMapping.aws_resource_name}
                </div>
              </div>
              <div className="mr-kv">
                <div className="mr-kv-label">
                  GCP · {selectedMapping.gcp_resource_type
                    ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type]
                    : ''} (변환 결과)
                </div>
                <div className="mr-kv-value mr-mono">
                  {selectedMapping.gcp_resource_name ?? '-'}
                </div>
              </div>

              {/* 검토 안내 */}
              {selectedMapping.review_reason && (
                <div className="mr-callout">
                  <div className="mr-callout-head">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    검토가 필요한 이유
                  </div>
                  <p className="mr-callout-body">
                    {formatReviewReason(selectedMapping.review_reason)}
                  </p>
                </div>
              )}

              {/* Terraform 코드 */}
              {isEditing ? (
                <div className="mr-kv">
                  <div className="mr-kv-label mr-kv-label-edit">
                    <span>Terraform 코드 수정</span>
                    <span className="mr-edit-flag">EDITING</span>
                  </div>
                  <textarea
                    value={editedCode}
                    onChange={(e) => setEditedCode(e.target.value)}
                    rows={10}
                    className="mr-textarea mr-mono"
                  />
                </div>
              ) : (
                selectedMapping.terraform_code && (
                  <div className="mr-kv">
                    <div className="mr-kv-label">Terraform 코드</div>
                    <pre className="mr-code mr-mono">
                      {selectedMapping.terraform_code}
                    </pre>
                  </div>
                )
              )}

              <div className="mr-modal-actions">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mr-btn-secondary"
                      onClick={() => setIsEditing(false)}
                    >
                      취소
                    </Button>
                    <Button
                      size="sm"
                      className="mr-btn-primary mr-btn-save"
                      onClick={handleSaveEdit}
                    >
                      저장
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mr-btn-secondary"
                      onClick={() => handleOpenEdit(selectedMapping)}
                    >
                      ✏️ 수정
                    </Button>
                    <Button
                      size="sm"
                      className="mr-btn-primary mr-btn-approve"
                      onClick={() => handleConfirm(selectedMapping)}
                    >
                      ✅ 확인 완료
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── styles ─────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

.mr-page {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: #edf0f6;
  max-width: 1280px;
  margin: 0 auto;
  padding: 40px 36px 80px;
}

/* ── State views ─────────────────────────────────── */
.mr-state {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  height: 100vh;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; color: #aeb4c5;
  background: #0b0e17;
}
.mr-state-error { color: #ef4444; height: auto; padding: 80px 36px; }
.mr-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(174,180,197,0.2);
  border-top-color: #5aa3ff;
  animation: mr-spin 700ms linear infinite;
}
@keyframes mr-spin { to { transform: rotate(360deg); } }

/* ── Page header ─────────────────────────────────── */
.mr-page-header { margin-bottom: 28px; }
.mr-eyebrow {
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
.mr-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 8px #ffa53d;
  animation: mr-pulse 1.6s ease-in-out infinite;
}
.mr-pip-blue { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
@keyframes mr-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}
.mr-page-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 0 0 12px; color: #edf0f6;
}
.mr-page-desc {
  font-size: 15px; color: #aeb4c5;
  line-height: 1.6; margin: 0; max-width: 680px;
}

/* ── Summary cards ───────────────────────────────── */
.mr-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 24px;
}
.mr-sum-card {
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
}
.mr-sum-card::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: currentColor;
  opacity: 0.55;
}
.mr-sum-auto    { color: #6ee7a0; }
.mr-sum-review  { color: #ffa53d; }
.mr-sum-manual  { color: #ef4444; }
.mr-sum-nr      { color: #7a8298; }
.mr-dim         { opacity: 0.5; }
.mr-sum-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: currentColor;
  margin-bottom: 8px;
}
.mr-sum-num {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 32px;
  letter-spacing: -0.03em;
  color: #edf0f6;
  line-height: 1;
  margin-bottom: 8px;
}
.mr-sum-foot {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; color: #aeb4c5;
  letter-spacing: 0.06em;
}

/* ── Card ────────────────────────────────────────── */
.mr-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  overflow: hidden;
}
.mr-card-head {
  padding: 22px 28px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
  flex-wrap: wrap;
}
.mr-card-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
  margin-bottom: 10px;
}
.mr-card-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 19px;
  letter-spacing: -0.015em;
  color: #edf0f6;
  margin: 0;
}
.mr-card-meta {
  display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.mr-meta-k {
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #7a8298;
}
.mr-meta-v {
  font-size: 12px; color: #edf0f6;
  letter-spacing: 0.02em;
}

/* ── Empty ───────────────────────────────────────── */
.mr-empty { padding: 60px 28px; text-align: center; }
.mr-empty-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 600;
  color: #edf0f6; margin: 0 0 6px;
}
.mr-empty-sub {
  font-size: 13px; color: #aeb4c5;
  margin: 0;
}

/* ── Table ───────────────────────────────────────── */
.mr-table-wrap { overflow-x: auto; }
.mr-table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Plus Jakarta Sans', sans-serif;
}
.mr-table thead th {
  text-align: left;
  padding: 14px 28px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #7a8298;
  background: rgba(255,255,255,0.015);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.mr-table thead .mr-th-action { width: 130px; }
.mr-row {
  border-bottom: 1px solid rgba(255,255,255,0.06);
  transition: background 160ms;
}
.mr-row:last-child { border-bottom: none; }
.mr-row:hover { background: rgba(255,255,255,0.02); }
.mr-row-nr { opacity: 0.5; }
.mr-table tbody td { padding: 16px 28px; vertical-align: top; }

.mr-res { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.mr-res-type {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 600; font-size: 14px;
  letter-spacing: -0.005em;
  color: #edf0f6;
  display: inline-flex; align-items: center; gap: 8px;
}
.mr-res-type::before {
  content: ""; width: 6px; height: 6px; border-radius: 2px;
  flex-shrink: 0;
}
.mr-res-aws::before { background: #ffa53d; box-shadow: 0 0 6px rgba(255,165,61,0.6); }
.mr-res-gcp::before { background: #5aa3ff; box-shadow: 0 0 6px rgba(90,163,255,0.6); }
.mr-res-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #7a8298;
  letter-spacing: 0.02em;
  word-break: break-all;
}
.mr-nr-tag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #7a8298;
  font-style: italic;
  letter-spacing: 0.04em;
}

/* ── Badges (mr-badge) ───────────────────────────── */
.mr-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  border-radius: 100px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.mr-badge-ready     { background: rgba(110,231,160,0.12); color: #6ee7a0; border: 1px solid rgba(110,231,160,0.4); }
.mr-badge-syncing   { background: rgba(90,163,255,0.12);  color: #5aa3ff; border: 1px solid rgba(90,163,255,0.4); }
.mr-badge-preparing { background: rgba(255,165,61,0.12);  color: #ffa53d; border: 1px solid rgba(255,165,61,0.4); }
.mr-badge-failed    { background: rgba(239,68,68,0.12);   color: #ef4444; border: 1px solid rgba(239,68,68,0.4); }
.mr-badge-muted     { background: rgba(122,130,152,0.10); color: #aeb4c5; border: 1px solid rgba(122,130,152,0.32); }

/* ── Action buttons in table ─────────────────────── */
.mr-td-action { white-space: nowrap; }
.mr-btn-confirm {
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 12px !important; font-weight: 600 !important;
  padding: 7px 16px !important;
  border-radius: 8px !important;
  border: 1px solid rgba(90,163,255,0.4) !important;
  background: rgba(90,163,255,0.10) !important;
  color: #5aa3ff !important;
  cursor: pointer;
  transition: all 160ms;
}
.mr-btn-confirm:hover {
  background: rgba(90,163,255,0.18) !important;
  border-color: rgba(90,163,255,0.6) !important;
  color: #edf0f6 !important;
}
.mr-confirmed {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em;
  color: #6ee7a0;
}

/* ── Modal ───────────────────────────────────────── */
.mr-modal-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(11, 14, 23, 0.78);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: mr-fade-in 160ms ease-out;
  font-family: 'Plus Jakarta Sans', sans-serif;
}
@keyframes mr-fade-in { from { opacity: 0; } to { opacity: 1; } }
.mr-modal {
  width: 100%; max-width: 640px;
  max-height: calc(100vh - 48px);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, #15171f, #101218);
  box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(90,163,255,0.06);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: mr-modal-in 220ms cubic-bezier(.22,.8,.18,1);
  color: #edf0f6;
}
@keyframes mr-modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.mr-modal-head {
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.mr-modal-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 18px;
  letter-spacing: -0.015em;
  margin: 0;
  display: inline-flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.mr-modal-aws { color: #ffa53d; }
.mr-modal-gcp { color: #5aa3ff; }
.mr-modal-arrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #7a8298; font-weight: 500;
}
.mr-modal-close {
  background: none;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 8px;
  width: 32px; height: 32px;
  color: #aeb4c5;
  cursor: pointer;
  font-size: 13px;
  display: grid; place-items: center;
  transition: all 160ms;
  flex-shrink: 0;
}
.mr-modal-close:hover {
  color: #edf0f6;
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.22);
}

.mr-modal-body {
  padding: 22px 24px 24px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 16px;
}

.mr-kv { display: flex; flex-direction: column; gap: 8px; }
.mr-kv-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #aeb4c5;
}
.mr-kv-label-edit {
  display: flex; align-items: center; justify-content: space-between;
}
.mr-edit-flag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.18em;
  color: #ffa53d;
  padding: 3px 8px;
  border: 1px solid rgba(255,165,61,0.4);
  background: rgba(255,165,61,0.10);
  border-radius: 100px;
}
.mr-kv-value {
  font-size: 13px;
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 11px 14px;
  color: #edf0f6;
  word-break: break-all;
}
.mr-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  letter-spacing: 0.01em;
}

.mr-callout {
  border: 1px solid rgba(255,165,61,0.32);
  background: linear-gradient(135deg, rgba(255,165,61,0.08), rgba(255,165,61,0.02));
  border-radius: 12px;
  padding: 14px 16px;
}
.mr-callout-head {
  display: flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #ffa53d;
  margin-bottom: 8px;
}
.mr-callout-body {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px; line-height: 1.6;
  color: #edf0f6;
  margin: 0;
}

.mr-code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.6;
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 14px 16px;
  color: #aeb4c5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  margin: 0;
}
.mr-textarea {
  width: 100%;
  background: rgba(0,0,0,0.45);
  border: 1px solid rgba(90,163,255,0.32);
  border-radius: 10px;
  padding: 14px 16px;
  color: #edf0f6;
  resize: vertical;
  outline: none;
  transition: border-color 160ms, box-shadow 160ms;
  line-height: 1.6;
}
.mr-textarea:focus {
  border-color: rgba(90,163,255,0.6);
  box-shadow: 0 0 0 3px rgba(90,163,255,0.12);
}

/* ── Modal actions ───────────────────────────────── */
.mr-modal-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255,255,255,0.06);
  margin-top: 6px;
  padding-top: 16px;
}
.mr-btn-primary {
  padding: 10px 18px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  letter-spacing: -0.005em !important;
  border: 1px solid rgba(255,255,255,0.15) !important;
  background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)) !important;
  color: #edf0f6 !important;
  cursor: pointer;
  transition: all 180ms;
}
.mr-btn-secondary {
  padding: 10px 18px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 500 !important;
  border: 1px solid rgba(255,255,255,0.13) !important;
  background: transparent !important;
  color: #aeb4c5 !important;
  cursor: pointer;
  transition: all 160ms;
}
.mr-btn-secondary:hover {
  color: #edf0f6 !important;
  background: rgba(255,255,255,0.04) !important;
}
.mr-btn-save {
  background: linear-gradient(180deg, #5aa3ff, #3d83df) !important;
  border: 1px solid rgba(90,163,255,0.6) !important;
  color: #0b0e17 !important;
  box-shadow: 0 0 24px rgba(90,163,255,0.22);
}
.mr-btn-save:hover {
  filter: brightness(1.08);
  box-shadow: 0 0 32px rgba(90,163,255,0.35);
}
.mr-btn-approve {
  background: linear-gradient(180deg, rgba(110,231,160,0.22), rgba(110,231,160,0.10)) !important;
  border: 1px solid rgba(110,231,160,0.5) !important;
  color: #6ee7a0 !important;
}
.mr-btn-approve:hover {
  background: linear-gradient(180deg, rgba(110,231,160,0.32), rgba(110,231,160,0.16)) !important;
  border-color: rgba(110,231,160,0.7) !important;
  color: #b9f5cf !important;
}

/* ── Responsive ──────────────────────────────────── */
@media (max-width: 900px) {
  .mr-page { padding: 32px 20px 80px; }
  .mr-summary { grid-template-columns: repeat(2, 1fr); }
  .mr-page-title { font-size: 28px; }
  .mr-card-head { flex-direction: column; align-items: flex-start; }
  .mr-card-meta { align-items: flex-start; }
  .mr-table thead th, .mr-table tbody td { padding: 12px 16px; }
}
@media (max-width: 600px) {
  .mr-summary { grid-template-columns: 1fr 1fr; }
}
`
