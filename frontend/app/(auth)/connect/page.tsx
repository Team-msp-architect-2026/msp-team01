// frontend/app/(auth)/connect/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function ConnectPage() {
  const router = useRouter()
  const [roleArn, setRoleArn] = useState('')
  const [alias, setAlias] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')

  const handleConnect = async () => {
    if (!roleArn.trim()) {
      setError('Role ARN을 입력하세요.')
      return
    }

    setError('')
    setIsLoading(true)
    setStatus('verifying')

    try {
      await apiClient.post('/api/accounts/connect', {
        role_arn: roleArn,
        account_alias: alias || null,
      })
      setStatus('success')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ||
        'AWS 계정 연동에 실패했습니다.'
      setError(msg)
      setStatus('error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>AWS 계정 연동</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step 1 — IAM Role 생성 안내 */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Step 1. IAM Role 자동 생성</p>
            <Button
              variant="outline"
              className="w-full text-left justify-start"
              onClick={() => {
                // CloudFormation 스택 링크 — §16-4
                window.open(
                  'https://console.aws.amazon.com/cloudformation/home#/stacks/create',
                  '_blank'
                )
              }}
            >
              🔗 AWS 콘솔에서 AutoOpsRole 생성하기
            </Button>
            <p className="text-xs text-gray-500">
              CloudFormation으로 AutoOpsRole + AutoOpsRDSExportRole 자동 생성
            </p>
          </div>

          {/* Step 2 — Role ARN 입력 */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Step 2. 생성된 Role ARN 입력</p>
            <Input
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/AutoOpsRole"
            />
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="계정 별칭 (선택)"
            />
          </div>

          {/* 상태 표시 — §12-3 */}
          {status === 'verifying' && (
            <Alert>
              <AlertDescription className="flex items-center gap-2">
                <span className="animate-spin">⏳</span>
                AWS 계정 접근을 확인하고 있습니다...
              </AlertDescription>
            </Alert>
          )}
          {status === 'success' && (
            <Alert className="border-green-500 bg-green-50">
              <AlertDescription className="text-green-700">
                ✅ 연동 성공! 대시보드로 이동합니다...
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full bg-teal-600 hover:bg-teal-700"
            onClick={handleConnect}
            disabled={isLoading}
          >
            연동 확인
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}