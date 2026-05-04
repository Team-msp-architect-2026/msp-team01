// frontend/app/projects/[id]/mirror/page.tsx
'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useDRStatus, useSyncHistory } from '@/hooks/useMirrorOps'
import { Button } from '@/components/ui/button'

const DR_STATUS_CONFIG = {
  ready:     { label: '✅ 준비 완료',    badgeClass: 'bg-emerald-500/10 text-emerald-400' },
  syncing:   { label: '🔄 동기화 중',    badgeClass: 'bg-blue-500/10 text-blue-400' },
  not_ready: { label: '⚠️ 동기화 필요', badgeClass: 'bg-white/5 text-[#9ca3af]' },
}

const PACKAGE_STATUS_CONFIG = {
  ready:     { label: '✅ 준비 완료',                              color: 'text-emerald-400' },
  preparing: { label: '⏳ 준비 중 (DB 스냅샷 Export 진행 중...)', color: 'text-yellow-400' },
  failed:    { label: '❌ 생성 실패',                              color: 'text-red-400' },
}

const TRIGGER_LABEL: Record<string, string> = {
  deployment_completed: '배포 완료',
  infra_changed:        '인프라 변경',
  manual:               '수동 동기화',
}

export default function MirrorDashboardPage() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()

  const { data: drStatus, isLoading, error, refetch } = useDRStatus(projectId)
  const { data: history } = useSyncHistory(projectId)

  const [syncError, setSyncError] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  const handleManualSync = async () => {
    setSyncError(null)
    setIsSyncing(true)
    try {
      await apiClient.post(`/api/mirror/${projectId}/sync`)
      refetch()
    } catch (err: unknown) {
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
      <div className="flex items-center justify-center h-screen text-[#9ca3af]">
        DR 상태 로딩 중...
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-6 py-8 md:px-12 md:py-12">
        <p className="text-red-400">{error}</p>
        <Button
          variant="outline"
          className="mt-3 border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white"
          onClick={refetch}
        >
          다시 시도
        </Button>
      </div>
    )
  }

  const statusKey       = drStatus?.dr_status ?? 'not_ready'
  const statusConfig    = DR_STATUS_CONFIG[statusKey]
  const pkg             = drStatus?.dr_package
  const pkgStatusConfig = pkg?.status ? PACKAGE_STATUS_CONFIG[pkg.status] : null

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-5xl">

      {/* 페이지 헤더 — [수정 3] 페일오버 버튼 헤더에서 제거 */}
      <div className="mb-8 flex flex-col md:flex-row md:justify-between md:items-start gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">MirrorOps</h2>
          <p className="text-[#9ca3af] text-sm">
            us-west-2 리전 기준 실시간 인프라 동기화 현황입니다.
          </p>
        </div>
        {/* 수동 동기화만 헤더에 유지 */}
        <Button
          variant="outline"
          className="border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white"
          onClick={handleManualSync}
          disabled={isSyncing}
        >
          {isSyncing ? '동기화 중...' : '🔄 수동 동기화'}
        </Button>
      </div>

      {/* 동기화 에러 */}
      {syncError && (
        <div className="mb-4 bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
          {syncError}
        </div>
      )}

      {/* AWS Primary / GCP Standby */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
          <p className="text-xs text-[#9ca3af] font-semibold mb-3">AWS Primary</p>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🟢</span>
            <div>
              <p className="font-semibold">운영 중</p>
              <p className="text-xs text-[#9ca3af] mt-0.5">
                리소스: {drStatus?.aws_resource_count ?? 0}개 · us-west-2
              </p>
            </div>
          </div>
        </div>

        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
          <p className="text-xs text-[#9ca3af] font-semibold mb-3">GCP Standby</p>
          <div className="flex items-center gap-3">
            <span className="text-3xl">
              {drStatus?.dr_status === 'ready' ? '🟡' : '⚫'}
            </span>
            <div>
              <p className="font-semibold">
                {drStatus?.dr_status === 'ready' ? '대기 중' : 'DR 패키지 준비 중'}
              </p>
              <p className="text-xs text-[#9ca3af] mt-0.5">
                리소스: {drStatus?.gcp_resource_count ?? 0}개 · us-west1
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* DR 상태 요약 */}
      <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 mb-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-[#9ca3af] mb-2">DR 상태</p>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.badgeClass}`}>
              {statusConfig.label}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#9ca3af] mb-1">마지막 동기화</p>
            <p className="text-sm font-medium">
              {drStatus?.last_synced_at
                ? new Date(drStatus.last_synced_at).toLocaleString('ko-KR')
                : '-'}
            </p>
          </div>
        </div>

        {pkg && (
          <div className="pt-4 border-t border-white/8 space-y-2">
            <p className="text-sm font-medium">DR Package 구성 현황</p>
            <p className={`text-sm ${pkgStatusConfig?.color}`}>
              {pkgStatusConfig?.label}
            </p>

            {pkg.status === 'preparing' && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 text-xs">
                <p className="text-yellow-400">
                  ⏳ DR 상태: 준비 중 (DB 스냅샷 Export 진행 중...)
                </p>
                <p className="text-yellow-400/70 mt-1">
                  ✅ GCP Terraform 코드 · ✅ 컨테이너 이미지 · ⏳ RDS 스냅샷 Export
                </p>
              </div>
            )}

            <div className="flex gap-6 pt-1">
              <div>
                <p className="text-xs text-[#9ca3af]">예상 RTO</p>
                <p className="text-lg font-bold text-emerald-400">{pkg.rto_minutes ?? 12}분</p>
              </div>
              <div>
                <p className="text-xs text-[#9ca3af]">예상 RPO</p>
                <p className="text-lg font-bold text-emerald-400">{pkg.rpo_minutes ?? 3}분</p>
              </div>
            </div>
          </div>
        )}

        {/* [수정 3] 페일오버 버튼 — DR 상태 카드 하단으로 이동 */}
        <div className="pt-4 border-t border-white/8 flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            className="border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white flex-1"
            onClick={() => router.push(`/projects/${projectId}/mirror/resources`)}
          >
            🗂️ 리소스 매핑 현황
          </Button>
          <Button
            variant="outline"
            className="border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white flex-1"
            onClick={() => router.push(`/projects/${projectId}/mirror/package`)}
          >
            📋 DR 리포트
          </Button>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white flex-1"
            onClick={() => router.push(`/projects/${projectId}/failover`)}
          >
            🔴 페일오버 실행
          </Button>
        </div>
      </div>

      {/* 동기화 이력 */}
      <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
        <p className="text-sm text-[#9ca3af] font-semibold mb-4">동기화 이력</p>
        {history.length === 0 ? (
          <p className="text-sm text-[#9ca3af]">동기화 이력이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {history.slice(0, 5).map((h) => (
              <div
                key={h.sync_id}
                className="flex justify-between items-center text-sm border-b border-white/8 pb-3"
              >
                <span className="text-[#9ca3af]">
                  {new Date(h.started_at).toLocaleString('ko-KR')}
                </span>
                <span className="text-[#9ca3af]">
                  {TRIGGER_LABEL[h.trigger_type] ?? h.trigger_type}
                </span>
                <span>
                  {h.status === 'completed'
                    ? '✅ 완료'
                    : h.status === 'running'
                    ? '⏳ 진행 중'
                    : '❌ 실패'}
                </span>
                <span className="text-xs text-[#9ca3af]">
                  {h.completed_at
                    ? `${Math.round(
                        (new Date(h.completed_at).getTime() -
                          new Date(h.started_at).getTime()) /
                          1000
                      )}초`
                    : '-'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}