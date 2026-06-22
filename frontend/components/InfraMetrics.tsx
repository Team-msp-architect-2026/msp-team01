// frontend/components/InfraMetrics.tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

type Period = '1h' | '6h' | '24h' | '7d'

interface DataPoint {
  timestamp: string
  value: number
}

interface MetricsData {
  project_id: string
  period: Period
  region: string
  resources: {
    ecs_cluster?: string
    ecs_service?: string
    alb?: string
    rds?: string
  }
  metrics: {
    ecs?: { cpu: DataPoint[]; memory: DataPoint[] }
    alb?: { request_count: DataPoint[]; response_time: DataPoint[]; error_5xx: DataPoint[] }
    rds?: { cpu: DataPoint[]; connections: DataPoint[]; storage_free_gb: DataPoint[] }
  }
  message?: string
}

interface Props {
  projectId: string
}

const PERIODS: { value: Period; label: string }[] = [
  { value: '1h',  label: '1시간' },
  { value: '6h',  label: '6시간' },
  { value: '24h', label: '24시간' },
  { value: '7d',  label: '7일' },
]

function formatTimestamp(ts: string, period: Period): string {
  const d = new Date(ts)
  if (period === '1h' || period === '6h') {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }
  if (period === '24h') {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit' })
}

function toChartData(series: DataPoint[], period: Period, key: string) {
  return series.map(p => ({
    time: formatTimestamp(p.timestamp, period),
    [key]: p.value,
  }))
}

function MetricPanel({
  title,
  subtitle,
  children,
  isEmpty,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  isEmpty?: boolean
}) {
  return (
    <div style={{
      background: '#13151f',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '10px',
      padding: '16px',
    }}>
      <div style={{ marginBottom: '12px' }}>
        <span style={{ color: '#edf0f6', fontSize: '13px', fontWeight: 600 }}>{title}</span>
        {subtitle && (
          <span style={{ color: '#475569', fontSize: '11px', marginLeft: '6px' }}>{subtitle}</span>
        )}
      </div>
      {isEmpty ? (
        <div style={{
          height: '150px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#475569', fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          데이터 없음
        </div>
      ) : children}
    </div>
  )
}

export default function InfraMetrics({ projectId }: Props) {
  const [period, setPeriod]     = useState<Period>('1h')
  const [data, setData]         = useState<MetricsData | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg]   = useState<string | null>(null)

  const fetchMetrics = useCallback(async (p: Period) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get(
        `/api/projects/${projectId}/metrics?period=${p}`
      )
      setData(res.data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchMetrics(period) }, [period, fetchMetrics])

  const handleRescan = async () => {
    setScanning(true)
    setScanMsg(null)
    try {
      await apiClient.post(`/api/craft/${projectId}/rescan`)
      setScanMsg('스캔 중... 30초 후 자동 갱신됩니다')
      setTimeout(() => {
        fetchMetrics(period)
        setScanning(false)
        setScanMsg(null)
      }, 30000)
    } catch {
      setScanning(false)
      setScanMsg('스캔 요청 실패')
    }
  }

  const C = {
    cpu:        '#6366f1',
    memory:     '#22d3ee',
    requests:   '#10b981',
    respTime:   '#f59e0b',
    error5xx:   '#ef4444',
    connections:'#a78bfa',
    storage:    '#34d399',
  }

  const tooltipStyle = {
    backgroundColor: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '12px',
  }

  const fmt = (fn: (n: number) => [string, string]) => (v: any): [string, string] => {
    const n = typeof v === 'number' ? v : 0
    return fn(n)
  }

  const sectionLabel = (text: string) => (
    <div style={{
      color: '#64748b',
      fontSize: '11px',
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      marginBottom: '10px',
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {text}
    </div>
  )

  const btnBase: React.CSSProperties = {
    padding: '5px 12px',
    borderRadius: '7px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'transparent',
    color: '#475569',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    transition: 'all 150ms',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* 기간 선택 + 새로고침 + 수동 스캔 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          color: '#64748b', fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {data?.resources?.ecs_cluster && (
            <span>
              cluster: <span style={{ color: '#94a3b8' }}>{data.resources.ecs_cluster}</span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {PERIODS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              style={{
                ...btnBase,
                border: period === value
                  ? '1px solid rgba(99,102,241,0.6)'
                  : '1px solid rgba(255,255,255,0.08)',
                background: period === value ? 'rgba(99,102,241,0.12)' : 'transparent',
                color: period === value ? '#818cf8' : '#475569',
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => fetchMetrics(period)}
            disabled={loading}
            style={{ ...btnBase, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? '...' : '↻'}
          </button>
          <button
            onClick={handleRescan}
            disabled={scanning}
            style={{
              ...btnBase,
              border: scanning ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.13)',
              background: scanning ? 'rgba(99,102,241,0.10)' : 'transparent',
              color: scanning ? '#818cf8' : '#7a8298',
              cursor: scanning ? 'not-allowed' : 'pointer',
            }}
          >
            {scanning ? '스캔 중...' : '수동 스캔'}
          </button>
        </div>
      </div>

      {/* 스캔 메시지 */}
      {scanMsg && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.18)',
          color: '#a5b4fc',
          fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {scanMsg}
        </div>
      )}

      {/* 에러 */}
      {error && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          color: '#fca5a5',
          fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {error}
        </div>
      )}

      {/* 메시지 */}
      {data?.message && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.18)',
          color: '#a5b4fc',
          fontSize: '12px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {data.message}
        </div>
      )}

      {/* ── ECS ── */}
      {data?.resources?.ecs_cluster && (
        <div>
          {sectionLabel(`ECS · ${data.resources.ecs_service || ''}`)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

            <MetricPanel title="CPU 사용률" subtitle="%" isEmpty={!data.metrics.ecs?.cpu?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={toChartData(data.metrics.ecs?.cpu ?? [], period, 'v')}>
                  <defs>
                    <linearGradient id="gc1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.cpu} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.cpu} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n.toFixed(1)}%`, 'CPU'])} />
                  <Area type="monotone" dataKey="v" stroke={C.cpu} fill="url(#gc1)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </MetricPanel>

            <MetricPanel title="Memory 사용률" subtitle="%" isEmpty={!data.metrics.ecs?.memory?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={toChartData(data.metrics.ecs?.memory ?? [], period, 'v')}>
                  <defs>
                    <linearGradient id="gc2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.memory} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.memory} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n.toFixed(1)}%`, 'Memory'])} />
                  <Area type="monotone" dataKey="v" stroke={C.memory} fill="url(#gc2)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </MetricPanel>
          </div>
        </div>
      )}

      {/* ── ALB ── */}
      {data?.resources?.alb && (
        <div>
          {sectionLabel('ALB')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>

            <MetricPanel title="요청 수" subtitle="건/구간" isEmpty={!data.metrics.alb?.request_count?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={toChartData(data.metrics.alb?.request_count ?? [], period, 'v')}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n}건`, '요청'])} />
                  <Line type="monotone" dataKey="v" stroke={C.requests} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </MetricPanel>

            <MetricPanel title="응답 시간" subtitle="ms" isEmpty={!data.metrics.alb?.response_time?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={toChartData(data.metrics.alb?.response_time ?? [], period, 'v')}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${(n * 1000).toFixed(0)}ms`, '응답'])} />
                  <Line type="monotone" dataKey="v" stroke={C.respTime} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </MetricPanel>

            <MetricPanel title="5xx 에러" subtitle="건/구간" isEmpty={!data.metrics.alb?.error_5xx?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={toChartData(data.metrics.alb?.error_5xx ?? [], period, 'v')}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n}건`, '5xx'])} />
                  <Line type="monotone" dataKey="v" stroke={C.error5xx} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </MetricPanel>
          </div>
        </div>
      )}

      {/* ── RDS ── */}
      {data?.resources?.rds && (
        <div>
          {sectionLabel(`RDS · ${data.resources.rds}`)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>

            <MetricPanel title="CPU 사용률" subtitle="%" isEmpty={!data.metrics.rds?.cpu?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={toChartData(data.metrics.rds?.cpu ?? [], period, 'v')}>
                  <defs>
                    <linearGradient id="gc3" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.cpu} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.cpu} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n.toFixed(1)}%`, 'CPU'])} />
                  <Area type="monotone" dataKey="v" stroke={C.cpu} fill="url(#gc3)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </MetricPanel>

            <MetricPanel title="DB 커넥션" subtitle="개" isEmpty={!data.metrics.rds?.connections?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={toChartData(data.metrics.rds?.connections ?? [], period, 'v')}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n.toFixed(0)}개`, '커넥션'])} />
                  <Line type="monotone" dataKey="v" stroke={C.connections} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </MetricPanel>

            <MetricPanel title="여유 스토리지" subtitle="GB" isEmpty={!data.metrics.rds?.storage_free_gb?.length}>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={toChartData(data.metrics.rds?.storage_free_gb ?? [], period, 'v')}>
                  <defs>
                    <linearGradient id="gc4" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.storage} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.storage} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#334155', fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={fmt(n => [`${n.toFixed(1)}GB`, '여유'])} />
                  <Area type="monotone" dataKey="v" stroke={C.storage} fill="url(#gc4)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </MetricPanel>
          </div>
        </div>
      )}

      {/* 배포 전 안내 */}
      {!loading && !error && !data?.resources?.ecs_cluster && !data?.resources?.alb && !data?.resources?.rds && (
        <div style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: '#334155',
          fontSize: '13px',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          배포 완료 후 모니터링이 활성화됩니다
        </div>
      )}
    </div>
  )
}