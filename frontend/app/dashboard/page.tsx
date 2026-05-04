// frontend/app/dashboard/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Project } from '@/types'

const STATUS_CONFIG: Record<string, { text: string; color: string }> = {
  completed:      { text: '✅ 완료',      color: 'text-emerald-400' },
  deploying:      { text: '⏳ 배포 중',   color: 'text-blue-400' },
  failed:         { text: '❌ 실패',      color: 'text-red-400' },
  partial_failed: { text: '⚠️ 부분 실패', color: 'text-yellow-400' },
  created:        { text: '🔧 준비 중',   color: 'text-[#9ca3af]' },
}

const DR_STATUS_CONFIG: Record<string, { text: string; color: string }> = {
  ready:     { text: '✅ 준비 완료',    color: 'text-emerald-400' },
  syncing:   { text: '🔄 동기화 중',    color: 'text-blue-400' },
  not_ready: { text: '⚠️ 동기화 필요', color: 'text-[#9ca3af]' },
}

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects]     = useState<Project[]>([])
  const [isLoading, setIsLoading]   = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [destroyAws, setDestroyAws] = useState(false)

  useEffect(() => {
    apiClient
      .get('/api/projects')
      .then((res) => setProjects(res.data.data))
      .catch(() => setError('프로젝트 목록을 불러오지 못했습니다.'))
      .finally(() => setIsLoading(false))
  }, [])

  const handleDelete = async (projectId: string) => {
    try {
      await apiClient.request({
        method: 'DELETE',
        url: `/api/projects/${projectId}`,
        data: { destroy_aws_resources: destroyAws },
      })
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId))
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? '프로젝트 삭제에 실패했습니다.'
      setError(msg)
    } finally {
      setDeletingId(null)
      setDestroyAws(false)
    }
  }

  const totalResources = projects.length * 16
  const drReadyCount   = projects.filter((p) => p.dr_status === 'ready').length
  const drReadyRate    = projects.length > 0
    ? Math.round((drReadyCount / projects.length) * 100)
    : 0

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-5xl">

      {/* 헤더 */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">⚙️ AutoOps</h1>
          <p className="text-[#9ca3af] text-sm mt-1">대시보드</p>
        </div>
        <button
          onClick={() => router.push('/projects/new')}
          className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-xl hover:bg-white/90 transition-colors"
        >
          + 새 프로젝트
        </button>
      </div>

      {/* 요약 카드 3개 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 text-center">
          <p className="text-xs text-[#9ca3af] mb-2">전체 프로젝트</p>
          <p className="text-3xl font-bold">{projects.length}개</p>
        </div>
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 text-center">
          <p className="text-xs text-[#9ca3af] mb-2">AWS 리소스</p>
          <p className="text-3xl font-bold">{totalResources}개</p>
        </div>
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 text-center">
          <p className="text-xs text-[#9ca3af] mb-2">DR 준비율</p>
          <p className={`text-3xl font-bold ${
            drReadyRate === 100 ? 'text-emerald-400' :
            drReadyRate > 0     ? 'text-yellow-400'  : 'text-[#9ca3af]'
          }`}>
            {drReadyRate}%
          </p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="mb-4 bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 flex justify-between items-center">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* 프로젝트 목록 */}
      <div className="bg-[#121214] border border-white/8 rounded-3xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/8">
          <p className="text-sm font-semibold">프로젝트 목록</p>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-[#9ca3af] text-sm">
            로딩 중...
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-[#9ca3af]">프로젝트가 없습니다.</p>
            <button
              onClick={() => router.push('/projects/new')}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-sm rounded-xl transition-colors"
            >
              + 새 프로젝트 만들기
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8">
                <th className="text-left px-6 py-3 text-xs text-[#9ca3af] font-semibold">프로젝트</th>
                <th className="text-left px-4 py-3 text-xs text-[#9ca3af] font-semibold">환경</th>
                <th className="text-left px-4 py-3 text-xs text-[#9ca3af] font-semibold">배포 상태</th>
                <th className="text-left px-4 py-3 text-xs text-[#9ca3af] font-semibold">DR 상태</th>
                <th className="text-left px-4 py-3 text-xs text-[#9ca3af] font-semibold">마지막 배포</th>
                <th className="text-left px-4 py-3 text-xs text-[#9ca3af] font-semibold">바로가기</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const deployConf         = STATUS_CONFIG[p.status]       ?? { text: p.status,    color: 'text-[#9ca3af]' }
                const drConf             = DR_STATUS_CONFIG[p.dr_status] ?? { text: p.dr_status, color: 'text-[#9ca3af]' }
                const isConfirmingDelete = deletingId === p.project_id

                return (
                  <tr
                    key={p.project_id}
                    className="border-b border-white/8 hover:bg-white/[0.04] cursor-pointer transition-colors"
                    onClick={() => {
                      if (isConfirmingDelete) return
                      router.push(`/projects/${p.project_id}`)
                    }}
                  >
                    <td className="px-6 py-4">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-[#9ca3af] mt-0.5">
                        {p.prefix}-{p.environment} · {p.region}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-white/5 text-[#9ca3af]">
                        {p.environment}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-sm font-medium ${deployConf.color}`}>
                        {deployConf.text}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-sm font-medium ${drConf.color}`}>
                        {drConf.text}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-[#9ca3af] text-xs">
                      {p.last_deployed_at
                        ? new Date(p.last_deployed_at).toLocaleString('ko-KR')
                        : '-'}
                    </td>

                    {/* 바로가기 + 삭제 */}
                    <td className="px-4 py-4">
                      <div
                        className="flex gap-2 items-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isConfirmingDelete && (
                          <>
                            <button
                              onClick={() => router.push(`/projects/${p.project_id}/mirror`)}
                              className="px-2.5 py-1 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-[#9ca3af] hover:text-white transition-colors"
                              title="MirrorOps DR 대시보드"
                            >
                              🪞 DR
                            </button>
                            <button
                              onClick={() => router.push(`/projects/${p.project_id}/failover`)}
                              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                                p.dr_status === 'ready'
                                  ? 'bg-red-600/20 hover:bg-red-600/40 text-red-400'
                                  : 'bg-white/5 hover:bg-white/10 text-[#9ca3af]'
                              }`}
                              title="페일오버 콘솔"
                            >
                              🔴
                            </button>
                            <button
                              onClick={() => setDeletingId(p.project_id)}
                              className="px-2.5 py-1 rounded-lg text-xs bg-white/5 hover:bg-red-500/20 text-[#9ca3af] hover:text-red-400 transition-colors"
                              title="프로젝트 삭제"
                            >
                              🗑️
                            </button>
                          </>
                        )}

                        {/* 삭제 확인 단계 */}
                        {isConfirmingDelete && (
                          <div className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-1.5 text-xs text-[#9ca3af] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={destroyAws}
                                onChange={(e) => setDestroyAws(e.target.checked)}
                                className="accent-red-500"
                              />
                              AWS 리소스도 삭제
                            </label>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleDelete(p.project_id)}
                                className="px-2.5 py-1 rounded-lg text-xs bg-red-600 hover:bg-red-700 text-white transition-colors"
                              >
                                삭제
                              </button>
                              <button
                                onClick={() => {
                                  setDeletingId(null)
                                  setDestroyAws(false)
                                }}
                                className="px-2.5 py-1 rounded-lg text-xs bg-white/5 hover:bg-white/10 text-[#9ca3af] transition-colors"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}