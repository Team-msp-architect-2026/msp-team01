// frontend/app/projects/[id]/mirror/package/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// §12-13 체크리스트 상태 표시
const CHECKLIST_ICON: Record<string, string> = {
  done:    '✅',
  pending: '⏳',
  warning: '⚠️',
}

export default function DRPackagePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const { data, isLoading } = useDRPackage(projectId)

  if (isLoading) {
    return <div className="p-6 text-gray-500">DR Package 로딩 중...</div>
  }

  const latest = data?.latest

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">📦 DR Package 상세</h1>

      {!latest ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            <p>DR Package가 없습니다.</p>
            <p className="text-xs mt-1">
              CraftOps 배포 완료 후 MirrorOps 동기화 시 자동 생성됩니다.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* §12-13: 구성 현황 */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-sm">구성 현황</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge
                    className={
                      latest.status === 'ready'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }
                  >
                    {latest.status === 'ready' ? '✅ 준비 완료' : '⏳ 준비 중'}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    {new Date(latest.created_at).toLocaleString('ko-KR')}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Terraform 코드 */}
              <div className="flex items-center gap-2 text-sm">
                <span>
                  {latest.components.terraform_code.status === 'ready' ? '✅' : '⏳'}
                </span>
                <span>GCP Terraform 코드 생성 완료 + validate 통과</span>
              </div>

              {/* 컨테이너 이미지 */}
              <div className="flex items-center gap-2 text-sm">
                <span>
                  {latest.components.container_image.status === 'ready' ? '✅' : '⏳'}
                </span>
                <span>컨테이너 이미지 GCR 복사 완료</span>
                {latest.components.container_image.gcr_uri && (
                  <span className="text-xs text-gray-400 font-mono truncate max-w-xs">
                    ({latest.components.container_image.gcr_uri})
                  </span>
                )}
              </div>

              {/* DB 스냅샷 */}
              <div className="flex items-center gap-2 text-sm">
                <span>
                  {latest.components.db_snapshot.status === 'ready'
                    ? '✅'
                    : latest.components.db_snapshot.status === 'exporting'
                    ? '⏳'
                    : '⏳'}
                </span>
                <span>
                  RDS 스냅샷 Export{' '}
                  {latest.components.db_snapshot.status === 'ready'
                    ? '완료 (Parquet → S3)'
                    : '진행 중...'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* §12-13: DR 예측 + 매핑 신뢰도 */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">DR 예측</p>
                <div className="flex gap-4 mt-2">
                  <div>
                    <p className="text-xs text-gray-400">예상 RTO</p>
                    <p className="text-2xl font-bold text-teal-600">
                      {latest.dr_report.rto_minutes}분
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">예상 RPO</p>
                    <p className="text-2xl font-bold text-teal-600">
                      {latest.dr_report.rpo_minutes}분
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-gray-500">매핑 신뢰도</p>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-green-600">✅ 자동</span>
                    <span>{latest.dr_report.confidence_summary.auto}개</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-yellow-600">⚠️ 검토 필요</span>
                    <span>{latest.dr_report.confidence_summary.review}개</span>
                  </div>
                  {latest.dr_report.confidence_summary.manual > 0 && (
                    <div className="flex justify-between">
                      <span className="text-red-600">❌ 수동</span>
                      <span>{latest.dr_report.confidence_summary.manual}개</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* §12-13: DR 체크리스트 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">DR 체크리스트</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {latest.dr_report.checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span>{CHECKLIST_ICON[item.status] ?? '⬜'}</span>
                  <span>{item.item}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* §12-13: S3 저장 경로 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">S3 저장 경로</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs font-mono text-gray-600 bg-gray-50 p-2 rounded">
                autoops-dr-packages/projects/{projectId}/latest/
              </p>
            </CardContent>
          </Card>

          {/* §12-13: 이전 버전 이력 */}
          {data?.history && data.history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">이전 버전 이력</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {/* 현재 버전 */}
                <div className="flex justify-between text-sm border-b pb-1">
                  <span className="font-medium">
                    {new Date(latest.created_at).toLocaleString('ko-KR')}
                  </span>
                  <span className="text-gray-500">현재 버전</span>
                  <Badge className="bg-green-100 text-green-700">✅ ready</Badge>
                </div>
                {/* 과거 버전 */}
                {data.history.map((h) => (
                  <div key={h.package_id} className="flex justify-between text-sm">
                    <span>{new Date(h.created_at).toLocaleString('ko-KR')}</span>
                    <span className="text-gray-500">이전 버전</span>
                    <Badge variant="outline">{h.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}