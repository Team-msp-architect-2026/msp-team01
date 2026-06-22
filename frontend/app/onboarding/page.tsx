// frontend/app/onboarding/page.tsx
'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api'

type ScanStatus = 'idle' | 'scanning' | 'pending_confirm' | 'confirming' | 'completed' | 'failed'

interface ScanGroup {
  region: string
  vpc_id: string | null
  vpc_name: string | null
  resources: Array<{ resource_type: string; resource_id: string; resource_name: string }>
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  )
}

function OnboardingPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [accountId, setAccountId]   = useState<string>('')
  const [scanId, setScanId]         = useState<string>('')
  const [projectId, setProjectId]   = useState<string>('')
  const [status, setStatus]         = useState<ScanStatus>('idle')
  const [groups, setGroups]         = useState<Record<string, ScanGroup>>({})
  const [totalResources, setTotal]  = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [slackWebhook, setSlack]    = useState<string>('')

  useEffect(() => {
    apiClient.get('/api/accounts').then(res => {
      const accounts = res.data.data
      const fromQuery = searchParams.get('accountId')
      if (fromQuery && accounts.some((a: any) => a.account_id === fromQuery)) {
        setAccountId(fromQuery)
      } else if (accounts.length > 0) {
        setAccountId(accounts[0].account_id)
      }
    })
  }, [searchParams])

  const handleStartScan = async () => {
    if (!accountId) return
    setStatus('scanning')
    setError(null)
    try {
      const res = await apiClient.post(`/api/accounts/${accountId}/onboard`)
      setScanId(res.data.data.scan_id)
      setProjectId(res.data.data.project_id)
      pollStatus(accountId)
    } catch (e: any) {
      setStatus('failed')
      setError(e.response?.data?.detail?.message || '스캔 시작 실패')
    }
  }

  const pollStatus = (accId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/accounts/${accId}/onboard/status`)
        const data = res.data.data
        if (data.status === 'pending_confirm') {
          setGroups(data.scan_result || {})
          setTotal(data.total_resources || 0)
          setStatus('pending_confirm')
          clearInterval(interval)
        } else if (data.status === 'failed') {
          setStatus('failed')
          clearInterval(interval)
        }
      } catch { clearInterval(interval) }
    }, 3000)
  }

  const handleConfirm = async () => {
    setStatus('confirming')
    try {
      await apiClient.post(`/api/accounts/${accountId}/onboard/confirm`, {
        scan_id: scanId,
        groups,
      })
      setStatus('completed')
      // ⚠️ v3 변경: 거버넌스 통합 허브로 리다이렉트
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (e: any) {
      setStatus('failed')
      setError(e.response?.data?.detail?.message || '확정 실패')
    }
  }

  const handleSaveSlack = async () => {
    try {
      await apiClient.patch('/api/users/me', { slack_webhook_url: slackWebhook })
      alert('Slack Webhook URL이 저장되었습니다.')
    } catch {
      alert('저장 실패')
    }
  }

  return (
    <div className="px-6 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">기존 인프라 연동</h1>
      <p className="text-[#9ca3af] text-sm mb-8">
        현재 AWS 계정의 인프라를 스캔하여 운영 거버넌스 체계에 편입합니다.
      </p>

      {status === 'idle' && (
        <div className="space-y-4">
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
            <p className="text-sm text-[#9ca3af] mb-4">
              연동된 AWS 계정의 전체 리소스를 스캔합니다. (약 1~2분 소요)
            </p>
            <button
              onClick={handleStartScan}
              className="px-6 py-3 bg-[#ffa53d] text-black font-semibold rounded-2xl hover:bg-[#ff9420] transition-colors"
            >
              스캔 시작
            </button>
          </div>

          {/* Slack Webhook URL 설정 */}
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-6">
            <p className="text-sm font-semibold mb-1">Slack 알림 연동 (선택)</p>
            <p className="text-xs text-[#9ca3af] mb-3">
              CRITICAL/HIGH Drift 감지 시 Slack으로 알림을 받습니다.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://hooks.slack.com/services/..."
                value={slackWebhook}
                onChange={(e) => setSlack(e.target.value)}
                className="flex-1 px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-xl
                           text-[#edf0f6] placeholder-[#9ca3af] focus:outline-none focus:border-[#ffa53d]"
              />
              <button
                onClick={handleSaveSlack}
                disabled={!slackWebhook}
                className="px-4 py-2 text-sm bg-white/8 hover:bg-white/12 border border-white/10
                           text-[#edf0f6] font-medium rounded-xl transition-colors disabled:opacity-40"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'scanning' && (
        <div className="bg-[#121214] border border-white/8 rounded-3xl p-6 text-center">
          <div className="text-2xl mb-3 animate-spin inline-block">⚙️</div>
          <p className="text-sm text-[#9ca3af]">AWS 계정 리소스 스캔 중...</p>
        </div>
      )}

      {status === 'pending_confirm' && (
        <div className="space-y-4">
          <div className="bg-[#121214] border border-white/8 rounded-3xl p-4">
            <p className="text-sm font-semibold">
              스캔 완료 — 리소스 {totalResources}개 발견
            </p>
            <p className="text-xs text-[#9ca3af] mt-1">
              그룹화 결과를 확인하고 확정하세요.
            </p>
          </div>

          {Object.entries(groups).map(([key, group]) => (
            <div key={key} className="bg-[#121214] border border-white/8 rounded-3xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-[#ffa53d]">{group.region}</span>
                {group.vpc_id && (
                  <span className="text-xs text-[#9ca3af]">
                    {group.vpc_name || group.vpc_id}
                  </span>
                )}
                <span className="ml-auto text-xs text-[#9ca3af]">
                  {group.resources.length}개
                </span>
              </div>
              <div className="space-y-1">
                {group.resources.slice(0, 5).map((r, i) => (
                  <div key={i} className="text-xs text-[#9ca3af] flex justify-between">
                    <span>{r.resource_type.split('::').pop()}</span>
                    <span className="font-mono">{r.resource_name || r.resource_id}</span>
                  </div>
                ))}
                {group.resources.length > 5 && (
                  <p className="text-xs text-[#9ca3af]">
                    +{group.resources.length - 5}개 더...
                  </p>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={handleConfirm}
            className="w-full py-3 bg-[#ffa53d] text-black font-semibold rounded-2xl hover:bg-[#ff9420] transition-colors"
          >
            이 그룹화로 Baseline 등록
          </button>
        </div>
      )}

      {status === 'completed' && (
        <div className="bg-[#121214] border border-emerald-500/30 rounded-3xl p-6 text-center">
          <p className="text-emerald-400 font-semibold mb-1">✅ 온보딩 완료</p>
          <p className="text-sm text-[#9ca3af]">거버넌스 대시보드로 이동합니다...</p>
        </div>
      )}

      {status === 'failed' && (
        <div className="bg-[#121214] border border-red-500/30 rounded-3xl p-6">
          <p className="text-red-400 font-semibold mb-2">❌ 실패</p>
          <p className="text-sm text-[#9ca3af]">{error}</p>
          <button
            onClick={() => setStatus('idle')}
            className="mt-3 px-4 py-2 text-sm bg-white/5 hover:bg-white/10 rounded-xl"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}