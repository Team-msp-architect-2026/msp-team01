// frontend/app/projects/new/NewProjectPageContent.tsx
'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { WizardLayout } from '@/components/craftops/WizardLayout'
import { IntentAnalysis } from '@/components/craftops/IntentAnalysis'

type WizardPhase = 'project-create' | 'step1' | '2-1' | '2-2' | '2-3' | '2-4' | '2-5' | '2-6' | 'summary' | 'validate'

const DEFAULT_CONTAINER_IMAGE = '611058323802.dkr.ecr.us-west-2.amazonaws.com/autoops-sample-app:latest'

export default function NewProjectPageContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const existingProjectId = searchParams.get('project_id')

  const [projectForm, setProjectForm] = useState({
    name: '', prefix: '', environment: 'prod', region: 'us-west-2',
  })
  const [projectId, setProjectId]           = useState<string | null>(existingProjectId)
  const [phase, setPhase]                   = useState<WizardPhase>(
    existingProjectId ? 'step1' : 'project-create'
  )
  const [completedSteps, setCompletedSteps] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting]     = useState(false)
  const [namingPreview, setNamingPreview]   = useState<string[]>([])
  const [stepConfigs, setStepConfigs]       = useState<Record<string, Record<string, unknown>>>({})
  const [cidrError, setCidrError]           = useState('')
  const [recommendedConfig, setRecommendedConfig] = useState<Record<string, unknown>>({})

  const validateCIDR = (cidr: string): boolean => {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/
    if (!cidrRegex.test(cidr)) return false
    const [ip, prefix] = cidr.split('/')
    const parts = ip.split('.').map(Number)
    if (parts.some((p) => p > 255)) return false
    if (parseInt(prefix) > 32) return false
    return true
  }

  const handleCreateProject = async () => {
    setIsSubmitting(true)
    try {
      const accRes = await apiClient.get('/api/accounts')
      const acc    = accRes.data.data[0]

      const projRes = await apiClient.post('/api/projects', {
        name:        projectForm.name,
        account_id:  acc.account_id,
        prefix:      projectForm.prefix,
        environment: projectForm.environment,
        region:      projectForm.region,
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
      const res  = await apiClient.post('/api/craft/config', {
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
      }
      // next_step 없으면 summary로 이동
    } finally {
      setIsSubmitting(false)
    }
  }

  const isProd = projectForm.environment === 'prod'

  // shared top bar (non-wizard phases use this; wizard phases use WizardLayout's own top bar)
  const TopBar = ({ stepLabel, onBack, backLabel }: { stepLabel?: string; onBack?: () => void; backLabel?: string }) => (
    <div className="npc-topbar">
      <div className="npc-top-left">
        <span className="npc-brand">
          <span className="npc-mark"></span>
          AutoOps
        </span>
        {projectForm.name && (
          <>
            <span className="npc-crumb-sep" />
            <div className="npc-crumb-proj">
              <span className="npc-crumb-eyebrow">
                <span className="npc-pip" />
                CraftOps · 인프라 설계
              </span>
              <span className="npc-crumb-name">{projectForm.name}</span>
            </div>
          </>
        )}
      </div>
      <div className="npc-top-right">
        {stepLabel && <span className="npc-step-counter">{stepLabel}</span>}
        {onBack && (
          <button className="npc-btn-exit" onClick={onBack}>
            {backLabel || '나가기'}
          </button>
        )}
      </div>
    </div>
  )

  // ── phase: project-create ──────────────────────────────────────
  if (phase === 'project-create') {
    return (
      <>
        <style>{styles}</style>
        <TopBar onBack={() => router.push('/dashboard')} backLabel="← 대시보드" />

        <div className="npc-shell">
          <div className="npc-shell-inner">
            <div className="npc-step-header">
              <div className="npc-step-eyebrow">
                <span className="npc-pip" />
                Step 00 · 프로젝트 생성
              </div>
              <h1 className="npc-step-title">AWS 인프라 구성 시작하기</h1>
              <p className="npc-step-desc">
                프로젝트 정보를 입력하면 CraftOps가 16개 AWS 리소스를 자동으로 설계합니다.
              </p>
            </div>

            <div className="npc-form-card">
              {/* 서비스 이름 */}
              <div className="npc-field">
                <label className="npc-label">서비스 이름</label>
                <p className="npc-hint">프로젝트 식별용으로만 쓰입니다. 자유롭게 입력하세요.</p>
                <div className="npc-input-wrap">
                  <input
                    className="npc-input"
                    placeholder="예) Fortune 송금 서비스"
                    value={projectForm.name}
                    onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
              </div>

              {/* prefix */}
              <div className="npc-field">
                <label className="npc-label">리소스 식별자 (Prefix)</label>
                <p className="npc-hint">모든 AWS 리소스 이름에 자동으로 붙습니다.</p>
                <div className="npc-input-wrap">
                  <input
                    className="npc-input npc-mono"
                    placeholder="예) PAY, GW, FORTUNE"
                    value={projectForm.prefix}
                    onChange={(e) => setProjectForm((f) => ({ ...f, prefix: e.target.value }))}
                  />
                </div>
                <p className="npc-hint npc-preview">
                  예){' '}
                  <span className="npc-mono-inline">
                    {(projectForm.prefix || 'PAY')}-prod-vpc, {(projectForm.prefix || 'PAY')}-prod-rds
                  </span>
                </p>
              </div>

              {/* 환경 */}
              <div className="npc-field">
                <label className="npc-label">서비스 환경</label>
                <div className="npc-env-grid">
                  {([
                    { v: 'prod',    name: 'prod',    desc: '실서비스 (금융보안 자동 적용)', tone: 'orange' },
                    { v: 'staging', name: 'staging', desc: '검증/테스트',                  tone: 'yellow' },
                    { v: 'dev',     name: 'dev',     desc: '개발용 (최소 사양)',            tone: 'blue' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      className={`npc-env-card${projectForm.environment === opt.v ? ' npc-active' : ''}`}
                      data-tone={opt.tone}
                      onClick={() => setProjectForm((f) => ({ ...f, environment: opt.v }))}
                    >
                      <span className="npc-env-name">{opt.name}</span>
                      <span className="npc-env-desc">{opt.desc}</span>
                      <span className="npc-env-check">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 리전 안내 */}
              <p className="npc-region-note">
                배포 리전 ·{' '}
                <span className="npc-mono-inline">{projectForm.region}</span>{' '}
                (Oregon) · 변경이 필요하면 위저드 완료 후 수정할 수 있습니다.
              </p>
            </div>

            <div className="npc-nav-row">
              <button className="npc-btn-prev" onClick={() => router.push('/dashboard')}>
                <span className="npc-arrow">←</span>
                취소
              </button>
              <button
                className="npc-btn-next"
                onClick={handleCreateProject}
                disabled={isSubmitting || !projectForm.name || !projectForm.prefix}
              >
                {isSubmitting ? (
                  <>
                    <span className="npc-spinner" />
                    <span>생성 중...</span>
                  </>
                ) : (
                  <>
                    <span>인프라 설계 시작</span>
                    <span className="npc-arrow">→</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── phase: step1 ──────────────────────────────────────────────
  if (phase === 'step1' && projectId) {
    return (
      <>
        <style>{styles}</style>
        <TopBar
          stepLabel="Step 01 / 06"
          onBack={() => router.push(`/projects/${projectId}`)}
          backLabel="← 프로젝트 정보"
        />

        <div className="npc-shell">
          <div className="npc-shell-inner">
            <div className="npc-step-header">
              <div className="npc-step-eyebrow">
                <span className="npc-pip" />
                Step 01 · AI 의도 분석
              </div>
              <h1 className="npc-step-title">어떤 서비스를 만드시나요?</h1>
              <p className="npc-step-desc">
                서비스를 간단히 설명해주세요. Gemini가 필요한 AWS 리소스 구성을 제안합니다.
              </p>
            </div>

            <div className="npc-form-card">
              <IntentAnalysis
                projectId={projectId!}
                environment={projectForm.environment}
                onComplete={(result) => {
                 setRecommendedConfig(result.recommended_config)
                  setPhase('2-1')
                }}
              />
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── phase: 2-1 기본 설정 ──────────────────────────────────────
  if (phase === '2-1') {
    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-1"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="리소스 네이밍 규칙을 확인해주세요."
          description="아래 규칙으로 16개 리소스가 자동 네이밍됩니다. Prefix와 환경은 프로젝트 생성 시 입력한 값입니다."
          sidekick={
            isProd
              ? 'prod 환경에는 Multi-AZ + 암호화 + 백업 30일이 자동 적용됩니다. 금융보안원 tfsec 보안 스캔 통과 요건입니다.'
              : `${projectForm.environment} 환경 기준으로 최소 사양이 적용됩니다. 실서비스 전에 prod로 전환하세요.`
          }
          onNext={() =>
            handleSaveStep('2-1', {
              prefix:       projectForm.prefix,
              environment:  projectForm.environment,
              region:       projectForm.region,
              project_name: projectForm.name,
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="npc-grid-2">
            <div className="npc-field">
              <label className="npc-label">Prefix</label>
              <div className="npc-input-wrap npc-readonly">
                <input className="npc-input npc-mono" value={projectForm.prefix} readOnly />
              </div>
            </div>
            <div className="npc-field">
              <label className="npc-label">Environment</label>
              <div className="npc-input-wrap npc-readonly">
                <input className="npc-input npc-mono" value={projectForm.environment} readOnly />
              </div>
            </div>
          </div>

          {namingPreview.length > 0 ? (
            <div className="npc-preview-block">
              <div className="npc-preview-label">생성될 리소스 이름 미리보기</div>
              <ul className="npc-preview-list">
                {namingPreview.slice(0, 5).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              {namingPreview.length > 5 && (
                <div className="npc-preview-more">+ 외 {namingPreview.length - 5}개</div>
              )}
            </div>
          ) : (
            <p className="npc-helper">
              다음을 누르면{' '}
              <span className="npc-mono-inline">
                {projectForm.prefix || 'PREFIX'}-{projectForm.environment}-*
              </span>{' '}
              형식으로 16개 리소스 이름이 확정됩니다.
            </p>
          )}
        </WizardLayout>
      </>
    )
  }

  // ── phase: 2-2 네트워크 ────────────────────────────────────────
  if (phase === '2-2') {
    const currentCidr = (stepConfigs['2-2']?.vpc_cidr as string) || '10.0.0.0/16'
    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-2"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="VPC 네트워크 대역을 정해주세요."
          description="CIDR 하나만 입력하면 서브넷 분배, 인터넷 게이트웨이, NAT Gateway, 라우팅 테이블이 모두 자동 생성됩니다."
          sidekick="CIDR 하나만 입력하면 서브넷 분배, 인터넷 게이트웨이, NAT Gateway, 라우팅 테이블이 모두 자동 생성됩니다. 직접 만들 필요 없습니다."
          onPrev={() => setPhase('2-1')}
          onNext={() => {
            const cidr = (stepConfigs['2-2']?.vpc_cidr as string) || '10.0.0.0/16'
            if (!validateCIDR(cidr)) {
              setCidrError('올바른 CIDR 형식이 아닙니다. 예) 10.0.0.0/16')
              return
            }
            setCidrError('')
            handleSaveStep('2-2', { vpc_cidr: cidr })
          }}
          isSubmitting={isSubmitting}
        >
          <div className="npc-field">
            <label className="npc-label">VPC CIDR</label>
            <p className="npc-hint">
              대부분의 경우 기본값(10.0.0.0/16)을 그대로 사용해도 됩니다. 다른 사내 네트워크와 겹치지 않게 설정해주세요.
            </p>
            <div className={`npc-input-wrap${cidrError ? ' npc-error' : ''}`}>
              <input
                className="npc-input npc-mono"
                defaultValue="10.0.0.0/16"
                onChange={(e) => {
                  const val = e.target.value
                  setStepConfigs((prev) => ({
                    ...prev,
                    '2-2': { ...prev['2-2'], vpc_cidr: val },
                  }))
                  if (cidrError) {
                    setCidrError(validateCIDR(val) ? '' : '올바른 CIDR 형식이 아닙니다. 예) 10.0.0.0/16')
                  }
                }}
              />
            </div>
            {cidrError ? (
              <p className="npc-field-error">{cidrError}</p>
            ) : (
              <p className="npc-hint">
                {isProd
                  ? 'prod → Public 2 + Private 2 (Multi-AZ 고가용성 구성)'
                  : `${projectForm.environment} → Public 1 + Private 1 (단일 AZ 구성)`}
              </p>
            )}
          </div>

          <div className="npc-preview-block">
            <div className="npc-preview-label">자동 생성될 서브넷 구성</div>
            <ul className="npc-preview-list">
              {isProd ? (
                <>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.1.0/24')} · Public · {projectForm.region}a</li>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.2.0/24')} · Public · {projectForm.region}c</li>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.11.0/24')} · Private · {projectForm.region}a</li>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.12.0/24')} · Private · {projectForm.region}c</li>
                </>
              ) : (
                <>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.1.0/24')} · Public · {projectForm.region}a</li>
                  <li>{currentCidr.replace(/\.0\/\d+$/, '.11.0/24')} · Private · {projectForm.region}a</li>
                </>
              )}
            </ul>
            <div className="npc-preview-more">+ Internet Gateway · NAT Gateway · Route Table 자동 구성</div>
          </div>
        </WizardLayout>
      </>
    )
  }

  // ── phase: 2-3 보안 그룹 ──────────────────────────────────────
  if (phase === '2-3') {
    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-3"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="금융보안 3-Tier 망분리가 자동 적용됩니다."
          description="외부망(ALB)이 탈취되더라도 내부 DB로의 침투를 구조적으로 차단하는 구성입니다. 금융위원회 전자금융업 보안 심사 망분리 요건을 자동 충족합니다."
          sidekick="이 구성으로 금융위원회 전자금융업 보안 심사의 망분리 요건을 자동 충족합니다. 외부망(ALB)이 탈취되더라도 내부 DB로의 침투를 구조적으로 차단합니다."
          onPrev={() => setPhase('2-2')}
          onNext={() => handleSaveStep('2-3', {})}
          isSubmitting={isSubmitting}
        >
          <div className="npc-sg-block">
            <div className="npc-sg-title">3-Tier Security Group 자동 구성</div>
            <div className="npc-sg-rows">
              <div className="npc-sg-row">
                <div className="npc-sg-key">SG-ALB</div>
                <div className="npc-sg-val">
                  <span className="npc-arrow-glyph">↓</span>
                  외부 인터넷 → 443, 80 허용 (HTTPS/HTTP)
                </div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">SG-App</div>
                <div className="npc-sg-val">
                  <span className="npc-arrow-glyph">↓</span>
                  ALB에서 오는 트래픽만 앱 서버 8080 허용
                </div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">SG-DB</div>
                <div className="npc-sg-val">
                  <span className="npc-arrow-glyph">·</span>
                  앱 서버에서 오는 트래픽만 DB 5432 허용
                </div>
              </div>
            </div>
          </div>
          <p className="npc-helper">※ 모든 규칙이 최적값으로 자동 설정됩니다. 수정 없이 다음으로 넘어가세요.</p>
        </WizardLayout>
      </>
    )
  }

  // ── phase: 2-4 ALB ────────────────────────────────────────────
  if (phase === '2-4') {
    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-4"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="로드 밸런서가 자동 생성됩니다."
          description="외부 트래픽을 받아 앱 서버로 분산하는 ALB(Application Load Balancer)입니다. 2개 가용영역(AZ)에 분산 배치되어 특정 데이터센터에 장애가 나도 서비스가 유지됩니다."
          sidekick="2개 가용영역(AZ)에 분산 배치되어 특정 데이터센터에 장애가 나도 서비스가 유지됩니다."
          onPrev={() => setPhase('2-3')}
          onNext={() =>
            handleSaveStep('2-4', {
              alb_name: `${projectForm.prefix}-${projectForm.environment}-alb`,
            })
          }
          isSubmitting={isSubmitting}
        >
          <div className="npc-field">
            <label className="npc-label">로드 밸런서 이름 (자동 생성)</label>
            <div className="npc-input-wrap npc-readonly">
              <input
                className="npc-input npc-mono"
                value={`${projectForm.prefix}-${projectForm.environment}-alb`}
                readOnly
              />
            </div>
          </div>

          <div className="npc-preview-block">
            <div className="npc-preview-label">자동 구성 항목</div>
            <ul className="npc-preview-list">
              <li>Public 서브넷 2개에 자동 배치 (Multi-AZ)</li>
              <li>SG-ALB 자동 연결</li>
              <li>HTTPS:443 리스너 + HTTP → HTTPS 자동 리다이렉트</li>
            </ul>
          </div>
        </WizardLayout>
      </>
    )
  }

  // ── phase: 2-5 ECS ────────────────────────────────────────────
  if (phase === '2-5') {
      const ecsVcpu   = (recommendedConfig as Record<string, Record<string, number>>)?.ecs?.vcpu ?? 1
      const ecsMemory = (recommendedConfig as Record<string, Record<string, number>>)?.ecs?.memory ?? 2048
    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-5"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="애플리케이션 컨테이너 설정"
          description="ECS Fargate로 컨테이너를 띄웁니다. vCPU/메모리는 표준값으로 고정되고, 이미지 주소만 지정해주세요."
          sidekick={
            isProd
              ? '실서비스 환경: 최소 2개 컨테이너 상시 유지 + 트래픽 급증 시 자동 확장. 서비스 중단 없이 운영됩니다.'
              : `${projectForm.environment} 환경: 최소 1개 컨테이너, 오토스케일링 OFF (비용 최소화).`
          }
          onPrev={() => setPhase('2-4')}
          onNext={() =>
            handleSaveStep('2-5', {
            vcpu:               ecsVcpu,
            memory:             ecsMemory,
            container_image:    (stepConfigs['2-5']?.container_image as string) || DEFAULT_CONTAINER_IMAGE,
            recommended_config: recommendedConfig,
          })
          }
          isSubmitting={isSubmitting}
        >
          <div className="npc-grid-2">
            <div className="npc-field">
              <label className="npc-label">vCPU (고정)</label>
              <div className="npc-input-wrap npc-readonly">
                <input className="npc-input npc-mono" value={`${ecsVcpu} vCPU`} readOnly />
              </div>
            </div>
            <div className="npc-field">
              <label className="npc-label">메모리 (고정)</label>
              <div className="npc-input-wrap npc-readonly">
                <input className="npc-input npc-mono" value={`${ecsMemory} MB`} readOnly />
              </div>
            </div>
          </div>

          <div className="npc-field">
            <label className="npc-label">배포할 컨테이너 이미지 주소</label>
            <p className="npc-hint">
              ECR 형식:{' '}
              <span className="npc-mono-inline">{'{계정ID}'}.dkr.ecr.{'{리전}'}.amazonaws.com/{'{이미지명}'}:{'{태그}'}</span>
            </p>
            <div className="npc-input-wrap">
              <input
                className="npc-input npc-mono"
                defaultValue={DEFAULT_CONTAINER_IMAGE}
                onChange={(e) =>
                  setStepConfigs((prev) => ({
                    ...prev,
                    '2-5': { ...prev['2-5'], container_image: e.target.value },
                  }))
                }
              />
            </div>
            <p className="npc-hint">아직 이미지가 없다면 기본 샘플 이미지로 먼저 배포 후 교체할 수 있습니다.</p>
          </div>
        </WizardLayout>
      </>
    )
  }

  // ── phase: 2-6 RDS ────────────────────────────────────────────
  if (phase === '2-6') {
    const rdsInstanceClass = (recommendedConfig as Record<string, Record<string, string>>)?.rds?.instance_class
      ?? (isProd ? 'db.t3.medium' : 'db.t3.micro')

    return (
      <>
        <style>{styles}</style>
        <WizardLayout
          currentStep="2-6"
          completedSteps={completedSteps}
          projectName={projectForm.name}
          region={projectForm.region}
          onExit={() => projectId && router.push(`/projects/${projectId}`)}
          title="데이터베이스 자동 구성"
          description={`규제 요건 기반으로 ${projectForm.environment} 환경에 맞춰 PostgreSQL이 자동 구성됩니다.`}
          sidekick={
            isProd
              ? '전자금융감독규정 준수를 위한 최소 보안 요건이 자동 적용됩니다. Multi-AZ + 백업 30일 + 암호화는 tfsec·checkov 필수 통과 조건입니다.'
              : `${projectForm.environment} 환경 최소 사양이 적용됩니다. 개발팀이 직접 설정할 필요 없습니다.`
          }
          onPrev={() => setPhase('2-5')}
          onNext={async () => {
            await handleSaveStep('2-6', {
              recommended_config: recommendedConfig,
            })
            setPhase('summary')
          }}
          isSubmitting={isSubmitting}
        >
          <div className="npc-sg-block">
            <div className="npc-sg-title">RDS PostgreSQL · {projectForm.environment}</div>
            <div className="npc-sg-rows">
              <div className="npc-sg-row">
                <div className="npc-sg-key">엔진</div>
                <div className="npc-sg-val">PostgreSQL 15</div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">인스턴스</div>
                <div className="npc-sg-val npc-mono">{rdsInstanceClass}</div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">Multi-AZ</div>
                <div className="npc-sg-val">
                  <span className={`npc-pill ${isProd ? 'npc-pill-on' : 'npc-pill-off'}`}>{isProd ? 'ON' : 'OFF'}</span>
                  {isProd && <span className="npc-sg-note">이중화로 DB 장애 시 자동 전환</span>}
                </div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">백업 보존</div>
                <div className="npc-sg-val">
                  <span className="npc-mono">{isProd ? '30일' : '0일'}</span>
                  {isProd && <span className="npc-sg-note">금융보안원 요건</span>}
                </div>
              </div>
              <div className="npc-sg-row">
                <div className="npc-sg-key">암호화</div>
                <div className="npc-sg-val">
                  <span className={`npc-pill ${isProd ? 'npc-pill-on' : 'npc-pill-off'}`}>{isProd ? 'ON' : 'OFF'}</span>
                  {isProd && <span className="npc-sg-note">tfsec 필수 항목</span>}
                </div>
              </div>
            </div>
          </div>
          {isProd && (
            <p className="npc-helper">
              ※ 이 설정 없이는 다음 단계(Validation Loop)의 tfsec·checkov 보안 스캔을 통과할 수 없습니다.
            </p>
          )}
        </WizardLayout>
      </>
    )
  }

  // ── phase: summary ────────────────────────────────────────────
  if (phase === 'summary') {
    const vpcCidr        = (stepConfigs['2-2']?.vpc_cidr as string) || '10.0.0.0/16'
    const albName        = `${projectForm.prefix}-${projectForm.environment}-alb`
    const containerImage = (stepConfigs['2-5']?.container_image as string) || DEFAULT_CONTAINER_IMAGE
    const rdsInstanceClass = (recommendedConfig as Record<string, Record<string, string>>)?.rds?.instance_class
      ?? (isProd ? 'db.t3.medium' : 'db.t3.micro')
    const ecsVcpu   = (recommendedConfig as Record<string, Record<string, number>>)?.ecs?.vcpu ?? 1
    const ecsMemory = (recommendedConfig as Record<string, Record<string, number>>)?.ecs?.memory ?? 2048
    const ecsMaxTasks   = (recommendedConfig as Record<string, Record<string, Record<string, number>>>)?.ecs?.autoscaling?.max ?? (isProd ? 10 : 3)
    const ecsTargetCpu  = (recommendedConfig as Record<string, Record<string, Record<string, number>>>)?.ecs?.autoscaling?.target_cpu ?? 70

    return (
      <>
        <style>{styles}</style>
        <TopBar
          stepLabel="Summary · 배포 직전"
          onBack={() => setPhase('2-6')}
          backLabel="← 설정으로"
        />

        <div className="npc-shell">
          <div className="npc-shell-inner npc-wide">

            <div className="npc-step-header">
              <div className="npc-step-eyebrow">
                <span className="npc-pip" />
                Step 07 · 최종 확인
              </div>
              <h1 className="npc-step-title">배포 전 최종 확인</h1>
              <p className="npc-step-desc">
                아래 <span className="npc-emph">16개 리소스</span>가 AWS{' '}
                <span className="npc-mono-inline">{projectForm.region}</span>에 생성됩니다. 배포 후 AWS 요금이 발생하니 내용을 확인하세요.
              </p>
            </div>

            <div className="npc-summary-grid">

              {/* 기본 설정 */}
              <div className="npc-sum-card">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">01</div>
                  <div className="npc-sum-title">기본 설정</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span>서비스 이름</span><span className="npc-mono">{projectForm.name}</span></div>
                  <div className="npc-sum-row"><span>네이밍 규칙</span><span className="npc-mono">{projectForm.prefix}-{projectForm.environment}-*</span></div>
                  <div className="npc-sum-row"><span>배포 리전</span><span className="npc-mono">{projectForm.region}</span></div>
                  <div className="npc-sum-row"><span>환경</span><span className="npc-mono">{projectForm.environment}</span></div>
                </div>
              </div>

              {/* 네트워크 */}
              <div className="npc-sum-card">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">02</div>
                  <div className="npc-sum-title">네트워크</div>
                  <div className="npc-sum-sub">VPC · 서브넷 · IGW · NAT</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span>VPC CIDR</span><span className="npc-mono">{vpcCidr}</span></div>
                  <div className="npc-sum-row"><span>서브넷</span><span className="npc-mono">{isProd ? 'Public 2 + Private 2 (Multi-AZ)' : 'Public 1 + Private 1'}</span></div>
                  <div className="npc-sum-row"><span>NAT Gateway</span><span className="npc-mono">{isProd ? '생성' : '미생성'}</span></div>
                </div>
              </div>

              {/* 보안 그룹 */}
              <div className="npc-sum-card">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">03</div>
                  <div className="npc-sum-title">보안 그룹</div>
                  <div className="npc-sum-sub">금융보안 3-Tier 망분리</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span className="npc-mono">SG-ALB</span><span className="npc-mono">외부 → 443, 80</span></div>
                  <div className="npc-sum-row"><span className="npc-mono">SG-App</span><span className="npc-mono">ALB → 8080</span></div>
                  <div className="npc-sum-row"><span className="npc-mono">SG-DB</span><span className="npc-mono">App → 5432</span></div>
                </div>
              </div>

              {/* ALB */}
              <div className="npc-sum-card">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">04</div>
                  <div className="npc-sum-title">ALB</div>
                  <div className="npc-sum-sub">로드 밸런서</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span>이름</span><span className="npc-mono">{albName}</span></div>
                  <div className="npc-sum-row"><span>리스너</span><span className="npc-mono">HTTPS:443</span></div>
                </div>
              </div>

              {/* ECS */}
              <div className="npc-sum-card npc-sum-wide">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">05</div>
                  <div className="npc-sum-title">ECS Fargate</div>
                  <div className="npc-sum-sub">앱 서버</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span>vCPU / 메모리</span><span className="npc-mono">{ecsVcpu} vCPU · {ecsMemory} MB</span></div>
                  <div className="npc-sum-row"><span>이미지</span><span className="npc-mono npc-break">{containerImage}</span></div>
                  <div className="npc-sum-row"><span>최소 태스크</span><span className="npc-mono">{isProd ? '2 (고가용성)' : '1'}</span></div>
                  <div className="npc-sum-row"><span>오토스케일링</span><span className="npc-mono">{isProd ? `ON · CPU ${ecsTargetCpu}% · 최대 ${ecsMaxTasks}` : 'OFF'}</span></div>
                </div>
              </div>

              {/* RDS */}
              <div className="npc-sum-card npc-sum-wide">
                <div className="npc-sum-head">
                  <div className="npc-sum-num">06</div>
                  <div className="npc-sum-title">RDS PostgreSQL</div>
                  <div className="npc-sum-sub">데이터베이스</div>
                </div>
                <div className="npc-sum-rows">
                  <div className="npc-sum-row"><span>인스턴스</span><span className="npc-mono">{rdsInstanceClass}</span></div>
                  <div className="npc-sum-row"><span>Multi-AZ</span><span className="npc-mono">{isProd ? 'ON' : 'OFF'}</span></div>
                  <div className="npc-sum-row"><span>백업 보존</span><span className="npc-mono">{isProd ? '30일' : '0일'}</span></div>
                  <div className="npc-sum-row"><span>암호화</span><span className="npc-mono">{isProd ? 'ON' : 'OFF'}</span></div>
                </div>
              </div>
            </div>

            {/* Next steps banner */}
            <div className="npc-next-banner">
              <div className="npc-next-ico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3 7-7"/>
                  <path d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9"/>
                </svg>
              </div>
              <div>
                <div className="npc-next-label">다음 단계 · Validation Loop</div>
                <div className="npc-next-text">
                  <span className="npc-mono-inline">terraform validate</span> →{' '}
                  <span className="npc-mono-inline">tfsec · checkov</span> 보안 스캔 →{' '}
                  <span className="npc-mono-inline">Infracost</span> 비용 예측 →{' '}
                  <span className="npc-mono-inline">terraform plan</span> 순서로 자동 검증 후 배포가 실행됩니다.
                </div>
              </div>
            </div>

            <div className="npc-nav-row">
              <button className="npc-btn-prev" onClick={() => setPhase('2-6')}>
                <span className="npc-arrow">←</span>
                설정 다시 보기
              </button>
              <button
                className="npc-btn-next"
                onClick={() => projectId && router.push(`/projects/${projectId}/validate`)}
              >
                <span>검증 시작하기</span>
                <span className="npc-arrow">→</span>
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return null
}

// ─── shared styles ─────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

/* Top bar (reused from WizardLayout look) */
.npc-topbar {
  position: sticky; top: 0; z-index: 30;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 36px;
  background: rgba(11, 14, 23, 0.85);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.npc-top-left { display: flex; align-items: center; gap: 16px; }
.npc-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
  color: #edf0f6;
}
.npc-mark {
  width: 26px; height: 26px;
  border-radius: 7px;
  background:
    radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.7), transparent 60%),
    radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.7), transparent 60%),
    #11151f;
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow: 0 4px 24px rgba(90,163,255,0.18), inset 0 0 12px rgba(255,255,255,0.06);
  position: relative; flex-shrink: 0;
}
.npc-mark::after {
  content: ""; position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 9px; height: 9px; border-radius: 2px;
  background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
}
.npc-crumb-sep {
  width: 6px; height: 6px; transform: rotate(45deg);
  border-top: 1px solid #7a8298;
  border-right: 1px solid #7a8298;
}
.npc-crumb-proj { display: flex; flex-direction: column; gap: 2px; }
.npc-crumb-eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ffa53d;
  display: inline-flex; align-items: center; gap: 8px;
}
.npc-crumb-name {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 15px;
  color: #edf0f6; letter-spacing: -0.015em;
}
.npc-top-right { display: flex; align-items: center; gap: 14px; }
.npc-step-counter {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; letter-spacing: 0.14em;
  text-transform: uppercase; color: #aeb4c5;
  padding: 6px 12px; border: 1px solid rgba(255,255,255,0.13);
  border-radius: 100px; background: rgba(255,255,255,0.03);
}
.npc-btn-exit {
  font-size: 13px; font-weight: 500;
  color: #aeb4c5; background: none; border: none;
  cursor: pointer; padding: 6px 10px;
  transition: color 160ms; font-family: inherit;
}
.npc-btn-exit:hover { color: #edf0f6; }

/* Shell */
.npc-shell {
  min-height: calc(100vh - 70px);
  padding: 48px 36px 80px;
  display: flex; justify-content: center;
  color: #edf0f6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.npc-shell-inner { width: 100%; max-width: 600px; }
.npc-shell-inner.npc-wide { max-width: 1080px; }

.npc-step-header { margin-bottom: 28px; }
.npc-step-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #ffa53d;
  padding: 5px 11px;
  border: 1px solid rgba(255,165,61,0.3);
  border-radius: 100px;
  background: rgba(255,165,61,0.06);
  margin-bottom: 16px;
}
.npc-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 8px #ffa53d;
  animation: npc-pulse 1.6s ease-in-out infinite;
}
@keyframes npc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}
.npc-step-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 36px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 0 0 12px; color: #edf0f6;
}
.npc-step-desc {
  font-size: 15px; color: #aeb4c5;
  line-height: 1.6; margin: 0; max-width: 560px;
}
.npc-emph { color: #edf0f6; font-weight: 600; }

/* Form card */
.npc-form-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 28px;
  margin-bottom: 20px;
  display: flex; flex-direction: column; gap: 22px;
}

.npc-field { display: flex; flex-direction: column; gap: 8px; }
.npc-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #aeb4c5;
}
.npc-hint {
  font-size: 12.5px; color: #7a8298;
  line-height: 1.5; margin: 0;
}
.npc-hint.npc-preview { color: #aeb4c5; }
.npc-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.npc-mono-inline {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #edf0f6;
  background: rgba(255,255,255,0.05);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.92em;
}

.npc-input-wrap {
  position: relative;
  display: flex; align-items: center;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 10px;
  background: rgba(255,255,255,0.025);
  transition: border-color 200ms, background 200ms, box-shadow 200ms;
}
.npc-input-wrap:hover { border-color: rgba(255,255,255,0.20); }
.npc-input-wrap:focus-within {
  border-color: rgba(255,165,61,0.55);
  background: rgba(255,255,255,0.04);
  box-shadow: 0 0 0 4px rgba(255,165,61,0.10);
}
.npc-input-wrap.npc-error {
  border-color: rgba(255,118,118,0.55);
  box-shadow: 0 0 0 4px rgba(255,118,118,0.10);
}
.npc-input-wrap.npc-readonly {
  background: rgba(255,255,255,0.015);
  border-style: dashed;
}
.npc-input {
  flex: 1; min-width: 0;
  background: transparent; border: none; outline: none;
  color: #edf0f6;
  font-family: 'Pretendard Variable', -apple-system, sans-serif;
  font-size: 14.5px;
  padding: 13px 16px;
  letter-spacing: -0.005em;
}
.npc-input.npc-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13.5px; letter-spacing: 0.01em; }
.npc-input::placeholder { color: #7a8298; }
.npc-input-wrap.npc-readonly .npc-input { color: #aeb4c5; cursor: not-allowed; }

.npc-field-error {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #ff7676;
  margin: 0;
  display: flex; align-items: center; gap: 6px;
}
.npc-field-error::before {
  content: "!"; display: grid; place-items: center;
  width: 14px; height: 14px; border-radius: 50%;
  background: rgba(255,118,118,0.18);
  font-size: 9px; font-weight: 700;
}

.npc-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.npc-helper {
  font-size: 12.5px; color: #7a8298;
  line-height: 1.55; margin: 4px 0 0;
}

/* Env selector cards */
.npc-env-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.npc-env-card {
  position: relative;
  padding: 14px 14px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
  text-align: left;
  cursor: pointer;
  transition: all 180ms;
  display: flex; flex-direction: column; gap: 4px;
  font-family: inherit;
}
.npc-env-card:hover { border-color: rgba(255,255,255,0.20); background: rgba(255,255,255,0.04); }
.npc-env-card .npc-env-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; font-weight: 600;
  color: #edf0f6; letter-spacing: 0.04em;
  text-transform: uppercase;
}
.npc-env-card .npc-env-desc { font-size: 11.5px; color: #aeb4c5; line-height: 1.4; }
.npc-env-card .npc-env-check {
  position: absolute; top: 12px; right: 12px;
  width: 16px; height: 16px;
  border-radius: 50%;
  display: grid; place-items: center;
  background: transparent; color: transparent;
  border: 1px solid rgba(255,255,255,0.20);
  transition: all 200ms;
}
.npc-env-card.npc-active {
  background: rgba(255,165,61,0.06);
  border-color: rgba(255,165,61,0.45);
  box-shadow: 0 0 0 4px rgba(255,165,61,0.08), 0 0 24px -8px rgba(255,165,61,0.4);
}
.npc-env-card.npc-active .npc-env-name { color: #ffa53d; }
.npc-env-card.npc-active .npc-env-check {
  background: #ffa53d;
  border-color: #ffa53d;
  color: #0a0d14;
}
.npc-env-card[data-tone="yellow"].npc-active {
  background: rgba(245,208,97,0.06);
  border-color: rgba(245,208,97,0.45);
  box-shadow: 0 0 0 4px rgba(245,208,97,0.08), 0 0 24px -8px rgba(245,208,97,0.4);
}
.npc-env-card[data-tone="yellow"].npc-active .npc-env-name { color: #f5d061; }
.npc-env-card[data-tone="yellow"].npc-active .npc-env-check { background: #f5d061; border-color: #f5d061; }
.npc-env-card[data-tone="blue"].npc-active {
  background: rgba(90,163,255,0.06);
  border-color: rgba(90,163,255,0.45);
  box-shadow: 0 0 0 4px rgba(90,163,255,0.08), 0 0 24px -8px rgba(90,163,255,0.4);
}
.npc-env-card[data-tone="blue"].npc-active .npc-env-name { color: #5aa3ff; }
.npc-env-card[data-tone="blue"].npc-active .npc-env-check { background: #5aa3ff; border-color: #5aa3ff; }

.npc-region-note {
  font-size: 12.5px;
  color: #7a8298;
  line-height: 1.55; margin: 0;
  padding-top: 4px;
}

/* Preview block (used for naming preview, subnet preview, etc) */
.npc-preview-block {
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px dashed rgba(255,165,61,0.25);
  background: rgba(255,165,61,0.04);
}
.npc-preview-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ffa53d; margin-bottom: 10px;
}
.npc-preview-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  color: #edf0f6;
}
.npc-preview-list li::before {
  content: "›";
  color: #ffa53d;
  margin-right: 8px;
}
.npc-preview-more {
  font-family: 'Pretendard Variable', -apple-system, sans-serif;
  font-size: 12px;
  color: #7a8298;
  margin-top: 8px;
  padding-left: 18px;
}

/* Security group / RDS read-only block */
.npc-sg-block {
  padding: 20px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.018);
}
.npc-sg-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  color: #edf0f6;
  margin-bottom: 14px;
  letter-spacing: -0.01em;
}
.npc-sg-rows { display: flex; flex-direction: column; }
.npc-sg-row {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
  align-items: center;
}
.npc-sg-row:last-child { border-bottom: none; }
.npc-sg-key {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 600;
  color: #ffa53d;
  letter-spacing: 0.04em;
}
.npc-sg-val {
  font-size: 13.5px;
  color: #aeb4c5;
  line-height: 1.5;
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.npc-sg-val.npc-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #edf0f6; }
.npc-arrow-glyph {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #7a8298; font-size: 14px;
}
.npc-sg-note { font-size: 11.5px; color: #7a8298; }

.npc-pill {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 100px;
  border: 1px solid;
}
.npc-pill-on { color: #6ee7a0; border-color: rgba(110,231,160,0.35); background: rgba(110,231,160,0.10); }
.npc-pill-off { color: #7a8298; border-color: rgba(255,255,255,0.13); background: rgba(255,255,255,0.025); }

/* Nav buttons (mirror WizardLayout) */
.npc-nav-row { display: flex; justify-content: space-between; align-items: center; padding-top: 8px; }
.npc-btn-prev {
  font-size: 13.5px; font-weight: 500;
  color: #aeb4c5; background: none; border: none;
  cursor: pointer; padding: 10px 8px;
  display: inline-flex; align-items: center; gap: 8px;
  transition: color 160ms;
  font-family: inherit;
}
.npc-btn-prev:hover:not(:disabled) { color: #edf0f6; }
.npc-btn-prev:hover:not(:disabled) .npc-arrow { transform: translateX(-3px); }
.npc-btn-prev .npc-arrow { transition: transform 200ms; display: inline-block; }
.npc-btn-prev:disabled { opacity: 0.3; cursor: not-allowed; }

.npc-btn-next {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 13px 22px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 600;
  letter-spacing: -0.005em;
  border-radius: 10px;
  border: 1px solid #f3f4f8;
  background: linear-gradient(180deg, #ffffff, #e8eaf0);
  color: #0a0d14;
  cursor: pointer;
  transition: transform 180ms, box-shadow 180ms, filter 180ms;
}
.npc-btn-next:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(255,165,61,0.5);
}
.npc-btn-next:disabled { opacity: 0.6; cursor: not-allowed; filter: saturate(0.6); }
.npc-btn-next .npc-arrow { transition: transform 200ms; display: inline-block; }
.npc-btn-next:hover:not(:disabled) .npc-arrow { transform: translateX(3px); }

.npc-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: npc-spin 700ms linear infinite;
  display: inline-block;
}
@keyframes npc-spin { to { transform: rotate(360deg); } }

/* Summary cards */
.npc-summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 24px;
}
.npc-sum-card {
  position: relative;
  padding: 22px 22px 20px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.10);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  overflow: hidden;
}
.npc-sum-card::before {
  content: ""; position: absolute;
  top: 0; left: 22px; right: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255,165,61,0.5), transparent);
}
.npc-sum-card.npc-sum-wide { grid-column: span 2; }
.npc-sum-head {
  display: flex; align-items: baseline; gap: 12px;
  margin-bottom: 14px;
}
.npc-sum-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 600;
  letter-spacing: 0.12em;
  color: #ffa53d;
}
.npc-sum-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 16px; font-weight: 700;
  letter-spacing: -0.015em;
  color: #edf0f6;
}
.npc-sum-sub {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.06em;
  margin-left: auto;
}
.npc-sum-rows { display: flex; flex-direction: column; }
.npc-sum-row {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255,255,255,0.06);
  font-size: 13.5px;
  align-items: center;
}
.npc-sum-row:last-child { border-bottom: none; }
.npc-sum-row > span:first-child { color: #aeb4c5; flex-shrink: 0; }
.npc-sum-row > span:last-child { color: #edf0f6; font-weight: 500; text-align: right; }
.npc-mono.npc-break { word-break: break-all; font-size: 12px; }

/* Validation next-step banner */
.npc-next-banner {
  display: flex; gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid rgba(90,163,255,0.22);
  background: linear-gradient(135deg, rgba(90,163,255,0.06), rgba(90,163,255,0.02));
  margin-bottom: 24px;
}
.npc-next-ico {
  flex-shrink: 0;
  width: 32px; height: 32px;
  border-radius: 8px;
  border: 1px solid rgba(90,163,255,0.3);
  background: rgba(90,163,255,0.10);
  color: #5aa3ff;
  display: grid; place-items: center;
}
.npc-next-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #5aa3ff; margin-bottom: 4px;
}
.npc-next-text { font-size: 13px; color: #aeb4c5; line-height: 1.6; }

@media (max-width: 900px) {
  .npc-topbar { padding: 14px 20px; }
  .npc-top-left .npc-crumb-sep, .npc-top-left .npc-crumb-proj { display: none; }
  .npc-shell { padding: 32px 20px 64px; }
  .npc-step-title { font-size: 28px; }
  .npc-env-grid { grid-template-columns: 1fr; }
  .npc-grid-2 { grid-template-columns: 1fr; }
  .npc-summary-grid { grid-template-columns: 1fr; }
  .npc-sum-card.npc-sum-wide { grid-column: span 1; }
}
`
