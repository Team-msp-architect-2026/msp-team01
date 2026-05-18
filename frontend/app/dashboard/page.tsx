// frontend/app/dashboard/page.tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api'
import { Project } from '@/types'

// ─── Status → visual tone mapping ─────────────────────────────
type Tone = 'green' | 'blue' | 'red' | 'yellow' | 'orange' | 'mute'
interface StatusConf { text: string; tone: Tone }

const STATUS_CONFIG: Record<string, StatusConf> = {
  completed:         { text: '완료',       tone: 'green' },
  deploying:         { text: '배포 중',    tone: 'blue' },
  failed:            { text: '실패',       tone: 'red' },
  partial_failed:    { text: '부분 실패',  tone: 'yellow' },
  created:           { text: '준비 중',    tone: 'mute' },
  destroying:        { text: '삭제 중',    tone: 'orange' },
  destroy_completed: { text: '삭제 완료',  tone: 'mute' },
  destroy_failed:    { text: '삭제 실패',  tone: 'red' },
}

const DR_STATUS_CONFIG: Record<string, StatusConf> = {
  ready:     { text: '준비 완료',    tone: 'green' },
  syncing:   { text: '동기화 중',    tone: 'blue' },
  not_ready: { text: '동기화 필요',  tone: 'mute' },
}

// AWS / GCP per-project resource counts (from §spec)
const AWS_RES_PER_PROJECT = 16
const GCP_DR_RES_PER_PROJECT = 11

// Filter chips
type FilterKey = 'all' | 'active' | 'deploying' | 'failed'

// ─── Toast ────────────────────────────────────────────────────
interface ToastData {
  projectName: string
  message: string
}

function DeployToast({ data, onClose }: { data: ToastData; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className="dx-toast" role="status">
      <div className="dx-toast-ico">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div className="dx-toast-body">
        <p className="dx-toast-title">{data.projectName}</p>
        <p className="dx-toast-msg">{data.message}</p>
      </div>
      <button className="dx-toast-x" onClick={onClose} aria-label="닫기">✕</button>
      <div className="dx-toast-bar" />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects]     = useState<Project[]>([])
  const [isLoading, setIsLoading]   = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [destroyAws, setDestroyAws] = useState(false)
  const [toast, setToast]           = useState<ToastData | null>(null)
  const [filter, setFilter]         = useState<FilterKey>('all')

  // localStorage toast (deploy success carry-over)
  useEffect(() => {
    const raw = localStorage.getItem('deploy_toast')
    if (raw) {
      try { setToast(JSON.parse(raw)) } catch {}
      localStorage.removeItem('deploy_toast')
    }
  }, [])

  // Fetch projects
  const fetchProjects = useCallback(() => {
    setIsLoading(true)
    apiClient
      .get('/api/projects')
      .then((res) => setProjects(res.data.data))
      .catch(() => setError('프로젝트 목록을 불러오지 못했습니다.'))
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => { fetchProjects() }, [fetchProjects])

  const handleDelete = async (projectId: string) => {
    try {
      await apiClient.request({
        method: 'DELETE',
        url: `/api/projects/${projectId}`,
        data: { destroy_aws_resources: destroyAws },
      })
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId))
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? '프로젝트 삭제에 실패했습니다.'
      setError(msg)
    } finally {
      setDeletingId(null)
      setDestroyAws(false)
    }
  }

  const closeToast = useCallback(() => setToast(null), [])

  // ─── Derived values ─────────────────────────────────────────
  const drReadyCount = projects.filter((p) => p.dr_status === 'ready').length
  const drReadyRate  = projects.length > 0
    ? Math.round((drReadyCount / projects.length) * 100)
    : 0
  const activeCount  = projects.filter((p) => p.status === 'completed').length
  const totalAws     = projects.length * AWS_RES_PER_PROJECT
  const totalDrAvail = projects.length * GCP_DR_RES_PER_PROJECT
  const totalDrLive  = drReadyCount * GCP_DR_RES_PER_PROJECT

  // unique regions string
  const regionsText = useMemo(() => {
    const set = new Set(projects.map((p) => p.region))
    if (set.size === 0) return '—'
    return Array.from(set).slice(0, 3).join(' · ')
  }, [projects])

  // filtered projects
  const filtered = useMemo(() => {
    if (filter === 'all') return projects
    if (filter === 'active')    return projects.filter((p) => p.status === 'completed')
    if (filter === 'deploying') return projects.filter((p) => p.status === 'deploying' || p.status === 'destroying')
    if (filter === 'failed')    return projects.filter((p) => p.status === 'failed' || p.status === 'partial_failed' || p.status === 'destroy_failed')
    return projects
  }, [projects, filter])

  // formatted "now"
  const nowText = useMemo(() => {
    const d = new Date()
    const fmt = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d)
    return `${fmt} KST`
  }, [])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root {
          --dx-bg: #0b0e17;
          --dx-ink: #edf0f6;
          --dx-ink-dim: #aeb4c5;
          --dx-ink-mute: #7a8298;
          --dx-line: rgba(255,255,255,0.08);
          --dx-line-2: rgba(255,255,255,0.13);
          --dx-line-3: rgba(255,255,255,0.20);
          --dx-orange: #ffa53d;
          --dx-blue: #5aa3ff;
          --dx-green: #6ee7a0;
          --dx-yellow: #f5d061;
          --dx-red: #ff7676;
          --dx-display: 'Plus Jakarta Sans', -apple-system, sans-serif;
          --dx-mono: 'JetBrains Mono', ui-monospace, monospace;
        }

        .dx-page {
          position: relative;
          padding: 40px 48px 80px;
          max-width: 1280px;
          margin: 0 auto;
          isolation: isolate;
          color: var(--dx-ink);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .dx-page::before {
          content: "";
          position: fixed; inset: 0; z-index: -1;
          background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, #000 30%, transparent 80%);
          opacity: 0.55;
          pointer-events: none;
        }

        /* Page head */
        .dx-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 1px solid var(--dx-line); gap: 16px; flex-wrap: wrap; }
        .dx-title-row { display: flex; align-items: center; gap: 14px; margin: 0 0 8px; }
        .dx-mark {
          width: 32px; height: 32px;
          display: grid; place-items: center;
          border-radius: 8px;
          background:
            radial-gradient(80% 80% at 30% 25%, rgba(255,165,61,0.7), transparent 60%),
            radial-gradient(80% 80% at 70% 80%, rgba(90,163,255,0.7), transparent 60%),
            #11151f;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: 0 4px 24px rgba(90,163,255,0.18), inset 0 0 12px rgba(255,255,255,0.06);
          position: relative; flex-shrink: 0;
        }
        .dx-mark::after { content: ""; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 10px; height: 10px; border-radius: 2px; background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.8); }
        .dx-title-row h1 { font-family: var(--dx-display); font-weight: 700; font-size: 28px; letter-spacing: -0.025em; margin: 0; color: var(--dx-ink); }
        .dx-meta { display: flex; align-items: center; gap: 14px; font-family: var(--dx-mono); font-size: 11.5px; font-weight: 500; color: var(--dx-ink-dim); letter-spacing: 0.08em; text-transform: uppercase; flex-wrap: wrap; }
        .dx-meta .pip { width: 6px; height: 6px; border-radius: 50%; background: var(--dx-green); box-shadow: 0 0 8px var(--dx-green); animation: dx-pulse 2s ease-in-out infinite; }
        .dx-meta .sep { width: 3px; height: 3px; border-radius: 50%; background: var(--dx-ink-mute); opacity: 0.6; }
        @keyframes dx-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.85); } }

        .dx-head-actions { display: flex; align-items: center; gap: 10px; }
        .dx-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 16px;
          font-family: inherit;
          font-size: 13px; font-weight: 600;
          border-radius: 10px;
          border: 1px solid var(--dx-line-2);
          background: rgba(255,255,255,0.04);
          color: var(--dx-ink);
          cursor: pointer;
          transition: background 160ms, border-color 160ms, transform 160ms;
        }
        .dx-btn:hover { background: rgba(255,255,255,0.08); border-color: var(--dx-line-3); }
        .dx-btn-primary { background: linear-gradient(180deg, #ffffff, #e8eaf0); color: #0a0d14; border-color: #f3f4f8; }
        .dx-btn-primary:hover { background: #fff; border-color: #fff; transform: translateY(-1px); box-shadow: 0 6px 24px -6px rgba(255,255,255,0.4), 0 0 24px -10px rgba(90,163,255,0.4); }
        .dx-btn .arrow { transition: transform 200ms; }
        .dx-btn:hover .arrow { transform: translateX(2px); }

        /* KPI */
        .dx-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 36px; }
        .dx-kpi {
          position: relative;
          padding: 22px 22px 20px;
          border-radius: 14px;
          border: 1px solid var(--dx-line-2);
          background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015));
          overflow: hidden;
          transition: border-color 220ms;
        }
        .dx-kpi:hover { border-color: var(--dx-line-3); }
        .dx-kpi::before {
          content: ""; position: absolute;
          top: 0; left: 22px; right: 22px;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--dx-accent, rgba(255,255,255,0.5)), transparent);
        }
        .dx-kpi[data-accent="orange"] { --dx-accent: var(--dx-orange); }
        .dx-kpi[data-accent="blue"]   { --dx-accent: var(--dx-blue); }
        .dx-kpi[data-accent="green"]  { --dx-accent: var(--dx-green); }
        .dx-kpi-label { display: flex; align-items: center; gap: 8px; font-family: var(--dx-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dx-ink-dim); margin-bottom: 14px; }
        .dx-kpi-label .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dx-accent, var(--dx-ink-mute)); box-shadow: 0 0 8px var(--dx-accent, transparent); }
        .dx-kpi-value { display: flex; align-items: baseline; gap: 6px; font-family: var(--dx-display); font-weight: 700; font-size: 36px; letter-spacing: -0.025em; line-height: 1; color: var(--dx-ink); }
        .dx-kpi-value .unit { font-family: inherit; font-size: 14px; color: var(--dx-ink-mute); font-weight: 500; }
        .dx-kpi-foot { margin-top: 14px; font-family: var(--dx-mono); font-size: 11.5px; color: var(--dx-ink-dim); }
        .dx-kpi-bar { margin-top: 12px; height: 3px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; }
        .dx-kpi-bar .fill { height: 100%; background: var(--dx-accent, var(--dx-ink-mute)); border-radius: 2px; transition: width 600ms cubic-bezier(.22,.8,.18,1); box-shadow: 0 0 10px var(--dx-accent, transparent); }

        /* Alert */
        .dx-alert {
          display: flex; gap: 10px; padding: 12px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255,118,118,0.3);
          background: rgba(255,118,118,0.06);
          color: var(--dx-red);
          font-size: 13px; line-height: 1.5;
          margin-bottom: 24px;
          align-items: center;
        }
        .dx-alert .ico { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; background: rgba(255,118,118,0.18); display: grid; place-items: center; font-family: var(--dx-mono); font-weight: 700; font-size: 11px; }
        .dx-alert .x { margin-left: auto; background: none; border: none; color: var(--dx-red); opacity: 0.6; cursor: pointer; font-family: var(--dx-mono); transition: opacity 160ms; }
        .dx-alert .x:hover { opacity: 1; }

        /* Table */
        .dx-table-card { border: 1px solid var(--dx-line-2); border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008)); overflow: hidden; }
        .dx-table-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--dx-line); background: rgba(255,255,255,0.01); gap: 12px; }
        .dx-table-head .title { display: flex; align-items: baseline; gap: 12px; }
        .dx-table-head .title h2 { font-family: var(--dx-display); font-weight: 700; font-size: 15px; margin: 0; letter-spacing: -0.015em; color: var(--dx-ink); }
        .dx-count { font-family: var(--dx-mono); font-size: 11px; color: var(--dx-ink-dim); letter-spacing: 0.1em; padding: 3px 8px; border-radius: 100px; border: 1px solid var(--dx-line-2); background: rgba(255,255,255,0.04); }
        .dx-filters { display: flex; gap: 6px; }
        .dx-chip {
          padding: 5px 12px;
          font-family: var(--dx-mono);
          font-size: 11.5px;
          font-weight: 500;
          letter-spacing: 0.05em;
          color: var(--dx-ink-dim);
          border: 1px solid var(--dx-line-2);
          border-radius: 100px;
          background: transparent;
          cursor: pointer;
          transition: color 160ms, background 160ms, border-color 160ms;
        }
        .dx-chip:hover { color: var(--dx-ink); border-color: var(--dx-line-3); }
        .dx-chip.active { color: var(--dx-ink); background: rgba(255,255,255,0.09); border-color: var(--dx-line-3); }

        .dx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .dx-table thead th { text-align: left; padding: 14px 16px; font-family: var(--dx-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dx-ink-dim); background: rgba(255,255,255,0.025); border-bottom: 1px solid var(--dx-line-2); }
        .dx-table thead th:first-child { padding-left: 22px; }
        .dx-table thead th:last-child { padding-right: 22px; text-align: right; }
        .dx-table tbody td { padding: 16px; border-bottom: 1px solid var(--dx-line); vertical-align: middle; }
        .dx-table tbody td:first-child { padding-left: 22px; }
        .dx-table tbody td:last-child { padding-right: 22px; }
        .dx-table tbody tr { transition: background 140ms; cursor: pointer; }
        .dx-table tbody tr:hover { background: rgba(255,255,255,0.025); }
        .dx-table tbody tr:last-child td { border-bottom: none; }

        .dx-proj .name { font-family: var(--dx-display); font-weight: 600; font-size: 14px; color: var(--dx-ink); letter-spacing: -0.01em; margin-bottom: 4px; }
        .dx-proj .meta { font-family: var(--dx-mono); font-size: 11.5px; color: var(--dx-ink-dim); letter-spacing: 0.02em; display: flex; align-items: center; gap: 8px; }
        .dx-proj .meta .dot-sep { width: 2px; height: 2px; border-radius: 50%; background: var(--dx-ink-mute); opacity: 0.6; }

        .dx-env { display: inline-flex; align-items: center; padding: 4px 10px; font-family: var(--dx-mono); font-size: 10.5px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 100px; border: 1px solid var(--dx-line-2); background: rgba(255,255,255,0.02); color: var(--dx-ink-dim); }
        .dx-env[data-env="prod"]       { color: var(--dx-orange); border-color: rgba(255,165,61,0.25);  background: rgba(255,165,61,0.05); }
        .dx-env[data-env="production"] { color: var(--dx-orange); border-color: rgba(255,165,61,0.25);  background: rgba(255,165,61,0.05); }
        .dx-env[data-env="stage"]      { color: var(--dx-yellow); border-color: rgba(245,208,97,0.25);  background: rgba(245,208,97,0.05); }
        .dx-env[data-env="staging"]    { color: var(--dx-yellow); border-color: rgba(245,208,97,0.25);  background: rgba(245,208,97,0.05); }
        .dx-env[data-env="dev"]        { color: var(--dx-blue);   border-color: rgba(90,163,255,0.25);  background: rgba(90,163,255,0.05); }
        .dx-env[data-env="development"]{ color: var(--dx-blue);   border-color: rgba(90,163,255,0.25);  background: rgba(90,163,255,0.05); }

        .dx-status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--dx-ink-dim); }
        .dx-status .pip { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .dx-status[data-tone="green"]  { color: var(--dx-green); }
        .dx-status[data-tone="green"] .pip  { background: var(--dx-green);  box-shadow: 0 0 8px var(--dx-green); }
        .dx-status[data-tone="blue"]   { color: var(--dx-blue); }
        .dx-status[data-tone="blue"] .pip   { background: var(--dx-blue);   box-shadow: 0 0 8px var(--dx-blue);   animation: dx-pulse 1.6s ease-in-out infinite; }
        .dx-status[data-tone="red"]    { color: var(--dx-red); }
        .dx-status[data-tone="red"] .pip    { background: var(--dx-red);    box-shadow: 0 0 8px var(--dx-red); }
        .dx-status[data-tone="yellow"] { color: var(--dx-yellow); }
        .dx-status[data-tone="yellow"] .pip { background: var(--dx-yellow); box-shadow: 0 0 8px var(--dx-yellow); }
        .dx-status[data-tone="orange"] { color: var(--dx-orange); }
        .dx-status[data-tone="orange"] .pip { background: var(--dx-orange); box-shadow: 0 0 8px var(--dx-orange); animation: dx-pulse 1.6s ease-in-out infinite; }
        .dx-status[data-tone="mute"] .pip { background: var(--dx-ink-mute); }

        .dx-ts { font-family: var(--dx-mono); font-size: 11.5px; color: var(--dx-ink-dim); letter-spacing: 0.01em; }
        .dx-ts .dim { color: var(--dx-ink-mute); }

        .dx-actions { display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
        .dx-ibtn {
          width: 30px; height: 30px;
          display: grid; place-items: center;
          border-radius: 8px;
          border: 1px solid var(--dx-line-2);
          background: rgba(255,255,255,0.02);
          color: var(--dx-ink-dim);
          cursor: pointer;
          transition: all 160ms;
          padding: 0;
        }
        .dx-ibtn:hover { color: var(--dx-ink); border-color: var(--dx-line-3); background: rgba(255,255,255,0.05); }
        .dx-ibtn[data-variant="blue"]:hover { color: var(--dx-blue); border-color: rgba(90,163,255,0.4); background: rgba(90,163,255,0.08); }
        .dx-ibtn[data-variant="red"]:hover { color: var(--dx-red); border-color: rgba(255,118,118,0.4); background: rgba(255,118,118,0.08); }
        .dx-ibtn[data-variant="orange"] { color: var(--dx-orange); border-color: rgba(255,165,61,0.3); background: rgba(255,165,61,0.06); }
        .dx-ibtn[data-variant="orange"]:hover { background: rgba(255,165,61,0.15); border-color: rgba(255,165,61,0.5); }
        .dx-ibtn:disabled { opacity: 0.35; cursor: not-allowed; }
        .dx-ibtn:disabled:hover { color: var(--dx-ink-mute); border-color: var(--dx-line-2); background: rgba(255,255,255,0.02); }

        .dx-confirm { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,118,118,0.3); background: rgba(255,118,118,0.05); }
        .dx-confirm-check { display: flex; align-items: center; gap: 8px; font-family: var(--dx-mono); font-size: 11px; color: var(--dx-ink-dim); cursor: pointer; user-select: none; letter-spacing: 0.02em; }
        .dx-confirm-check input { display: none; }
        .dx-confirm-check .cb { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--dx-line-3); background: rgba(255,255,255,0.03); display: grid; place-items: center; transition: all 200ms; }
        .dx-confirm-check .cb svg { opacity: 0; color: #fff; }
        .dx-confirm-check input:checked + .cb { background: var(--dx-red); border-color: var(--dx-red); }
        .dx-confirm-check input:checked + .cb svg { opacity: 1; }
        .dx-confirm-btns { display: flex; gap: 6px; }
        .dx-btn-danger { padding: 6px 12px; font-family: var(--dx-display); font-size: 11.5px; font-weight: 600; border-radius: 8px; border: 1px solid var(--dx-red); background: var(--dx-red); color: #fff; cursor: pointer; transition: filter 160ms; }
        .dx-btn-danger:hover { filter: brightness(1.1); }
        .dx-btn-ghost { padding: 6px 12px; font-family: inherit; font-size: 11.5px; font-weight: 500; border-radius: 8px; border: 1px solid var(--dx-line-2); background: transparent; color: var(--dx-ink-dim); cursor: pointer; transition: all 160ms; }
        .dx-btn-ghost:hover { color: var(--dx-ink); background: rgba(255,255,255,0.05); }

        .dx-empty { padding: 80px 24px; text-align: center; }
        .dx-empty-mark { width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 14px; border: 1px dashed var(--dx-line-3); display: grid; place-items: center; color: var(--dx-ink-mute); }
        .dx-empty-title { font-family: var(--dx-display); font-weight: 600; font-size: 16px; color: var(--dx-ink); margin: 0 0 6px; letter-spacing: -0.01em; }
        .dx-empty-sub { font-size: 13px; color: var(--dx-ink-dim); margin: 0 0 22px; }

        .dx-loading { padding: 80px 24px; text-align: center; font-family: var(--dx-mono); font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--dx-ink-mute); display: flex; align-items: center; justify-content: center; gap: 12px; }
        .dx-loading .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--dx-blue); animation: dx-spin 700ms linear infinite; }
        @keyframes dx-spin { to { transform: rotate(360deg); } }

        /* Toast */
        .dx-toast {
          position: fixed; bottom: 24px; right: 24px; z-index: 100;
          min-width: 320px; max-width: 400px;
          padding: 16px 18px;
          border-radius: 14px;
          border: 1px solid rgba(110,231,160,0.3);
          background: linear-gradient(135deg, rgba(15,45,31,0.95), rgba(13,31,23,0.95));
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          box-shadow: 0 20px 60px -20px rgba(0,0,0,0.6), 0 0 40px -10px rgba(110,231,160,0.2);
          display: flex; gap: 12px;
          overflow: hidden;
          animation: dx-slideUp 300ms cubic-bezier(.22,.8,.18,1);
        }
        .dx-toast-ico { flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; background: rgba(110,231,160,0.15); border: 1px solid rgba(110,231,160,0.3); display: grid; place-items: center; color: var(--dx-green); }
        .dx-toast-body { flex: 1; min-width: 0; }
        .dx-toast-title { font-family: var(--dx-display); font-weight: 600; font-size: 14px; color: var(--dx-ink); margin: 0 0 4px; letter-spacing: -0.01em; }
        .dx-toast-msg { font-size: 12.5px; color: var(--dx-green); margin: 0; line-height: 1.4; }
        .dx-toast-x { background: none; border: none; color: var(--dx-ink-mute); cursor: pointer; font-family: var(--dx-mono); transition: color 160ms; flex-shrink: 0; }
        .dx-toast-x:hover { color: var(--dx-ink); }
        .dx-toast-bar { position: absolute; bottom: 0; left: 0; height: 2px; background: var(--dx-green); box-shadow: 0 0 8px var(--dx-green); animation: dx-shrink 4s linear forwards; }
        @keyframes dx-slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes dx-shrink { from { width: 100%; } to { width: 0%; } }

        @media (max-width: 1024px) {
          .dx-kpi-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 720px) {
          .dx-page { padding: 28px 20px 60px; }
          .dx-head { flex-direction: column; align-items: stretch; gap: 16px; }
          .dx-kpi-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
          .dx-kpi-value { font-size: 28px; }
          .dx-table { font-size: 12px; }
          .dx-table thead th, .dx-table tbody td { padding: 12px 10px; }
          .dx-filters { display: none; }
        }
      `}</style>

      <div className="dx-page">

        {/* Page header */}
        <div className="dx-head">
          <div>
            <div className="dx-title-row">
              <span className="dx-mark"></span>
              <h1>Dashboard</h1>
            </div>
            <div className="dx-meta">
              <span className="pip"></span>
              <span>All systems operational</span>
              <span className="sep"></span>
              <span>{nowText}</span>
            </div>
          </div>
          <div className="dx-head-actions">
            <button className="dx-btn" onClick={fetchProjects} disabled={isLoading}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
              </svg>
              새로고침
            </button>
            <button className="dx-btn dx-btn-primary" onClick={() => router.push('/projects/new')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              새 프로젝트
              <span className="arrow">→</span>
            </button>
          </div>
        </div>

        {/* KPI grid */}
        <div className="dx-kpi-grid">
          <div className="dx-kpi">
            <div className="dx-kpi-label">
              <span className="dot" style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 0 8px rgba(255,255,255,0.3)' }}></span>
              Projects
            </div>
            <div className="dx-kpi-value">
              {projects.length}<span className="unit">개</span>
            </div>
            <div className="dx-kpi-foot">
              {activeCount} active · {projects.length - activeCount} other
            </div>
          </div>

          <div className="dx-kpi" data-accent="orange">
            <div className="dx-kpi-label">
              <span className="dot"></span>
              AWS Resources · CraftOps
            </div>
            <div className="dx-kpi-value">
              {totalAws}<span className="unit">개</span>
            </div>
            <div className="dx-kpi-foot">{regionsText}</div>
          </div>

          <div className="dx-kpi" data-accent="blue">
            <div className="dx-kpi-label">
              <span className="dot"></span>
              GCP DR · MirrorOps
            </div>
            <div className="dx-kpi-value">
              {totalDrLive}<span className="unit">/ {totalDrAvail}</span>
            </div>
            <div className="dx-kpi-foot">{drReadyCount} of {projects.length} mirrored</div>
          </div>

          <div className="dx-kpi" data-accent="green">
            <div className="dx-kpi-label">
              <span className="dot"></span>
              DR Ready Rate
            </div>
            <div className="dx-kpi-value">
              {drReadyRate}<span className="unit">%</span>
            </div>
            <div className="dx-kpi-bar">
              <div className="fill" style={{ width: `${drReadyRate}%` }} />
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="dx-alert" role="alert">
            <span className="ico">!</span>
            <span>{error}</span>
            <button className="x" onClick={() => setError(null)} aria-label="닫기">✕</button>
          </div>
        )}

        {/* Projects table */}
        <div className="dx-table-card">
          <div className="dx-table-head">
            <div className="title">
              <h2>프로젝트 목록</h2>
              <span className="dx-count">{filtered.length} {filter === 'all' ? 'total' : filter}</span>
            </div>
            <div className="dx-filters">
              {(['all', 'active', 'deploying', 'failed'] as FilterKey[]).map((k) => (
                <button
                  key={k}
                  className={`dx-chip ${filter === k ? 'active' : ''}`}
                  onClick={() => setFilter(k)}
                >
                  {k === 'all' ? 'All' : k === 'active' ? 'Active' : k === 'deploying' ? 'Deploying' : 'Failed'}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="dx-loading">
              <span className="spinner"></span>
              <span>loading projects</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="dx-empty">
              <div className="dx-empty-mark">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </div>
              <h3 className="dx-empty-title">
                {projects.length === 0 ? '아직 프로젝트가 없습니다' : `이 조건에 맞는 프로젝트가 없습니다`}
              </h3>
              <p className="dx-empty-sub">
                {projects.length === 0
                  ? '첫 프로젝트를 만들고 AWS·GCP 듀얼 환경을 시작해보세요.'
                  : '다른 필터를 선택해보세요.'}
              </p>
              {projects.length === 0 && (
                <button className="dx-btn dx-btn-primary" onClick={() => router.push('/projects/new')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  새 프로젝트 만들기
                </button>
              )}
            </div>
          ) : (
            <table className="dx-table">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>환경</th>
                  <th>배포 상태</th>
                  <th>DR 상태</th>
                  <th>마지막 배포</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const deployConf = STATUS_CONFIG[p.status]       ?? { text: p.status,    tone: 'mute' as Tone }
                  const drConf     = DR_STATUS_CONFIG[p.dr_status] ?? { text: p.dr_status, tone: 'mute' as Tone }
                  const isConfirmingDelete = deletingId === p.project_id
                  const drReady = p.dr_status === 'ready'

                  // format last_deployed_at as: YYYY-MM-DD HH:MM
                  let dateStr = '—'
                  let timeStr = ''
                  if (p.last_deployed_at) {
                    const d = new Date(p.last_deployed_at)
                    const pad = (n: number) => String(n).padStart(2, '0')
                    dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
                    timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`
                  }

                  return (
                    <tr
                      key={p.project_id}
                      onClick={() => {
                        if (isConfirmingDelete) return
                        router.push(`/projects/${p.project_id}`)
                      }}
                    >
                      <td>
                        <div className="dx-proj">
                          <div className="name">{p.name}</div>
                          <div className="meta">
                            <span>{p.prefix}-{p.environment}</span>
                            <span className="dot-sep"></span>
                            <span>{p.region}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="dx-env" data-env={p.environment}>{p.environment}</span>
                      </td>
                      <td>
                        <span className="dx-status" data-tone={deployConf.tone}>
                          <span className="pip"></span>
                          {deployConf.text}
                        </span>
                      </td>
                      <td>
                        <span className="dx-status" data-tone={drConf.tone}>
                          <span className="pip"></span>
                          {drConf.text}
                        </span>
                      </td>
                      <td>
                        <span className="dx-ts">
                          {dateStr}{timeStr && <> <span className="dim">{timeStr}</span></>}
                        </span>
                      </td>
                      <td>
                        <div className="dx-actions" onClick={(e) => e.stopPropagation()}>
                          {!isConfirmingDelete ? (
                            <>
                              <button
                                className="dx-ibtn"
                                data-variant="blue"
                                title="MirrorOps DR 대시보드"
                                onClick={() => router.push(`/projects/${p.project_id}/mirror`)}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                                  <path d="M12 3v18"/>
                                </svg>
                              </button>
                              <button
                                className="dx-ibtn"
                                data-variant="orange"
                                disabled={!drReady}
                                title={drReady ? '페일오버 콘솔' : 'DR이 준비되어야 페일오버 가능'}
                                onClick={() => router.push(`/projects/${p.project_id}/failover`)}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                                </svg>
                              </button>
                              <button
                                className="dx-ibtn"
                                data-variant="red"
                                title="프로젝트 삭제"
                                onClick={() => setDeletingId(p.project_id)}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                                </svg>
                              </button>
                            </>
                          ) : (
                            <div className="dx-confirm">
                              <label className="dx-confirm-check">
                                <input
                                  type="checkbox"
                                  checked={destroyAws}
                                  onChange={(e) => setDestroyAws(e.target.checked)}
                                />
                                <span className="cb">
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                </span>
                                AWS 리소스도 삭제
                              </label>
                              <div className="dx-confirm-btns">
                                <button
                                  className="dx-btn-ghost"
                                  onClick={() => { setDeletingId(null); setDestroyAws(false) }}
                                >
                                  취소
                                </button>
                                <button
                                  className="dx-btn-danger"
                                  onClick={() => handleDelete(p.project_id)}
                                >
                                  영구 삭제
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && <DeployToast data={toast} onClose={closeToast} />}
    </>
  )
}
