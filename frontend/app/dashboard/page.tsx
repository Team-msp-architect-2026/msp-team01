// frontend/app/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Project } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const STATUS_LABEL: Record<string, string> = {
  completed:  '✅ 완료',
  deploying:  '⏳ 배포 중',
  failed:     '❌ 실패',
  created:    '🔧 준비 중',
}

const DR_STATUS_LABEL: Record<string, string> = {
  ready:     '✅ 준비 완료',
  syncing:   '🔄 동기화 중',
  not_ready: '⚠️ 동기화 필요',
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await apiClient.get('/api/projects')
        setProjects(res.data.data)
      } finally {
        setIsLoading(false)
      }
    }
    fetchProjects()
  }, [])

  // §12-4 요약 통계
  const totalResources = projects.length * 16
  const drReadyCount = projects.filter((p) => p.dr_status === 'ready').length
  const drReadyRate = projects.length > 0
    ? Math.round((drReadyCount / projects.length) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🏠 대시보드</h1>
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          onClick={() => router.push('/projects/new')}
        >
          + 새 프로젝트
        </Button>
      </div>

      {/* 요약 카드 — §12-4 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-gray-500">전체 프로젝트</p>
            <p className="text-3xl font-bold">{projects.length}개</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-gray-500">AWS 리소스</p>
            <p className="text-3xl font-bold">{totalResources}개</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm text-gray-500">DR 준비율</p>
            <p className="text-3xl font-bold">{drReadyRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* 최근 프로젝트 목록 */}
      <Card>
        <CardHeader>
          <CardTitle>최근 프로젝트</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-gray-500">로딩 중...</p>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>프로젝트가 없습니다.</p>
              <Button
                className="mt-2 bg-teal-600 hover:bg-teal-700"
                onClick={() => router.push('/projects/new')}
              >
                + 새 인프라 생성
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="text-left py-2">이름</th>
                  <th className="text-left py-2">환경</th>
                  <th className="text-left py-2">상태</th>
                  <th className="text-left py-2">DR 상태</th>
                  <th className="text-left py-2">마지막 배포</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.project_id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/projects/${p.project_id}`)}
                  >
                    <td className="py-2 font-medium">
                      {p.prefix}-{p.environment}
                    </td>
                    <td className="py-2">
                      <Badge variant="outline">{p.environment}</Badge>
                    </td>
                    <td className="py-2">{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td className="py-2">{DR_STATUS_LABEL[p.dr_status] ?? p.dr_status}</td>
                    <td className="py-2 text-gray-500">
                      {p.last_deployed_at
                        ? new Date(p.last_deployed_at).toLocaleDateString('ko-KR')
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* DR 상태 요약 */}
      <Card>
        <CardHeader>
          <CardTitle>DR 상태 요약</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {projects.map((p) => (
            <div key={p.project_id} className="flex justify-between items-center py-1 border-b">
              <span className="font-medium">{p.prefix}-{p.environment}</span>
              <span>{DR_STATUS_LABEL[p.dr_status] ?? p.dr_status}</span>
              <span className="text-xs text-gray-500">
                {p.last_synced_at
                  ? `마지막 동기화:${new Date(p.last_synced_at).toLocaleDateString('ko-KR')}`
                  : '동기화 없음'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}