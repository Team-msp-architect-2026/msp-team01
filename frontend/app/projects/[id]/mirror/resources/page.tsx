// frontend/app/projects/[id]/mirror/resources/page.tsx
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useResourceMappings } from '@/hooks/useMirrorOps'
import { ResourceMapping, Confidence } from '@/types/mirror'
import { Button } from '@/components/ui/button'

const CONFIDENCE_CONFIG: Record<Confidence, { label: string; badgeClass: string }> = {
  auto:   { label: '✅ 자동',      badgeClass: 'bg-emerald-500/10 text-emerald-400' },
  review: { label: '⚠️ 검토 필요', badgeClass: 'bg-yellow-500/10 text-yellow-400' },
  manual: { label: '❌ 수동 설정', badgeClass: 'bg-red-500/10 text-red-400' },
}

const AWS_TYPE_SHORT: Record<string, string> = {
  'AWS::EC2::VPC':                                 'VPC',
  'AWS::EC2::Subnet':                              'Subnet',
  'AWS::EC2::RouteTable':                          'Route Table',
  'AWS::EC2::NatGateway':                          'NAT Gateway',
  'AWS::EC2::SecurityGroup':                       'Security Group',
  'AWS::ElasticLoadBalancingV2::LoadBalancer':     'ALB',
  'AWS::ElasticLoadBalancingV2::TargetGroup':      'Target Group',
  'AWS::IAM::Role':                                'IAM Role',
  'AWS::ECS::Cluster':                             'ECS Cluster',
  'AWS::ECS::Service':                             'ECS Service',
  'AWS::RDS::DBInstance':                          'RDS',
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

export default function ResourceMappingsPage() {
  const params = useParams()
  const projectId = params.id as string

  const { data: mappings, isLoading, error } = useResourceMappings(projectId)
  const [selectedMapping, setSelectedMapping] = useState<ResourceMapping | null>(null)
  const [confirmedIds, setConfirmedIds]       = useState<Set<string>>(new Set())

  const autoCount   = mappings.filter((m) => m.confidence === 'auto').length
  const reviewCount = mappings.filter((m) => m.confidence === 'review').length
  const manualCount = mappings.filter((m) => m.confidence === 'manual').length

  const handleConfirm = (mapping: ResourceMapping) => {
    setConfirmedIds((prev) => new Set(prev).add(mapping.aws_resource_id))
    setSelectedMapping(null)
    // TODO: Epic 8 — PATCH /api/mirror/{projectId}/resources/{id}/confirm
  }

  const isConfirmed = (mapping: ResourceMapping) =>
    mapping.user_confirmed || confirmedIds.has(mapping.aws_resource_id)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-[#9ca3af]">
        리소스 매핑 로딩 중...
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-6 py-8 md:px-12 md:py-12 text-red-400">{error}</div>
    )
  }

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">🗂️ 리소스 매핑 현황</h1>

      {/* 신뢰도 요약 */}
      <div className="flex gap-4 text-sm mb-6">
        <span className="text-emerald-400 font-medium">✅ 자동 변환 {autoCount}개</span>
        <span className="text-white/20">│</span>
        <span className="text-yellow-400 font-medium">⚠️ 검토 필요 {reviewCount}개</span>
        {manualCount > 0 && (
          <>
            <span className="text-white/20">│</span>
            <span className="text-red-400 font-medium">❌ 수동 설정 {manualCount}개</span>
          </>
        )}
      </div>

      {/* 매핑 테이블 */}
      <div className="bg-[#121214] border border-white/8 rounded-3xl overflow-hidden">
        {mappings.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[#9ca3af]">매핑된 리소스가 없습니다.</p>
            <p className="text-xs text-[#9ca3af]/60 mt-2">
              CraftOps로 AWS 인프라 배포 후 MirrorOps 동기화 시 표시됩니다.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left p-4 text-xs text-[#9ca3af] font-semibold">AWS 리소스</th>
                <th className="text-left p-4 text-xs text-[#9ca3af] font-semibold">GCP 리소스</th>
                <th className="text-left p-4 text-xs text-[#9ca3af] font-semibold">신뢰도</th>
                <th className="text-left p-4 text-xs text-[#9ca3af] font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => {
                const conf = CONFIDENCE_CONFIG[m.confidence]
                return (
                  <tr key={i} className="border-b border-white/8 hover:bg-white/[0.02]">
                    <td className="p-4">
                      <p className="font-medium">
                        {AWS_TYPE_SHORT[m.aws_resource_type] ?? m.aws_resource_type}
                      </p>
                      <p className="text-xs text-[#9ca3af] mt-0.5">{m.aws_resource_name}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium">
                        {m.gcp_resource_type
                          ? GCP_TYPE_SHORT[m.gcp_resource_type] ?? m.gcp_resource_type
                          : '-'}
                      </p>
                      <p className="text-xs text-[#9ca3af] mt-0.5">
                        {m.gcp_resource_name ?? '-'}
                      </p>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${conf.badgeClass}`}>
                        {conf.label}
                      </span>
                    </td>
                    <td className="p-4">
                      {m.confidence === 'review' && !isConfirmed(m) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white text-xs"
                          onClick={() => setSelectedMapping(m)}
                        >
                          확인
                        </Button>
                      )}
                      {isConfirmed(m) && (
                        <span className="text-xs text-emerald-400">✅ 확인됨</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 매핑 상세 모달 */}
      {selectedMapping && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#121214] border border-white/8 rounded-3xl w-full max-w-lg mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <p className="font-semibold">
                {AWS_TYPE_SHORT[selectedMapping.aws_resource_type] ?? selectedMapping.aws_resource_type}
                {' → '}
                {selectedMapping.gcp_resource_type
                  ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type] ?? selectedMapping.gcp_resource_type
                  : 'GCP 리소스'}{' '}
                매핑 상세
              </p>
              <button
                onClick={() => setSelectedMapping(null)}
                className="text-[#9ca3af] hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-[#9ca3af] mb-1">
                  AWS {AWS_TYPE_SHORT[selectedMapping.aws_resource_type]} (원본)
                </p>
                <p className="text-sm font-mono bg-black/30 border border-white/8 rounded-xl p-3">
                  {selectedMapping.aws_resource_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#9ca3af] mb-1">
                  GCP{' '}
                  {selectedMapping.gcp_resource_type
                    ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type]
                    : ''}{' '}
                  (변환 결과)
                </p>
                <p className="text-sm font-mono bg-black/30 border border-white/8 rounded-xl p-3">
                  {selectedMapping.gcp_resource_name ?? '-'}
                </p>
              </div>

              {selectedMapping.review_reason && (
                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-xs text-yellow-400">
                  ⚠️ {selectedMapping.review_reason}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white"
                >
                  ✏️ 수정
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handleConfirm(selectedMapping)}
                >
                  ✅ 확인 완료
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}