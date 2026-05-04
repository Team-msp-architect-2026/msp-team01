// frontend/app/projects/[id]/failover/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { FailoverResponse } from '@/types/mirror'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const SIMULATION_STEPS = [
  { label: 'Terraform Init',         duration: '2초' },
  { label: 'Terraform Plan',         duration: 'GCP 11개' },
  { label: 'Terraform Apply',        duration: '시뮬레이션' },
  { label: 'Cloud SQL 복원 예상',     duration: '3분 20초' },
  { label: 'Cloud Run 배포 예상',     duration: '2분 10초' },
  { label: 'Load Balancer 헬스체크',  duration: '시뮬레이션' },
]

export default function FailoverPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()

  const [mode, setMode]                 = useState<'simulation' | 'actual'>('simulation')
  const [confirmName, setConfirmName]   = useState('')
  const [isRunning, setIsRunning]       = useState(false)
  const [error, setError]               = useState('')
  const [failoverData, setFailoverData] = useState<FailoverResponse | null>(null)
  const [simStep, setSimStep]           = useState(-1)
  const [logs, setLogs]                 = useState<string[]>([])

  const { data: packageData } = useDRPackage(projectId)
  const latest = packageData?.latest

  const { events } = useWebSocket(
    failoverData ? projectId : null,
    // [FIX] fo_ 접두사 제거
    failoverData ? failoverData.failover_id : null
  )

  // ── 시뮬레이션 단계 진행 ─────────────────────────────────────
  useEffect(() => {
    if (!isRunning || mode !== 'simulation') return

    // [FIX] 마지막 단계에서 isRunning false 전환
    if (simStep >= SIMULATION_STEPS.length - 1) {
      setIsRunning(false)
      return
    }

    const timer = setTimeout(() => setSimStep((s) => s + 1), 800)
    return () => clearTimeout(timer)
  }, [isRunning, simStep, mode])

  // ── WebSocket 이벤트 (actual 모드) ───────────────────────────
  useEffect(() => {
    if (!events.length) return
    const latest_event = events[events.length - 1]

    if (latest_event.event_type === 'failover_progress') {
      const data = latest_event.data as { current_resource?: string }
      if (data.current_resource) {
        setLogs((prev) => [...prev, data.current_resource!])
      }
    }

    if (latest_event.event_type === 'failover_completed') {
      const data = latest_event.data as {
        gcp_resources_created?: number
        actual_rto_seconds?: number
      }
      setIsRunning(false)
      setLogs((prev) => [
        ...prev,
        `✅ GCP 페일오버 완료. 실제 RTO: ${
          data.actual_rto_seconds
            ? `${Math.floor(data.actual_rto_seconds / 60)}분 ${data.actual_rto_seconds % 60}초`
            : '측정 중'
        }`,
      ])
    }
  }, [events])

  // ── 페일오버 실행 ────────────────────────────────────────────
  const handleFailover = async () => {
    setError('')
    if (mode === 'actual' && !confirmName.trim()) {
      setError('프로젝트명을 입력하세요.')
      return
    }

    setIsRunning(true)
    setSimStep(0)
    setLogs([])

    try {
      const body: Record<string, string> = { mode }
      if (mode === 'actual') body.confirm_project_name = confirmName

      const res = await apiClient.post(`/api/mirror/${projectId}/failover`, body)
      setFailoverData(res.data.data)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? '페일오버 실행에 실패했습니다.'
      setError(msg)
      setIsRunning(false)
      setSimStep(-1)
    }
  }

  return (
    <div className="px-6 py-8 md:px-12 md:py-12 max-w-2xl">

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push(`/projects/${projectId}/mirror`)}
          className="text-[#9ca3af] hover:text-white transition-colors text-sm"
        >
          ← 대시보드
        </button>
        <h1 className="text-2xl font-bold">🔴 페일오버 콘솔</h1>
      </div>

      {/* DR Package 상태 */}
      {latest && (
        <div className="bg-[#121214] border border-white/8 rounded-2xl p-4 mb-6 flex justify-between items-center text-sm">
          <span className="text-[#9ca3af]">
            DR Package: {new Date(latest.created_at).toLocaleString('ko-KR')} (최신)
          </span>
          <span className="text-emerald-400 font-medium">
            예상 RTO: {latest.dr_report.rto_minutes}분
          </span>
        </div>
      )}

      {/* 모드 선택 */}
      {!isRunning && (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 space-y-4">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                value="simulation"
                checked={mode === 'simulation'}
                onChange={() => setMode('simulation')}
                className="accent-emerald-500"
              />
              <span className="font-medium">시뮬레이션 (예상 흐름 확인)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                value="actual"
                checked={mode === 'actual'}
                onChange={() => setMode('actual')}
                className="accent-red-500"
              />
              <span className="font-medium">실제 페일오버 실행</span>
            </label>
          </div>

          {mode === 'actual' && (
            <div className="space-y-2 bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
              <p className="text-sm font-medium text-red-400">
                ⚠️ GCP us-west1에 실제로 인프라가 생성됩니다.
              </p>
              <p className="text-xs text-red-400/70">이 작업은 되돌리기 어렵습니다.</p>
              <p className="text-xs text-[#9ca3af] mt-2">
                확인을 위해 프로젝트명을 정확히 입력하세요.
              </p>
              <Input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder="예: test-project"
                className="bg-black/30 border-white/10 text-white placeholder:text-[#9ca3af]"
              />
              <p className="text-xs text-[#9ca3af]/60">
                대상 GCP 리전: us-west1 (오레곤) — 고정값
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            className={`w-full font-bold py-4 rounded-2xl transition-all hover:-translate-y-0.5 hover:shadow-lg ${
              mode === 'actual'
                ? 'bg-red-600 hover:bg-red-700 hover:shadow-red-500/20 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-500/20 text-white'
            }`}
            onClick={handleFailover}
          >
            {mode === 'simulation' ? '▶ 시뮬레이션 시작' : '🔴 페일오버 실행'}
          </button>
        </div>
      )}

      {/* 시뮬레이션 단계 표시 */}
      {(isRunning || simStep >= 0) && mode === 'simulation' && (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
          <p className="text-sm text-[#9ca3af] font-semibold mb-4">시뮬레이션 진행 중</p>
          <div className="space-y-3">
            {SIMULATION_STEPS.map((step, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span>
                    {i < simStep ? '✅' : i === simStep ? '⏳' : '⬜'}
                  </span>
                  <span className={i === simStep ? 'font-medium text-white' : 'text-[#9ca3af]'}>
                    {step.label}
                  </span>
                </div>
                {i < simStep && (
                  <span className="text-[#9ca3af] text-xs">{step.duration}</span>
                )}
              </div>
            ))}

            {/* [FIX] isRunning=false + 마지막 단계 = 완료 표시 */}
            {!isRunning && simStep >= SIMULATION_STEPS.length - 1 && (
              <div className="pt-3 border-t border-white/8">
                <p className="text-emerald-400 font-semibold">총 예상 RTO: 약 12분</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* actual 실행 중 — WebSocket 로그 */}
      {isRunning && mode === 'actual' && (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
          <p className="text-sm font-semibold text-red-400 mb-4">
            🔴 페일오버 실행 중 — GCP us-west1
          </p>
          <div className="bg-black rounded-2xl p-4 h-48 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-[#9ca3af]">GCP 리소스 생성 대기 중...</p>
            ) : (
              logs.map((log, i) => (
                <p key={i} className="text-emerald-400">{log}</p>
              ))
            )}
          </div>
        </div>
      )}

      {/* [FIX] 완료 후 다시 시뮬레이션 버튼 */}
      {!isRunning && simStep >= SIMULATION_STEPS.length - 1 && (
        <Button
          variant="outline"
          className="mt-4 border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white"
          onClick={() => {
            setSimStep(-1)
            setFailoverData(null)
          }}
        >
          다시 시뮬레이션
        </Button>
      )}
    </div>
  )
}