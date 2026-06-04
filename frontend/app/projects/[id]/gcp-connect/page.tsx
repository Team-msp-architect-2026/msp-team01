// frontend/app/projects/[id]/gcp-connect/page.tsx
'use client'

import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ConnectStatus = 'idle' | 'validating' | 'success' | 'error'

interface ConnectResult {
  gcp_project_id: string
  sa_email: string
  connected_at: string
}

const REQUIRED_ROLES = [
  'Cloud Run 관리자',
  'Compute 관리자',
  'Cloud SQL 관리자',
  '저장소 관리자',
  'Artifact Registry 관리자',
  '서비스 계정 관리자',
]

export default function GcpConnectPage() {
  const params    = useParams()
  const router    = useRouter()
  const projectId = params.id as string

  const [gcpProjectId, setGcpProjectId] = useState('')
  const [keyData, setKeyData]           = useState<Record<string, unknown> | null>(null)
  const [keyFileName, setKeyFileName]   = useState('')
  const [status, setStatus]             = useState<ConnectStatus>('idle')
  const [error, setError]               = useState('')
  const [result, setResult]             = useState<ConnectResult | null>(null)
  const [isDragging, setIsDragging]     = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── JSON 키 파싱 ─────────────────────────────────────────────
  const parseKeyFile = (file: File) => {
    setError('')
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      setError('JSON 형식의 서비스 계정 키 파일만 업로드할 수 있습니다.')
      setKeyData(null)
      setKeyFileName('')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        if (!parsed.client_email || !parsed.private_key) {
          setError('유효한 서비스 계정 키가 아닙니다. client_email / private_key 필드가 필요합니다.')
          setKeyData(null)
          setKeyFileName('')
          return
        }
        setKeyData(parsed)
        setKeyFileName(file.name)
        if (!gcpProjectId && typeof parsed.project_id === 'string') {
          setGcpProjectId(parsed.project_id)
        }
      } catch {
        setError('JSON 파싱에 실패했습니다. 파일이 손상되지 않았는지 확인하세요.')
        setKeyData(null)
        setKeyFileName('')
      }
    }
    reader.onerror = () => {
      setError('파일을 읽는 중 오류가 발생했습니다.')
    }
    reader.readAsText(file)
  }

  // ── 드래그 앤 드롭 ───────────────────────────────────────────
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseKeyFile(file)
  }

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseKeyFile(file)
  }

  // ── 연동 실행 ────────────────────────────────────────────────
  const handleConnect = async () => {
    if (!gcpProjectId || !keyData) return
    setStatus('validating')
    setError('')

    try {
      const res = await apiClient.post(`/api/projects/${projectId}/gcp/connect`, {
        gcp_project_id: gcpProjectId,
        service_account_key: keyData,
      })
      setResult(res.data.data)
      setStatus('success')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? 'GCP 연동에 실패했습니다. 권한과 프로젝트 ID를 확인하세요.'
      setError(msg)
      setStatus('error')
    }
  }

  const handleRetry = () => {
    setStatus('idle')
    setError('')
  }

  const canConnect = Boolean(gcpProjectId && keyData) && status !== 'validating'

  // ── 성공 화면 ────────────────────────────────────────────────
  if (status === 'success' && result) {
    return (
      <>
        <style>{styles}</style>
        <div className="gc-page">
          <div className="gc-success">
            <div className="gc-success-ico">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div className="gc-success-eyebrow">
              <span className="gc-pip gc-pip-green" />
              Connection Established
            </div>
            <h1 className="gc-success-title">GCP 연동 완료</h1>
            <p className="gc-success-sub">
              이제 MirrorOps Sync와 Failover 기능을 사용할 수 있습니다.
            </p>

            <div className="gc-success-detail">
              <div className="gc-detail-row">
                <span className="gc-detail-k">프로젝트</span>
                <span className="gc-detail-v gc-mono">{result.gcp_project_id}</span>
              </div>
              <div className="gc-detail-row">
                <span className="gc-detail-k">서비스 계정</span>
                <span className="gc-detail-v gc-mono">{result.sa_email}</span>
              </div>
              <div className="gc-detail-row">
                <span className="gc-detail-k">Artifact Registry</span>
                <span className="gc-detail-v">
                  <span className="gc-mono">autoops-repo</span>
                  <span className="gc-detail-region">us-west1</span>
                  <span className="gc-detail-auto">자동 생성됨</span>
                </span>
              </div>
            </div>

            <button
              className="gc-btn-primary gc-btn-go"
              onClick={() => router.push(`/projects/${projectId}/mirror`)}
            >
              <span>MirrorOps로 이동</span>
              <span className="gc-go-arrow">→</span>
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style>{styles}</style>

      <div className="gc-page">

        {/* ── Header (성공 후 숨김 — 위 분기에서 처리됨) ───────── */}
        <header className="gc-header">
          <button
            onClick={() => router.push(`/projects/${projectId}/mirror`)}
            className="gc-back"
          >
            <span className="gc-back-arrow">←</span>
            프로젝트로
          </button>
          <div className="gc-eyebrow">
            <span className="gc-pip" />
            AutoOps · GCP Integration
          </div>
          <h1 className="gc-title">
            <span className="gc-title-glyph">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </span>
            GCP 계정 연동
          </h1>
          <p className="gc-desc">
            본인 GCP 서비스 계정 JSON 키를 업로드해 AutoOps와 연결하세요. 연동 후
            MirrorOps의 DR 동기화와 페일오버 기능이 활성화됩니다.
          </p>
        </header>

        {/* ── 안내 섹션 ─────────────────────────── */}
        <section className="gc-card">
          <div className="gc-card-eyebrow">
            <span className="gc-pip gc-pip-blue" />
            Step 01 · GCP 프로젝트
          </div>

          <div className="gc-field">
            <label className="gc-field-label">GCP 프로젝트 ID</label>
            <Input
              value={gcpProjectId}
              onChange={(e) => setGcpProjectId(e.target.value)}
              placeholder="my-gcp-project-id"
              className="gc-input gc-mono"
            />
          </div>

          <p className="gc-hint">
            GCP 콘솔에서 서비스 계정을 생성하고 JSON 키를 다운로드하세요.
          </p>

          {/* 필요 권한 */}
          <div className="gc-roles">
            <div className="gc-roles-label">필요 권한</div>
            <div className="gc-roles-list">
              {REQUIRED_ROLES.map((role) => (
                <span key={role} className="gc-role">
                  <span className="gc-role-dot" />
                  {role}
                </span>
              ))}
            </div>
          </div>

          {/* GCP 콘솔 단계별 가이드 */}
          <div className="gc-guide">
            <div className="gc-guide-bar">
              <span className="gc-pip gc-pip-blue" />
              GCP 콘솔 · 서비스 계정 만들기
            </div>

            <ol className="gc-steps">
              <li className="gc-step">
                <span className="gc-step-num">1</span>
                <div className="gc-step-body">
                  <p className="gc-step-text">
                    <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="gc-step-link">console.cloud.google.com</a>
                    {' '}접속 → 상단에서 프로젝트 선택
                  </p>
                </div>
              </li>

              <li className="gc-step">
                <span className="gc-step-num">2</span>
                <div className="gc-step-body">
                  <p className="gc-step-text">
                    좌측 메뉴 → <span className="gc-kbd">IAM 및 관리자</span> → <span className="gc-kbd">서비스 계정</span> → <span className="gc-kbd">서비스 계정 만들기</span>
                  </p>
                  <div className="gc-step-note">
                    <span className="gc-note-k">서비스 계정 이름</span>
                    <span className="gc-note-v gc-mono">autoops-dr</span>
                  </div>
                </div>
              </li>

              <li className="gc-step">
                <span className="gc-step-num">3</span>
                <div className="gc-step-body">
                  <p className="gc-step-text">
                    <span className="gc-kbd">역할 선택</span>에서 아래 6개 역할 추가
                  </p>
                  <div className="gc-step-roles">
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">Cloud Run 관리자</span>
                      <span className="gc-role-why">ECS Service → Cloud Run 배포</span>
                    </div>
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">Compute 관리자</span>
                      <span className="gc-role-why">VPC · 서브넷 · 방화벽 · NAT 생성</span>
                    </div>
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">Cloud SQL 관리자</span>
                      <span className="gc-role-why">RDS → Cloud SQL 생성</span>
                    </div>
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">저장소 관리자</span>
                      <span className="gc-role-why">GCS 버킷 (Terraform State)</span>
                    </div>
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">Artifact Registry 관리자</span>
                      <span className="gc-role-why">autoops-repo 생성</span>
                    </div>
                    <div className="gc-step-role">
                      <span className="gc-role-dot" />
                      <span className="gc-role-name">서비스 계정 관리자</span>
                      <span className="gc-role-why">IAM Role → Service Account 생성</span>
                    </div>
                  </div>
                </div>
              </li>

              <li className="gc-step">
                <span className="gc-step-num">4</span>
                <div className="gc-step-body">
                  <p className="gc-step-text">
                    서비스 계정 목록에서 <span className="gc-mono gc-inline-mono">autoops-dr</span> 클릭 → <span className="gc-kbd">키</span> 탭 →
                    {' '}<span className="gc-kbd">키 추가</span> → <span className="gc-kbd">새 키 만들기</span> → <span className="gc-kbd">JSON</span> → <span className="gc-kbd">만들기</span>
                  </p>
                  <div className="gc-step-result">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    JSON 파일이 자동으로 다운로드됩니다
                  </div>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* ── JSON 키 업로드 ────────────────────── */}
        <section className="gc-card">
          <div className="gc-card-eyebrow">
            <span className="gc-pip gc-pip-blue" />
            Step 02 · 서비스 계정 키
          </div>

          <div
            className={`gc-drop ${isDragging ? 'gc-drop-active' : ''} ${keyData ? 'gc-drop-done' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="gc-file-input"
            />

            {keyData ? (
              <div className="gc-drop-success">
                <div className="gc-drop-check">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div className="gc-drop-file">
                  <div className="gc-drop-fname gc-mono">{keyFileName}</div>
                  <div className="gc-drop-fmeta">
                    {typeof keyData.client_email === 'string' ? keyData.client_email : '서비스 계정 키 확인됨'}
                  </div>
                </div>
                <span className="gc-drop-replace">교체하려면 클릭</span>
              </div>
            ) : (
              <div className="gc-drop-empty">
                <div className="gc-drop-ico">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div className="gc-drop-main">
                  JSON 키 파일을 드래그하거나 <span className="gc-drop-browse">클릭하여 선택</span>
                </div>
                <div className="gc-drop-sub gc-mono">service-account-key.json</div>
              </div>
            )}
          </div>

          {error && status !== 'error' && (
            <div className="gc-inline-error">
              <span className="gc-err-dot" />
              {error}
            </div>
          )}
        </section>

        {/* ── 에러 화면 ─────────────────────────── */}
        {status === 'error' && (
          <section className="gc-error-card">
            <div className="gc-error-head">
              <span className="gc-err-dot" />
              GCP 연동 실패
            </div>
            <p className="gc-error-msg">{error}</p>
            <Button
              variant="outline"
              className="gc-btn-retry"
              onClick={handleRetry}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              다시 시도
            </Button>
          </section>
        )}

        {/* ── 연동 버튼 ─────────────────────────── */}
        {status !== 'error' && (
          <button
            className={`gc-btn-primary gc-connect ${!canConnect ? 'gc-disabled' : ''}`}
            onClick={handleConnect}
            disabled={!canConnect}
          >
            {status === 'validating' ? (
              <>
                <span className="gc-spinner" />
                <span>GCP 프로젝트 접근 권한 확인 중...</span>
              </>
            ) : (
              <>
                <span className="gc-connect-glyph">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </span>
                <span>GCP 연동 시작</span>
              </>
            )}
          </button>
        )}

      </div>
    </>
  )
}

// ─── styles ─────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

body { background: #0b0e17; color: #edf0f6; }
body::before {
  content: ""; position: fixed; inset: 0; z-index: -1;
  background-image:
    linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
  opacity: 0.55; pointer-events: none;
}

.gc-page {
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: #edf0f6;
  max-width: 580px;
  margin: 0 auto;
  padding: 48px 24px 80px;
  display: flex; flex-direction: column; gap: 18px;
}

.gc-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.01em;
}

/* ── Header ─────────────────────────────────── */
.gc-header { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.gc-back {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none;
  color: #aeb4c5;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  padding: 6px 0;
  margin-bottom: 8px;
  transition: color 160ms;
}
.gc-back:hover { color: #edf0f6; }
.gc-back:hover .gc-back-arrow { transform: translateX(-3px); }
.gc-back-arrow { transition: transform 200ms; display: inline-block; }

.gc-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
  padding: 5px 11px;
  border: 1px solid rgba(90,163,255,0.3);
  border-radius: 100px;
  background: rgba(90,163,255,0.06);
  align-self: flex-start;
}
.gc-pip {
  width: 6px; height: 6px; border-radius: 50%;
  background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff;
  animation: gc-pulse 1.6s ease-in-out infinite;
}
.gc-pip-blue { background: #5aa3ff; box-shadow: 0 0 8px #5aa3ff; }
.gc-pip-green { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
@keyframes gc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}

.gc-title {
  display: flex; align-items: center; gap: 12px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 32px;
  letter-spacing: -0.03em; line-height: 1.15;
  margin: 6px 0 8px;
  color: #edf0f6;
}
.gc-title-glyph {
  width: 40px; height: 40px;
  border-radius: 10px;
  display: grid; place-items: center;
  border: 1px solid rgba(90,163,255,0.32);
  background: rgba(90,163,255,0.10);
  color: #5aa3ff;
  flex-shrink: 0;
}
.gc-desc {
  font-size: 14.5px; color: #aeb4c5;
  line-height: 1.6; margin: 0;
}

/* ── Card ───────────────────────────────────── */
.gc-card {
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.13);
  background: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 24px 26px;
  display: flex; flex-direction: column; gap: 16px;
}
.gc-card-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #5aa3ff;
}

/* ── Field ──────────────────────────────────── */
.gc-field { display: flex; flex-direction: column; gap: 8px; }
.gc-field-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #aeb4c5;
}
.gc-input {
  width: 100% !important;
  background: rgba(0,0,0,0.4) !important;
  border: 1px solid rgba(255,255,255,0.13) !important;
  color: #edf0f6 !important;
  padding: 11px 14px !important;
  border-radius: 10px !important;
  font-size: 13px !important;
}
.gc-input::placeholder { color: #7a8298 !important; }
.gc-input:focus {
  outline: none !important;
  border-color: rgba(90,163,255,0.6) !important;
  box-shadow: 0 0 0 3px rgba(90,163,255,0.14) !important;
}

.gc-hint {
  font-size: 13px; color: #aeb4c5;
  line-height: 1.55; margin: 0;
}

/* ── Roles ──────────────────────────────────── */
.gc-roles { display: flex; flex-direction: column; gap: 10px; }
.gc-roles-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #aeb4c5;
}
.gc-roles-list { display: flex; flex-wrap: wrap; gap: 8px; }
.gc-role {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.02);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; color: #edf0f6;
  letter-spacing: 0.01em;
}
.gc-role-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #ffa53d; box-shadow: 0 0 6px rgba(255,165,61,0.6);
}

/* ── Console guide (단계별) ─────────────────── */
.gc-guide {
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.28);
  overflow: hidden;
}
.gc-guide-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 16px;
  background: rgba(90,163,255,0.05);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #5aa3ff;
}
.gc-steps {
  list-style: none;
  margin: 0; padding: 8px 18px;
  counter-reset: gc-step;
}
.gc-step {
  position: relative;
  display: flex; gap: 14px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.gc-step:last-child { border-bottom: none; }
.gc-step:not(:last-child)::after {
  content: ""; position: absolute;
  left: 12px; top: 40px; bottom: 2px; width: 1px;
  background: linear-gradient(180deg, rgba(90,163,255,0.3), transparent);
}
.gc-step-num {
  flex-shrink: 0;
  width: 25px; height: 25px;
  border-radius: 50%;
  display: grid; place-items: center;
  border: 1px solid rgba(90,163,255,0.4);
  background: rgba(90,163,255,0.12);
  color: #5aa3ff;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 600;
  z-index: 1;
}
.gc-step-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding-top: 2px; }
.gc-step-text {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 13.5px; line-height: 1.6;
  color: #edf0f6;
  margin: 0;
}
.gc-step-link { color: #5aa3ff; text-decoration: none; border-bottom: 1px solid rgba(90,163,255,0.4); }
.gc-step-link:hover { border-bottom-color: #5aa3ff; }
.gc-kbd {
  display: inline-block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 500;
  color: #edf0f6;
  padding: 1px 7px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  white-space: nowrap;
}
.gc-inline-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px; color: #ffa53d;
}
.gc-step-note {
  display: inline-flex; align-items: center; gap: 10px;
  align-self: flex-start;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255,165,61,0.28);
  background: rgba(255,165,61,0.06);
}
.gc-note-k {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: #ffa53d;
}
.gc-note-v {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px; font-weight: 600;
  color: #edf0f6;
}
.gc-step-roles {
  display: flex; flex-direction: column; gap: 2px;
  padding: 6px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.02);
}
.gc-step-role {
  display: grid;
  grid-template-columns: 9px minmax(0, auto) 1fr;
  align-items: baseline;
  gap: 4px 11px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.gc-step-role:last-child { border-bottom: none; }
.gc-step-role .gc-role-dot { align-self: center; }
.gc-role-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px; font-weight: 600;
  color: #edf0f6;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.gc-role-why {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 12px; font-weight: 500;
  color: #aeb4c5;
  letter-spacing: -0.005em;
  line-height: 1.45;
}
.gc-step-result {
  display: inline-flex; align-items: center; gap: 8px;
  align-self: flex-start;
  padding: 8px 13px;
  border-radius: 8px;
  border: 1px solid rgba(34,197,94,0.32);
  background: rgba(34,197,94,0.08);
  color: #22c55e;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px; font-weight: 500;
  letter-spacing: 0.02em;
}

/* ── Drop zone ──────────────────────────────── */
.gc-drop {
  position: relative;
  border-radius: 14px;
  border: 1.5px dashed rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.012);
  padding: 28px 24px;
  cursor: pointer;
  transition: all 200ms;
}
.gc-drop:hover { border-color: rgba(90,163,255,0.5); background: rgba(90,163,255,0.04); }
.gc-drop-active {
  border-color: #5aa3ff;
  background: rgba(90,163,255,0.10);
  box-shadow: 0 0 0 4px rgba(90,163,255,0.10), 0 0 30px rgba(90,163,255,0.12);
}
.gc-drop-done {
  border-style: solid;
  border-color: rgba(34,197,94,0.5);
  background: rgba(34,197,94,0.05);
  cursor: pointer;
}
.gc-file-input { display: none; }

.gc-drop-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  text-align: center;
}
.gc-drop-ico {
  width: 48px; height: 48px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.13);
  background: rgba(255,255,255,0.03);
  color: #5aa3ff;
  display: grid; place-items: center;
  margin-bottom: 4px;
}
.gc-drop-main {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px; font-weight: 500;
  color: #edf0f6;
}
.gc-drop-browse { color: #5aa3ff; font-weight: 600; }
.gc-drop-sub {
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.04em;
}

.gc-drop-success {
  display: flex; align-items: center; gap: 14px;
}
.gc-drop-check {
  width: 38px; height: 38px;
  border-radius: 10px;
  background: rgba(34,197,94,0.16);
  border: 1px solid rgba(34,197,94,0.4);
  color: #22c55e;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.gc-drop-file { flex: 1; min-width: 0; }
.gc-drop-fname {
  font-size: 13.5px; font-weight: 600;
  color: #edf0f6;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-drop-fmeta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: #7a8298;
  letter-spacing: 0.01em;
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-drop-replace {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; color: #5aa3ff;
  letter-spacing: 0.06em;
  white-space: nowrap;
  flex-shrink: 0;
}
@media (max-width: 480px) {
  .gc-drop-replace { display: none; }
}

/* ── Inline error ───────────────────────────── */
.gc-inline-error {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px;
  border-radius: 10px;
  border: 1px solid rgba(239,68,68,0.3);
  background: rgba(239,68,68,0.06);
  font-size: 12.5px; color: #ef4444;
  line-height: 1.5;
}
.gc-err-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #ef4444; box-shadow: 0 0 8px #ef4444;
  flex-shrink: 0;
}

/* ── Error card ─────────────────────────────── */
.gc-error-card {
  border-radius: 16px;
  border: 1px solid rgba(239,68,68,0.32);
  background: linear-gradient(180deg, rgba(239,68,68,0.06), rgba(239,68,68,0.015));
  padding: 22px 26px;
  display: flex; flex-direction: column; gap: 14px;
  align-items: flex-start;
}
.gc-error-head {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: #ef4444;
}
.gc-error-msg {
  font-size: 14px; color: #edf0f6;
  line-height: 1.55; margin: 0;
}
.gc-btn-retry {
  display: inline-flex !important; align-items: center !important; gap: 8px !important;
  padding: 10px 16px !important;
  border-radius: 10px !important;
  font-family: 'Plus Jakarta Sans', sans-serif !important;
  font-size: 13px !important; font-weight: 600 !important;
  border: 1px solid rgba(239,68,68,0.4) !important;
  background: rgba(239,68,68,0.08) !important;
  color: #ef4444 !important;
  cursor: pointer;
  transition: all 160ms;
}
.gc-btn-retry:hover { background: rgba(239,68,68,0.16) !important; border-color: rgba(239,68,68,0.6) !important; }

/* ── Primary / connect button ───────────────── */
.gc-btn-primary {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  width: 100%;
  padding: 15px 24px;
  border-radius: 12px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 15px; font-weight: 700;
  letter-spacing: -0.01em;
  border: 1px solid rgba(90,163,255,0.5);
  background: linear-gradient(180deg, #5aa3ff, #3d83df);
  color: #0b0e17;
  cursor: pointer;
  transition: all 200ms;
  box-shadow: 0 0 24px rgba(90,163,255,0.2);
}
.gc-btn-primary:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 8px 32px -6px rgba(90,163,255,0.45); }
.gc-connect-glyph { display: inline-flex; }
.gc-disabled {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.1);
  color: #7a8298;
  cursor: not-allowed;
  box-shadow: none;
}
.gc-disabled:hover { filter: none; transform: none; box-shadow: none; }

.gc-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(11,14,23,0.25);
  border-top-color: #0b0e17;
  animation: gc-spin 700ms linear infinite;
}
.gc-disabled .gc-spinner { border-color: rgba(174,180,197,0.2); border-top-color: #aeb4c5; }
@keyframes gc-spin { to { transform: rotate(360deg); } }

/* validating 상태는 비활성처럼 보이되 스피너는 명확히 */
.gc-connect:disabled:not(.gc-disabled) {
  background: linear-gradient(180deg, rgba(90,163,255,0.5), rgba(61,131,223,0.5));
  color: #0b0e17;
  cursor: wait;
}

/* ── Success screen ─────────────────────────── */
.gc-success {
  border-radius: 18px;
  border: 1px solid rgba(34,197,94,0.32);
  background:
    radial-gradient(ellipse 120% 80% at 50% 0%, rgba(34,197,94,0.10), transparent 70%),
    linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
  padding: 40px 36px;
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  box-shadow: 0 0 60px -20px rgba(34,197,94,0.3);
}
.gc-success-ico {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: rgba(34,197,94,0.16);
  border: 1px solid rgba(34,197,94,0.45);
  color: #22c55e;
  display: grid; place-items: center;
  margin-bottom: 20px;
  box-shadow: 0 0 0 6px rgba(34,197,94,0.08), 0 0 30px rgba(34,197,94,0.25);
}
.gc-success-eyebrow {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: #22c55e;
  margin-bottom: 12px;
}
.gc-success-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-weight: 700; font-size: 28px;
  letter-spacing: -0.03em;
  color: #edf0f6;
  margin: 0 0 8px;
}
.gc-success-sub {
  font-size: 14px; color: #aeb4c5;
  line-height: 1.6; margin: 0 0 28px;
  max-width: 380px;
}

.gc-success-detail {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(0,0,0,0.3);
  padding: 4px 18px;
  margin-bottom: 28px;
  text-align: left;
}
.gc-detail-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 13px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.gc-detail-row:last-child { border-bottom: none; }
.gc-detail-k {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: #7a8298;
  flex-shrink: 0;
}
.gc-detail-v {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; color: #edf0f6;
  text-align: right;
  word-break: break-all;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.gc-detail-region {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em;
  color: #5aa3ff;
  padding: 2px 8px;
  border: 1px solid rgba(90,163,255,0.32);
  background: rgba(90,163,255,0.08);
  border-radius: 100px;
}
.gc-detail-auto {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em;
  color: #22c55e;
  padding: 2px 8px;
  border: 1px solid rgba(34,197,94,0.4);
  background: rgba(34,197,94,0.10);
  border-radius: 100px;
}

.gc-btn-go {
  background: linear-gradient(180deg, #22c55e, #16a34a);
  border-color: rgba(34,197,94,0.5);
  color: #04140a;
  box-shadow: 0 0 28px rgba(34,197,94,0.25);
  max-width: 320px;
}
.gc-btn-go:hover { box-shadow: 0 8px 36px -6px rgba(34,197,94,0.5); }
.gc-go-arrow { transition: transform 200ms; display: inline-block; }
.gc-btn-go:hover .gc-go-arrow { transform: translateX(4px); }

/* ── Responsive ─────────────────────────────── */
@media (max-width: 560px) {
  .gc-page { padding: 32px 18px 80px; }
  .gc-title { font-size: 26px; }
  .gc-success { padding: 32px 22px; }
  .gc-detail-row { flex-direction: column; align-items: flex-start; gap: 4px; }
  .gc-detail-v { justify-content: flex-start; text-align: left; }
}
`
