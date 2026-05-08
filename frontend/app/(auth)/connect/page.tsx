// frontend/app/(auth)/connect/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const AUTOOPS_ACCOUNT_ID  = '611058323802'
const CF_TEMPLATE_URL = 'https://autoops-cf-templates.s3.us-west-2.amazonaws.com/autoops-role.yaml'
  

export default function ConnectPage() {
  const router = useRouter()

  const [userId, setUserId]   = useState('')
  const [roleArn, setRoleArn] = useState('')
  const [alias, setAlias]     = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]     = useState('')
  const [status, setStatus]   = useState<'idle' | 'verifying' | 'success' | 'error'>('idle')

  // 현재 로그인 유저 ID 조회 (ExternalId 주입용)
  useEffect(() => {
    apiClient
      .get('/api/auth/me')
      .then((res) => setUserId(res.data.data.user_id))
      .catch(() => {})
  }, [])

  const handleOpenCloudFormation = () => {
    const params = new URLSearchParams({
      templateURL:              CF_TEMPLATE_URL,
      stackName:                'AutoOpsRole',
      param_ExternalId:         userId,
      param_AutoOpsAccountId:   AUTOOPS_ACCOUNT_ID,
    })
    window.open(
      `https://console.aws.amazon.com/cloudformation/home?region=us-west-2#/stacks/create/review?${params.toString()}`,
      '_blank'
    )
  }

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
        role_arn:      roleArn,
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
    <div className="min-h-screen flex items-center justify-center bg-[#000000]">
      <Card className="w-full max-w-lg bg-[#121214] border border-white/8">
        <CardHeader>
          <CardTitle className="text-white">AWS 계정 연동</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Step 1 — IAM Role 생성 안내 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-white">Step 1. IAM Role 자동 생성</p>
            <Button
              variant="outline"
              className="w-full text-left justify-start border-white/10 text-[#9ca3af] hover:bg-white/5 hover:text-white"
              onClick={handleOpenCloudFormation}
              disabled={!userId}
            >
              🔗 AWS 콘솔에서 AutoOpsRole 생성하기
            </Button>
            <p className="text-xs text-[#9ca3af]">
              CloudFormation으로 AutoOpsRole + AutoOpsRDSExportRole 자동 생성
            </p>
            {!userId && (
              <p className="text-xs text-yellow-400">
                ⏳ 사용자 정보 로딩 중...
              </p>
            )}
          </div>

          {/* Step 2 — Role ARN 입력 */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-white">Step 2. 생성된 Role ARN 입력</p>
            <p className="text-xs text-[#9ca3af]">
              CloudFormation 스택 완료 후 [출력] 탭에서 AutoOpsRoleArn 값을 복사하세요.
            </p>
            <Input
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value)}
              placeholder="arn:aws:iam::123456789012:role/AutoOpsRole"
              className="bg-black/30 border-white/10 text-white placeholder:text-[#9ca3af]"
            />
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="계정 별칭 (선택)"
              className="bg-black/30 border-white/10 text-white placeholder:text-[#9ca3af]"
            />
          </div>

          {/* 상태 표시 */}
          {status === 'verifying' && (
            <Alert className="border-blue-500/20 bg-blue-500/5">
              <AlertDescription className="flex items-center gap-2 text-blue-400">
                <span className="animate-spin">⏳</span>
                AWS 계정 접근을 확인하고 있습니다...
              </AlertDescription>
            </Alert>
          )}
          {status === 'success' && (
            <Alert className="border-emerald-500/20 bg-emerald-500/5">
              <AlertDescription className="text-emerald-400">
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
            className="w-full bg-teal-600 hover:bg-teal-700 text-white"
            onClick={handleConnect}
            disabled={isLoading || !roleArn.trim()}
          >
            {isLoading ? '확인 중...' : '연동 확인'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}