import { useEffect, useRef, useState, useCallback } from 'react'
import { WSEvent } from '@/types'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(
  projectId: string | null,
  deploymentId: string | null,
  // [추가] failover 등 다른 용도로 파라미터 이름 변경 가능
  idParamName: string = 'deployment_id'
) {
  const ws            = useRef<WebSocket | null>(null)
  const [events, setEvents]           = useState<WSEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent]     = useState<WSEvent | null>(null)

  const connect = useCallback(() => {
    if (!projectId || !deploymentId) return

    const token = localStorage.getItem('access_token')
    // [수정] idParamName을 동적으로 사용
    const url = `${WS_BASE}/ws/events/${projectId}?${idParamName}=${deploymentId}&token=${token}`

    ws.current = new WebSocket(url)
    ws.current.onopen    = () => setIsConnected(true)
    ws.current.onmessage = (e) => {
      const event: WSEvent = JSON.parse(e.data)
      setLastEvent(event)
      setEvents((prev) => [...prev, event])
    }
    ws.current.onclose = () => setIsConnected(false)
    ws.current.onerror = () => setIsConnected(false)
  }, [projectId, deploymentId, idParamName])

  const disconnect = useCallback(() => {
    ws.current?.close()
    setIsConnected(false)
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { events, isConnected, lastEvent, connect, disconnect }
}