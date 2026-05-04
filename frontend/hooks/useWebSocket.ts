// frontend/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react'
import { WSEvent } from '@/types'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'

export function useWebSocket(
  projectId: string | null,
  deploymentId: string | null
) {
  const ws = useRef<WebSocket | null>(null)
  const [events, setEvents] = useState<WSEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null)

  const connect = useCallback(() => {
    if (!projectId || !deploymentId) return

    const token = localStorage.getItem('access_token')
    const url = `${WS_BASE}/ws/events/${projectId}?deployment_id=${deploymentId}&token=${token}`

    ws.current = new WebSocket(url)

    ws.current.onopen = () => setIsConnected(true)

    ws.current.onmessage = (e) => {
      const event: WSEvent = JSON.parse(e.data)
      setLastEvent(event)
      setEvents((prev) => [...prev, event])
    }

    ws.current.onclose = () => setIsConnected(false)
    ws.current.onerror = () => setIsConnected(false)
  }, [projectId, deploymentId])

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