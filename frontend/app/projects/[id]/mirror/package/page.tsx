// frontend/app/projects/[id]/mirror/package/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { Button } from '@/components/ui/button'

const CHECKLIST_ICON: Record<string, string> = {
  done:    '✅',
  pending: '⏳',
  warning: '⚠️',
}

export default function DRPackagePage() {
  const params = useParams()
  const projectId = params.id as string

  const { data, isLoading, error, refetch } = useDRPackage(projectId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-[#9ca3af]">
        DR Package 로딩 중...
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

  const latest = data?.latest

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-5xl">
      <h1 className="text-2xl font-bold mb-6">📦 DR Package 상세</h1>

      {!latest ? (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-12 text-center">
          <p className="text-[#9ca3af]">DR Package가 없습니다.</p>
          <p className="text-xs text-[#9ca3af]/60 mt-2">
            CraftOps 배포 완료 후 MirrorOps 동기화 시 자동 생성됩니다.
          </p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* 구성 현황 */}
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-[#9ca3af] font-semibold">구성 현황</p>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  latest.status === 'ready'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-yellow-500/10 text-yellow-400'
                }`}>
                  {latest.status === 'ready' ? '✅ 준비 완료' : '⏳ 준비 중'}
                </span>
                <span className="text-xs text-[#9ca3af]">
                  {new Date(latest.created_at).toLocaleString('ko-KR')}
                </span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span>{latest.components.terraform_code.status === 'ready' ? '✅' : '⏳'}</span>
                <span>GCP Terraform 코드 생성 완료 + validate 통과</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span>{latest.components.container_image.status === 'ready' ? '✅' : '⏳'}</span>
                <span>컨테이너 이미지 GCR 복사 완료</span>
                {latest.components.container_image.gcr_uri && (
                  <span className="text-xs text-[#9ca3af] font-mono truncate max-w-xs">
                    ({latest.components.container_image.gcr_uri})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span>
                  {latest.components.db_snapshot.status === 'ready' ? '✅' : '⏳'}
                </span>
                <span>
                  RDS 스냅샷 Export{' '}
                  {latest.components.db_snapshot.status === 'ready'
                    ? '완료 (Parquet → S3)'
                    : '진행 중...'}
                </span>
              </div>
            </div>
          </div>

          {/* DR 예측 + 매핑 신뢰도 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
              <p className="text-sm text-[#9ca3af] font-semibold mb-4">DR 예측</p>
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-[#9ca3af]">예상 RTO</p>
                  <p className="text-3xl font-bold text-emerald-400">
                    {latest.dr_report.rto_minutes}
                    <span className="text-lg font-normal text-[#9ca3af] ml-1">분</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#9ca3af]">예상 RPO</p>
                  <p className="text-3xl font-bold text-emerald-400">
                    {latest.dr_report.rpo_minutes}
                    <span className="text-lg font-normal text-[#9ca3af] ml-1">분</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
              <p className="text-sm text-[#9ca3af] font-semibold mb-4">매핑 신뢰도</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-emerald-400">✅ 자동</span>
                  <span>{latest.dr_report.confidence_summary.auto}개</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-yellow-400">⚠️ 검토 필요</span>
                  <span>{latest.dr_report.confidence_summary.review}개</span>
                </div>
                {latest.dr_report.confidence_summary.manual > 0 && (
                  <div className="flex justify-between">
                    <span className="text-red-400">❌ 수동</span>
                    <span>{latest.dr_report.confidence_summary.manual}개</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DR 체크리스트 */}
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
            <p className="text-sm text-[#9ca3af] font-semibold mb-4">DR 체크리스트</p>
            <div className="space-y-3">
              {latest.dr_report.checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span>{CHECKLIST_ICON[item.status] ?? '⬜'}</span>
                  <span>{item.item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* S3 저장 경로 */}
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
            <p className="text-sm text-[#9ca3af] font-semibold mb-3">S3 저장 경로</p>
            <p className="text-xs font-mono bg-black/30 border border-white/8 rounded-xl p-3 text-[#9ca3af]">
              autoops-dr-packages/projects/{projectId}/latest/
            </p>
          </div>

          {/* [FIX] 옵셔널 체이닝 통일 */}
          {data?.history && data.history.length > 0 && (
            <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
              <p className="text-sm text-[#9ca3af] font-semibold mb-4">이전 버전 이력</p>
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm border-b border-white/8 pb-2">
                  <span className="font-medium">
                    {new Date(latest.created_at).toLocaleString('ko-KR')}
                  </span>
                  <span className="text-[#9ca3af] text-xs">현재 버전</span>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400">
                    ✅ ready
                  </span>
                </div>
                {data.history.map((h) => (
                  <div
                    key={h.package_id}
                    className="flex justify-between items-center text-sm"
                  >
                    <span className="text-[#9ca3af]">
                      {new Date(h.created_at).toLocaleString('ko-KR')}
                    </span>
                    <span className="text-[#9ca3af] text-xs">이전 버전</span>
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/5 text-[#9ca3af]">
                      {h.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}