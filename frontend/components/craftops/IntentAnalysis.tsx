// frontend/components/craftops/IntentAnalysis.tsx
'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface AnalysisResult {
  analysis_id: string
  resources: string[]
  recommended_config: Record<string, unknown>
}

interface Props {
  projectId: string
  onComplete: (result: AnalysisResult) => void
}

// §12-5 리소스 이름 매핑
const RESOURCE_LABELS: Record<string, string> = {
  vpc:            'VPC + Subnet 4개 + IGW + NAT Gateway',
  security_group: 'Security Group 3개',
  alb:            'ALB + Target Group',
  ecs_fargate:    'ECS Fargate (오토스케일링)',
  rds:            'RDS PostgreSQL (Multi-AZ 권장)',
}

export function IntentAnalysis({ projectId, onComplete }: Props) {
  const [prompt, setPrompt] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')

  const handleAnalyze = async () => {
    if (!prompt.trim()) return

    setIsAnalyzing(true)
    setError('')
    try {
      const res = await apiClient.post('/api/craft/analyze', {
        project_id: projectId,
        prompt,
      })
      setResult(res.data.data)
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message || 'AI 분석에 실패했습니다.'
      )
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* §12-5: 자연어 입력 영역 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">인프라 요구사항을 자연어로 입력하세요</label>
        <Textarea
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}   
          placeholder="예) 프로덕션용 Python API 서버, PostgreSQL DB, 오레곤 리전, 오토스케일링 필요"
          rows={4}
        />
      </div>

      <Button
        className="bg-teal-600 hover:bg-teal-700"
        onClick={handleAnalyze}
        disabled={isAnalyzing || !prompt.trim()}
      >
        {isAnalyzing ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin">⏳</span> AI 분석 중...
          </span>
        ) : (
          '분석하기 →'
        )}
      </Button>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* §12-5: AI 분석 결과 */}
      {result && (
        <Card className="border-teal-200 bg-teal-50">
          <CardContent className="p-4 space-y-3">
            <p className="font-medium text-teal-800">── AI 분석 결과 ──</p>
            <div className="space-y-1">
              {result.resources.map((r) => (
                <div key={r} className="flex items-center gap-2 text-sm">
                  <span className="text-green-600">✅</span>
                  <span>{RESOURCE_LABELS[r] ?? r}</span>
                </div>
              ))}
            </div>
            <Button
              className="w-full bg-teal-600 hover:bg-teal-700 mt-2"
              onClick={() => onComplete(result)}
            >
              설정 시작하기 →
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}