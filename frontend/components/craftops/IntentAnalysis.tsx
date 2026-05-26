// frontend/components/craftops/IntentAnalysis.tsx
'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/api'

interface AnalysisResult {
  analysis_id: string
  resources: string[]
  recommended_config: Record<string, unknown>
}

interface Props {
  projectId: string
  environment: string
  onComplete: (result: AnalysisResult) => void
}

const getResourceLabels = (env: string): Record<string, string> => {
  const isProd = env === 'prod' || env === 'production'
  return {
    vpc:            isProd
      ? 'VPC + Subnet 4개 + IGW + NAT Gateway'
      : 'VPC + Subnet 2개 + IGW',
    security_group: 'Security Group 3개',
    alb:            'ALB + Target Group',
    ecs_fargate:    'ECS Fargate (오토스케일링)',
    rds:            isProd
      ? 'RDS PostgreSQL (Multi-AZ)'
      : 'RDS PostgreSQL (Single-AZ)',
  }
}

export function IntentAnalysis({ projectId, environment, onComplete }: Props) {
  const [prompt, setPrompt]           = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult]           = useState<AnalysisResult | null>(null)
  const [error, setError]             = useState('')

  const resourceLabels = getResourceLabels(environment)

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

  // subnet은 vpc 항목에 포함되므로 필터링
  const displayResources = (result?.resources ?? []).filter(r => r !== 'subnet')

  return (
    <>
      <style>{styles}</style>

      <div className="ia-wrap">

        {/* Prompt input */}
        <div className="ia-field">
          <label className="ia-label">
            <span className="ia-label-text">인프라 요구사항을 자연어로 입력하세요</span>
            <span className="ia-label-hint">Gemini가 분석해 16개 AWS 리소스 구성을 제안합니다.</span>
          </label>
          <div className="ia-textarea-wrap">
            <textarea
              className="ia-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="예) 프로덕션용 Python API 서버, PostgreSQL DB, 오레곤 리전, 오토스케일링 필요"
              rows={4}
            />
            <div className="ia-textarea-foot">
              <span className="ia-char-count">{prompt.length}자</span>
              <span className="ia-hint-row">
                <kbd className="ia-kbd">⌘</kbd>
                <kbd className="ia-kbd">↵</kbd>
                <span>분석 실행</span>
              </span>
            </div>
          </div>
        </div>

        {/* Analyze button */}
        <button
          className="ia-btn-primary"
          onClick={handleAnalyze}
          disabled={isAnalyzing || !prompt.trim()}
        >
          {isAnalyzing ? (
            <>
              <span className="ia-spinner" />
              <span>AI 분석 중...</span>
            </>
          ) : (
            <>
              <span>분석하기</span>
              <span className="ia-arrow">→</span>
            </>
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="ia-alert" role="alert">
            <span className="ia-alert-ico">!</span>
            <span>{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="ia-result">
            <div className="ia-result-head">
              <div className="ia-result-eyebrow">
                <span className="ia-pip" />
                AI 분석 결과
              </div>
              <span className="ia-result-count">{displayResources.length}개 컴포넌트</span>
            </div>

            <ul className="ia-result-list">
              {displayResources.map((r) => (
                <li key={r} className="ia-result-item">
                  <span className="ia-check">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </span>
                  <span className="ia-item-label">{resourceLabels[r] ?? r}</span>
                </li>
              ))}
            </ul>

            <button className="ia-btn-primary ia-btn-full" onClick={() => onComplete(result)}>
              <span>설정 시작하기</span>
              <span className="ia-arrow">→</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}

const styles = `
.ia-wrap {
  display: flex; flex-direction: column; gap: 22px;
  color: #edf0f6;
  font-family: 'Pretendard Variable', -apple-system, sans-serif;
}

.ia-field { display: flex; flex-direction: column; gap: 10px; }
.ia-label { display: flex; flex-direction: column; gap: 4px; }
.ia-label-text {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #aeb4c5;
}
.ia-label-hint { font-size: 12.5px; color: #7a8298; line-height: 1.5; }

.ia-textarea-wrap {
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 12px;
  background: rgba(255,255,255,0.025);
  transition: border-color 200ms, background 200ms, box-shadow 200ms;
  overflow: hidden;
}
.ia-textarea-wrap:hover { border-color: rgba(255,255,255,0.20); }
.ia-textarea-wrap:focus-within {
  border-color: rgba(255,165,61,0.55);
  background: rgba(255,255,255,0.04);
  box-shadow: 0 0 0 4px rgba(255,165,61,0.10);
}
.ia-textarea {
  width: 100%;
  background: transparent;
  border: none; outline: none; resize: vertical;
  color: #edf0f6;
  font-family: inherit;
  font-size: 14.5px;
  line-height: 1.6;
  padding: 16px 18px 12px;
  letter-spacing: -0.005em;
  min-height: 110px;
}
.ia-textarea::placeholder { color: #7a8298; }
.ia-textarea-foot {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 18px 12px;
  border-top: 1px dashed rgba(255,255,255,0.06);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.02em;
}
.ia-hint-row { display: inline-flex; align-items: center; gap: 6px; }
.ia-kbd {
  display: inline-grid; place-items: center;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  font-family: inherit; font-size: 10.5px;
  color: #aeb4c5;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 4px;
}

.ia-btn-primary {
  align-self: flex-start;
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
.ia-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(255,165,61,0.5);
}
.ia-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; filter: saturate(0.6); }
.ia-btn-primary .ia-arrow { transition: transform 200ms; display: inline-block; }
.ia-btn-primary:hover:not(:disabled) .ia-arrow { transform: translateX(3px); }
.ia-btn-full { width: 100%; justify-content: center; }

.ia-spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(10,13,20,0.2);
  border-top-color: rgba(10,13,20,0.9);
  animation: ia-spin 700ms linear infinite;
  display: inline-block;
}
@keyframes ia-spin { to { transform: rotate(360deg); } }

.ia-alert {
  display: flex; gap: 10px; align-items: center;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,118,118,0.3);
  background: rgba(255,118,118,0.06);
  color: #ff7676;
  font-size: 13px; line-height: 1.5;
}
.ia-alert-ico {
  flex-shrink: 0; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(255,118,118,0.18);
  display: grid; place-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700; font-size: 11px;
}

.ia-result {
  border-radius: 14px;
  border: 1px solid rgba(110,231,160,0.22);
  background: linear-gradient(180deg, rgba(110,231,160,0.05), rgba(110,231,160,0.01));
  padding: 22px 22px 20px;
  display: flex; flex-direction: column; gap: 16px;
}
.ia-result-head { display: flex; align-items: center; justify-content: space-between; }
.ia-result-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #6ee7a0;
}
.ia-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #6ee7a0; box-shadow: 0 0 8px #6ee7a0;
}
.ia-result-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #aeb4c5;
  letter-spacing: 0.1em;
  padding: 3px 9px;
  border-radius: 100px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.04);
}

.ia-result-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ia-result-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.08);
}
.ia-check {
  flex-shrink: 0;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(110,231,160,0.18);
  border: 1px solid rgba(110,231,160,0.4);
  display: grid; place-items: center;
  color: #6ee7a0;
}
.ia-item-label {
  font-size: 13.5px; color: #edf0f6;
  font-weight: 500; letter-spacing: -0.005em;
}
`