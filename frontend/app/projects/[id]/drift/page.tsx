// frontend/app/projects/[id]/drift/page.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'

interface DriftEvent {
  drift_id:      string
  resource_id:   string
  resource_type: string
  changed_by:    string
  diff_summary:  string
  severity:      'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  status:        'detected' | 'accepted' | 'guided'
  detected_at:   string
}

const SEVERITY_CONFIG = {
  CRITICAL: { color: 'text-red-400',    bg: 'bg-red-400/10',    emoji: '🔴' },
  HIGH:     { color: 'text-yellow-400', bg: 'bg-yellow-400/10', emoji: '🟡' },
  MEDIUM:   { color: 'text-orange-400', bg: 'bg-orange-400/10', emoji: '🟠' },
  LOW:      { color: 'text-[#9ca3af]',  bg: 'bg-white/5',       emoji: '⚪' },
}

const STATUS_LABEL = {
  detected: '미처리',
  accepted: '승인됨',
  guided:   '가이드 발송',
}

export default function DriftPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router   = useRouter()
  const [events, setEvents]     = useState<DriftEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [filter, setFilter]     = useState<string>('all')

  const fetchEvents = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/drift`)
      setEvents(res.data.data)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // WebSocket drift_detected 이벤트 수신 → 자동 갱신
  useEffect(() => {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || ''
    const wsUrl   = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')
    const token   = typeof window !== 'undefined' ? localStorage.getItem('access_token') : ''
    const ws      = new WebSocket(`${wsUrl}/ws/events/${projectId}?token=${token}`)

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'drift_detected') fetchEvents()
    }

    return () => ws.close()
  }, [projectId, fetchEvents])

  const handleApprove = async (driftId: string) => {
    setActionId(driftId)
    try {
      await apiClient.post(`/api/drift/${driftId}/approve`)
      await fetchEvents()
    } finally { setActionId(null) }
  }

  const handleReject = async (driftId: string) => {
    setActionId(driftId)
    try {
      await apiClient.post(`/api/drift/${driftId}/reject`)
      await fetchEvents()
    } finally { setActionId(null) }
  }

  const filtered = filter === 'all' ? events
    : filter === 'detected' ? events.filter(e => e.status === 'detected')
    : events.filter(e => e.severity === filter)

  if (loading) return <div className="p-8 text-[#9ca3af]">로딩 중...</div>

  return (
    <div className="px-6 py-8 max-w-4xl">
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        className="text-[#9ca3af] hover:text-white text-sm mb-6 block"
      >
        ← 거버넌스 허브
      </button>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Configuration Drift</h1>
        <span className="text-sm text-[#9ca3af]">총 {events.length}건</span>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4">
        {[
          { v: 'all',      l: '전체' },
          { v: 'detected', l: '미처리' },
          { v: 'CRITICAL', l: '🔴 CRITICAL' },
          { v: 'HIGH',     l: '🟡 HIGH' },
        ].map(f => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3 py-1.5 text-xs rounded-xl transition-colors ${
              filter === f.v ? 'bg-white/15 text-white' : 'bg-white/5 text-[#9ca3af] hover:bg-white/10'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-8 text-center">
          <p className="text-emerald-400 font-semibold">✅ 감지된 Drift 없음</p>
          <p className="text-sm text-[#9ca3af] mt-1">모든 리소스가 Baseline과 일치합니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(event => {
            const cfg = SEVERITY_CONFIG[event.severity]
            return (
              <div
                key={event.drift_id}
                className={`bg-[#121214] border border-white/8 rounded-3xl p-5 ${
                  event.severity === 'CRITICAL' ? 'border-red-500/30' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold ${cfg.color}`}>
                        {cfg.emoji} {event.severity}
                      </span>
                      <span className="text-xs text-[#9ca3af]">
                        {STATUS_LABEL[event.status]}
                      </span>
                    </div>
                    <p className="text-sm font-medium font-mono">{event.resource_id}</p>
                    <p className="text-xs text-[#9ca3af] mt-1">
                      {event.resource_type.split('::').slice(1).join('::')}
                    </p>
                    <p className="text-xs text-[#9ca3af] mt-2">{event.diff_summary}</p>
                    {event.changed_by && (
                      <p className="text-xs text-[#9ca3af] mt-1">
                        변경자: <span className="font-mono">{event.changed_by}</span>
                      </p>
                    )}
                    <p className="text-xs text-[#9ca3af] mt-1">
                      {new Date(event.detected_at).toLocaleString('ko-KR')}
                    </p>
                  </div>

                  {event.status === 'detected' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleApprove(event.drift_id)}
                        disabled={actionId === event.drift_id}
                        className="px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-xl transition-colors disabled:opacity-50"
                      >
                        ✅ 승인
                      </button>
                      <button
                        onClick={() => handleReject(event.drift_id)}
                        disabled={actionId === event.drift_id}
                        className="px-3 py-1.5 text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors disabled:opacity-50"
                      >
                        ❌ 거부
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}