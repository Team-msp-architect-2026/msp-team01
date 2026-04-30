// frontend/app/projects/[id]/failover/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { useDRPackage } from '@/hooks/useMirrorOps'
import { FailoverResponse } from '@/types/mirror'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'

// §12-14: 시뮬레이션 단계 목록
const SIMULATION_STEPS = [
  { label: 'Terraform Init',          duration: '2초' },
  { label: 'Terraform Plan',          duration: 'GCP 11개' },
  { label: 'Terraform Apply',         duration: '시뮬레이션' },
  { label: 'Cloud SQL 복원 예상',      duration: '3분 20초' },
  { label: 'Cloud Run 배포 예상',      duration: '2분 10초' },
  { label: 'Load Balancer 헬스체크',   duration: '시뮬레이션' },
]

export default function FailoverPage() {
  const { id: projectId } = useParams<{ id: string }>()
  const router = useRouter()

  const [mode, setMode] = useState<'simulation' | 'actual'>('simulation')
  const [confirmName, setConfirmName] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState('')
  const [failoverData, setFailoverData] = useState<FailoverResponse | null>(null)
  const [simStep, setSimStep] = useState(-1)   // 시뮬레이션 단계 인덱스
  const [logs, setLogs] = useState<string[]>([])

  const { data: packageData } = useDRPackage(projectId)
  const latest = packageData?.latest
  const { events } = useWebSocket(
    failoverData ? projectId : null,
    failoverData ? `fo_${failoverData.failover_id}` : null
  )

  // §12-14: 시뮬레이션 단계 순차 표시
  useEffect(() => {
    if (!isRunning || mode !== 'simulation') return
    if (simStep >= SIMULATION_STEPS.length - 1) return

    const timer = setTimeout(() => setSimStep((s) => s + 1), 800)
    return () => clearTimeout(timer)
  }, [isRunning, simStep, mode])

  // WebSocket 이벤트 처리 — §7-7 failover_progress, failover_completed
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
        `✅ GCP 페일오버 완료. 실제 RTO:${
          data.actual_rto_seconds
            ? `${Math.floor(data.actual_rto_seconds / 60)}분${data.actual_rto_seconds % 60}초`
            : '측정 중'
        }`,
      ])
    }
  }, [events])

  const handleFailover = async () => {
    setError('')

    // §5-5 actual 모드 — confirm_project_name 필요
    if (mode === 'actual') {
      // 예상 프로젝트명: prefix-environment (백엔드에서 검증)
      if (!confirmName.trim()) {
        setError('프로젝트명을 입력하세요.')
        return
      }
    }

    setIsRunning(true)
    setSimStep(0)
    setLogs([])

    try {
      const body: Record<string, string> = { mode }
      if (mode === 'actual') {
        body.confirm_project_name = confirmName
      }

      const res = await apiClient.post(
        `/api/mirror/${projectId}/failover`,
        body
      )
      setFailoverData(res.data.data)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message || '페일오버 실행에 실패했습니다.'
      setError(msg)
      setIsRunning(false)
      setSimStep(-1)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">🔴 페일오버 콘솔</h1>

      {/* DR Package 상태 표시 */}
      {latest && (
        <Card>
          <CardContent className="p-3 text-sm">
            <div className="flex justify-between">
              <span>
                DR Package:{' '}
                {new Date(latest.created_at).toLocaleString('ko-KR')} (최신)
              </span>
              <span className="text-teal-600">예상 RTO: {latest.dr_report.rto_minutes}분</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* §12-14: 모드 선택 */}
      {!isRunning && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="simulation"
                  checked={mode === 'simulation'}
                  onChange={() => setMode('simulation')}
                />
                <span className="font-medium">시뮬레이션 (예상 흐름 확인)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="actual"
                  checked={mode === 'actual'}
                  onChange={() => setMode('actual')}
                />
                <span className="font-medium">실제 페일오버 실행</span>
              </label>
            </div>

            {/* §12-14: actual 모드 — 프로젝트명 재입력 */}
            {mode === 'actual' && (
              <div className="space-y-2 bg-red-50 border border-red-200 rounded p-3">
                <p className="text-sm font-medium text-red-700">
                  ⚠️ GCP us-west1에 실제로 인프라가 생성됩니다.
                </p>
                <p className="text-xs text-red-600">이 작업은 되돌리기 어렵습니다.</p>
                <p className="text-xs text-gray-600 mt-2">
                  확인을 위해 프로젝트명을 정확히 입력하세요.
                </p>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={`예: DD-prod`}
                />
                <p className="text-xs text-gray-400">
                  대상 GCP 리전: us-west1 (오레곤) — §2 기술스택 고정값
                </p>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              className={
                mode === 'actual'
                  ? 'w-full bg-red-600 hover:bg-red-700'
                  : 'w-full bg-teal-600 hover:bg-teal-700'
              }
              onClick={handleFailover}
            >
              {mode === 'simulation' ? '▶ 시뮬레이션 시작' : '🔴 페일오버 실행'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* §12-14: 시뮬레이션 단계 표시 */}
      {isRunning && mode === 'simulation' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">시뮬레이션 진행 중</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {SIMULATION_STEPS.map((step, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span>
                    {i < simStep ? '✅' : i === simStep ? '⏳' : '⬜'}
                  </span>
                  <span className={i === simStep ? 'font-medium' : ''}>
                    {step.label}
                  </span>
                </div>
                {i < simStep && (
                  <span className="text-gray-500 text-xs">{step.duration}</span>
                )}
              </div>
            ))}

            {simStep >= SIMULATION_STEPS.length - 1 && (
              <div className="pt-2 border-t">
                <p className="text-teal-600 font-medium">
                  총 예상 RTO: 약 12분
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* §12-14: actual 모드 실행 중 — WebSocket 실시간 로그 */}
      {isRunning && mode === 'actual' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              🔴 페일오버 실행 중 — GCP us-west1
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-gray-900 text-green-400 rounded p-3 h-48 overflow-y-auto font-mono text-xs">
              {logs.length === 0 ? (
                <p className="text-gray-500">GCP 리소스 생성 대기 중...</p>
              ) : (
                logs.map((log, i) => <p key={i}>{log}</p>)
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 완료 후 버튼 */}
      {!isRunning && simStep >= SIMULATION_STEPS.length - 1 && (
        <Button
          variant="outline"
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