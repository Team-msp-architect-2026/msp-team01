// frontend/app/projects/[id]/mirror/page.tsx
'use client'

import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useDRStatus, useSyncHistory } from '@/hooks/useMirrorOps'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

// §12-11 dr_status 표시 정의
const DR_STATUS_CONFIG = {
  ready:     { label: '✅ 준비 완료',    color: 'bg-green-100 text-green-700' },
  syncing:   { label: '🔄 동기화 중',    color: 'bg-yellow-100 text-yellow-700' },
  not_ready: { label: '⚠️ 동기화 필요', color: 'bg-gray-100 text-gray-600' },
}

// §12-11 dr_package.status 표시 정의
const PACKAGE_STATUS_CONFIG = {
  ready:     { label: '✅ 준비 완료',                 color: 'text-green-600' },
  preparing: { label: '⏳ 준비 중 (DB 스냅샷 Export 진행 중...)', color: 'text-yellow-600' },
  failed:    { label: '❌ 생성 실패',                 color: 'text-red-600' },
}

// TRIGGER_TYPE 한글 표시
const TRIGGER_LABEL: Record<string, string> = {
  deployment_completed: '배포 완료',
  infra_changed:        '인프라 변경',
  manual:               '수동 동기화',
}

export default function MirrorDashboardPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: drStatus, isLoading, refetch } = useDRStatus(projectId)
  const { data: history } = useSyncHistory(projectId)

  const handleManualSync = async () => {
    await apiClient.post(`/api/mirror/${projectId}/sync`)
    refetch()
  }

  if (isLoading) {
    return (
      <div className="p-6 text-gray-500">DR 상태 로딩 중...</div>
    )
  }

  const statusConfig = DR_STATUS_CONFIG[drStatus?.dr_status ?? 'not_ready']
  const pkg = drStatus?.dr_package
  const pkgStatusConfig = pkg?.status
    ? PACKAGE_STATUS_CONFIG[pkg.status]
    : null

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🪞 MirrorOps DR Console</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleManualSync}>
            🔄 수동 동기화
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            onClick={() => router.push(`/projects/${projectId}/failover`)}
          >
            🔴 페일오버 실행
          </Button>
        </div>
      </div>

      {/* DR 상태 카드 — §12-11 */}
      <div className="grid grid-cols-2 gap-4">
        {/* AWS Primary */}
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 mb-2">AWS Primary</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🟢</span>
              <div>
                <p className="font-medium">운영 중</p>
                <p className="text-xs text-gray-500">
                  리소스: {drStatus?.aws_resource_count ?? 0}개 · us-west-2
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* GCP Standby */}
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500 mb-2">GCP Standby</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {drStatus?.dr_status === 'ready' ? '🟡' : '⚫'}
              </span>
              <div>
                <p className="font-medium">
                  {drStatus?.dr_status === 'ready' ? '대기 중' : 'DR 패키지 준비 중'}
                </p>
                <p className="text-xs text-gray-500">
                  리소스: {drStatus?.gcp_resource_count ?? 0}개 · us-west1
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* DR 상태 요약 */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">DR 상태</p>
              <Badge className={statusConfig.color}>
                {statusConfig.label}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">마지막 동기화</p>
              <p className="text-sm font-medium">
                {drStatus?.last_synced_at
                  ? new Date(drStatus.last_synced_at).toLocaleString('ko-KR')
                  : '-'}
              </p>
            </div>
          </div>

          {/* DR Package 구성 현황 — §12-11 */}
          {pkg && (
            <div className="space-y-1 pt-2 border-t">
              <p className="text-sm font-medium">DR Package 구성 현황</p>
              <p className={`text-sm${pkgStatusConfig?.color}`}>
                {pkgStatusConfig?.label}
              </p>

              {/* §12-11: DB Export 진행 중인 경우 별도 표시 */}
              {pkg.status === 'preparing' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
                  <p className="text-yellow-700">
                    ⏳ DR 상태: 준비 중 (DB 스냅샷 Export 진행 중...)
                  </p>
                  <p className="text-yellow-600 mt-1">
                    ✅ GCP Terraform 코드 · ✅ 컨테이너 이미지 · ⏳ RDS 스냅샷 Export
                  </p>
                </div>
              )}

              {/* RTO/RPO */}
              <div className="flex gap-4 pt-1">
                <div>
                  <p className="text-xs text-gray-500">예상 RTO</p>
                  <p className="font-medium">{pkg.rto_minutes ?? 12}분</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">예상 RPO</p>
                  <p className="font-medium">{pkg.rpo_minutes ?? 3}분</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 바로가기 버튼 */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${projectId}/mirror/resources`)}
        >
          🗂️ 리소스 매핑 현황
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push(`/projects/${projectId}/mirror/package`)}
        >
          📋 DR 리포트
        </Button>
      </div>

      {/* 동기화 이력 — §12-11 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">동기화 이력</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">동기화 이력이 없습니다.</p>
          ) : (
            history.slice(0, 5).map((h) => (
              <div
                key={h.sync_id}
                className="flex justify-between items-center text-sm border-b py-1"
              >
                <span>
                  {new Date(h.started_at).toLocaleString('ko-KR')}
                </span>
                <span className="text-gray-500">
                  {TRIGGER_LABEL[h.trigger_type] ?? h.trigger_type}
                </span>
                <span>
                  {h.status === 'completed' ? '✅ 완료' : h.status === 'running' ? '⏳ 진행 중' : '❌ 실패'}
                </span>
                <span className="text-xs text-gray-400">
                  {h.completed_at
                    ? `${Math.round(
                        (new Date(h.completed_at).getTime() -
                          new Date(h.started_at).getTime()) /
                          1000
                      )}초`
                    : '-'}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}