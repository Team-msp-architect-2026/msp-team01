// frontend/hooks/useMirrorOps.ts
import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/lib/api'
import {
  DRStatus, ResourceMapping, DRPackageResponse, SyncHistory
} from '@/types/mirror'

export function useDRStatus(projectId: string) {
  const [data, setData] = useState<DRStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/mirror/${projectId}/status`)
      setData(res.data.data)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetch()
    // 10초마다 폴링 (dr_status 변화 감지)
    const interval = setInterval(fetch, 10000)
    return () => clearInterval(interval)
  }, [fetch])

  return { data, isLoading, refetch: fetch }
}

export function useResourceMappings(projectId: string) {
  const [data, setData] = useState<ResourceMapping[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    apiClient.get(`/api/mirror/${projectId}/resources`).then((res) => {
      setData(res.data.data)
      setIsLoading(false)
    })
  }, [projectId])

  return { data, isLoading }
}

export function useDRPackage(projectId: string) {
  const [data, setData] = useState<DRPackageResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetch = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/mirror/${projectId}/package`)
      setData(res.data.data)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { data, isLoading, refetch: fetch }
}

export function useSyncHistory(projectId: string) {
  const [data, setData] = useState<SyncHistory[]>([])

  useEffect(() => {
    apiClient
      .get(`/api/mirror/${projectId}/sync-history`)
      .then((res) => setData(res.data.data))
  }, [projectId])

  return { data }
}