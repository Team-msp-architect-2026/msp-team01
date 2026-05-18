// frontend/app/(auth)/signup/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiClient } from '@/lib/api'

const signupSchema = z.object({
  name: z.string().min(2, '이름은 2자 이상이어야 합니다.'),
  email: z.string().email('올바른 이메일을 입력하세요.'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다.')
    .regex(/[A-Z]/, '대문자를 포함해야 합니다.')
    .regex(/[0-9]/, '숫자를 포함해야 합니다.')
    .regex(/[^A-Za-z0-9]/, '특수문자를 포함해야 합니다.'),
  agree: z
    .boolean()
    .refine((v) => v === true, { message: '약관에 동의해주세요.' }),
})
type SignupForm = z.infer<typeof signupSchema>

const STRENGTH_TONES = [
  { bg: '#ff7676', text: 'Weak' },
  { bg: '#ff9747', text: 'Fair' },
  { bg: '#ffa53d', text: 'Good' },
  { bg: '#9bd1ff', text: 'Strong' },
  { bg: '#6ee7a0', text: 'Excellent' },
] as const

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [pwValue, setPwValue] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: { agree: false },
  })

  const pwReqs = {
    len: pwValue.length >= 8,
    upper: /[A-Z]/.test(pwValue),
    num: /[0-9]/.test(pwValue),
    sym: /[^A-Za-z0-9]/.test(pwValue),
  }
  const met = Object.values(pwReqs).filter(Boolean).length
  const tone = STRENGTH_TONES[met]
  const pwValid = met === 4

  const onSubmit = async (data: SignupForm) => {
    setError('')
    try {
      const { agree: _agree, ...payload } = data
      void _agree
      await apiClient.post('/api/auth/signup', payload)
      router.push('/login')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ||
        '회원가입에 실패했습니다.'
      setError(msg)
    }
  }

  // Bind onChange for password so we can drive the strength meter alongside RHF
  const passwordReg = register('password')

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
          --green: #6ee7a0;
          --danger: #ff7676;
          --display: 'Plus Jakarta Sans', -apple-system, sans-serif;
          --mono: 'JetBrains Mono', ui-monospace, monospace;
        }
        body { background: var(--bg); color: var(--ink); }

        .au-stage {
          position: relative; min-height: 100vh;
          display: grid; grid-template-columns: 1fr 1fr;
          isolation: isolate;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        /* Left rail */
        .au-rail {
          position: relative;
          padding: 64px 56px;
          display: flex; flex-direction: column;
          border-right: 1px solid var(--line-2);
          overflow: hidden;
        }
        .au-rail-bg {
          position: absolute; inset: 0; z-index: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse 90% 80% at 30% 40%, #000 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse 90% 80% at 30% 40%, #000 30%, transparent 80%);
          opacity: 0.6;
        }
        .au-rail-glow-o {
          position: absolute; z-index: 1; pointer-events: none;
          top: -160px; left: -160px;
          width: 540px; height: 540px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,165,61,0.18), transparent 60%);
          filter: blur(20px);
        }
        .au-rail-glow-b {
          position: absolute; z-index: 1; pointer-events: none;
          bottom: -200px; right: -120px;
          width: 580px; height: 580px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(90,163,255,0.16), transparent 60%);
          filter: blur(20px);
        }
        .au-rail-streams { position: absolute; inset: 0; z-index: 1; pointer-events: none; width: 100%; height: 100%; }
        .au-rail-stream { fill: none; stroke-linecap: round; stroke-dasharray: 10 22; opacity: 0.4; }
        .au-rail-stream-o { stroke: var(--orange); stroke-width: 1.4; }
        .au-rail-stream-b { stroke: var(--blue); stroke-width: 1.4; }

        .au-rail-content { position: relative; z-index: 5; display: flex; flex-direction: column; height: 100%; }
        .au-rail-brand {
          display: inline-flex; align-items: center; gap: 10px;
          font-family: var(--display);
          font-weight: 800; font-size: 16px; letter-spacing: -0.02em;
          color: var(--ink); text-decoration: none;
          width: fit-content;
          background: none; border: none; padding: 0; cursor: pointer;
        }
        .au-mark {
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
        .au-mark::after {
          content: ""; position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 8px; height: 8px; border-radius: 2px;
          background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8);
        }

        .au-rail-headline { margin-top: auto; margin-bottom: 40px; }
        .au-rail-eyebrow {
          display: inline-flex; align-items: center; gap: 10px;
          font-family: var(--mono);
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.2em; text-transform: uppercase;
          color: var(--ink-mute);
          margin-bottom: 24px;
        }
        .au-rail-eyebrow::before { content: ""; width: 24px; height: 1px; background: currentColor; }
        .au-rail-title {
          font-family: var(--display);
          font-weight: 700;
          font-size: clamp(32px, 3.4vw, 44px);
          line-height: 1.12;
          letter-spacing: -0.03em;
          color: var(--ink);
          margin: 0 0 18px;
          max-width: 460px;
        }
        .au-rail-title em { font-style: normal; color: var(--ink-dim); }
        .au-rail-sub { color: var(--ink-dim); font-size: 15px; line-height: 1.65; max-width: 420px; margin: 0; }

        .au-rail-features { margin-top: 40px; display: flex; flex-direction: column; gap: 14px; max-width: 420px; }
        .au-rail-feature { display: flex; gap: 14px; align-items: flex-start; }
        .au-rail-feature .au-fico {
          flex-shrink: 0; width: 30px; height: 30px;
          border-radius: 8px;
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--line-2);
          display: grid; place-items: center;
          color: var(--ink-dim);
        }
        .au-rail-feature[data-tone="orange"] .au-fico { color: var(--orange); border-color: rgba(255,165,61,0.25); background: rgba(255,165,61,0.06); }
        .au-rail-feature[data-tone="blue"]   .au-fico { color: var(--blue);   border-color: rgba(90,163,255,0.25);  background: rgba(90,163,255,0.06); }
        .au-rail-feature .au-flabel { font-family: var(--display); font-weight: 600; font-size: 14px; color: var(--ink); letter-spacing: -0.01em; margin-bottom: 3px; }
        .au-rail-feature .au-fdesc { font-size: 13px; color: var(--ink-dim); line-height: 1.5; }

        .au-rail-foot {
          margin-top: auto; padding-top: 40px;
          display: flex; align-items: center; gap: 12px;
          font-family: var(--mono);
          font-size: 11px; color: var(--ink-mute);
          letter-spacing: 0.1em; text-transform: uppercase;
        }
        .au-rail-foot .pip {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--green); box-shadow: 0 0 8px var(--green);
        }

        /* Right form column */
        .au-form-col {
          position: relative;
          padding: 64px 56px;
          display: flex; flex-direction: column;
          justify-content: center;
          min-height: 100vh;
        }
        .au-form-top {
          position: absolute; top: 24px; right: 28px;
          display: flex; align-items: center; gap: 14px;
          font-size: 13px; color: var(--ink-dim);
        }
        .au-link {
          background: none; border: none; cursor: pointer;
          font: inherit; padding: 0;
          color: var(--ink); font-weight: 600;
          border-bottom: 1px solid var(--line-3);
          padding-bottom: 1px;
          transition: color 160ms, border-color 160ms;
        }
        .au-link:hover { color: var(--orange); border-bottom-color: var(--orange); }

        .au-form-inner { width: 100%; max-width: 440px; margin: 0 auto; }
        .au-form-head { margin-bottom: 36px; }
        .au-form-eyebrow {
          font-family: var(--mono);
          font-size: 10.5px; font-weight: 500;
          letter-spacing: 0.22em; text-transform: uppercase;
          color: var(--ink-mute);
          margin-bottom: 14px;
          display: inline-flex; align-items: center; gap: 10px;
        }
        .au-form-eyebrow .step {
          padding: 3px 8px;
          border: 1px solid var(--line-2);
          border-radius: 100px;
          background: rgba(255,255,255,0.02);
          color: var(--ink-dim);
          letter-spacing: 0.15em;
        }
        .au-form-title {
          font-family: var(--display);
          font-size: 32px; font-weight: 700;
          letter-spacing: -0.025em; line-height: 1.15;
          color: var(--ink); margin: 0 0 10px;
        }
        .au-form-sub { font-size: 14px; color: var(--ink-dim); line-height: 1.55; margin: 0; }

        .au-form { display: flex; flex-direction: column; gap: 18px; }
        .au-field { display: flex; flex-direction: column; gap: 8px; }
        .au-field-label {
          display: flex; align-items: center; justify-content: space-between;
          font-family: var(--mono);
          font-size: 10.5px; font-weight: 500;
          letter-spacing: 0.16em; text-transform: uppercase;
          color: var(--ink-dim);
        }

        .au-input-wrap {
          position: relative;
          display: flex; align-items: center;
          border: 1px solid var(--line-2);
          border-radius: 10px;
          background: rgba(255,255,255,0.025);
          transition: border-color 200ms, background 200ms, box-shadow 200ms;
        }
        .au-input-wrap:hover { border-color: var(--line-3); }
        .au-input-wrap:focus-within {
          border-color: rgba(90,163,255,0.55);
          background: rgba(255,255,255,0.04);
          box-shadow: 0 0 0 4px rgba(90,163,255,0.10);
        }
        .au-input-wrap.au-error {
          border-color: rgba(255,118,118,0.55);
          box-shadow: 0 0 0 4px rgba(255,118,118,0.10);
        }
        .au-input-wrap.au-valid:not(:focus-within) {
          border-color: rgba(110,231,160,0.35);
        }
        .au-input-icon { padding: 0 12px 0 14px; color: var(--ink-mute); display: grid; place-items: center; flex-shrink: 0; }
        .au-input-wrap:focus-within .au-input-icon { color: var(--blue); }
        .au-input-wrap.au-valid:not(:focus-within) .au-input-icon { color: var(--green); }
        .au-input {
          flex: 1; min-width: 0;
          background: transparent; border: none; outline: none;
          color: var(--ink);
          font-family: inherit;
          font-size: 14.5px;
          padding: 14px 14px 14px 0;
          letter-spacing: -0.005em;
        }
        .au-input::placeholder { color: var(--ink-mute); font-family: var(--mono); font-size: 13px; letter-spacing: 0.02em; }
        .au-toggle {
          padding: 0 14px;
          background: transparent; border: none; cursor: pointer;
          color: var(--ink-mute);
          font-family: var(--mono); font-size: 11px;
          letter-spacing: 0.1em; text-transform: uppercase;
          transition: color 160ms;
        }
        .au-toggle:hover { color: var(--ink-dim); }

        .au-field-error {
          font-family: var(--mono);
          font-size: 11px; color: var(--danger);
          letter-spacing: 0.02em;
          display: flex; align-items: center; gap: 6px;
        }
        .au-field-error::before {
          content: "!"; display: grid; place-items: center;
          width: 14px; height: 14px; border-radius: 50%;
          background: rgba(255,118,118,0.15);
          font-size: 9px; font-weight: 700;
        }

        /* PW reqs */
        .au-pw-reqs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 14px;
          margin-top: 2px;
          padding: 12px 14px;
          border-radius: 8px;
          border: 1px dashed var(--line-2);
          background: rgba(255,255,255,0.015);
        }
        .au-pw-req {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px;
          color: var(--ink-mute);
          transition: color 200ms;
          font-family: var(--mono);
          letter-spacing: 0.01em;
        }
        .au-pw-req .dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--ink-mute);
          transition: background 200ms, box-shadow 200ms;
          flex-shrink: 0;
        }
        .au-pw-req.met { color: var(--green); }
        .au-pw-req.met .dot {
          background: var(--green);
          box-shadow: 0 0 8px rgba(110,231,160,0.5);
        }

        .au-pw-strength { margin-top: 4px; display: flex; align-items: center; gap: 10px; }
        .au-pw-strength .bar { flex: 1; height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; position: relative; }
        .au-pw-strength .fill { height: 100%; width: 0%; transition: width 300ms, background 300ms; border-radius: 2px; }
        .au-pw-strength .label { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; min-width: 56px; text-align: right; }

        .au-terms {
          display: flex; align-items: flex-start; gap: 11px;
          margin-top: 4px;
          cursor: pointer;
          user-select: none;
        }
        .au-terms input { display: none; }
        .au-terms .box {
          flex-shrink: 0;
          width: 18px; height: 18px;
          border-radius: 5px;
          border: 1px solid var(--line-3);
          background: rgba(255,255,255,0.03);
          display: grid; place-items: center;
          transition: background 200ms, border-color 200ms;
          margin-top: 1px;
        }
        .au-terms .box svg { opacity: 0; transition: opacity 160ms; color: #0a0d14; }
        .au-terms input:checked + .box { background: #fff; border-color: #fff; }
        .au-terms input:checked + .box svg { opacity: 1; }
        .au-terms .text { font-size: 13px; color: var(--ink-dim); line-height: 1.5; }
        .au-terms .text a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--line-3); transition: color 160ms, border-color 160ms; }
        .au-terms .text a:hover { color: var(--blue); border-bottom-color: var(--blue); }

        .au-alert {
          display: flex; gap: 10px;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255,118,118,0.3);
          background: rgba(255,118,118,0.06);
          color: var(--danger);
          font-size: 13px; line-height: 1.5;
        }
        .au-alert .ico {
          flex-shrink: 0; width: 18px; height: 18px;
          border-radius: 50%; background: rgba(255,118,118,0.18);
          display: grid; place-items: center;
          font-family: var(--mono); font-weight: 700; font-size: 11px;
        }

        .au-submit {
          margin-top: 8px;
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
        .au-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 8px 30px -8px rgba(255,255,255,0.35), 0 0 30px -10px rgba(90,163,255,0.5);
        }
        .au-submit:disabled { opacity: 0.65; cursor: not-allowed; filter: saturate(0.6); }
        .au-submit .arrow { transition: transform 200ms; }
        .au-submit:hover:not(:disabled) .arrow { transform: translateX(3px); }
        .au-spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid rgba(10,13,20,0.2);
          border-top-color: rgba(10,13,20,0.9);
          animation: au-spin 700ms linear infinite;
        }
        @keyframes au-spin { to { transform: rotate(360deg); } }

        .au-form-foot {
          margin-top: 20px;
          text-align: center;
          font-size: 13px;
          color: var(--ink-dim);
        }

        @media (max-width: 960px) {
          .au-stage { grid-template-columns: 1fr; }
          .au-rail {
            padding: 32px 28px;
            min-height: auto;
            border-right: none;
            border-bottom: 1px solid var(--line-2);
          }
          .au-rail-headline { margin-top: 32px; margin-bottom: 24px; }
          .au-rail-features { display: none; }
          .au-rail-foot { padding-top: 24px; }
          .au-form-col { padding: 40px 28px 56px; min-height: auto; }
          .au-form-top { position: static; justify-content: flex-end; margin-bottom: 24px; }
        }
        @media (max-width: 520px) {
          .au-rail { padding: 28px 22px; }
          .au-form-col { padding: 32px 22px 48px; }
          .au-form-title { font-size: 26px; }
          .au-pw-reqs { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="au-stage">

        {/* ============== Left rail ============== */}
        <aside className="au-rail">
          <div className="au-rail-bg"></div>
          <div className="au-rail-glow-o"></div>
          <div className="au-rail-glow-b"></div>

          <svg className="au-rail-streams" viewBox="0 0 800 1200" preserveAspectRatio="xMidYMid slice">
            <path className="au-rail-stream au-rail-stream-o" d="M -40 980 C 180 920, 320 860, 480 720 S 720 540, 900 500" />
            <path className="au-rail-stream au-rail-stream-b" d="M 820 140 C 620 220, 480 320, 360 460 S 140 660, -40 700" />
          </svg>

          <div className="au-rail-content">
            <button className="au-rail-brand" onClick={() => router.push('/')}>
              <span className="au-mark"></span>
              AutoOps
            </button>

            <div className="au-rail-headline">
              <div className="au-rail-eyebrow">Join AutoOps</div>
              <h1 className="au-rail-title">
                한 줄로 시작해서<br/>
                <em>두 클라우드를 다룹니다.</em>
              </h1>
              <p className="au-rail-sub">
                가입과 동시에 AWS Primary와 GCP Standby를 동시에 운영하는 인프라 자동화 워크플로우를 시작할 수 있습니다.
              </p>
            </div>

            <div className="au-rail-features">
              <div className="au-rail-feature" data-tone="orange">
                <div className="au-fico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                </div>
                <div>
                  <div className="au-flabel">자연어 프롬프트로 인프라 생성</div>
                  <div className="au-fdesc">&ldquo;Postgres 붙은 FastAPI 서버&rdquo; 같은 한 문장이 Terraform이 됩니다.</div>
                </div>
              </div>

              <div className="au-rail-feature" data-tone="blue">
                <div className="au-fico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                    <path d="M3 12h18M12 3v18"/>
                  </svg>
                </div>
                <div>
                  <div className="au-flabel">GCP DR 자동 미러링</div>
                  <div className="au-fdesc">AWS에 배포하는 순간 GCP Standby가 같이 만들어집니다.</div>
                </div>
              </div>

              <div className="au-rail-feature">
                <div className="au-fico">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M9 12l2 2 4-4"/>
                    <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                  </svg>
                </div>
                <div>
                  <div className="au-flabel">4단계 자동 검증</div>
                  <div className="au-fdesc">validate → tfsec → checkov → infracost. 배포 전에 다 잡습니다.</div>
                </div>
              </div>
            </div>

            <div className="au-rail-foot">
              <span className="pip"></span>
              AutoOps · v0.4.2
            </div>
          </div>
        </aside>

        {/* ============== Right form column ============== */}
        <section className="au-form-col">

          <div className="au-form-top">
            <span>이미 계정이 있으신가요?</span>
            <button type="button" className="au-link" onClick={() => router.push('/login')}>
              로그인
            </button>
          </div>

          <div className="au-form-inner">
            <div className="au-form-head">
              <div className="au-form-eyebrow">
                <span className="step">Step 01 / 02</span>
                계정 만들기
              </div>
              <h2 className="au-form-title">계정을 만들어 시작하세요</h2>
              <p className="au-form-sub">가입 후 AWS · GCP 연결로 넘어갑니다. 1분이면 충분합니다.</p>
            </div>

            <form className="au-form" onSubmit={handleSubmit(onSubmit)} noValidate>

              {/* Name */}
              <div className="au-field">
                <label className="au-field-label" htmlFor="name"><span>이름</span></label>
                <div className={`au-input-wrap ${errors.name ? 'au-error' : ''}`}>
                  <span className="au-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </span>
                  <input
                    id="name"
                    className="au-input"
                    type="text"
                    placeholder="홍길동"
                    autoComplete="name"
                    {...register('name')}
                  />
                </div>
                {errors.name && <div className="au-field-error">{errors.name.message}</div>}
              </div>

              {/* Email */}
              <div className="au-field">
                <label className="au-field-label" htmlFor="email"><span>이메일</span></label>
                <div className={`au-input-wrap ${errors.email ? 'au-error' : ''}`}>
                  <span className="au-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="3" y="5" width="18" height="14" rx="2"/>
                      <path d="M3 7l9 7 9-7"/>
                    </svg>
                  </span>
                  <input
                    id="email"
                    className="au-input"
                    type="email"
                    placeholder="user@example.com"
                    autoComplete="email"
                    {...register('email')}
                  />
                </div>
                {errors.email && <div className="au-field-error">{errors.email.message}</div>}
              </div>

              {/* Password */}
              <div className="au-field">
                <label className="au-field-label" htmlFor="password">
                  <span>비밀번호</span>
                </label>
                <div
                  className={`au-input-wrap ${
                    errors.password ? 'au-error' : pwValid ? 'au-valid' : ''
                  }`}
                >
                  <span className="au-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="4" y="11" width="16" height="10" rx="2"/>
                      <path d="M8 11V7a4 4 0 1 1 8 0v4"/>
                    </svg>
                  </span>
                  <input
                    id="password"
                    className="au-input"
                    type={showPw ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...passwordReg}
                    onChange={(e) => {
                      passwordReg.onChange(e)
                      setPwValue(e.target.value)
                    }}
                  />
                  <button
                    type="button"
                    className="au-toggle"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label="비밀번호 표시 토글"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>

                <div className="au-pw-strength">
                  <div className="bar">
                    <div
                      className="fill"
                      style={{
                        width: `${(met / 4) * 100}%`,
                        background: tone.bg,
                      }}
                    />
                  </div>
                  <div className="label" style={{ color: tone.bg }}>
                    {tone.text}
                  </div>
                </div>

                <div className="au-pw-reqs">
                  <div className={`au-pw-req ${pwReqs.len ? 'met' : ''}`}><span className="dot"></span>8자 이상</div>
                  <div className={`au-pw-req ${pwReqs.upper ? 'met' : ''}`}><span className="dot"></span>대문자 포함</div>
                  <div className={`au-pw-req ${pwReqs.num ? 'met' : ''}`}><span className="dot"></span>숫자 포함</div>
                  <div className={`au-pw-req ${pwReqs.sym ? 'met' : ''}`}><span className="dot"></span>특수문자 포함</div>
                </div>

                {errors.password && <div className="au-field-error">{errors.password.message}</div>}
              </div>

              {/* Terms */}
              <label className="au-terms">
                <input type="checkbox" {...register('agree')} />
                <span className="box">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </span>
                <span className="text">
                  <a href="/terms" onClick={(e) => { e.preventDefault(); router.push('/terms') }}>이용약관</a>
                  {' '}및{' '}
                  <a href="/privacy" onClick={(e) => { e.preventDefault(); router.push('/privacy') }}>개인정보처리방침</a>
                  에 동의합니다.
                </span>
              </label>
              {errors.agree && <div className="au-field-error">{errors.agree.message}</div>}

              {/* Form-level error */}
              {error && (
                <div className="au-alert" role="alert">
                  <span className="ico">!</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button type="submit" className="au-submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <span className="au-spinner"></span>
                    <span>가입 중...</span>
                  </>
                ) : (
                  <>
                    <span>계정 만들기</span>
                    <span className="arrow">→</span>
                  </>
                )}
              </button>
            </form>

            <div className="au-form-foot">
              Step 02에서는 AWS · GCP 계정 연결을 진행합니다.
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
