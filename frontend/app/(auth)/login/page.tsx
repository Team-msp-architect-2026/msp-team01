// frontend/app/(auth)/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

const loginSchema = z.object({
  email: z.string().email('올바른 이메일을 입력하세요.'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
})
type LoginForm = z.infer<typeof loginSchema>

export default function LoginPage() {
  const router = useRouter()
  const { setAuth } = useAuthStore()
  const [error, setError] = useState<string>('')
  const [showPw, setShowPw] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (data: LoginForm) => {
    setError('')
    try {
      const res = await apiClient.post('/api/auth/login', data)
      const { access_token, user } = res.data.data

      setAuth(user, access_token)

      // §12-2 전환 로직: AWS 미연동 → SCR-C-02, 연동 완료 → SCR-C-03
      if (!user.aws_connected) {
        router.push('/connect')
      } else {
        router.push('/dashboard')
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ||
        '로그인에 실패했습니다.'
      setError(msg)
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --bg: #07090f;
          --ink: #e7ebf3;
          --ink-dim: #8b93a7;
          --ink-mute: #4b5267;
          --line: rgba(255,255,255,0.06);
          --line-2: rgba(255,255,255,0.10);
          --line-3: rgba(255,255,255,0.16);
          --orange: #ffa53d;
          --blue: #5aa3ff;
          --danger: #ff7676;
          --display: 'Plus Jakarta Sans', -apple-system, sans-serif;
          --mono: 'JetBrains Mono', ui-monospace, monospace;
        }
        body { background: var(--bg); color: var(--ink); overflow: hidden; }

        .ao-stage {
          position: relative; min-height: 100vh;
          display: grid; place-items: center;
          padding: 24px;
          overflow: hidden; isolation: isolate;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .ao-grid {
          position: absolute; inset: 0; z-index: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, #000 30%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, #000 30%, transparent 75%);
          opacity: 0.5;
        }
        .ao-orbit {
          position: absolute; top: 50%; left: 50%;
          width: min(720px, 80vw); aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border-radius: 50%; border: 1px dashed rgba(255,255,255,0.06);
          z-index: 1; animation: ao-spin 90s linear infinite;
        }
        .ao-orbit::before, .ao-orbit::after {
          content: ""; position: absolute; border-radius: 50%;
          border: 1px dashed rgba(255,255,255,0.04);
        }
        .ao-orbit::before { inset: -60px; }
        .ao-orbit::after  { inset: -140px; border-color: rgba(255,255,255,0.025); }
        @keyframes ao-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

        .ao-vignette {
          position: absolute; inset: 0; z-index: 1; pointer-events: none;
          background: radial-gradient(ellipse 60% 55% at 50% 50%, transparent 0%, rgba(7,9,15,0.55) 70%, rgba(7,9,15,0.95) 100%);
        }
        .ao-streams { position: absolute; inset: 0; z-index: 2; pointer-events: none; width: 100%; height: 100%; }
        .ao-stream {
          fill: none; stroke-linecap: round; filter: url(#aoGlow);
          stroke-dasharray: 1400; stroke-dashoffset: 1400;
          animation: ao-draw 2.6s 0.2s cubic-bezier(.22,.8,.18,1) forwards, ao-flow 9s 3s linear infinite;
        }
        .ao-stream-o { stroke: var(--orange); stroke-width: 2.2; }
        .ao-stream-o-thin { stroke: var(--orange); stroke-width: 1; opacity: 0.5; }
        .ao-stream-b { stroke: var(--blue); stroke-width: 2.2; animation-delay: 0.5s, 3.3s; }
        .ao-stream-b-thin { stroke: var(--blue); stroke-width: 1; opacity: 0.5; animation-delay: 0.5s, 3.3s; }
        @keyframes ao-draw { to { stroke-dashoffset: 0; } }
        @keyframes ao-flow {
          0%   { stroke-dasharray: 12 28; stroke-dashoffset: 0; }
          100% { stroke-dasharray: 12 28; stroke-dashoffset: -160; }
        }

        .ao-topbar {
          position: fixed; top: 0; left: 0; right: 0; z-index: 50;
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 28px;
        }
        .ao-brand {
          display: inline-flex; align-items: center; gap: 10px;
          font-family: var(--display);
          font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
          color: var(--ink); text-decoration: none;
          background: none; border: none; cursor: pointer; padding: 0;
        }
        .ao-mark {
          width: 24px; height: 24px;
          display: grid; place-items: center;
          border-radius: 6px;
          background:
            radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.7), transparent 60%),
            radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.7), transparent 60%),
            #11151f;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 24px rgba(90,163,255,0.18), inset 0 0 12px rgba(255,255,255,0.06);
          position: relative;
        }
        .ao-mark::after {
          content: ""; position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 8px; height: 8px; border-radius: 2px;
          background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
        }
        .ao-back {
          font-family: var(--mono);
          font-size: 12px; color: var(--ink-dim);
          background: rgba(255,255,255,0.03);
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 14px; border-radius: 8px;
          border: 1px solid var(--line-2);
          cursor: pointer;
          transition: color 160ms, border-color 160ms, background 160ms;
        }
        .ao-back:hover { color: var(--ink); border-color: var(--line-3); background: rgba(255,255,255,0.06); }

        .ao-corner {
          position: absolute; z-index: 4;
          font-family: var(--mono); font-size: 11.5px; font-weight: 500;
          display: inline-flex; align-items: center; gap: 10px;
          opacity: 0; animation: ao-rise 900ms 1200ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .ao-corner .pip {
          width: 7px; height: 7px; border-radius: 50%;
          box-shadow: 0 0 10px currentColor;
        }
        .ao-corner-bl { bottom: 24px; left: 28px; color: var(--orange); }
        .ao-corner-br { bottom: 24px; right: 28px; color: var(--ink-mute); font-weight: 400; letter-spacing: 0.1em; }
        @keyframes ao-rise {
          0%   { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        .ao-panel {
          position: relative; z-index: 10;
          width: 100%; max-width: 440px;
          padding: 44px 40px 36px;
          border-radius: 18px;
          border: 1px solid var(--line-2);
          background:
            radial-gradient(ellipse 100% 60% at 50% 0%, rgba(90,163,255,0.06), transparent 70%),
            linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.005));
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow:
            0 20px 60px -20px rgba(0,0,0,0.6),
            0 0 80px -30px rgba(90,163,255,0.25),
            inset 0 1px 0 rgba(255,255,255,0.05);
          opacity: 0;
          animation: ao-panelIn 900ms 200ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .ao-panel::before {
          content: ""; position: absolute; top: -1px; left: 30px; right: 30px; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent);
        }
        @keyframes ao-panelIn {
          0%   { opacity: 0; transform: translateY(20px) scale(0.985); filter: blur(8px); }
          100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }

        .ao-head { text-align: center; margin-bottom: 32px; }
        .ao-head-mark {
          width: 44px; height: 44px;
          margin: 0 auto 18px;
          border-radius: 12px;
          background:
            radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.8), transparent 60%),
            radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.8), transparent 60%),
            #11151f;
          border: 1px solid rgba(255,255,255,0.10);
          box-shadow: 0 6px 30px rgba(90,163,255,0.25), inset 0 0 16px rgba(255,255,255,0.08);
          position: relative;
        }
        .ao-head-mark::after {
          content: ""; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
          width: 14px; height: 14px; border-radius: 3px;
          background: #fff; box-shadow: 0 0 14px rgba(255,255,255,0.9);
        }
        .ao-eyebrow {
          font-family: var(--mono); font-size: 10.5px; font-weight: 500;
          letter-spacing: 0.22em; text-transform: uppercase;
          color: var(--ink-mute); margin-bottom: 12px;
        }
        .ao-title {
          font-family: var(--display);
          font-size: 28px; font-weight: 700;
          letter-spacing: -0.025em; line-height: 1.15;
          color: var(--ink); margin: 0 0 8px;
        }
        .ao-sub { font-size: 13.5px; color: var(--ink-dim); margin: 0; line-height: 1.5; }

        .ao-form { display: flex; flex-direction: column; gap: 18px; }
        .ao-field { display: flex; flex-direction: column; gap: 8px; }
        .ao-field-label {
          display: flex; align-items: center; justify-content: space-between;
          font-family: var(--mono);
          font-size: 10.5px; font-weight: 500;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--ink-dim);
        }
        .ao-field-label .ao-hint {
          font-size: 11px; letter-spacing: 0; text-transform: none;
          color: var(--ink-mute); font-family: inherit; font-weight: 500;
        }
        .ao-field-label .ao-hint a {
          color: var(--blue); text-decoration: none;
          background: none; border: none; cursor: pointer; font: inherit; padding: 0;
        }
        .ao-field-label .ao-hint a:hover { text-decoration: underline; }

        .ao-input-wrap {
          position: relative;
          display: flex; align-items: center;
          border: 1px solid var(--line-2);
          border-radius: 10px;
          background: rgba(255,255,255,0.025);
          transition: border-color 200ms, background 200ms, box-shadow 200ms;
        }
        .ao-input-wrap:hover { border-color: var(--line-3); }
        .ao-input-wrap:focus-within {
          border-color: rgba(90,163,255,0.55);
          background: rgba(255,255,255,0.04);
          box-shadow: 0 0 0 4px rgba(90,163,255,0.10);
        }
        .ao-input-wrap.ao-error {
          border-color: rgba(255,118,118,0.55);
          box-shadow: 0 0 0 4px rgba(255,118,118,0.10);
        }
        .ao-input-icon {
          padding: 0 12px 0 14px;
          color: var(--ink-mute);
          display: grid; place-items: center;
          flex-shrink: 0;
        }
        .ao-input-wrap:focus-within .ao-input-icon { color: var(--blue); }
        .ao-input {
          flex: 1; min-width: 0;
          background: transparent; border: none; outline: none;
          color: var(--ink);
          font-family: inherit;
          font-size: 14.5px;
          padding: 14px 14px 14px 0;
          letter-spacing: -0.005em;
        }
        .ao-input::placeholder { color: var(--ink-mute); font-family: var(--mono); font-size: 13px; letter-spacing: 0.02em; }
        .ao-toggle {
          padding: 0 14px;
          background: transparent; border: none; cursor: pointer;
          color: var(--ink-mute);
          font-family: var(--mono); font-size: 11px;
          letter-spacing: 0.1em; text-transform: uppercase;
          transition: color 160ms;
        }
        .ao-toggle:hover { color: var(--ink-dim); }

        .ao-field-error {
          font-family: var(--mono);
          font-size: 11px; color: var(--danger);
          letter-spacing: 0.02em;
          display: flex; align-items: center; gap: 6px;
          margin-top: 2px;
        }
        .ao-field-error::before {
          content: "!"; display: grid; place-items: center;
          width: 14px; height: 14px; border-radius: 50%;
          background: rgba(255,118,118,0.15);
          font-size: 9px; font-weight: 700;
        }

        .ao-alert {
          display: flex; gap: 10px;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255,118,118,0.3);
          background: rgba(255,118,118,0.06);
          color: var(--danger);
          font-size: 13px; line-height: 1.5;
        }
        .ao-alert .ico {
          flex-shrink: 0; width: 18px; height: 18px;
          border-radius: 50%; background: rgba(255,118,118,0.18);
          display: grid; place-items: center;
          font-family: var(--mono); font-weight: 700; font-size: 11px;
        }

        .ao-submit {
          margin-top: 6px;
          width: 100%;
          display: inline-flex; align-items: center; justify-content: center; gap: 10px;
          padding: 14px 18px;
          font-family: var(--display);
          font-size: 14px; font-weight: 600;
          letter-spacing: -0.005em;
          border-radius: 10px;
          border: 1px solid #f3f4f8;
          background: linear-gradient(180deg, #ffffff, #e8eaf0);
          color: #0a0d14;
          cursor: pointer;
          transition: transform 180ms, box-shadow 180ms, filter 180ms;
        }
        .ao-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(90,163,255,0.5);
        }
        .ao-submit:disabled { opacity: 0.65; cursor: not-allowed; filter: saturate(0.6); }
        .ao-submit .arrow { transition: transform 200ms; }
        .ao-submit:hover:not(:disabled) .arrow { transform: translateX(3px); }
        .ao-spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(10,13,20,0.2);
          border-top-color: rgba(10,13,20,0.9);
          animation: ao-spin2 700ms linear infinite;
        }
        @keyframes ao-spin2 { to { transform: rotate(360deg); } }

        .ao-divider {
          display: flex; align-items: center; gap: 12px;
          margin: 26px 0 18px;
          font-family: var(--mono);
          font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase;
          color: var(--ink-mute);
        }
        .ao-divider::before, .ao-divider::after {
          content: ""; flex: 1; height: 1px; background: var(--line-2);
        }
        .ao-signup-row { text-align: center; font-size: 13px; color: var(--ink-dim); }
        .ao-link {
          color: var(--ink);
          text-decoration: none;
          font-weight: 600;
          border-bottom: 1px solid var(--line-3);
          padding: 0 0 1px;
          transition: color 160ms, border-color 160ms;
          background: none; border-left: none; border-right: none; border-top: none;
          font-family: inherit; font-size: inherit; cursor: pointer;
        }
        .ao-link:hover { color: var(--orange); border-bottom-color: var(--orange); }

        .ao-meta {
          position: relative; z-index: 10;
          margin-top: 22px;
          display: flex; align-items: center; justify-content: center; gap: 18px;
          font-family: var(--mono);
          font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase;
          color: var(--ink-mute);
          opacity: 0;
          animation: ao-rise 900ms 500ms cubic-bezier(.22,.8,.18,1) forwards;
        }
        .ao-meta a {
          color: inherit; text-decoration: none; transition: color 160ms;
          background: none; border: none; cursor: pointer; font: inherit; padding: 0;
        }
        .ao-meta a:hover { color: var(--ink-dim); }
        .ao-meta .ao-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--ink-mute); opacity: 0.5; }

        @media (max-width: 600px) {
          .ao-panel { padding: 36px 26px 30px; }
          .ao-topbar { padding: 16px 18px; }
          .ao-corner-bl, .ao-corner-br { font-size: 10px; bottom: 14px; }
          .ao-corner-bl { left: 16px; }
          .ao-corner-br { right: 16px; }
        }
      `}</style>

      <div className="ao-stage">

        {/* Background atmosphere */}
        <div className="ao-grid"></div>
        <div className="ao-orbit"></div>

        <svg className="ao-streams" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <filter id="aoGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path className="ao-stream ao-stream-o" d="M -50 760 C 220 700, 380 640, 620 540 S 1050 380, 1300 360" />
          <path className="ao-stream ao-stream-o-thin" d="M -80 820 C 260 780, 480 720, 700 600 S 1100 460, 1380 440" />
          <path className="ao-stream ao-stream-b" d="M 1650 140 C 1380 200, 1220 260, 980 360 S 550 520, 300 540" />
          <path className="ao-stream ao-stream-b-thin" d="M 1680 80 C 1340 120, 1120 180, 900 300 S 500 440, 220 460" />
        </svg>

        <div className="ao-vignette"></div>

        {/* Top bar */}
        <div className="ao-topbar">
          <button className="ao-brand" onClick={() => router.push('/')}>
            <span className="ao-mark"></span>
            AutoOps
          </button>
          <button className="ao-back" onClick={() => router.push('/')}>← 홈으로</button>
        </div>

        {/* Corner labels */}
        <div className="ao-corner ao-corner-bl">
          <span className="pip" style={{ background: 'var(--orange)', width: 7, height: 7, borderRadius: '50%', boxShadow: '0 0 10px currentColor' }}></span>
          Secure Session · TLS 1.3
        </div>
        {/* Login Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <div className="ao-panel">
            <div className="ao-head">
              <div className="ao-head-mark"></div>
              <div className="ao-eyebrow">Sign in</div>
              <h1 className="ao-title">다시 만나서 반갑습니다</h1>
              <p className="ao-sub">계정으로 로그인하고 인프라를 이어서 만드세요.</p>
            </div>

            <form className="ao-form" onSubmit={handleSubmit(onSubmit)} noValidate>

              {/* Email */}
              <div className="ao-field">
                <label className="ao-field-label" htmlFor="email">
                  <span>이메일</span>
                </label>
                <div className={`ao-input-wrap ${errors.email ? 'ao-error' : ''}`}>
                  <span className="ao-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M3 7l9 7 9-7" />
                    </svg>
                  </span>
                  <input
                    id="email"
                    className="ao-input"
                    type="email"
                    placeholder="user@example.com"
                    autoComplete="email"
                    {...register('email')}
                  />
                </div>
                {errors.email && (
                  <div className="ao-field-error">{errors.email.message}</div>
                )}
              </div>

              {/* Password */}
              <div className="ao-field">
                <label className="ao-field-label" htmlFor="password">
                  <span>비밀번호</span>
                  <span className="ao-hint">
                    <button type="button" onClick={() => router.push('/forgot-password')}>
                      비밀번호 찾기
                    </button>
                  </span>
                </label>
                <div className={`ao-input-wrap ${errors.password ? 'ao-error' : ''}`}>
                  <span className="ao-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
                    </svg>
                  </span>
                  <input
                    id="password"
                    className="ao-input"
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    className="ao-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label="비밀번호 표시 토글"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && (
                  <div className="ao-field-error">{errors.password.message}</div>
                )}
              </div>

              {/* Form-level error */}
              {error && (
                <div className="ao-alert" role="alert">
                  <span className="ico">!</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button type="submit" className="ao-submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <span className="ao-spinner"></span>
                    <span>로그인 중...</span>
                  </>
                ) : (
                  <>
                    <span>로그인</span>
                    <span className="arrow">→</span>
                  </>
                )}
              </button>
            </form>

            <div className="ao-divider">New here</div>
            <div className="ao-signup-row">
              계정이 없으신가요?{' '}
              <button type="button" className="ao-link" onClick={() => router.push('/signup')}>
                회원가입
              </button>
            </div>
          </div>

          <div className="ao-meta">
            <span>v0.4.2</span>
            <span className="ao-sep"></span>
            <button type="button" onClick={() => router.push('/privacy')}>개인정보처리방침</button>
            <span className="ao-sep"></span>
            <button type="button" onClick={() => router.push('/terms')}>이용약관</button>
          </div>
        </div>
      </div>
    </>
  )
}
