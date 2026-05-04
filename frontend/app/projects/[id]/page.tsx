// frontend/app/projects/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Project } from '@/types'

const STATUS_CONFIG: Record<string, { text: string; color: string }> = {
  completed:      { text: '✅ 배포 완료',  color: 'text-emerald-400' },
  deploying:      { text: '⏳ 배포 중',    color: 'text-blue-400' },
  failed:         { text: '❌ 배포 실패',  color: 'text-red-400' },
  partial_failed: { text: '⚠️ 부분 실패', color: 'text-yellow-400' },
  created:        { text: '🔧 준비 중',    color: 'text-[#9ca3af]' },
}

const DR_STATUS_CONFIG: Record<string, { text: string; color: string }> = {
  ready:     { text: '✅ 준비 완료',    color: 'text-emerald-400' },
  syncing:   { text: '🔄 동기화 중',    color: 'text-blue-400' },
  not_ready: { text: '⚠️ 동기화 필요', color: 'text-[#9ca3af]' },
}

export default function ProjectDetailPage() {
  const params    = useParams()
  const projectId = params.id as string
  const router    = useRouter()

  const [project, setProject]     = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get(`/api/projects/${projectId}`)
      .then((res) => setProject(res.data.data))
      .catch(() => setError('프로젝트 정보를 불러오지 못했습니다.'))
      .finally(() => setIsLoading(false))
  }, [projectId])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-[#9ca3af]">
        로딩 중...
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="px-6 py-8 md:px-12 md:py-12">
        <p className="text-red-400">{error ?? '프로젝트를 찾을 수 없습니다.'}</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="mt-3 text-sm text-[#9ca3af] hover:text-white transition-colors"
        >
          ← 대시보드로 돌아가기
        </button>
      </div>
    )
  }

  const deployConf = STATUS_CONFIG[project.status]       ?? { text: project.status,    color: 'text-[#9ca3af]' }
  const drConf     = DR_STATUS_CONFIG[project.dr_status] ?? { text: project.dr_status, color: 'text-[#9ca3af]' }

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-5xl">

      {/* 헤더 */}
      <div className="mb-8">
        <button
          onClick={() => router.push('/dashboard')}
          className="text-[#9ca3af] hover:text-white text-sm transition-colors mb-4 block"
        >
          ← 대시보드
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-[#9ca3af] text-sm mt-1">
              {project.prefix}-{project.environment} · {project.region}
            </p>
          </div>
          <span className="text-xs text-[#9ca3af] bg-white/5 px-3 py-1 rounded-full">
            {project.environment}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* ── CraftOps 섹션 ── */}
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs text-[#9ca3af] font-semibold mb-1">🏗️ CraftOps</p>
            <p className="text-sm text-[#9ca3af]">인프라 설계 · 배포</p>
          </div>

          {/* 배포 상태 */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#9ca3af]">배포 상태</span>
              <span className={`font-medium ${deployConf.color}`}>
                {deployConf.text}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#9ca3af]">마지막 배포</span>
              <span className="text-sm">
                {project.last_deployed_at
                  ? new Date(project.last_deployed_at).toLocaleString('ko-KR')
                  : '-'}
              </span>
            </div>
          </div>

          {/* CraftOps 액션 */}
          <div className="space-y-2 pt-2 border-t border-white/8">

            {/* created → 첫 배포 시작 */}
            {project.status === 'created' && (
              <button
                onClick={() => router.push(`/projects/${projectId}/validate`)}
                className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
              >
                🚀 배포 시작
              </button>
            )}

            {/* deploying → 배포 로그 보기 */}
            {project.status === 'deploying' && (
              <button
                onClick={() => router.push(`/projects/${projectId}/deploy`)}
                className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                ⏳ 배포 진행 중 — 로그 보기
              </button>
            )}

            {/* completed / failed → 재배포 */}
            {(project.status === 'completed' || project.status === 'failed') && (
              <button
                onClick={() => router.push(`/projects/${projectId}/validate`)}
                className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
              >
                🔄 재배포
              </button>
            )}

            {/* partial_failed → Partial Failure 대응 */}
            {project.status === 'partial_failed' && (
              <button
                onClick={() => router.push(`/projects/${projectId}/partial-failure`)}
                className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
              >
                ⚠️ Partial Failure 대응
              </button>
            )}
          </div>
        </div>

        {/* ── MirrorOps 섹션 ── */}
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs text-[#9ca3af] font-semibold mb-1">🪞 MirrorOps</p>
            <p className="text-sm text-[#9ca3af]">재해복구 · DR 모니터링</p>
          </div>

          {/* DR 상태 */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#9ca3af]">DR 상태</span>
              <span className={`font-medium ${drConf.color}`}>
                {drConf.text}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#9ca3af]">마지막 동기화</span>
              <span className="text-sm">
                {project.last_synced_at
                  ? new Date(project.last_synced_at).toLocaleString('ko-KR')
                  : '-'}
              </span>
            </div>
          </div>

          {/* MirrorOps 액션 */}
          <div className="space-y-2 pt-2 border-t border-white/8">
            <button
              onClick={() => router.push(`/projects/${projectId}/mirror`)}
              className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
            >
              🪞 DR 대시보드
            </button>
            <button
              onClick={() => router.push(`/projects/${projectId}/mirror/resources`)}
              className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
            >
              🗂️ 리소스 매핑 현황
            </button>
            <button
              onClick={() => router.push(`/projects/${projectId}/mirror/package`)}
              className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium bg-white/5 hover:bg-white/10 transition-colors"
            >
              📦 DR Package
            </button>

            {/* 페일오버 — DR ready 여부에 따라 강조 */}
            <button
              onClick={() => router.push(`/projects/${projectId}/failover`)}
              className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-bold transition-colors ${
                project.dr_status === 'ready'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-white/5 hover:bg-white/10 text-[#9ca3af]'
              }`}
            >
              🔴 페일오버 실행
              {project.dr_status !== 'ready' && (
                <span className="ml-2 text-xs font-normal">(DR 준비 필요)</span>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}