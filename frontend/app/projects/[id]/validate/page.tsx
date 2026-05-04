// frontend/app/projects/[id]/validate/page.tsx
'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { ValidationResult } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ErrorDetails {
  manual_edit_required?: boolean
  error_location?: string
  fixed_code?: string
}

export default function ValidatePage() {
  const router = useRouter()
  const { id: projectId } = useParams<{ id: string }>()

  const [isValidating, setIsValidating] = useState(false)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [error, setError] = useState<{
    code: string
    message: string
    details?: ErrorDetails
  } | null>(null)

  const handleValidate = async () => {
    setIsValidating(true)
    setError(null)
    try {
      const res = await apiClient.post('/api/craft/validate', {
        project_id: projectId,
      })
      setResult(res.data.data)
    } catch (err: unknown) {
      const errData = (
        err as { response?: { data?: { error?: { code?: string; message?: string; details?: ErrorDetails } } } }
      )?.response?.data?.error
      setError({
        code: errData?.code || 'UNKNOWN',
        message: errData?.message || 'Validation에 실패했습니다.',
        details: errData?.details,
      })
    } finally {
      setIsValidating(false)
    }
  }

  const vr = result?.validation_results

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">🔍 Step 3 — 코드 검증</h1>
        <span className="text-sm text-gray-500">Step 3/4</span>
      </div>

      {!result && !error && (
        <Button
          className="bg-teal-600 hover:bg-teal-700"
          onClick={handleValidate}
          disabled={isValidating}
        >
          {isValidating ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span> 검증 중...
            </span>
          ) : (
            '검증 시작'
          )}
        </Button>
      )}

      {error?.details?.manual_edit_required && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">❌ 자동 수정 실패</p>
            <p className="text-xs mt-1">
              에러 위치: {error.details.error_location?.slice(0, 100)}
            </p>
            <Button size="sm" variant="outline" className="mt-2">
              수동 편집 모드
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error?.code === 'TERRAFORM_ERROR' && !error.details?.manual_edit_required && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">🔴 {error.message}</p>
            {error.details?.fixed_code !== undefined && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={handleValidate}
              >
                자동 수정 코드 적용 후 재검증
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {result && vr && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Terraform 코드 미리보기</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32">
                {result.terraform_code.slice(0, 300)}...
              </pre>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="outline">전체 코드 보기</Button>
                <Button size="sm" variant="outline">다운로드</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">🔒 보안 스캔 결과</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span>{vr.validate.passed ? '✅' : '❌'}</span>
                <span>terraform validate</span>
                {vr.validate.correction_attempts > 0 && (
                  <span className="text-xs text-gray-500">
                    (Self-Correction {vr.validate.correction_attempts}회)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span>{vr.security_scan.passed ? '✅' : '⚠️'}</span>
                <span>
                  tfsec + checkov ({vr.security_scan.critical} critical,{' '}
                  {vr.security_scan.high} high, {vr.security_scan.medium} medium)
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                💰 비용 예측 (Infracost) — 합계 ${vr.cost_estimation.monthly_total.toFixed(2)} / 월
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {vr.cost_estimation.breakdown.map((item) => (
                <div key={item.resource} className="flex justify-between text-sm">
                  <span className="text-gray-600">{item.resource}</span>
                  <span>${item.monthly_cost.toFixed(2)} / 월</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-sm">
              📋 terraform plan:{' '}
              <span className="text-green-600 font-medium">
                {vr.plan.add} to add
              </span>
              , {vr.plan.change} to change, {vr.plan.destroy} to destroy
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => router.push('/projects/new')}
            >
              ← 설정 수정
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() =>
                router.push(
                  `/projects/${projectId}/deploy?validation_id=${result.validation_id}`
                )
              }
            >
              배포하기 →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}