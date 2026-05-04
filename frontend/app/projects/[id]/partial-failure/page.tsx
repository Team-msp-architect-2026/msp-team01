// frontend/app/projects/[id]/partial-failure/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Deployment } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function PartialFailurePage() {
  const { id: projectId } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const deploymentId = searchParams.get('deployment_id') || ''

  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [containerImage, setContainerImage] = useState('')
  const [actionResult, setActionResult] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!deploymentId) return
    apiClient
      .get(`/api/craft/${projectId}/deployments/${deploymentId}`)
      .then((res) => setDeployment(res.data.data))
  }, [projectId, deploymentId])

  const handleAction = async (
    action: 'resume' | 'fix_retry' | 'full_destroy'
  ) => {
    setIsLoading(true)
    try {
      const body: Record<string, unknown> = { action }
      if (action === 'fix_retry' && containerImage) {
        body.fix_params = { container_image: containerImage }
      }

      await apiClient.post(
        `/api/craft/${projectId}/deployments/${deploymentId}/action`,
        body
      )
      setActionResult(
        action === 'full_destroy'
          ? '전체 삭제를 시작했습니다.'
          : '재시도를 시작했습니다. 배포 화면으로 이동합니다.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">⚠️ 배포 중 오류 발생</h1>

      {deployment && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 space-y-1 text-sm">
            <p>
              생성 완료:{' '}
              <strong>{deployment.completed_resources ?? 0}개 리소스</strong>
            </p>
            <p className="text-red-600">
              오류 내용: {deployment.error_message || '알 수 없는 오류'}
            </p>
            <p className="text-gray-600">현재 State가 S3에 저장되었습니다.</p>
          </CardContent>
        </Card>
      )}

      {actionResult && (
        <Alert className="border-green-500 bg-green-50">
          <AlertDescription className="text-green-700">
            {actionResult}
          </AlertDescription>
        </Alert>
      )}

      {/* §12-10: 3가지 대응 옵션 */}
      <div className="space-y-3">
        {/* ① Resume */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="font-medium">① Resume (실패 지점부터 재시도)</p>
            <p className="text-sm text-gray-500">
              완료된 리소스 유지, 실패 지점부터 재실행
            </p>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => handleAction('resume')}
              disabled={isLoading}
            >
              재시도 →
            </Button>
          </CardContent>
        </Card>

        {/* ② Fix & Retry */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="font-medium">② Fix & Retry (파라미터 수정 후 재시도)</p>
            <Input
              value={containerImage}
              onChange={(e) => setContainerImage(e.target.value)}
              placeholder="컨테이너 이미지 URI"
            />
            <Button
              size="sm"
              className="bg-orange-500 hover:bg-orange-600"
              onClick={() => handleAction('fix_retry')}
              disabled={isLoading}
            >
              수정 후 재시도 →
            </Button>
          </CardContent>
        </Card>

        {/* ③ Full Destroy */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="font-medium">③ Full Destroy (전체 삭제 후 처음부터)</p>
            <p className="text-sm text-gray-500">
              생성된 모든 리소스를 삭제합니다.
            </p>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleAction('full_destroy')}
              disabled={isLoading}
            >
              전체 삭제
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}