// frontend/app/projects/[id]/mirror/resources/page.tsx
'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useResourceMappings } from '@/hooks/useMirrorOps'
import { ResourceMapping, Confidence } from '@/types/mirror'
import { apiClient } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// §5-2 신뢰도 표시 — confidence: auto/review/manual
const CONFIDENCE_CONFIG: Record<Confidence, { label: string; color: string }> = {
  auto:   { label: '✅ 자동',      color: 'bg-green-100 text-green-700' },
  review: { label: '⚠️ 검토 필요', color: 'bg-yellow-100 text-yellow-700' },
  manual: { label: '❌ 수동 설정', color: 'bg-red-100 text-red-700' },
}

// AWS 리소스 타입 → 짧은 이름
const AWS_TYPE_SHORT: Record<string, string> = {
  'AWS::EC2::VPC':                                  'VPC',
  'AWS::EC2::Subnet':                               'Subnet',
  'AWS::EC2::RouteTable':                           'Route Table',
  'AWS::EC2::NatGateway':                           'NAT Gateway',
  'AWS::EC2::SecurityGroup':                        'Security Group',
  'AWS::ElasticLoadBalancingV2::LoadBalancer':      'ALB',
  'AWS::ElasticLoadBalancingV2::TargetGroup':       'Target Group',
  'AWS::IAM::Role':                                 'IAM Role',
  'AWS::ECS::Cluster':                              'ECS Cluster',
  'AWS::ECS::Service':                              'ECS Service',
  'AWS::RDS::DBInstance':                           'RDS',
}

// GCP 리소스 타입 → 짧은 이름
const GCP_TYPE_SHORT: Record<string, string> = {
  'google_compute_network':        'VPC Network',
  'google_compute_subnetwork':     'Subnetwork',
  'google_compute_router':         'Cloud Router',
  'google_compute_router_nat':     'Cloud NAT',
  'google_compute_firewall':       'Firewall Rule',
  'google_compute_backend_service':'Cloud LB',
  'google_service_account':        'Service Account',
  'google_cloud_run_service':      'Cloud Run',
  'google_sql_database_instance':  'Cloud SQL',
}

export default function ResourceMappingsPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { data: mappings, isLoading } = useResourceMappings(projectId)
  const [selectedMapping, setSelectedMapping] = useState<ResourceMapping | null>(null)

  // 신뢰도 요약
  const autoCount   = mappings.filter((m) => m.confidence === 'auto').length
  const reviewCount = mappings.filter((m) => m.confidence === 'review').length
  const manualCount = mappings.filter((m) => m.confidence === 'manual').length

  const handleConfirm = async (mapping: ResourceMapping) => {
    // user_confirmed 업데이트 (Epic 8에서 백엔드 API 연동)
    setSelectedMapping(null)
  }

  if (isLoading) {
    return <div className="p-6 text-gray-500">리소스 매핑 로딩 중...</div>
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">🗂️ 리소스 매핑 현황</h1>

      {/* §12-12: 신뢰도 요약 */}
      <div className="flex gap-4 text-sm">
        <span className="text-green-600 font-medium">✅ 자동 변환 {autoCount}개</span>
        <span>│</span>
        <span className="text-yellow-600 font-medium">⚠️ 검토 필요 {reviewCount}개</span>
        {manualCount > 0 && (
          <>
            <span>│</span>
            <span className="text-red-600 font-medium">❌ 수동 설정 {manualCount}개</span>
          </>
        )}
      </div>

      {/* §12-12: 리소스 매핑 테이블 */}
      <Card>
        <CardContent className="p-0">
          {mappings.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>매핑된 리소스가 없습니다.</p>
              <p className="text-xs mt-1">
                CraftOps로 AWS 인프라 배포 후 MirrorOps 동기화 시 표시됩니다.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-gray-600">
                  <th className="text-left p-3">AWS 리소스</th>
                  <th className="text-left p-3">GCP 리소스</th>
                  <th className="text-left p-3">신뢰도</th>
                  <th className="text-left p-3">액션</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => {
                  const conf = CONFIDENCE_CONFIG[m.confidence]
                  return (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <p className="font-medium">
                          {AWS_TYPE_SHORT[m.aws_resource_type] ?? m.aws_resource_type}
                        </p>
                        <p className="text-xs text-gray-400">{m.aws_resource_name}</p>
                      </td>
                      <td className="p-3">
                        <p className="font-medium">
                          {m.gcp_resource_type
                            ? GCP_TYPE_SHORT[m.gcp_resource_type] ?? m.gcp_resource_type
                            : '-'}
                        </p>
                        <p className="text-xs text-gray-400">{m.gcp_resource_name ?? '-'}</p>
                      </td>
                      <td className="p-3">
                        <Badge className={conf.color}>{conf.label}</Badge>
                      </td>
                      <td className="p-3">
                        {m.confidence === 'review' && !m.user_confirmed && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedMapping(m)}
                          >
                            확인
                          </Button>
                        )}
                        {m.user_confirmed && (
                          <span className="text-xs text-green-600">✅ 확인됨</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* §12-12: 매핑 상세 모달 */}
      {selectedMapping && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="text-base">
                {AWS_TYPE_SHORT[selectedMapping.aws_resource_type] ?? selectedMapping.aws_resource_type}
                {' → '}
                {selectedMapping.gcp_resource_type
                  ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type] ?? selectedMapping.gcp_resource_type
                  : 'GCP 리소스'}{' '}
                매핑 상세
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedMapping(null)}
              >
                ✕
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500">
                  AWS {AWS_TYPE_SHORT[selectedMapping.aws_resource_type]} (원본)
                </p>
                <p className="text-sm mt-1 font-mono bg-gray-50 p-2 rounded">
                  {selectedMapping.aws_resource_name}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  GCP {selectedMapping.gcp_resource_type
                    ? GCP_TYPE_SHORT[selectedMapping.gcp_resource_type]
                    : ''} (변환 결과)
                </p>
                <p className="text-sm mt-1 font-mono bg-gray-50 p-2 rounded">
                  {selectedMapping.gcp_resource_name ?? '-'}
                </p>
              </div>
              {selectedMapping.review_reason && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-700">
                  ⚠️ {selectedMapping.review_reason}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm">
                  ✏️ 수정
                </Button>
                <Button
                  size="sm"
                  className="bg-teal-600 hover:bg-teal-700"
                  onClick={() => handleConfirm(selectedMapping)}
                >
                  ✅ 확인 완료
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}