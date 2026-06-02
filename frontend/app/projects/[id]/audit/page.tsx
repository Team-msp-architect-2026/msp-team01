// frontend/app/projects/[id]/audit/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'

interface AuditLog {
  id:         string
  layer:      'platform' | 'aws_change' | 'validation_block'
  action:     string
  actor:      string
  detail:     Record<string, any>
  created_at: string
}

const LAYER_CONFIG = {
  platform:         { label: '플랫폼 행위',     color: 'text-blue-400',   bg: 'bg-blue-400/10'   },
  aws_change:       { label: 'AWS 변경',        color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  validation_block: { label: 'Validation 차단', color: 'text-red-400',    bg: 'bg-red-400/10'    },
}

const ACTION_LABEL: Record<string, string> = {
  craftops_deploy:            '배포 실행',
  craftops_destroy:           '인프라 삭제',
  project_delete:             '프로젝트 삭제',
  failover_execute:           '페일오버 실행',
  drift_approve:              'Drift 승인',
  drift_reject:               'Drift 거부',
  onboarding_complete:        '온보딩 완료',
  validation_blocked_tfsec:   'tfsec 차단',
  validation_blocked_checkov: 'checkov 차단',
}

export default function AuditLogPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()
  const [logs, setLogs]       = useState<AuditLog[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [layer, setLayer]     = useState<string>('')

  useEffect(() => {
    setLoading(true)
    const params = layer ? `?layer=${layer}` : ''
    apiClient
      .get(`/api/projects/${projectId}/audit-logs${params}`)
      .then(res => {
        setLogs(res.data.data.items)
        setTotal(res.data.data.total)
      })
      .finally(() => setLoading(false))
  }, [projectId, layer])

  return (
    <div className="px-6 py-8 max-w-4xl">
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="text-[#9ca3af] hover:text-white text-sm mb-6 block"
      >
        ← 거버넌스 허브
      </button>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <span className="text-sm text-[#9ca3af]">총 {total}건</span>
      </div>

      {/* 레이어 필터 */}
      <div className="flex gap-2 mb-4">
        {[
          { value: '',                 label: '전체' },
          { value: 'platform',         label: '플랫폼 행위' },
          { value: 'aws_change',       label: 'AWS 변경' },
          { value: 'validation_block', label: 'Validation 차단' },
        ].map(f => (
          <button
            key={f.value}
            onClick={() => setLayer(f.value)}
            className={`px-3 py-1.5 text-xs rounded-xl transition-colors ${
              layer === f.value
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-[#9ca3af] hover:bg-white/10'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[#9ca3af] text-sm">로딩 중...</p>
      ) : logs.length === 0 ? (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-8 text-center">
          <p className="text-[#9ca3af] text-sm">기록이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const cfg = LAYER_CONFIG[log.layer]
            return (
              <div key={log.id} className="bg-[#121214] border border-white/8 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-sm font-medium">
                        {ACTION_LABEL[log.action] || log.action}
                      </span>
                    </div>
                    <p className="text-xs text-[#9ca3af] font-mono">{log.actor}</p>
                    {log.detail && Object.keys(log.detail).length > 0 && (
                      <pre className="text-xs text-[#9ca3af] mt-2 bg-black/20 p-2 rounded-lg overflow-x-auto">
                        {JSON.stringify(log.detail, null, 2)}
                      </pre>
                    )}
                  </div>
                  <span className="text-xs text-[#9ca3af] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString('ko-KR')}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}