// frontend/components/craftops/WizardLayout.tsx
'use client'

import { ReactNode } from 'react'

interface Step {
  id: string
  label: string
}

const STEPS: Step[] = [
  { id: '2-1', label: '기본 설정' },
  { id: '2-2', label: '네트워크' },
  { id: '2-3', label: '보안 그룹' },
  { id: '2-4', label: 'ALB' },
  { id: '2-5', label: 'ECS' },
  { id: '2-6', label: 'RDS' },
]

interface Props {
  currentStep: string
  completedSteps: string[]
  children: ReactNode
  dependencyTree?: ReactNode
  sidekick?: string
  onPrev?: () => void
  onNext?: () => void
  isSubmitting?: boolean
}

export function WizardLayout({
  currentStep,
  completedSteps,
  children,
  sidekick,
  onPrev,
  onNext,
  isSubmitting,
}: Props) {
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep)

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* 왼쪽: 설정 폼 영역 */}
      <div className="col-span-2 space-y-4">
        {/* 단계 헤더 */}
        <div>
          <p className="text-xs text-gray-500">
            Step 2-{stepIndex + 1} / 6
          </p>
          <h2 className="text-xl font-bold">
            {STEPS[stepIndex]?.label}
          </h2>
        </div>

        {/* 폼 컨텐츠 */}
        {children}

        {/* Sidekick AI 권장 메시지 */}
        {sidekick && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
            💡 {sidekick}
          </div>
        )}

        {/* 이전/다음 버튼 */}
        <div className="flex justify-between pt-4">
          <button
            onClick={onPrev}
            disabled={!onPrev}
            className="text-gray-600 hover:text-gray-800 disabled:opacity-30"
          >
            ← 이전
          </button>
          <button
            onClick={onNext}
            disabled={isSubmitting}
            className="bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 disabled:opacity-50"
          >
            {isSubmitting ? '저장 중...' : '다음 →'}
          </button>
        </div>
      </div>

      {/* 오른쪽: 의존성 트리 — §12-6 */}
      <div className="col-span-1">
        <div className="border rounded p-4 space-y-2 sticky top-4">
          <p className="text-sm font-medium text-gray-600">── 의존성 트리 ──</p>
          {STEPS.map((step) => {
            const isDone = completedSteps.includes(step.id)
            const isCurrent = step.id === currentStep
            return (
              <div
                key={step.id}
                className={`text-sm flex items-center gap-2${
                  isCurrent ? 'font-bold text-teal-600' : ''
                }`}
              >
                <span>
                  {isDone ? '✅' : isCurrent ? '⏳' : '⬜'}
                </span>
                <span>{step.label}</span>
              </div>
            )
          })}
          <p className="text-xs text-gray-500 pt-2">총 16개 리소스</p>
        </div>
      </div>
    </div>
  )
}