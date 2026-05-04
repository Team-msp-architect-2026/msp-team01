// frontend/app/projects/[id]/deploy/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface LogEntry {
  message: string
  timestamp: number
}

export default function DeployPage() {
  const router = useRouter()
  const { id: projectId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const validationId = searchParams.get('validation_id') || ''

  const [deploymentId, setDeploymentId] = useState<string | null>(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployStatus, setDeployStatus] = useState<
    'idle' | 'deploying' | 'completed' | 'failed'
  >('idle')
  const [logs, setLogs] = useState<LogEntry[]>([])

  const { events, isConnected } = useWebSocket(projectId, deploymentId)

  // WebSocket 이벤트 처리 — §7-7
  useEffect(() => {
    if (!events.length) return
    const latest = events[events.length - 1]

    if (latest.event_type === 'deploy_progress') {
      const data = latest.data as { log?: string; timestamp?: number }
      if (data.log) {
        setLogs((prev) => [...prev, {
          message: data.log!,
          timestamp: data.timestamp || Date.now(),
        }])
      }
    }

    if (latest.event_type === 'deploy_completed') {
      setDeployStatus('completed')
      // §12-9: 배포 완료 → SCR-B-01 DR 대시보드 이동
      setTimeout(() => router.push(`/projects/${projectId}/mirror`), 2000)
    }

    if (latest.event_type === 'deploy_failed') {
      setDeployStatus('failed')
      // §12-9: 실패 → SCR-A-11 Partial Failure
      setTimeout(
        () => router.push(`/projects/${projectId}/partial-failure`),
        1000
      )
    }
  }, [events, projectId, router])

  const handleDeploy = async () => {
    setIsDeploying(true)
    try {
      const res = await apiClient.post('/api/craft/deploy', {
        project_id: projectId,
        validation_id: validationId,
      })
      setDeploymentId(res.data.data.deployment_id)
      setDeployStatus('deploying')
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🚀 Step 4 — 배포 실행</h1>
        <span className="text-sm text-gray-500">Step 4/4</span>
      </div>

      {deployStatus === 'idle' && (
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          onClick={handleDeploy}
          disabled={isDeploying}
        >
          {isDeploying ? '배포 시작 중...' : '배포하기'}
        </Button>
      )}

      {deployStatus === 'deploying' && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {/* §12-9: 리소스별 진행 상태 */}
            <div className="flex items-center gap-2 text-sm">
              <span className="animate-spin">⏳</span>
              <span>Terraform Apply 진행 중...</span>
              {isConnected && (
                <span className="text-xs text-green-500">● WebSocket 연결됨</span>
              )}
            </div>

            {/* §12-9: 실시간 로그 (CloudWatch → WebSocket) */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <p className="text-xs font-medium text-gray-500">
                  📋 실시간 로그 (CloudWatch → WebSocket)
                </p>
                <Button size="sm" variant="ghost" className="text-xs">
                  전체 로그
                </Button>
              </div>
              <div className="bg-gray-900 text-green-400 rounded p-3 h-40 overflow-y-auto font-mono text-xs">
                {logs.length === 0 ? (
                  <p className="text-gray-500">로그 수신 대기 중...</p>
                ) : (
                  logs.map((log, i) => (
                    <p key={i}>{log.message}</p>
                  ))
                )}
              </div>
            </div>

            <Button size="sm" variant="outline" className="text-red-500">
              배포 취소
            </Button>
          </CardContent>
        </Card>
      )}

      {deployStatus === 'completed' && (
        <Card className="border-green-500 bg-green-50">
          <CardContent className="p-4">
            <p className="text-green-700 font-medium">
              ✅ 배포 완료. MirrorOps가 자동으로 시작됩니다.
            </p>
            <p className="text-sm text-green-600 mt-1">
              DR 대시보드로 이동 중...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}