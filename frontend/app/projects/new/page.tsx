// frontend/app/projects/new/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { WizardLayout } from '@/components/craftops/WizardLayout'
import { IntentAnalysis } from '@/components/craftops/IntentAnalysis'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type WizardPhase = 'project-create' | 'step1' | '2-1' | '2-2' | '2-3' | '2-4' | '2-5' | '2-6' | 'validate'

export default function NewProjectPage() {
  const router = useRouter()

  const [projectForm, setProjectForm] = useState({
    name: '', prefix: '', environment: 'prod', region: 'us-west-2',
  })
  const [projectId, setProjectId] = useState<string | null>(null)

  const [phase, setPhase] = useState<WizardPhase>('project-create')
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [namingPreview, setNamingPreview] = useState<string[]>([])
  const [stepConfigs, setStepConfigs] = useState<Record<string, Record<string, unknown>>>({})

  const handleCreateProject = async () => {
    setIsSubmitting(true)
    try {
      const accRes = await apiClient.get('/api/accounts')
      const acc = accRes.data.data[0]

      const projRes = await apiClient.post('/api/projects', {
        name: projectForm.name,
        account_id: acc.account_id,
        prefix: projectForm.prefix,
        environment: projectForm.environment,
        region: projectForm.region,
      })
      setProjectId(projRes.data.data.project_id)
      setPhase('step1')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveStep = async (step: string, config: Record<string, unknown>) => {
    if (!projectId) return
    setIsSubmitting(true)
    try {
      const res = await apiClient.post('/api/craft/config', {
        project_id: projectId,
        step,
        config,
      })
      const data = res.data.data
      setCompletedSteps(data.completed_steps ?? [])
      if (step === '2-1' && data.naming_preview) {
        setNamingPreview(data.naming_preview)
      }
      setStepConfigs((prev) => ({ ...prev, [step]: config }))

      const nextStep = data.next_step
      if (nextStep) {
        setPhase(nextStep as WizardPhase)
      } else {
        router.push(`/projects/${projectId}/validate`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (phase === 'project-create') {
    return (
      <div className="p-6 max-w-lg mx-auto space-y-4">
        <h1 className="text-2xl font-bold">새 인프라 생성</h1>
        <Input
          placeholder="프로젝트 이름"
          value={projectForm.name}
          onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          placeholder="prefix (예: DD)"
          value={projectForm.prefix}
          onChange={(e) => setProjectForm((f) => ({ ...f, prefix: e.target.value }))}
        />
        <select
          className="w-full border rounded px-3 py-2 text-sm"
          value={projectForm.environment}
          onChange={(e) => setProjectForm((f) => ({ ...f, environment: e.target.value }))}
        >
          <option value="prod">prod</option>
          <option value="staging">staging</option>
          <option value="dev">dev</option>
        </select>
        <Button
          className="w-full bg-teal-600 hover:bg-teal-700"
          onClick={handleCreateProject}
          disabled={isSubmitting || !projectForm.name || !projectForm.prefix}
        >
          {isSubmitting ? '생성 중...' : '다음 →'}
        </Button>
      </div>
    )
  }

  if (phase === 'step1' && projectId) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Step 1 — 요구사항 분석</h1>
        <IntentAnalysis
          projectId={projectId}
          onComplete={() => setPhase('2-1')}
        />
      </div>
    )
  }

  if (phase === '2-1') {
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-1"
          completedSteps={completedSteps}
          sidekick="프로덕션 환경이므로 Multi-AZ 구성을 권장합니다."
          onNext={() =>
            handleSaveStep('2-1', {
              prefix: projectForm.prefix,
              environment: projectForm.environment,
              region: projectForm.region,
              project_name: projectForm.name,
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">리소스 네이밍 규칙</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <p className="text-xs text-gray-500">프리픽스</p>
                  <Input value={projectForm.prefix} readOnly className="bg-gray-50" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">환경</p>
                  <Input value={projectForm.environment} readOnly className="bg-gray-50" />
                </div>
              </div>
            </div>
            {namingPreview.length > 0 && (
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs text-gray-500 mb-1">네이밍 미리보기</p>
                <div className="text-xs space-y-0.5">
                  {namingPreview.slice(0, 5).map((n) => (
                    <p key={n} className="font-mono">{n}</p>
                  ))}
                  {namingPreview.length > 5 && (
                    <p className="text-gray-400">... 외 {namingPreview.length - 5}개</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </WizardLayout>
      </div>
    )
  }

  if (phase === '2-2') {
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-2"
          completedSteps={completedSteps}
          sidekick="VPC CIDR 입력 시 서브넷 4개(prod) 또는 2개(dev/staging)가 자동 분배됩니다."
          onPrev={() => setPhase('2-1')}
          onNext={() =>
            handleSaveStep('2-2', {
              vpc_cidr: (stepConfigs['2-2']?.vpc_cidr as string) || '10.0.0.0/16',
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">VPC CIDR</label>
              <Input
                defaultValue="10.0.0.0/16"
                onChange={(e) =>
                  setStepConfigs((prev) => ({
                    ...prev,
                    '2-2': { ...prev['2-2'], vpc_cidr: e.target.value },
                  }))
                }
              />
              <p className="text-xs text-gray-500 mt-1">
                서브넷 자동 분배 (prod: Public 2 + Private 2 / dev·staging: Public 1 + Private 1)
              </p>
            </div>
          </div>
        </WizardLayout>
      </div>
    )
  }

  if (phase === '2-3') {
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-3"
          completedSteps={completedSteps}
          sidekick="SG 간 참조 관계를 자동 구성합니다. ALB→App→DB 순서로 허용 규칙이 설정됩니다."
          onPrev={() => setPhase('2-2')}
          onNext={() => handleSaveStep('2-3', {})}
          isSubmitting={isSubmitting}
        >
          <div className="space-y-2 text-sm bg-gray-50 rounded p-3">
            <p className="font-medium">자동 구성 내용</p>
            <p>SG-ALB: 443, 80 ← 0.0.0.0/0</p>
            <p>SG-App: 8080 ← SG-ALB</p>
            <p>SG-DB: 5432 ← SG-App</p>
          </div>
        </WizardLayout>
      </div>
    )
  }

  if (phase === '2-4') {
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-4"
          completedSteps={completedSteps}
          sidekick="ALB는 Public Subnet에 자동 배치됩니다."
          onPrev={() => setPhase('2-3')}
          onNext={() =>
            handleSaveStep('2-4', {
              alb_name: `${projectForm.prefix}-${projectForm.environment}-alb`,
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">ALB 이름</label>
              <Input
                value={`${projectForm.prefix}-${projectForm.environment}-alb`}
                readOnly
                className="bg-gray-50"
              />
            </div>
            <p className="text-xs text-gray-500">
              서브넷: Public 자동 배치 / 보안그룹: SG-ALB 자동 연결 / HTTPS:443 리스너
            </p>
          </div>
        </WizardLayout>
      </div>
    )
  }

  if (phase === '2-5') {
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-5"
          completedSteps={completedSteps}
          sidekick={
            projectForm.environment === 'prod'
              ? 'prod 환경: 최소 2개 태스크 + CPU 70% 오토스케일링 자동 적용'
              : 'dev 환경: 최소 1개 태스크 / 오토스케일링 비활성화'
          }
          onPrev={() => setPhase('2-4')}
          onNext={() =>
            handleSaveStep('2-5', {
              vcpu: 1,
              memory: 2048,
              container_image: (stepConfigs['2-5']?.container_image as string) || '',
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">vCPU</label>
                <Input defaultValue="1" readOnly className="bg-gray-50" />
              </div>
              <div>
                <label className="text-sm font-medium">메모리 (MB)</label>
                <Input defaultValue="2048" readOnly className="bg-gray-50" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">컨테이너 이미지 URI</label>
              <Input
                placeholder="123456789012.dkr.ecr.us-west-2.amazonaws.com/my-app:latest"
                onChange={(e) =>
                  setStepConfigs((prev) => ({
                    ...prev,
                    '2-5': { ...prev['2-5'], container_image: e.target.value },
                  }))
                }
              />
            </div>
          </div>
        </WizardLayout>
      </div>
    )
  }

  if (phase === '2-6') {
    const isProd = projectForm.environment === 'prod'
    return (
      <div className="p-6">
        <WizardLayout
          currentStep="2-6"
          completedSteps={completedSteps}
          sidekick={
            isProd
              ? 'prod 환경: Multi-AZ ON / 백업 30일 / 암호화 ON 자동 적용'
              : 'dev 환경: Multi-AZ OFF / 백업 0일 / 암호화 OFF'
          }
          onPrev={() => setPhase('2-5')}
          onNext={() => handleSaveStep('2-6', {})}
          isSubmitting={isSubmitting}
        >
          <div className="space-y-2 text-sm bg-gray-50 rounded p-3">
            <p className="font-medium">자동 적용 설정 ({projectForm.environment})</p>
            <p>엔진: PostgreSQL 15</p>
            <p>인스턴스: {isProd ? 'db.t3.medium' : 'db.t3.micro'}</p>
            <p>Multi-AZ: {isProd ? 'ON' : 'OFF'}</p>
            <p>백업 보존: {isProd ? '30일' : '0일'}</p>
            <p>암호화: {isProd ? 'ON' : 'OFF'}</p>
          </div>
        </WizardLayout>
      </div>
    )
  }

  return null
}